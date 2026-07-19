"""Shop schemas expose only shopper-safe fields (no cost/margin)."""
from decimal import Decimal

from schemas.shop import CatalogPage, ShopCategory, ShopProduct, ShopSummary


def test_shop_product_omits_cost_fields():
    p = ShopProduct(
        id=1,
        name="Milk",
        description=None,
        sell_price=Decimal("12000"),
        image_url=None,
        uom="dona",
        category_id=None,
        category_name=None,
        company_id=5,
        company_name="Shop A",
        company_slug="shop-a",
        in_stock=True,
    )
    dumped = p.model_dump()
    assert "cost_price" not in dumped
    assert "profit_percent" not in dumped
    assert dumped["sell_price"] == Decimal("12000")
    assert dumped["in_stock"] is True


def test_catalog_page_wraps_items():
    page = CatalogPage(items=[], total=0, skip=0, limit=20)
    assert page.total == 0 and page.items == []


def test_shop_summary_and_category_shapes():
    s = ShopSummary(
        company_id=5,
        slug="shop-a",
        name="Shop A",
        logo_url=None,
        marketplace_description="Best",
        supports_delivery=True,
        supports_pickup=False,
    )
    assert s.slug == "shop-a"
    c = ShopCategory(id=3, name="Drinks")
    assert c.name == "Drinks"
