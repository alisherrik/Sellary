"""No cross-tenant leakage: only published products of enabled shops surface."""
import hashlib
import hmac
import json
from decimal import Decimal
from urllib.parse import urlencode

import pytest

from core.config import settings
from models.product import Product

BOT_TOKEN = "123456:TEST-BOT-TOKEN"


def _headers(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(settings, "TELEGRAM_AUTH_MAX_AGE_SECONDS", 10**12)
    user = json.dumps({"id": 7, "first_name": "T"}, separators=(",", ":"))
    fields = {"auth_date": "1700000000", "user": user}
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    return {"X-Telegram-Init-Data": urlencode(fields)}


def _add(db, company, name, *, published, price="9.00"):
    p = Product(
        company_id=company.id,
        name=name,
        cost_price=Decimal("1.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal("3"),
        is_active=True,
        is_published=published,
    )
    db.add(p)
    db.flush()
    return p


def test_disabled_shop_never_leaks(
    client, db_session, default_company, secondary_company, monkeypatch
):
    headers = _headers(monkeypatch)
    # default is enabled; secondary stays disabled but has a "published" product.
    default_company.is_marketplace_enabled = True
    db_session.flush()
    _add(db_session, default_company, "PublicItem", published=True)
    _add(db_session, secondary_company, "ShouldNeverShow", published=True)

    catalog = client.get("/api/shop/catalog", headers=headers).json()
    names = {i["name"] for i in catalog["items"]}
    assert "PublicItem" in names
    assert "ShouldNeverShow" not in names

    # Shop list must not include the disabled secondary shop.
    shops = client.get("/api/shop/shops", headers=headers).json()
    assert secondary_company.id not in {s["company_id"] for s in shops}

    # Its slug detail must 404, not reveal products.
    resp = client.get(f"/api/shop/shops/{secondary_company.slug}", headers=headers)
    assert resp.status_code == 404


def test_enabling_one_shop_does_not_expose_others_unpublished(
    client, db_session, default_company, secondary_company, monkeypatch
):
    headers = _headers(monkeypatch)
    default_company.is_marketplace_enabled = True
    secondary_company.is_marketplace_enabled = True
    db_session.flush()
    _add(db_session, default_company, "DefPublic", published=True)
    _add(db_session, secondary_company, "SecUnpublished", published=False)

    catalog = client.get("/api/shop/catalog", headers=headers).json()
    names = {i["name"] for i in catalog["items"]}
    assert "DefPublic" in names
    assert "SecUnpublished" not in names
