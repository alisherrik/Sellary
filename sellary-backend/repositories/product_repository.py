from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from models.inventory_layer import InventoryLayer
from models.product import Product
from models.purchase_receipt import PurchaseReceipt, PurchaseReceiptItem
from models.sale import Sale, SaleStatus
from models.sale_item import SaleItem
from typing import Optional, List


class ProductRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, company_id: int, product_id: int) -> Optional[Product]:
        return self.db.query(Product).filter(
            Product.company_id == company_id,
            Product.id == product_id,
        ).first()

    def get_by_id_for_update(self, company_id: int, product_id: int) -> Optional[Product]:
        """
        Get product with row-level lock (SELECT ... FOR UPDATE).
        Use this when modifying stock to prevent race conditions.
        """
        return self.db.query(Product).filter(
            Product.company_id == company_id,
            Product.id == product_id,
        ).with_for_update().first()

    def get_multiple_for_update(self, company_id: int, product_ids: List[int]) -> List[Product]:
        """
        Get multiple products with row-level locks (SELECT ... FOR UPDATE).
        Products are ordered by ID to prevent deadlocks when multiple
        transactions lock the same products in different orders.
        """
        if not product_ids:
            return []
        return self.db.query(Product).filter(
            Product.company_id == company_id,
            Product.id.in_(product_ids)
        ).order_by(Product.id).with_for_update().all()

    def get_by_barcode(self, company_id: int, barcode: str) -> Optional[Product]:
        # Compared trimmed on both sides: barcodes typed with a trailing space
        # slipped past the duplicate check and split one article across two
        # cards, so the same goods had two stocks and two histories.
        return self.db.query(Product).filter(
            Product.company_id == company_id,
            func.trim(Product.barcode) == (barcode or "").strip(),
        ).first()

    def get_all(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        category_id: Optional[int] = None,
        active_only: bool = True,
    ) -> tuple[List[Product], int]:
        query = self.db.query(Product).filter(Product.company_id == company_id)

        if active_only:
            query = query.filter(Product.is_active == True)

        if search:
            query = query.filter(
                or_(
                    Product.name.ilike(f"%{search}%"),
                    Product.barcode.ilike(f"%{search}%"),
                )
            )

        if category_id:
            query = query.filter(Product.category_id == category_id)

        total = query.count()
        products = query.offset(skip).limit(limit).all()

        return products, total

    def get_movement_totals(
        self,
        company_id: int,
        product_ids: List[int],
    ) -> dict[int, dict[str, Decimal]]:
        """How much of each product came in, went out, and is left.

        `purchased` and `sold` are read from the documents — the receipt lines and
        the sale lines — because that is what the shop counted. A layer can be
        shrunk by a ledger repair or never written at all (the June PO #9 bug),
        so reading them from the layers made a product look like it sold more
        than it ever bought. `ledger_stock` is the layers, and it is meant to be
        the independent figure: when it disagrees with `products.stock_quantity`
        that is drift, not rounding.
        """
        zero = Decimal("0")
        totals = {
            product_id: {"purchased": zero, "sold": zero, "ledger_stock": zero}
            for product_id in product_ids
        }
        if not product_ids:
            return totals

        layer_rows = (
            self.db.query(
                InventoryLayer.product_id,
                func.sum(InventoryLayer.remaining_quantity),
            )
            .filter(
                InventoryLayer.company_id == company_id,
                InventoryLayer.product_id.in_(product_ids),
                InventoryLayer.reversed_at.is_(None),
            )
            .group_by(InventoryLayer.product_id)
            .all()
        )
        for product_id, remaining in layer_rows:
            totals[product_id]["ledger_stock"] = remaining or zero

        purchased_rows = (
            self.db.query(
                PurchaseReceiptItem.product_id,
                func.sum(PurchaseReceiptItem.quantity),
            )
            .join(PurchaseReceipt, PurchaseReceiptItem.purchase_receipt_id == PurchaseReceipt.id)
            # A voided line keeps its receipt row but its layer is reversed.
            .outerjoin(
                InventoryLayer,
                InventoryLayer.purchase_receipt_item_id == PurchaseReceiptItem.id,
            )
            .filter(
                PurchaseReceipt.company_id == company_id,
                PurchaseReceiptItem.product_id.in_(product_ids),
                PurchaseReceipt.reversed_at.is_(None),
                InventoryLayer.reversed_at.is_(None),
            )
            .group_by(PurchaseReceiptItem.product_id)
            .all()
        )
        for product_id, purchased in purchased_rows:
            totals[product_id]["purchased"] = purchased or zero

        sold_rows = (
            self.db.query(
                SaleItem.product_id,
                func.sum(SaleItem.quantity - SaleItem.quantity_returned),
            )
            .join(Sale, SaleItem.sale_id == Sale.id)
            .filter(
                Sale.company_id == company_id,
                SaleItem.product_id.in_(product_ids),
                Sale.status != SaleStatus.CANCELLED,
                Sale.voided_at.is_(None),
            )
            .group_by(SaleItem.product_id)
            .all()
        )
        for product_id, sold in sold_rows:
            totals[product_id]["sold"] = sold or zero

        return totals

    def create(self, product: Product) -> Product:
        # Flush only — the service layer assembles the product row, its initial
        # ledger layer/value and inventory log, and the API layer commits once
        # the whole unit of work is ready (and rolls back on failure).
        self.db.add(product)
        self.db.flush()
        self.db.refresh(product)
        return product

    def update(self, product: Product) -> Product:
        self.db.flush()
        self.db.refresh(product)
        return product

    def delete(self, company_id: int, product_id: int) -> bool:
        product = self.get_by_id(company_id, product_id)
        if product:
            product.is_active = False
            self.db.flush()
            self.db.commit()
            return True
        return False

    def get_low_stock_products(self, company_id: int, min_stock: Optional[int] = None) -> List[Product]:
        query = self.db.query(Product).filter(
            Product.company_id == company_id,
            Product.is_active == True,
        )
        if min_stock:
            query = query.filter(Product.stock_quantity <= min_stock)
        else:
            query = query.filter(Product.stock_quantity <= Product.min_stock_level)
        return query.all()
