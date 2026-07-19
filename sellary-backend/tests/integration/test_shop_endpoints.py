"""End-to-end /api/shop routes with initData auth + published/enabled gating."""
import hashlib
import hmac
import json
from decimal import Decimal
from urllib.parse import urlencode

import pytest

from core.config import settings
from models.product import Product

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _init_data(telegram_id=42, bot_token=BOT_TOKEN):
    user = json.dumps(
        {"id": telegram_id, "first_name": "Ali", "username": "shopper"},
        separators=(",", ":"),
    )
    fields = {"auth_date": "1700000000", "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


@pytest.fixture
def shop_headers(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10**12)
    return {"X-Telegram-Init-Data": _init_data()}


def _publish_product(db, company, name, price="10.00"):
    company.is_marketplace_enabled = True
    db.flush()
    p = Product(
        company_id=company.id,
        name=name,
        cost_price=Decimal("4.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal("5"),
        is_active=True,
        is_published=True,
    )
    db.add(p)
    db.flush()
    return p


def test_catalog_requires_init_data(client):
    resp = client.get("/api/shop/catalog")
    assert resp.status_code in (401, 422)


def test_catalog_returns_published(client, db_session, default_company, shop_headers):
    _publish_product(db_session, default_company, "Apple")
    resp = client.get("/api/shop/catalog", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 1
    assert "Apple" in {i["name"] for i in body["items"]}
    # No cost leakage in the wire response.
    assert all("cost_price" not in i for i in body["items"])


def test_catalog_company_filter(
    client, db_session, default_company, secondary_company, shop_headers
):
    _publish_product(db_session, default_company, "D1")
    _publish_product(db_session, secondary_company, "S1")
    resp = client.get(
        f"/api/shop/catalog?company={secondary_company.id}", headers=shop_headers
    )
    assert resp.status_code == 200, resp.text
    assert {i["name"] for i in resp.json()["items"]} == {"S1"}


def test_get_single_product(client, db_session, default_company, shop_headers):
    p = _publish_product(db_session, default_company, "Milk")
    resp = client.get(f"/api/shop/products/{p.id}", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Milk"


def test_get_unpublished_product_404(client, db_session, default_company, shop_headers):
    default_company.is_marketplace_enabled = True
    db_session.flush()
    p = Product(
        company_id=default_company.id,
        name="Hidden",
        cost_price=Decimal("1.0000"),
        sell_price=Decimal("2.0000"),
        stock_quantity=Decimal("1"),
        is_active=True,
        is_published=False,
    )
    db_session.add(p)
    db_session.flush()
    resp = client.get(f"/api/shop/products/{p.id}", headers=shop_headers)
    assert resp.status_code == 404, resp.text


def test_list_shops(client, db_session, default_company, shop_headers):
    _publish_product(db_session, default_company, "X")
    resp = client.get("/api/shop/shops", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    assert default_company.id in {s["company_id"] for s in resp.json()}


def test_get_shop_by_slug(client, db_session, default_company, shop_headers):
    _publish_product(db_session, default_company, "OnlyOne")
    resp = client.get(f"/api/shop/shops/{default_company.slug}", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["shop"]["slug"] == default_company.slug
    assert {p["name"] for p in body["products"]} == {"OnlyOne"}


def test_get_unknown_shop_404(client, shop_headers):
    resp = client.get("/api/shop/shops/does-not-exist", headers=shop_headers)
    assert resp.status_code == 404, resp.text


def test_categories(client, db_session, default_company, shop_headers):
    from models.category import Category

    cat = Category(company_id=default_company.id, name="Fruit")
    db_session.add(cat)
    db_session.flush()
    default_company.is_marketplace_enabled = True
    db_session.flush()
    p = Product(
        company_id=default_company.id,
        name="Kiwi",
        cost_price=Decimal("1.0000"),
        sell_price=Decimal("2.0000"),
        stock_quantity=Decimal("1"),
        is_active=True,
        is_published=True,
        category_id=cat.id,
    )
    db_session.add(p)
    db_session.flush()
    resp = client.get("/api/shop/categories", headers=shop_headers)
    assert resp.status_code == 200, resp.text
    assert "Fruit" in {c["name"] for c in resp.json()}
