from typing import List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from models.category import Category
from models.company import Company
from models.product import Product


class ShopRepository:
    """Cross-company, read-only queries for the public marketplace catalog.

    Every query is gated by the marketplace visibility rule:
      Product.is_published AND Product.is_active
      AND Company.is_marketplace_enabled AND Company.is_active
    This is the one place tenant scope is intentionally global — reads only.
    """

    def __init__(self, db: Session):
        self.db = db

    def _base_product_query(self):
        return (
            self.db.query(Product)
            .join(Company, Product.company_id == Company.id)
            .options(joinedload(Product.company), joinedload(Product.category))
            .filter(
                Product.is_published.is_(True),
                Product.is_active.is_(True),
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
        )

    def catalog(
        self,
        *,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        category_id: Optional[int] = None,
        company_id: Optional[int] = None,
    ) -> Tuple[List[Product], int]:
        query = self._base_product_query()
        if search:
            query = query.filter(
                or_(
                    Product.name.ilike(f"%{search}%"),
                    Product.barcode.ilike(f"%{search}%"),
                )
            )
        if category_id is not None:
            query = query.filter(Product.category_id == category_id)
        if company_id is not None:
            query = query.filter(Product.company_id == company_id)
        total = query.count()
        products = query.order_by(Product.id).offset(skip).limit(limit).all()
        return products, total

    def get_published_product(self, product_id: int) -> Optional[Product]:
        return self._base_product_query().filter(Product.id == product_id).first()

    def enabled_shops(self) -> List[Company]:
        return (
            self.db.query(Company)
            .filter(
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
            .order_by(Company.name)
            .all()
        )

    def get_enabled_shop_by_slug(self, slug: str) -> Optional[Company]:
        return (
            self.db.query(Company)
            .filter(
                Company.slug == slug,
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
            .first()
        )

    def products_for_shop(self, company_id: int) -> List[Product]:
        return (
            self._base_product_query()
            .filter(Product.company_id == company_id)
            .order_by(Product.id)
            .all()
        )

    def published_categories(self) -> List[Category]:
        return (
            self.db.query(Category)
            .join(Product, Product.category_id == Category.id)
            .join(Company, Product.company_id == Company.id)
            .filter(
                Category.is_active.is_(True),
                Product.is_published.is_(True),
                Product.is_active.is_(True),
                Company.is_marketplace_enabled.is_(True),
                Company.is_active.is_(True),
            )
            .distinct()
            .order_by(Category.name)
            .all()
        )
