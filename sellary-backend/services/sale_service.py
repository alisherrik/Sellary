from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from core.state_machine import validate_sale_transition
from models.sale import Sale, SaleStatus
from models.sale_item import SaleItem
from repositories.customer_repository import CustomerRepository
from repositories.inventory_repository import InventoryRepository
from repositories.product_repository import ProductRepository
from repositories.sale_repository import SaleRepository
from schemas.sale import SaleCreate, SaleResponse
from services.calculation_service import CalculationService
from services.inventory_ledger_service import InventoryLedgerService
from services.tenant import resolve_company_id


class SaleService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.sale_repo = SaleRepository(db)
        self.product_repo = ProductRepository(db)
        self.inventory_repo = InventoryRepository(db)
        self.customer_repo = CustomerRepository(db)
        self.calc = CalculationService
        self.ledger = InventoryLedgerService(db, self.company_id)

    def get_by_id(self, sale_id: int) -> Optional[SaleResponse]:
        sale = self.sale_repo.get_by_id(self.company_id, sale_id)
        if not sale:
            return None
        return self._to_response(sale)

    def get_all(
        self,
        skip: int = 0,
        limit: int = 50,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        cashier_id: Optional[int] = None,
        status: Optional[SaleStatus] = None,
    ) -> Tuple[List[SaleResponse], int]:
        sales, total = self.sale_repo.get_all(
            self.company_id,
            skip=skip,
            limit=limit,
            start_date=start_date,
            end_date=end_date,
            cashier_id=cashier_id,
            status=status,
        )
        return [self._to_response(sale) for sale in sales], total

    def create(self, sale_create: SaleCreate, cashier_id: int) -> SaleResponse:
        product_ids = [item.product_id for item in sale_create.items]
        locked_products = self.product_repo.get_multiple_for_update(
            self.company_id,
            product_ids,
        )

        product_map = {product.id: product for product in locked_products}
        requested_quantities = {}
        for item_create in sale_create.items:
            requested_quantities[item_create.product_id] = (
                requested_quantities.get(item_create.product_id, 0) + item_create.quantity
            )

        for product_id in product_ids:
            if product_id not in product_map:
                raise ValueError(f"Product with id {product_id} not found")

        for product_id, requested_quantity in requested_quantities.items():
            product = product_map[product_id]
            if not product.is_active:
                raise ValueError(f"Product '{product.name}' is not active")

        # Stock availability is no longer checked here: the FIFO ledger
        # (consume_fifo) is the single source of truth and raises a ValueError
        # ("Insufficient stock for product '<name>'") when a line cannot be
        # fully allocated from non-reversed layers. Overselling is therefore no
        # longer possible — exact FIFO accounting cannot back negative stock.

        subtotal = Decimal("0.00")
        tax_amount = Decimal("0.00")
        items: List[SaleItem] = []

        for item_create in sale_create.items:
            product = product_map[item_create.product_id]

            item_subtotal = self.calc.calculate_item_subtotal(
                item_create.quantity,
                item_create.unit_price,
            )
            item_tax = self.calc.calculate_item_tax(
                item_subtotal,
                item_create.tax_percent,
            )
            item_total = self.calc.calculate_item_total(
                item_subtotal,
                item_tax,
                item_create.discount_amount,
            )

            item = SaleItem(
                product_id=item_create.product_id,
                quantity=item_create.quantity,
                unit_price=item_create.unit_price,
                tax_percent=item_create.tax_percent,
                tax_amount=item_tax,
                discount_amount=item_create.discount_amount,
                subtotal=item_subtotal,
                total=item_total,
                # unit_cost_at_sale / cost_total_at_sale are set from the actual
                # FIFO layers consumed once the item has been flushed below.
                unit_cost_at_sale=product.cost_price,
                cost_total_at_sale=(item_create.quantity * product.cost_price).quantize(Decimal("0.01")),
                created_at=datetime.now(),
            )
            items.append(item)

            subtotal += item_subtotal
            tax_amount += item_tax

        total_amount = subtotal + tax_amount - sale_create.discount_amount

        if sale_create.discount_amount > 0 and (subtotal + tax_amount) > 0:
            discount_ratio = sale_create.discount_amount / (subtotal + tax_amount)
            for item in items:
                item.allocated_sale_discount_amount = (
                    (item.subtotal + item.tax_amount) * discount_ratio
                ).quantize(Decimal("0.01"))
            items[-1].allocated_sale_discount_amount += (
                sale_create.discount_amount
                - sum(i.allocated_sale_discount_amount for i in items)
            )

        if total_amount < 0:
            raise ValueError("Sale total cannot be negative")

        if sale_create.customer_id:
            customer = self.customer_repo.get_by_id(
                self.company_id,
                sale_create.customer_id,
            )
            if not customer:
                raise ValueError(f"Customer with id {sale_create.customer_id} not found")

        sale = Sale(
            company_id=self.company_id,
            customer_id=sale_create.customer_id,
            cashier_id=cashier_id,
            subtotal=subtotal,
            tax_amount=tax_amount,
            discount_amount=sale_create.discount_amount,
            total_amount=total_amount,
            payment_method=sale_create.payment_method,
            card_type=sale_create.card_type,
            status=SaleStatus.COMPLETED,
            notes=sale_create.notes,
            created_at=datetime.now(),
        )

        sale = self.sale_repo.create(sale, items)

        # Consume each line's stock through the FIFO ledger. The ledger proves
        # availability (raising ValueError on oversell), decrements layers,
        # records InventoryAllocation rows linked to the sale item, and writes
        # the single negative inventory log per line. Cost is derived from the
        # actual layers consumed, not the product's running average.
        for item in items:
            product = product_map[item.product_id]
            consumption = self.ledger.consume_fifo(
                product=product,
                quantity=item.quantity,
                consumer_type="sale_item",
                consumer_id=item.id,
                sale_item_id=item.id,
                user_id=cashier_id,
                reason=f"Sale #{sale.id}",
                reference_type="sale",
                reference_id=sale.id,
            )
            item.cost_total_at_sale = consumption.value.quantize(Decimal("0.01"))
            item.unit_cost_at_sale = (
                consumption.value / item.quantity
            ).quantize(Decimal("0.01"))

        self.db.flush()
        return self._to_response(sale)

    def cancel(self, sale_id: int, user_id: int) -> SaleResponse:
        sale = self.sale_repo.get_by_id_for_update(self.company_id, sale_id)
        if not sale:
            raise ValueError(f"Sale with id {sale_id} not found")

        validate_sale_transition(
            current_status=sale.status,
            target_status=SaleStatus.CANCELLED,
            sale_id=sale_id,
        )

        locked_items = self.sale_repo.get_sale_items_for_update(sale_id)
        product_ids = sorted(item.product_id for item in locked_items)
        locked_products = self.product_repo.get_multiple_for_update(
            self.company_id,
            product_ids,
        )
        product_map = {product.id: product for product in locked_products}

        for item in locked_items:
            product = product_map.get(item.product_id)
            if product:
                previous_quantity = product.stock_quantity
                new_quantity = previous_quantity + item.quantity
                product.stock_quantity = new_quantity

                self.inventory_repo.create_log(
                    company_id=self.company_id,
                    product_id=product.id,
                    user_id=user_id,
                    quantity_change=item.quantity,
                    previous_quantity=previous_quantity,
                    new_quantity=new_quantity,
                    reason=f"Cancelled sale #{sale_id}",
                    reference_type="sale_cancel",
                    reference_id=sale_id,
                )

        sale.status = SaleStatus.CANCELLED
        self.db.flush()
        return self._to_response(sale, items_override=locked_items)

    def _to_response(self, sale: Sale, items_override=None) -> SaleResponse:
        refunded_amount = Decimal("0.00")
        try:
            for sale_return in getattr(sale, "returns", []) or []:
                refunded_amount += sale_return.total_refund_amount
        except Exception:
            pass

        remaining_refundable = sale.total_amount - refunded_amount
        can_return = sale.status in (SaleStatus.COMPLETED, SaleStatus.PARTIALLY_RETURNED)

        items_source = items_override if items_override is not None else sale.items

        return SaleResponse(
            id=sale.id,
            customer_id=sale.customer_id,
            customer_name=sale.customer.name if sale.customer else None,
            cashier_id=sale.cashier_id,
            cashier_name=sale.cashier.full_name or sale.cashier.username,
            subtotal=sale.subtotal,
            tax_amount=sale.tax_amount,
            discount_amount=sale.discount_amount,
            total_amount=sale.total_amount,
            refunded_amount=refunded_amount,
            remaining_refundable_amount=remaining_refundable,
            payment_method=sale.payment_method,
            card_type=sale.card_type,
            status=sale.status,
            can_return=can_return,
            notes=sale.notes,
            created_at=sale.created_at,
            items=[
                {
                    "id": item.id,
                    "product_id": item.product_id,
                    "product_name": item.product.name,
                    "uom": item.product.uom,
                    "quantity": item.quantity,
                    "quantity_returned": getattr(item, "quantity_returned", 0) or 0,
                    "quantity_returnable": item.quantity - (getattr(item, "quantity_returned", 0) or 0),
                    "can_return": (
                        item.quantity - (getattr(item, "quantity_returned", 0) or 0)
                    ) > 0 and can_return,
                    "unit_price": item.unit_price,
                    "tax_percent": item.tax_percent,
                    "tax_amount": item.tax_amount,
                    "discount_amount": item.discount_amount,
                    "subtotal": item.subtotal,
                    "total": item.total,
                }
                for item in items_source
            ],
        )
