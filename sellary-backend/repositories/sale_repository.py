from decimal import Decimal, InvalidOperation
from sqlalchemy import String, case, cast, func, or_, select
from sqlalchemy.orm import Session, joinedload
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn
from models.customer_ledger_entry import CustomerLedgerEntry, CustomerLedgerEntryType
from models.product import Product
from models.customer import Customer
from models.user import User
from typing import Optional, List, Tuple
from datetime import datetime


# A cancelled sale is money that never happened: it is excluded from every
# turnover figure. Returned/partially-returned sales stay in — the sale did
# happen, and the refund is subtracted separately.
NON_CANCELLED_STATUSES = [SaleStatus.COMPLETED, SaleStatus.PARTIALLY_RETURNED, SaleStatus.RETURNED]


class SaleRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, company_id: int, sale_id: int) -> Optional[Sale]:
        return (
            self.db.query(Sale)
            .options(joinedload(Sale.items), joinedload(Sale.customer), joinedload(Sale.cashier))
            .filter(Sale.company_id == company_id, Sale.id == sale_id)
            .first()
        )

    def get_by_id_for_update(self, company_id: int, sale_id: int) -> Optional[Sale]:
        return (
            self.db.query(Sale)
            .filter(Sale.company_id == company_id, Sale.id == sale_id)
            .with_for_update()
            .first()
        )

    def get_sale_items_for_update(self, sale_id: int) -> List[SaleItem]:
        return (
            self.db.query(SaleItem)
            .filter(SaleItem.sale_id == sale_id)
            .order_by(SaleItem.id)
            .with_for_update()
            .all()
        )

    def refund_totals_subquery(self, company_id: int):
        """Per-sale refund totals, for subtracting from gross turnover.

        The single definition of "how much of this sale came back". Both the
        sales list summary and every report read it, so the two can never drift
        into disagreeing about the same number.
        """
        return (
            self.db.query(
                SaleReturn.sale_id,
                func.coalesce(func.sum(SaleReturn.total_refund_amount), Decimal("0.00")).label(
                    "refund_total"
                ),
            )
            .join(Sale, Sale.id == SaleReturn.sale_id)
            .filter(
                SaleReturn.company_id == company_id,
                Sale.status.in_(NON_CANCELLED_STATUSES),
            )
            .group_by(SaleReturn.sale_id)
            .subquery()
        )

    def _apply_filters(
        self,
        query,
        company_id: int,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        cashier_id: Optional[int] = None,
        status: Optional[SaleStatus] = None,
        search_terms: Optional[List[str]] = None,
        status_group: Optional[str] = None,
        payment_method: Optional[PaymentMethod] = None,
    ):
        """Narrow `query` to the sales the caller asked for.

        Shared by get_all and get_summary so the list and its KPI cards can
        never describe different sets of sales.
        """
        query = query.filter(Sale.company_id == company_id)

        if start_date:
            query = query.filter(Sale.created_at >= start_date)
        if end_date:
            query = query.filter(Sale.created_at <= end_date)
        if cashier_id:
            query = query.filter(Sale.cashier_id == cashier_id)
        if status:
            query = query.filter(Sale.status == status)
        if payment_method:
            query = query.filter(Sale.payment_method == payment_method)
        if status_group == "returns":
            query = query.filter(
                Sale.status.in_([SaleStatus.RETURNED, SaleStatus.PARTIALLY_RETURNED])
            )
        if search_terms:
            conditions = []
            item_count = (
                select(func.count(SaleItem.id))
                .where(SaleItem.sale_id == Sale.id)
                .correlate(Sale)
                .scalar_subquery()
            )
            total_base_quantity = (
                select(func.coalesce(func.sum(SaleItem.quantity), 0))
                .where(SaleItem.sale_id == Sale.id)
                .correlate(Sale)
                .scalar_subquery()
            )
            total_sold_quantity = (
                select(func.coalesce(func.sum(SaleItem.sold_quantity), 0))
                .where(SaleItem.sale_id == Sale.id)
                .correlate(Sale)
                .scalar_subquery()
            )
            for term in search_terms:
                pattern = f"%{term}%"
                term_conditions = [
                    cast(Sale.id, String).ilike(pattern),
                    cast(Sale.created_at, String).ilike(pattern),
                    cast(Sale.voided_at, String).ilike(pattern),
                    cast(Sale.subtotal, String).ilike(pattern),
                    cast(Sale.tax_amount, String).ilike(pattern),
                    cast(Sale.discount_amount, String).ilike(pattern),
                    cast(Sale.total_amount, String).ilike(pattern),
                    cast(Sale.payment_method, String).ilike(pattern),
                    cast(Sale.card_type, String).ilike(pattern),
                    cast(Sale.status, String).ilike(pattern),
                    Sale.notes.ilike(pattern),
                    Sale.void_reason.ilike(pattern),
                    Sale.cashier.has(
                        or_(
                            User.username.ilike(pattern),
                            User.full_name.ilike(pattern),
                            User.email.ilike(pattern),
                        )
                    ),
                    Sale.customer.has(
                        or_(
                            Customer.name.ilike(pattern),
                            Customer.phone.ilike(pattern),
                            Customer.email.ilike(pattern),
                        )
                    ),
                    Sale.items.any(
                        SaleItem.product.has(
                            or_(
                                Product.name.ilike(pattern),
                                Product.barcode.ilike(pattern),
                            )
                        )
                    ),
                    Sale.returns.any(
                        cast(SaleReturn.total_refund_amount, String).ilike(pattern)
                    ),
                ]
                try:
                    Decimal(term)
                except InvalidOperation:
                    pass
                else:
                    term_conditions.extend(
                        [
                            Sale.items.any(
                                or_(
                                    cast(SaleItem.quantity, String).ilike(pattern),
                                    cast(SaleItem.sold_quantity, String).ilike(pattern),
                                    cast(SaleItem.quantity_returned, String).ilike(pattern),
                                )
                            ),
                            cast(item_count, String).ilike(pattern),
                            cast(total_base_quantity, String).ilike(pattern),
                            cast(total_sold_quantity, String).ilike(pattern),
                        ]
                    )
                conditions.extend(term_conditions)
            query = query.filter(or_(*conditions))

        return query

    def get_all(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        cashier_id: Optional[int] = None,
        status: Optional[SaleStatus] = None,
        search_terms: Optional[List[str]] = None,
        status_group: Optional[str] = None,
        payment_method: Optional[PaymentMethod] = None,
    ) -> Tuple[List[Sale], int]:
        query = self.db.query(Sale).options(
            joinedload(Sale.items),
            joinedload(Sale.cashier),
        )
        query = self._apply_filters(
            query,
            company_id,
            start_date=start_date,
            end_date=end_date,
            cashier_id=cashier_id,
            status=status,
            search_terms=search_terms,
            status_group=status_group,
            payment_method=payment_method,
        )

        query = query.order_by(Sale.created_at.desc())

        total = query.count()
        sales = query.offset(skip).limit(limit).all()

        return sales, total

    def get_summary(
        self,
        company_id: int,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        cashier_id: Optional[int] = None,
        status: Optional[SaleStatus] = None,
        search_terms: Optional[List[str]] = None,
        status_group: Optional[str] = None,
        payment_method: Optional[PaymentMethod] = None,
    ) -> dict:
        """Totals over EVERY matching sale, not just the current page.

        The client cannot compute these: it holds one page at a time, so summing
        what it has shows a fraction of the real turnover.
        """
        refund_sub = self.refund_totals_subquery(company_id)
        refund_total = func.coalesce(refund_sub.c.refund_total, Decimal("0.00"))

        query = self.db.query(
            func.count(Sale.id).label("count"),
            func.coalesce(func.sum(Sale.total_amount), Decimal("0.00")).label("turnover"),
            func.coalesce(func.sum(refund_total), Decimal("0.00")).label("refunds"),
            func.count(case((refund_total > 0, Sale.id))).label("refund_operations"),
        ).outerjoin(refund_sub, Sale.id == refund_sub.c.sale_id)

        query = self._apply_filters(
            query,
            company_id,
            start_date=start_date,
            end_date=end_date,
            cashier_id=cashier_id,
            status=status,
            search_terms=search_terms,
            status_group=status_group,
            payment_method=payment_method,
        )
        # Cancelled sales are listed but never counted as turnover.
        query = query.filter(Sale.status.in_(NON_CANCELLED_STATUSES))

        row = query.one()

        # Split the same turnover by payment method so the sales-history card can
        # show what actually landed in the drawer (наличные) apart from карта and
        # в долг. Same filters, same non-cancelled set — the parts add back up to
        # `turnover`, which is what lets a cashier reconcile the till.
        by_method = {"cash": Decimal("0.00"), "card": Decimal("0.00"),
                     "mobile": Decimal("0.00"), "credit": Decimal("0.00")}
        method_query = self.db.query(
            Sale.payment_method,
            func.coalesce(func.sum(Sale.total_amount), Decimal("0.00")),
        )
        method_query = self._apply_filters(
            method_query,
            company_id,
            start_date=start_date,
            end_date=end_date,
            cashier_id=cashier_id,
            status=status,
            search_terms=search_terms,
            status_group=status_group,
            payment_method=payment_method,
        )
        method_query = method_query.filter(
            Sale.status.in_(NON_CANCELLED_STATUSES)
        ).group_by(Sale.payment_method)
        for method, amount in method_query.all():
            key = method.value if hasattr(method, "value") else str(method or "")
            if key in by_method:
                by_method[key] = amount or Decimal("0.00")

        # Cash repaid against в-долг sales physically lands in the drawer, but it
        # is not a sale, so it never shows up in the turnover split above. Without
        # it the «Касса» figure understates the till by exactly the debt that was
        # collected — which is what made a paid-off в долг still look owed. Add it
        # so the client can show Касса = наличные-продажи + погашение долга и
        # В долг = кредит − погашение (the two still sum back to turnover).
        # Payments are matched by their own timestamp only (a repayment is not a
        # sale, so cashier/status/search sale-filters do not apply); a method
        # filter for a non-cash method excludes it.
        cash_debt_payments = Decimal("0.00")
        if payment_method in (None, PaymentMethod.CASH):
            pay_query = self.db.query(
                func.coalesce(func.sum(CustomerLedgerEntry.amount), Decimal("0.00"))
            ).filter(
                CustomerLedgerEntry.company_id == company_id,
                CustomerLedgerEntry.entry_type == CustomerLedgerEntryType.PAYMENT.value,
                func.lower(func.coalesce(CustomerLedgerEntry.payment_method, "cash")) == "cash",
            )
            if start_date:
                pay_query = pay_query.filter(CustomerLedgerEntry.created_at >= start_date)
            if end_date:
                pay_query = pay_query.filter(CustomerLedgerEntry.created_at <= end_date)
            # Payment amounts are stored negative (money reducing a debt); the
            # cash brought in is the negation.
            cash_debt_payments = -(pay_query.scalar() or Decimal("0.00"))

        return {
            "count": row.count or 0,
            "turnover": row.turnover or Decimal("0.00"),
            "refunds": row.refunds or Decimal("0.00"),
            "refund_operations": row.refund_operations or 0,
            "by_method": by_method,
            "cash_debt_payments": cash_debt_payments,
        }

    def get_turnover_timestamps(
        self,
        company_id: int,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        cashier_id: Optional[int] = None,
        status: Optional[SaleStatus] = None,
        search_terms: Optional[List[str]] = None,
        status_group: Optional[str] = None,
        payment_method: Optional[PaymentMethod] = None,
    ) -> List[Tuple[datetime, Decimal]]:
        """(created_at, total_amount) for every matching non-cancelled sale.

        Bucketing into local hours/days is done by the caller in Python rather
        than in SQL: converting a UTC timestamp to a named zone is Postgres-only
        (`timezone('Asia/Dushanbe', ts)`) and would not run under the SQLite test
        engine, and a fixed-offset shift would be wrong across a DST boundary.
        Two columns over a date-bounded window is cheap enough to pay for that.
        """
        query = self.db.query(Sale.created_at, Sale.total_amount)
        query = self._apply_filters(
            query,
            company_id,
            start_date=start_date,
            end_date=end_date,
            cashier_id=cashier_id,
            status=status,
            search_terms=search_terms,
            status_group=status_group,
            payment_method=payment_method,
        )
        query = query.filter(Sale.status.in_(NON_CANCELLED_STATUSES))

        return [(row.created_at, row.total_amount or Decimal("0.00")) for row in query.all()]

    def get_search_candidates(self, company_id: int) -> list[tuple[str, str, str]]:
        """Return distinct suggestion values that occur in this tenant's sales."""

        candidates: list[tuple[str, str, str]] = []

        product_rows = (
            self.db.query(Product.name, Product.barcode)
            .join(SaleItem, SaleItem.product_id == Product.id)
            .join(Sale, Sale.id == SaleItem.sale_id)
            .filter(Sale.company_id == company_id)
            .distinct()
            .all()
        )
        for name, barcode in product_rows:
            if name:
                candidates.append(("product", name, name))
            if barcode:
                candidates.append(("product", f"{name} · {barcode}", barcode))

        customer_rows = (
            self.db.query(Customer.name, Customer.phone, Customer.email)
            .join(Sale, Sale.customer_id == Customer.id)
            .filter(Sale.company_id == company_id)
            .distinct()
            .all()
        )
        for name, phone, email in customer_rows:
            if name:
                candidates.append(("customer", name, name))
            if phone:
                candidates.append(("customer", f"{name} · {phone}", phone))
            if email:
                candidates.append(("customer", f"{name} · {email}", email))

        cashier_rows = (
            self.db.query(User.username, User.full_name, User.email)
            .join(Sale, Sale.cashier_id == User.id)
            .filter(Sale.company_id == company_id)
            .distinct()
            .all()
        )
        for username, full_name, email in cashier_rows:
            display_name = full_name or username
            candidates.append(("cashier", display_name, display_name))
            if username and username != display_name:
                candidates.append(("cashier", f"{display_name} · {username}", username))
            if email:
                candidates.append(("cashier", f"{display_name} · {email}", email))

        return candidates

    def create(self, sale: Sale, items: List[SaleItem]) -> Sale:
        """Persist a sale and its items, flushing so both get primary keys.

        The trailing flush is load-bearing: callers (SaleService, SyncService)
        consume each item's stock through the FIFO ledger immediately after,
        and ``InventoryAllocation.sale_item_id`` requires the item ``id`` to be
        assigned. Do not drop this flush.
        """
        self.db.add(sale)
        self.db.flush()

        for item in items:
            item.sale_id = sale.id
            self.db.add(item)

        self.db.flush()
        return sale

    def update(self, sale: Sale) -> Sale:
        self.db.commit()
        self.db.refresh(sale)
        return sale

    def get_daily_sales(
        self, company_id: int, start_date: datetime, end_date: datetime
    ) -> List[tuple[datetime, int, Decimal, Decimal]]:
        result = (
            self.db.query(
                Sale.created_at,
                Sale.id,
                Sale.total_amount,
            )
            .filter(
                Sale.company_id == company_id,
                Sale.created_at >= start_date,
                Sale.created_at <= end_date,
            )
            .filter(Sale.status == SaleStatus.COMPLETED)
            .order_by(Sale.created_at)
            .all()
        )
        return result

    def get_top_products(
        self, company_id: int, start_date: datetime, end_date: datetime, limit: int = 10
    ) -> List[tuple]:
        from models.product import Product

        result = (
            self.db.query(
                Product.id,
                Product.name,
                Product.barcode,
                SaleItem.quantity,
                SaleItem.subtotal,
            )
            .join(SaleItem, Product.id == SaleItem.product_id)
            .join(Sale, SaleItem.sale_id == Sale.id)
            .filter(
                Sale.company_id == company_id,
                Sale.created_at >= start_date,
                Sale.created_at <= end_date,
            )
            .filter(Sale.status == SaleStatus.COMPLETED)
            .order_by(SaleItem.quantity.desc())
            .limit(limit)
            .all()
        )
        return result
