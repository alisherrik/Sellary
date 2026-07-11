from datetime import datetime
from decimal import Decimal
from typing import List

from sqlalchemy.orm import Session

# NOTE: ``settings`` is imported but intentionally NOT consulted for oversell
# decisions. SYNC_ALLOW_OVERSELL is deprecated and no longer overrides ledger
# safety (see core/config.py). The import is retained so tests can assert the
# flag has no effect by patching ``services.sync_service.settings``.
from core.config import settings  # noqa: F401
from core.idempotency import IdempotencyConflictError, IdempotencyService
from models.company import Company
from models.product import Product
from models.sale import CardType, PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from models.user import User
from repositories.product_repository import ProductRepository
from repositories.sale_repository import SaleRepository
from schemas.category import Category as CategorySchema
from schemas.sync import (
    SyncBootstrapResponse,
    SyncProductItem,
    SyncSaleCreate,
    SyncSaleResult,
    SyncSalesRequest,
    SyncSalesResponse,
    SyncWarning,
)
from services.inventory_ledger_service import InventoryLedgerService


SYNC_ENDPOINT = "/api/sync/sales"


class SyncService:
    def __init__(self, db: Session):
        self.db = db
        self.product_repo = ProductRepository(db)
        self.sale_repo = SaleRepository(db)

    def bootstrap(self, company: Company, user: User) -> SyncBootstrapResponse:
        products = (
            self.db.query(Product)
            .filter(Product.company_id == company.id)
            .all()
        )

        from models.category import Category as CategoryModel

        categories = (
            self.db.query(CategoryModel)
            .filter(
                CategoryModel.company_id == company.id,
                CategoryModel.is_active == True,
            )
            .all()
        )

        return SyncBootstrapResponse(
            company_id=company.id,
            company_name=company.name,
            user_id=user.id,
            user_username=user.username,
            user_role=user.role,
            server_time=datetime.utcnow(),
            products=[
                SyncProductItem(
                    id=p.id,
                    barcode=p.barcode,
                    name=p.name,
                    uom=p.uom,
                    category_id=p.category_id,
                    sell_price=p.sell_price,
                    tax_percent=p.tax_percent,
                    stock_quantity=p.stock_quantity,
                    is_active=p.is_active,
                    updated_at=p.updated_at or p.created_at,
                )
                for p in products
            ],
            categories=[
                CategorySchema.model_validate(c) for c in categories
            ],
        )

    def sync_sales(
        self, company: Company, user: User, request: SyncSalesRequest
    ) -> SyncSalesResponse:
        results: List[SyncSaleResult] = []
        for sale_create in request.sales:
            result = self._process_single_sale(company, user, sale_create)
            results.append(result)
        return SyncSalesResponse(results=results)

    def _process_single_sale(
        self, company: Company, user: User, sale_create: SyncSaleCreate
    ) -> SyncSaleResult:
        idempotency_service = IdempotencyService(self.db)
        request_body = sale_create.model_dump()

        try:
            cached = idempotency_service.get_cached_response(
                key=sale_create.idempotency_key,
                company_id=company.id,
                user_id=user.id,
                endpoint=SYNC_ENDPOINT,
                request_body=request_body,
            )
            if cached:
                response_body, _ = cached
                return SyncSaleResult(
                    client_sale_id=sale_create.client_sale_id,
                    status="duplicate",
                    sale_id=response_body.get("sale_id"),
                )
        except IdempotencyConflictError:
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="duplicate",
            )

        error = self._validate_sale(sale_create)
        if error:
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="failed",
                error=error,
            )

        try:
            result = self._create_sale(company, user, sale_create)
        except Exception as exc:
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="failed",
                error=str(exc),
            )

        result_data = {
            "sale_id": result.sale_id,
            "client_sale_id": result.client_sale_id,
        }
        try:
            idempotency_service.store_response(
                key=sale_create.idempotency_key,
                company_id=company.id,
                user_id=user.id,
                endpoint=SYNC_ENDPOINT,
                request_body=request_body,
                response_body=result_data,
                status_code=201,
            )
        except IdempotencyConflictError:
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="duplicate",
                sale_id=result.sale_id,
            )

        return result

    def _validate_sale(self, sale_create: SyncSaleCreate) -> str | None:
        if not sale_create.items:
            return "Sale must have at least one item"

        payment_method_lower = sale_create.payment_method.lower()
        if payment_method_lower not in ("cash", "card", "mobile"):
            return f"Invalid payment_method: {sale_create.payment_method}"

        if payment_method_lower == "card" and not sale_create.card_type:
            return "card_type is required when payment_method is card"

        card_type_lower = sale_create.card_type.lower() if sale_create.card_type else None
        if payment_method_lower != "card" and card_type_lower:
            return "card_type must not be set when payment_method is not card"

        if card_type_lower and card_type_lower not in ("alif", "eskhata", "dc"):
            return f"Invalid card_type: {sale_create.card_type}"

        return None

    def _create_sale(
        self, company: Company, user: User, sale_create: SyncSaleCreate
    ) -> SyncSaleResult:
        product_ids = [item.product_id for item in sale_create.items]
        locked_products = self.product_repo.get_multiple_for_update(
            company.id, product_ids
        )
        product_map = {product.id: product for product in locked_products}

        missing_ids = [pid for pid in product_ids if pid not in product_map]
        if missing_ids:
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="failed",
                error=f"Products not found: {missing_ids}",
            )

        subtotal = Decimal("0.00")
        items: list[SaleItem] = []

        for item_create in sale_create.items:
            product = product_map[item_create.product_id]

            item_subtotal = (
                item_create.quantity * item_create.sell_price
            ).quantize(Decimal("0.01"))
            item_tax = (
                item_subtotal * product.tax_percent / Decimal("100")
            ).quantize(Decimal("0.01"))

            item = SaleItem(
                product_id=item_create.product_id,
                quantity=item_create.quantity,
                # The offline cashier always sells in the product's base unit.
                product_unit_id=None,
                sold_quantity=item_create.quantity,
                sold_unit_label=product.uom,
                sold_unit_factor=Decimal("1"),
                unit_price=item_create.sell_price,
                tax_percent=product.tax_percent,
                tax_amount=item_tax,
                discount_amount=Decimal("0.00"),
                subtotal=item_subtotal,
                total=(item_subtotal + item_tax).quantize(Decimal("0.01")),
                # Cost is finalised from the FIFO layers consumed below.
                unit_cost_at_sale=product.cost_price,
                cost_total_at_sale=(
                    item_create.quantity * product.cost_price
                ).quantize(Decimal("0.01")),
                created_at=sale_create.created_at_client,
            )
            items.append(item)

            subtotal += item_subtotal

        tax_amount = sum(item.tax_amount for item in items)
        total_amount = (
            subtotal + tax_amount - sale_create.discount_amount
        ).quantize(Decimal("0.01"))

        if total_amount < 0:
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="failed",
                error="Sale total cannot be negative",
            )

        pm_map = {
            "cash": PaymentMethod.CASH,
            "card": PaymentMethod.CARD,
            "mobile": PaymentMethod.MOBILE,
        }
        payment_method = pm_map[sale_create.payment_method.lower()]

        card_type = None
        if sale_create.card_type:
            card_type_map = {
                "alif": CardType.ALIF,
                "eskhata": CardType.ESKHATA,
                "dc": CardType.DC,
            }
            card_type = card_type_map.get(sale_create.card_type.lower())

        sale = Sale(
            company_id=company.id,
            customer_id=None,
            cashier_id=user.id,
            subtotal=subtotal,
            tax_amount=tax_amount,
            discount_amount=sale_create.discount_amount,
            total_amount=total_amount,
            payment_method=payment_method,
            card_type=card_type,
            status=SaleStatus.COMPLETED,
            notes=sale_create.notes,
            created_at=sale_create.created_at_client,
        )

        ledger = InventoryLedgerService(self.db, company.id)
        warnings: list[SyncWarning] = []
        try:
            with self.db.begin_nested():
                created_sale = self.sale_repo.create(sale, items)
                for item in items:
                    product = product_map[item.product_id]
                    consumption = ledger.consume_fifo(
                        product=product,
                        quantity=item.quantity,
                        consumer_type="sale_item",
                        consumer_id=item.id,
                        sale_item_id=item.id,
                        user_id=user.id,
                        reason=f"Sale #{created_sale.id}",
                        reference_type="sale",
                        reference_id=created_sale.id,
                        # Offline sales are immutable historical facts: record
                        # them even when they exceed available stock. Online
                        # POST /api/sales keeps the default (allow_oversell=False).
                        allow_oversell=True,
                    )
                    item.cost_total_at_sale = consumption.value.quantize(
                        Decimal("0.01")
                    )
                    item.unit_cost_at_sale = (
                        consumption.value / item.quantity
                    ).quantize(Decimal("0.01"))
                    if consumption.shortfall_quantity > 0:
                        warnings.append(
                            SyncWarning(
                                type="oversell",
                                product_id=product.id,
                                product_name=product.name,
                                requested=item.quantity,
                                available=consumption.available_before,
                                new_balance=product.stock_quantity,
                            )
                        )
        except ValueError as exc:
            # Genuinely bad rows only (e.g. negative total). Oversell no longer
            # raises because allow_oversell=True above.
            return SyncSaleResult(
                client_sale_id=sale_create.client_sale_id,
                status="failed",
                error=str(exc),
            )

        self.db.flush()

        return SyncSaleResult(
            client_sale_id=sale_create.client_sale_id,
            status="synced",
            sale_id=created_sale.id,
            warnings=warnings or None,
        )
