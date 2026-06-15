from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from models.product import Product
from repositories.category_repository import CategoryRepository
from repositories.product_repository import ProductRepository
from schemas.product import ProductCreate, ProductResponse, ProductUpdate
from services.calculation_service import CalculationService
from services.inventory_ledger_service import InventoryLedgerService
from services.tenant import resolve_company_id


class ProductService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.product_repo = ProductRepository(db)
        self.category_repo = CategoryRepository(db)
        self.ledger = InventoryLedgerService(db, self.company_id)
        self.calc = CalculationService

    def get_by_id(self, product_id: int) -> Optional[ProductResponse]:
        product = self.product_repo.get_by_id(self.company_id, product_id)
        if not product:
            return None
        return self._to_response(product)

    def get_by_barcode(self, barcode: str) -> Optional[ProductResponse]:
        product = self.product_repo.get_by_barcode(self.company_id, barcode)
        if not product:
            return None
        return self._to_response(product)

    def get_all(
        self,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        category_id: Optional[int] = None,
    ) -> Tuple[List[ProductResponse], int]:
        products, total = self.product_repo.get_all(
            self.company_id,
            skip=skip,
            limit=limit,
            search=search,
            category_id=category_id,
        )
        return [self._to_response(product) for product in products], total

    def create(self, product_create: ProductCreate, user_id: int | None = None) -> ProductResponse:
        existing = None
        if product_create.barcode:
            existing = self.product_repo.get_by_barcode(
                self.company_id,
                product_create.barcode,
            )
            if existing and existing.is_active:
                raise ValueError(f"Product with barcode '{product_create.barcode}' already exists")

        if product_create.category_id and not self.category_repo.get_by_id(
            self.company_id,
            product_create.category_id,
        ):
            raise ValueError(f"Category with id {product_create.category_id} not found")

        # Stock is owned by the ledger, never assigned to the product row directly.
        values = product_create.model_dump()
        initial_quantity = Decimal(values.pop("stock_quantity", 0) or 0)
        unit_cost = Decimal(values.get("cost_price") or 0)

        if existing:
            # Reactivating a soft-deleted product: refresh catalog fields but never
            # touch stock_quantity / inventory_value directly. Apply only the
            # requested initial quantity as a delta through the ledger.
            for field, value in values.items():
                setattr(existing, field, value)
            existing.is_active = True
            existing = self.product_repo.update(existing)
            if initial_quantity > 0:
                self.ledger.add_layer(
                    product=existing,
                    quantity=initial_quantity,
                    unit_cost=unit_cost,
                    source_type="product_initial",
                    source_id=existing.id,
                    user_id=user_id,
                    reason="Product reactivated",
                )
                # Reload so stock_quantity reflects the Numeric(10,3) column format.
                self.db.refresh(existing)
            return self._to_response(existing)

        # Create the row with zero quantity/value; the ledger sets stock/value/cost.
        product = Product(company_id=self.company_id, **values)
        product.stock_quantity = Decimal("0")
        product.inventory_value = Decimal("0.0000")
        product = self.product_repo.create(product)

        if initial_quantity > 0:
            self.ledger.add_layer(
                product=product,
                quantity=initial_quantity,
                unit_cost=unit_cost,
                source_type="product_initial",
                source_id=product.id,
                user_id=user_id,
                reason="Initial stock",
            )
            # Reload so stock_quantity reflects the Numeric(10,3) column format.
            self.db.refresh(product)

        return self._to_response(product)

    def update(self, product_id: int, product_update: ProductUpdate) -> ProductResponse:
        product = self.product_repo.get_by_id(self.company_id, product_id)
        if not product:
            raise ValueError(f"Product with id {product_id} not found")

        update_data = product_update.model_dump(exclude_unset=True)
        update_data.pop("stock_quantity", None)
        barcode = update_data.get("barcode")
        if barcode:
            existing = self.product_repo.get_by_barcode(self.company_id, barcode)
            if existing and existing.id != product_id:
                raise ValueError(f"Product with barcode '{barcode}' already exists")

        category_id = update_data.get("category_id")
        if category_id is not None and not self.category_repo.get_by_id(self.company_id, category_id):
            raise ValueError(f"Category with id {category_id} not found")

        # cost_price is the average cost backing historical inventory value and
        # purchase-layer costs. Changing it while stock exists would silently
        # rewrite that value, so require zero stock first. Supported workflow:
        # adjust stock to zero, edit cost, then receive a new purchase.
        if "cost_price" in update_data:
            new_cost = update_data["cost_price"]
            if new_cost is not None and Decimal(new_cost) != Decimal(product.cost_price):
                if Decimal(product.stock_quantity or 0) > 0:
                    raise ValueError(
                        "Cannot change cost_price unless stock is zero: "
                        "adjust stock to zero, then edit cost, then receive a new purchase"
                    )

        for field, value in update_data.items():
            setattr(product, field, value)

        product = self.product_repo.update(product)
        return self._to_response(product)

    def delete(self, product_id: int) -> bool:
        return self.product_repo.delete(self.company_id, product_id)

    def get_low_stock(self) -> List[ProductResponse]:
        products = self.product_repo.get_low_stock_products(self.company_id)
        return [self._to_response(product) for product in products]

    def search(self, query: str, limit: int = 10) -> List[ProductResponse]:
        products, _ = self.product_repo.get_all(self.company_id, search=query, limit=limit)
        return [self._to_response(product) for product in products]

    def _to_response(self, product: Product) -> ProductResponse:
        profit_percent = self.calc.calculate_profit_margin_percent(
            product.cost_price,
            product.sell_price,
        )
        return ProductResponse(
            id=product.id,
            barcode=product.barcode,
            name=product.name,
            description=product.description,
            category_id=product.category_id,
            category=(
                {
                    "id": product.category.id,
                    "name": product.category.name,
                }
                if product.category
                else None
            ),
            uom=product.uom,
            cost_price=product.cost_price,
            sell_price=product.sell_price,
            tax_percent=product.tax_percent,
            stock_quantity=product.stock_quantity,
            min_stock_level=product.min_stock_level,
            is_active=product.is_active,
            created_at=product.created_at,
            updated_at=product.updated_at,
            profit_percent=profit_percent,
        )
