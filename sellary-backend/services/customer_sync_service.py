from decimal import Decimal

from sqlalchemy.orm import Session

from core.idempotency import IdempotencyConflictError, IdempotencyService
from models.company import Company
from models.customer import Customer
from models.user import User
from schemas.customer_ledger import CustomerPaymentCreate
from schemas.sale import PaymentMethod as SchemaPaymentMethod
from schemas.sync import (
    SyncCustomerCreate,
    SyncCustomerResult,
    SyncCustomersRequest,
    SyncCustomersResponse,
    SyncPaymentCreate,
    SyncPaymentResult,
    SyncPaymentsRequest,
    SyncPaymentsResponse,
    SyncPaymentWarning,
)
from services.customer_ledger_service import CustomerLedgerService


PAYMENTS_ENDPOINT = "/api/sync/payments"
ZERO = Decimal("0.00")


class CustomerSyncService:
    def __init__(self, db: Session):
        self.db = db

    # ---- C2: batch customer upsert -------------------------------------
    def sync_customers(
        self, company: Company, user: User, request: SyncCustomersRequest
    ) -> SyncCustomersResponse:
        results = [self._upsert_customer(company, item) for item in request.customers]
        return SyncCustomersResponse(results=results)

    def _upsert_customer(
        self, company: Company, item: SyncCustomerCreate
    ) -> SyncCustomerResult:
        try:
            by_client = (
                self.db.query(Customer)
                .filter(
                    Customer.company_id == company.id,
                    Customer.client_customer_id == item.client_customer_id,
                )
                .first()
            )
            if by_client:
                # Idempotent replay — this client id was already pushed.
                return SyncCustomerResult(
                    client_customer_id=item.client_customer_id,
                    status="duplicate",
                    server_id=by_client.id,
                )

            if item.phone:
                by_phone = (
                    self.db.query(Customer)
                    .filter(
                        Customer.company_id == company.id,
                        Customer.phone == item.phone,
                        Customer.is_active == True,  # noqa: E712
                    )
                    .first()
                )
                if by_phone:
                    if by_phone.client_customer_id is None:
                        with self.db.begin_nested():
                            by_phone.client_customer_id = item.client_customer_id
                        return SyncCustomerResult(
                            client_customer_id=item.client_customer_id,
                            status="synced",
                            server_id=by_phone.id,
                        )
                    # Phone already mapped to another device's client id — do not
                    # overwrite; return the known server id.
                    return SyncCustomerResult(
                        client_customer_id=item.client_customer_id,
                        status="duplicate",
                        server_id=by_phone.id,
                    )

            with self.db.begin_nested():
                customer = Customer(
                    company_id=company.id,
                    client_customer_id=item.client_customer_id,
                    name=item.name,
                    phone=item.phone,
                    email=item.email,
                    address=item.address,
                    description=item.description,
                    is_active=True,
                )
                self.db.add(customer)
                self.db.flush()
            return SyncCustomerResult(
                client_customer_id=item.client_customer_id,
                status="synced",
                server_id=customer.id,
            )
        except Exception as exc:  # savepoint already rolled back; batch continues
            return SyncCustomerResult(
                client_customer_id=item.client_customer_id,
                status="failed",
                error=str(exc),
            )

    # ---- C5: batch debt payments (cap-to-balance) ----------------------
    def sync_payments(
        self, company: Company, user: User, request: SyncPaymentsRequest
    ) -> SyncPaymentsResponse:
        results = [
            self._process_payment(company, user, item) for item in request.payments
        ]
        return SyncPaymentsResponse(results=results)

    def _process_payment(
        self, company: Company, user: User, item: SyncPaymentCreate
    ) -> SyncPaymentResult:
        idempotency = IdempotencyService(self.db)
        request_body = item.model_dump()

        try:
            cached = idempotency.get_cached_response(
                key=item.idempotency_key,
                company_id=company.id,
                user_id=user.id,
                endpoint=PAYMENTS_ENDPOINT,
                request_body=request_body,
            )
            if cached:
                body, _ = cached
                return SyncPaymentResult(
                    client_payment_id=item.client_payment_id,
                    status="duplicate",
                    applied_amount=Decimal(str(body.get("applied_amount", "0.00"))),
                )
        except IdempotencyConflictError:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id, status="duplicate"
            )

        method = item.payment_method.lower()
        if method not in ("cash", "card", "mobile"):
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="failed",
                error=f"Invalid payment_method: {item.payment_method}",
            )

        customer = (
            self.db.query(Customer)
            .filter(
                Customer.company_id == company.id,
                Customer.client_customer_id == item.client_customer_id,
                Customer.is_active == True,  # noqa: E712
            )
            .first()
        )
        if not customer:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="failed",
                error=f"Customer not synced: {item.client_customer_id}",
            )

        ledger = CustomerLedgerService(self.db, company.id)
        balance = ledger.get_customer_balance(customer.id)
        requested = Decimal(item.amount).quantize(Decimal("0.01"))
        applied = min(requested, balance) if balance > ZERO else ZERO

        warnings: list[SyncPaymentWarning] = []
        if applied < requested:
            warnings.append(
                SyncPaymentWarning(
                    type="overpayment", requested=requested, applied=applied
                )
            )

        if applied <= ZERO:
            # Nothing to apply, but record idempotency so a re-push is a duplicate.
            return self._store_and_result(
                idempotency, company, user, item, request_body, ZERO, warnings
            )

        try:
            with self.db.begin_nested():
                ledger.record_payment(
                    customer.id,
                    CustomerPaymentCreate(
                        amount=applied,
                        payment_method=SchemaPaymentMethod(method),
                        description=item.description,
                    ),
                    user.id,
                )
        except Exception as exc:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="failed",
                error=str(exc),
            )

        return self._store_and_result(
            idempotency, company, user, item, request_body, applied, warnings
        )

    def _store_and_result(
        self,
        idempotency: IdempotencyService,
        company: Company,
        user: User,
        item: SyncPaymentCreate,
        request_body: dict,
        applied: Decimal,
        warnings: list[SyncPaymentWarning],
    ) -> SyncPaymentResult:
        try:
            idempotency.store_response(
                key=item.idempotency_key,
                company_id=company.id,
                user_id=user.id,
                endpoint=PAYMENTS_ENDPOINT,
                request_body=request_body,
                response_body={"applied_amount": str(applied)},
                status_code=201,
            )
        except IdempotencyConflictError:
            return SyncPaymentResult(
                client_payment_id=item.client_payment_id,
                status="duplicate",
                applied_amount=applied,
            )
        return SyncPaymentResult(
            client_payment_id=item.client_payment_id,
            status="synced",
            applied_amount=applied,
            warnings=warnings or None,
        )
