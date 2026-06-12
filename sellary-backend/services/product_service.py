from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from models.product import Product
from repositories.category_repository import CategoryRepository
from repositories.product_repository import ProductRepository
from schemas.product import ProductCreate, ProductResponse, ProductUpdate
from services.calculation_service import CalculationService
from services.tenant import resolve_company_id


class ProductService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)
        self.product_repo = ProductRepository(db)
        self.category_repo = CategoryRepository(db)
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

    def create(self, product_create: ProductCreate) -> ProductResponse:
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

        if existing:
            for field, value in product_create.model_dump().items():
                setattr(existing, field, value)
            existing.is_active = True
            existing = self.product_repo.update(existing)
            return self._to_response(existing)

        product = Product(company_id=self.company_id, **product_create.model_dump())
        product = self.product_repo.create(product)
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
