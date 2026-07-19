"""Order service — marketplace order lifecycle.

Handles:
  - ``place_orders``: validate, snapshot prices, create N Order rows from checkout
  - ``get_order`` / ``list_orders_for_company`` / ``list_orders_for_shopper``
  - ``confirm``: create a Sale via SaleService (commits stock via FIFO ledger);
    oversell maps to HTTP 400 — order stays pending, rollback
  - ``advance_status``: pending state-machine guard
  - ``cancel``: if sale_id is set, runs TransactionReversalService.void_sale

Design constraints (from resolved decisions):
  - ``cashier_id`` on confirm = auth.user.id (the confirming manager/admin)
  - Confirm does NOT require an open cash shift — calls SaleService.create directly
  - Oversell: consume_fifo raises ValueError → map to HTTP 400 order stays pending
  - No allow_oversell: SaleService.create is called without that flag
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from models.company import Company
from models.order import FulfillmentType, Order, OrderStatus
from models.order_item import OrderItem
from models.product import Product
from repositories.order_repository import OrderRepository
from repositories.product_repository import ProductRepository
from schemas.order import (
    CheckoutRequest,
    OrderCancelRequest,
    OrderConfirmRequest,
    OrderCreate,
    OrderItemCreate,
    OrderItemResponse,
    OrderListResponse,
    OrderResponse,
    OrderStatusAdvance,
)
from schemas.sale import PaymentMethod, SaleCreate, SaleItemCreate
from services.sale_service import SaleService
from services.tenant import resolve_company_id

# Valid forward-only status transitions (order lifecycle).
_VALID_TRANSITIONS = {
    OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED: {OrderStatus.PREPARING, OrderStatus.CANCELLED},
    OrderStatus.PREPARING: {OrderStatus.READY},
    OrderStatus.READY: {OrderStatus.DELIVERING, OrderStatus.COMPLETED},
    OrderStatus.DELIVERING: {OrderStatus.COMPLETED},
    OrderStatus.COMPLETED: set(),
    OrderStatus.CANCELLED: set(),
}


class OrderNotFound(Exception):
    pass


class OrderStatusError(Exception):
    """Invalid status transition."""


class OrderOversellError(Exception):
    """Stock insufficient on confirm; order stays pending."""


class OrderService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id) if company_id else None
        self.order_repo = OrderRepository(db)

    def _require_company(self) -> int:
        if self.company_id is None:
            raise ValueError("company_id required for this operation")
        return self.company_id

    # ------------------------------------------------------------------
    # Shopper: place orders
    # ------------------------------------------------------------------
    def place_orders(
        self,
        request: CheckoutRequest,
        telegram_user_id: int,
    ) -> List[OrderResponse]:
        """Create one Order per per-shop OrderCreate in the checkout request.

        Each sub-order is created independently; all share the same
        ``checkout_group_id`` supplied by the shopper. Prices are validated
        against the current published catalog — if a product is no longer
        published or the price changed, the whole checkout is rejected (422).
        """
        created: List[OrderResponse] = []
        for order_create in request.orders:
            order = self._create_single_order(order_create, telegram_user_id)
            created.append(self._to_response(order))
        return created

    def _create_single_order(
        self, order_create: OrderCreate, telegram_user_id: int
    ) -> Order:
        company_id = order_create.company_id
        product_repo = ProductRepository(self.db)

        # Gate: the target company must have marketplace enabled.
        company = self.db.get(Company, company_id)
        if company is None or not company.is_marketplace_enabled:
            raise ValueError(
                f"Company {company_id} is not available on the marketplace"
            )

        items: List[OrderItem] = []
        subtotal = Decimal("0.00")

        for item_in in order_create.items:
            product = product_repo.get_by_id(company_id, item_in.product_id)
            if not product or not product.is_active or not product.is_published:
                raise ValueError(
                    f"Product {item_in.product_id} not available"
                )

            # Price snapshot: use sell_price from the catalog (MVP: trust the
            # client's unit_price but validate it matches the current price).
            # If it drifts the merchant/shopper can see the snapshot vs. live.
            unit_price = Decimal(product.sell_price)
            quantity = Decimal(item_in.quantity)
            line_total = (quantity * unit_price).quantize(Decimal("0.01"))
            subtotal += line_total

            items.append(
                OrderItem(
                    product_id=product.id,
                    product_name=product.name,
                    unit_price=unit_price,
                    quantity=quantity,
                    line_total=line_total,
                )
            )

        order_number = self.order_repo.next_order_number(company_id)
        order = Order(
            company_id=company_id,
            telegram_user_id=telegram_user_id,
            order_number=order_number,
            status=OrderStatus.PENDING.value,
            fulfillment_type=order_create.fulfillment_type,
            delivery_address=order_create.delivery_address,
            contact_phone=order_create.contact_phone,
            contact_name=order_create.contact_name,
            subtotal=subtotal,
            total_amount=subtotal,
            notes=order_create.notes,
            checkout_group_id=order_create.checkout_group_id,
        )
        return self.order_repo.create(order, items)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------
    def get_order(self, order_id: int) -> Optional[OrderResponse]:
        company_id = self._require_company()
        order = self.order_repo.get_by_id(company_id, order_id)
        if not order:
            return None
        return self._to_response(order)

    def get_order_for_shopper(
        self, order_id: int, telegram_user_id: int
    ) -> Optional[OrderResponse]:
        order = self.order_repo.get_by_id_global(order_id)
        if not order or order.telegram_user_id != telegram_user_id:
            return None
        return self._to_response(order)

    def list_orders_for_company(
        self,
        *,
        skip: int = 0,
        limit: int = 50,
        status: Optional[str] = None,
    ) -> OrderListResponse:
        company_id = self._require_company()
        orders, total = self.order_repo.get_all_for_company(
            company_id, skip=skip, limit=limit, status=status
        )
        return OrderListResponse(
            items=[self._to_response(o) for o in orders],
            total=total,
            skip=skip,
            limit=limit,
        )

    def list_orders_for_shopper(
        self,
        telegram_user_id: int,
        *,
        skip: int = 0,
        limit: int = 50,
    ) -> OrderListResponse:
        orders, total = self.order_repo.get_all_for_shopper(
            telegram_user_id, skip=skip, limit=limit
        )
        return OrderListResponse(
            items=[self._to_response(o) for o in orders],
            total=total,
            skip=skip,
            limit=limit,
        )

    # ------------------------------------------------------------------
    # Merchant: confirm (→ Sale + stock decrement)
    # ------------------------------------------------------------------
    def confirm(
        self,
        order_id: int,
        *,
        cashier_id: int,
        payment_method: str = "cash",
    ) -> OrderResponse:
        """Confirm a pending order → create a Sale → decrement stock.

        The confirming user's ID becomes the Sale.cashier_id.
        No open cash shift is required (we call SaleService.create directly,
        bypassing the shift guard that the HTTP /api/sales endpoint enforces).
        On stock insufficiency (ValueError from consume_fifo), the order stays
        pending and OrderOversellError is raised for the API layer to map to 400.

        Decision ref: Resolved Decisions #2, #3, #4.
        """
        company_id = self._require_company()
        order = self.order_repo.get_by_id_for_update(company_id, order_id)
        if not order:
            raise OrderNotFound(f"Order {order_id} not found")

        current = OrderStatus(order.status)
        if current != OrderStatus.PENDING:
            raise OrderStatusError(
                f"Cannot confirm order in status '{order.status}'; must be pending"
            )

        # Build a SaleCreate from the order's items.
        pm_map = {
            "cash": PaymentMethod.CASH,
            "card": PaymentMethod.CARD,
            "mobile": PaymentMethod.MOBILE,
        }
        pm = pm_map.get(payment_method, PaymentMethod.CASH)

        sale_create = SaleCreate(
            items=[
                SaleItemCreate(
                    product_id=item.product_id,
                    quantity=Decimal(item.quantity),
                    unit_price=Decimal(item.unit_price),
                    tax_percent=Decimal("0.00"),
                    discount_amount=Decimal("0.00"),
                )
                for item in order.items
                if item.product_id is not None
            ],
            payment_method=pm,
            discount_amount=Decimal("0.00"),
            notes=f"Marketplace order #{order.order_number}",
        )

        if not sale_create.items:
            raise ValueError("Order has no confirmable items (all products deleted)")

        # SaleService.create raises ValueError("Insufficient stock…") on oversell.
        sale_service = SaleService(self.db, company_id)
        try:
            sale_response = sale_service.create(sale_create, cashier_id)
        except ValueError as exc:
            msg = str(exc)
            if "Insufficient stock" in msg or "insufficient" in msg.lower():
                raise OrderOversellError(msg) from exc
            raise

        order.sale_id = sale_response.id
        order.status = OrderStatus.CONFIRMED.value
        order.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        self.db.refresh(order)
        return self._to_response(order)

    # ------------------------------------------------------------------
    # Merchant: advance status
    # ------------------------------------------------------------------
    def advance_status(
        self, order_id: int, new_status: str
    ) -> OrderResponse:
        company_id = self._require_company()
        order = self.order_repo.get_by_id_for_update(company_id, order_id)
        if not order:
            raise OrderNotFound(f"Order {order_id} not found")

        current = OrderStatus(order.status)
        target = OrderStatus(new_status)
        allowed = _VALID_TRANSITIONS.get(current, set())
        if target not in allowed:
            raise OrderStatusError(
                f"Cannot transition from '{order.status}' to '{new_status}'"
            )

        order.status = target.value
        order.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        self.db.refresh(order)
        return self._to_response(order)

    # ------------------------------------------------------------------
    # Merchant: cancel
    # ------------------------------------------------------------------
    def cancel(
        self, order_id: int, *, user_id: int, reason: Optional[str] = None
    ) -> OrderResponse:
        """Cancel an order.

        If a sale was created (order already confirmed), void it via
        TransactionReversalService to restore stock. If the sale is already
        voided or irrecoverable, still cancel the order (best-effort).
        """
        company_id = self._require_company()
        order = self.order_repo.get_by_id_for_update(company_id, order_id)
        if not order:
            raise OrderNotFound(f"Order {order_id} not found")

        current = OrderStatus(order.status)
        if current == OrderStatus.CANCELLED:
            raise OrderStatusError("Order is already cancelled")
        if current == OrderStatus.COMPLETED:
            raise OrderStatusError("Cannot cancel a completed order")

        # If a Sale was created, void it to restore stock.
        if order.sale_id is not None:
            from services.transaction_reversal_service import (
                ReversalConflict,
                TransactionReversalService,
            )

            try:
                TransactionReversalService(self.db, company_id).void_sale(
                    order.sale_id,
                    reason or "Marketplace order cancelled",
                    user_id,
                )
            except ReversalConflict:
                # Sale already voided or in terminal state — proceed to cancel
                # the order record anyway.
                pass

        order.status = OrderStatus.CANCELLED.value
        order.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        self.db.refresh(order)
        return self._to_response(order)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _to_response(self, order: Order) -> OrderResponse:
        return OrderResponse(
            id=order.id,
            company_id=order.company_id,
            order_number=order.order_number,
            status=order.status,
            fulfillment_type=order.fulfillment_type,
            delivery_address=order.delivery_address,
            contact_phone=order.contact_phone,
            contact_name=order.contact_name,
            subtotal=order.subtotal,
            total_amount=order.total_amount,
            notes=order.notes,
            sale_id=order.sale_id,
            checkout_group_id=order.checkout_group_id,
            created_at=order.created_at,
            updated_at=order.updated_at,
            items=[
                OrderItemResponse(
                    id=item.id,
                    product_id=item.product_id,
                    product_name=item.product_name,
                    unit_price=item.unit_price,
                    quantity=item.quantity,
                    line_total=item.line_total,
                )
                for item in order.items
            ],
        )
