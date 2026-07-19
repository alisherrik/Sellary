"""Shop service gates on published+enabled and isolates nothing it shouldn't leak.

Uses default_company and secondary_company to prove cross-shop visibility for
enabled shops and invisibility for disabled ones / unpublished products.
"""
from decimal import Decimal

import pytest

from models.category import Category
from models.company import Company
from models.product import Product
from services.shop_service import ShopService


def _mk_product(db, company, name, *, published=True, category=None, stock=5, price="10.00"):
    p = Product(
        company_id=company.id,
        name=name,
        cost_price=Decimal("4.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal(stock),
        is_active=True,
        is_published=published,
        category_id=category.id if category else None,
    )
    db.add(p)
    db.flush()
    return p


@pytest.fixture
def enabled_default(db_session, default_company):
    default_company.is_marketplace_enabled = True
    default_company.name = "Default Shop"
    db_session.flush()
    return default_company


@pytest.fixture
def enabled_secondary(db_session, secondary_company):
    secondary_company.is_marketplace_enabled = True
    secondary_company.name = "Second Shop"
    db_session.flush()
    return secondary_company


def test_catalog_spans_enabled_shops(db_session, enabled_default, enabled_secondary):
    _mk_product(db_session, enabled_default, "Apple")
    _mk_product(db_session, enabled_secondary, "Banana")
    page = ShopService(db_session).catalog(skip=0, limit=50)
    names = {i.name for i in page.items}
    assert {"Apple", "Banana"} <= names
    assert page.total >= 2


def test_unpublished_product_hidden(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "Secret", published=False)
    page = ShopService(db_session).catalog(skip=0, limit=50)
    assert "Secret" not in {i.name for i in page.items}


def test_disabled_shop_hidden(db_session, default_company, secondary_company):
    # default enabled, secondary NOT enabled
    default_company.is_marketplace_enabled = True
    db_session.flush()
    _mk_product(db_session, default_company, "Visible")
    _mk_product(db_session, secondary_company, "FromDisabledShop")
    page = ShopService(db_session).catalog(skip=0, limit=50)
    names = {i.name for i in page.items}
    assert "Visible" in names
    assert "FromDisabledShop" not in names


def test_product_response_omits_cost(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "Milk", price="12000.00")
    page = ShopService(db_session).catalog(skip=0, limit=50)
    item = next(i for i in page.items if i.name == "Milk")
    dumped = item.model_dump()
    assert "cost_price" not in dumped
    assert item.sell_price == Decimal("12000.00")
    assert item.company_id == enabled_default.id


def test_search_filter(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "Red Apple")
    _mk_product(db_session, enabled_default, "Green Pear")
    page = ShopService(db_session).catalog(skip=0, limit=50, search="apple")
    assert {i.name for i in page.items} == {"Red Apple"}


def test_company_filter(db_session, enabled_default, enabled_secondary):
    _mk_product(db_session, enabled_default, "D1")
    _mk_product(db_session, enabled_secondary, "S1")
    page = ShopService(db_session).catalog(
        skip=0, limit=50, company_id=enabled_secondary.id
    )
    assert {i.name for i in page.items} == {"S1"}


def test_category_filter(db_session, enabled_default):
    cat = Category(company_id=enabled_default.id, name="Fruit")
    db_session.add(cat)
    db_session.flush()
    _mk_product(db_session, enabled_default, "Kiwi", category=cat)
    _mk_product(db_session, enabled_default, "Bread")
    page = ShopService(db_session).catalog(skip=0, limit=50, category_id=cat.id)
    assert {i.name for i in page.items} == {"Kiwi"}


def test_get_product_only_if_published(db_session, enabled_default):
    hidden = _mk_product(db_session, enabled_default, "Hidden", published=False)
    shown = _mk_product(db_session, enabled_default, "Shown")
    svc = ShopService(db_session)
    assert svc.get_product(hidden.id) is None
    assert svc.get_product(shown.id).name == "Shown"


def test_list_shops_only_enabled(db_session, enabled_default, secondary_company):
    shops = ShopService(db_session).list_shops()
    ids = {s.company_id for s in shops}
    assert enabled_default.id in ids
    assert secondary_company.id not in ids


def test_get_shop_by_slug_with_products(db_session, enabled_default):
    _mk_product(db_session, enabled_default, "OnlyOne")
    detail = ShopService(db_session).get_shop(enabled_default.slug)
    assert detail is not None
    assert detail.shop.company_id == enabled_default.id
    assert {p.name for p in detail.products} == {"OnlyOne"}


def test_categories_only_from_published_products(db_session, enabled_default):
    used = Category(company_id=enabled_default.id, name="Used")
    unused = Category(company_id=enabled_default.id, name="Unused")
    db_session.add_all([used, unused])
    db_session.flush()
    _mk_product(db_session, enabled_default, "P1", category=used)
    cats = ShopService(db_session).list_categories()
    names = {c.name for c in cats}
    assert "Used" in names
    assert "Unused" not in names
