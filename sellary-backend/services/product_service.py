from decimal import Decimal
from typing import List, Tuple, Optional
from sqlalchemy.orm import Session
from repositories.product_repository import ProductRepository
from repositories.category_repository import CategoryRepository
from models.product import Product
from schemas.product import ProductCreate, ProductUpdate, ProductResponse
from services.calculation_service import CalculationService


class ProductService:
    def __init__(self, db: Session):
        self.db = db
        self.product_repo = ProductRepository(db)
        self.category_repo = CategoryRepository(db)
        self.calc = CalculationService

    def get_by_id(self, product_id: int) -> Optional[Product]:
        return self.product_repo.get_by_id(product_id)

    def get_by_barcode(self, barcode: str) -> Optional[Product]:
        return self.product_repo.get_by_barcode(barcode)

    def get_all(
        self,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        category_id: Optional[int] = None,
    ) -> Tuple[List[ProductResponse], int]:
        products, total = self.product_repo.get_all(
            skip=skip, limit=limit, search=search, category_id=category_id
        )
        return [self._to_response(p) for p in products], total

    def create(self, product_create: ProductCreate) -> ProductResponse:
        if self.product_repo.get_by_barcode(product_create.barcode):
            raise ValueError(f"Product with barcode '{product_create.barcode}' already exists")

        if product_create.category_id:
            if not self.category_repo.get_by_id(product_create.category_id):
                raise ValueError(f"Category with id {product_create.category_id} not found")

        product = Product(**product_create.model_dump())
        product = self.product_repo.create(product)
        return self._to_response(product)

    def update(self, product_id: int, product_update: ProductUpdate) -> ProductResponse:
        product = self.product_repo.get_by_id(product_id)
        if not product:
            raise ValueError(f"Product with id {product_id} not found")

        update_data = product_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(product, field, value)

        product = self.product_repo.update(product)
        return self._to_response(product)

    def delete(self, product_id: int) -> bool:
        return self.product_repo.delete(product_id)

    def get_low_stock(self) -> List[ProductResponse]:
        products = self.product_repo.get_low_stock_products()
        return [self._to_response(p) for p in products]

    def search(self, query: str, limit: int = 10) -> List[ProductResponse]:
        products, _ = self.product_repo.get_all(search=query, limit=limit)
        return [self._to_response(p) for p in products]

    def _to_response(self, product: Product) -> ProductResponse:
        profit_percent = self.calc.calculate_profit_margin_percent(
            product.cost_price, product.sell_price
        )
        return ProductResponse(
            id=product.id,
            barcode=product.barcode,
            name=product.name,
            description=product.description,
            category_id=product.category_id,
            category={
                "id": product.category.id,
                "name": product.category.name,
            } if product.category else None,
            cost_price=product.cost_price,
            sell_price=product.sell_price,
            tax_percent=product.tax_percent,
            stock_quantity=product.stock_quantity,
            min_stock_level=product.min_stock_level,
            is_active=product.is_active,
            product_type=product.product_type,
            created_at=product.created_at,
            updated_at=product.updated_at,
            profit_percent=profit_percent,
        )
