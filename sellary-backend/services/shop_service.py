"""Map gated catalog rows to shopper-safe schemas. Cross-company, read-only."""
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from models.company import Company
from models.product import Product
from repositories.shop_repository import ShopRepository
from schemas.shop import (
    CatalogPage,
    ShopCategory,
    ShopDetail,
    ShopProduct,
    ShopSummary,
)


class ShopService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ShopRepository(db)

    def catalog(
        self,
        *,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        category_id: Optional[int] = None,
        company_id: Optional[int] = None,
    ) -> CatalogPage:
        products, total = self.repo.catalog(
            skip=skip,
            limit=limit,
            search=search,
            category_id=category_id,
            company_id=company_id,
        )
        return CatalogPage(
            items=[self._to_product(p) for p in products],
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_product(self, product_id: int) -> Optional[ShopProduct]:
        product = self.repo.get_published_product(product_id)
        return self._to_product(product) if product else None

    def list_shops(self) -> List[ShopSummary]:
        return [self._to_summary(c) for c in self.repo.enabled_shops()]

    def get_shop(self, slug: str) -> Optional[ShopDetail]:
        company = self.repo.get_enabled_shop_by_slug(slug)
        if company is None:
            return None
        products = self.repo.products_for_shop(company.id)
        return ShopDetail(
            shop=self._to_summary(company),
            products=[self._to_product(p) for p in products],
        )

    def list_categories(self) -> List[ShopCategory]:
        return [
            ShopCategory(id=c.id, name=c.name)
            for c in self.repo.published_categories()
        ]

    def _to_summary(self, company: Company) -> ShopSummary:
        return ShopSummary(
            company_id=company.id,
            slug=company.slug,
            name=company.name,
            logo_url=company.logo_url,
            marketplace_description=company.marketplace_description,
            supports_delivery=company.supports_delivery,
            supports_pickup=company.supports_pickup,
        )

    def _to_product(self, product: Product) -> ShopProduct:
        category = product.category if product.category and product.category.is_active else None
        return ShopProduct(
            id=product.id,
            name=product.name,
            description=product.description,
            sell_price=product.sell_price,
            image_url=product.image_url,
            uom=product.uom,
            category_id=category.id if category else None,
            category_name=category.name if category else None,
            company_id=product.company_id,
            company_name=product.company.name,
            company_slug=product.company.slug,
            in_stock=Decimal(product.stock_quantity or 0) > 0,
        )
