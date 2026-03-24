from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import or_
from models.product import Product
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
        return self.db.query(Product).filter(
            Product.company_id == company_id,
            Product.barcode == barcode,
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

    def create(self, product: Product) -> Product:
        self.db.add(product)
        self.db.commit()
        self.db.refresh(product)
        return product

    def update(self, product: Product) -> Product:
        self.db.commit()
        self.db.refresh(product)
        return product

    def delete(self, company_id: int, product_id: int) -> bool:
        product = self.get_by_id(company_id, product_id)
        if product:
            self.db.delete(product)
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
