"""Marketplace columns exist on Product and Company with correct defaults."""
from decimal import Decimal

from models.company import Company
from models.product import Product


def test_product_marketplace_defaults(db_session):
    company = db_session.query(Company).first()
    if company is None:
        company = Company(name="MP Co", slug="mp-co")
        db_session.add(company)
        db_session.flush()
    product = Product(
        company_id=company.id,
        name="Online item",
        cost_price=Decimal("1.0000"),
        sell_price=Decimal("2.0000"),
    )
    db_session.add(product)
    db_session.flush()
    assert product.is_published is False
    assert product.image_url is None


def test_company_marketplace_defaults(db_session):
    company = Company(name="Shop A", slug="shop-a-mp")
    db_session.add(company)
    db_session.flush()
    assert company.is_marketplace_enabled is False
    assert company.supports_delivery is True
    assert company.supports_pickup is True
    assert company.logo_url is None
    assert company.marketplace_description is None
