"""Unit prices carry 4 decimals; money totals stay at 2.

Reported as "give me 4 digits after the comma, you only gave 2, the value gets
lost". The cost side was widened to 4 decimals long ago (migration a1b2c3d4e5f6)
so a wholesale total could divide cleanly into a per-unit figure; the sell side
was left at 2, so 45 / 24 = 1.8750 could be stored as a cost but not as a price.
"""
from decimal import Decimal

import pytest
from pydantic import ValidationError

from core.security import get_password_hash
from models.category import Category
from models.inventory_layer import InventoryLayer
from models.product import Product
from models.sale import PaymentMethod
from models.sale_item import SaleItem
from models.user import User
from schemas.product import ProductCreate
from schemas.sale import SaleCreate, SaleItemCreate
from services.sale_service import SaleService

# 45 / 24 — the wholesale division that motivated the 4th decimal.
PRECISE_PRICE = Decimal("1.8750")


@pytest.fixture
def cashier(db_session):
    user = User(
        username="price-cashier",
        email="price-cashier@test.com",
        hashed_password=get_password_hash("password"),
        role="cashier",
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture
def product(db_session):
    category = Category(name="Precision")
    db_session.add(category)
    db_session.flush()

    product = Product(
        name="Wholesale item",
        category_id=category.id,
        cost_price=Decimal("1.2500"),
        sell_price=PRECISE_PRICE,
        stock_quantity=Decimal("100.000"),
        inventory_value=Decimal("125.0000"),
    )
    db_session.add(product)
    db_session.flush()
    db_session.add(
        InventoryLayer(
            company_id=product.company_id,
            product_id=product.id,
            source_type="opening_balance",
            source_id=None,
            original_quantity=Decimal("100.000"),
            remaining_quantity=Decimal("100.000"),
            unit_cost=Decimal("1.2500"),
        )
    )
    db_session.flush()
    return product


class TestSchemaAcceptsFourDecimals:
    def test_product_sell_price_takes_four_decimals(self):
        product = ProductCreate(
            name="Item",
            cost_price=Decimal("1.2345"),
            sell_price=PRECISE_PRICE,
        )
        assert product.sell_price == PRECISE_PRICE

    def test_product_sell_price_still_rejects_five(self):
        with pytest.raises(ValidationError):
            ProductCreate(
                name="Item",
                cost_price=Decimal("1.0000"),
                sell_price=Decimal("1.23456"),
            )

    def test_sale_item_unit_price_takes_four_decimals(self):
        item = SaleItemCreate(product_id=1, quantity=Decimal("1"), unit_price=PRECISE_PRICE)
        assert item.unit_price == PRECISE_PRICE


class TestPricePersistence:
    def test_product_sell_price_round_trips_unrounded(self, db_session, product):
        db_session.expire(product)
        assert Decimal(product.sell_price) == PRECISE_PRICE

    def test_sold_unit_price_is_recorded_unrounded(self, db_session, cashier, product):
        service = SaleService(db_session)
        result = service.create(
            SaleCreate(
                items=[
                    SaleItemCreate(
                        product_id=product.id,
                        quantity=Decimal("24"),
                        unit_price=PRECISE_PRICE,
                    )
                ],
                payment_method=PaymentMethod.CASH,
            ),
            cashier_id=cashier.id,
        )

        item = db_session.query(SaleItem).filter(SaleItem.sale_id == result.id).one()
        # The historical line must agree with the price it was sold at, not a
        # 2-decimal approximation of it.
        assert Decimal(item.unit_price) == PRECISE_PRICE

    def test_money_totals_stay_at_two_decimals(self, db_session, cashier, product):
        service = SaleService(db_session)
        result = service.create(
            SaleCreate(
                items=[
                    SaleItemCreate(
                        product_id=product.id,
                        quantity=Decimal("24"),
                        unit_price=PRECISE_PRICE,
                    )
                ],
                payment_method=PaymentMethod.CASH,
            ),
            cashier_id=cashier.id,
        )

        # 24 * 1.8750 divides exactly: the 4th decimal buys an exact total.
        assert result.total_amount == Decimal("45.00")
        assert result.total_amount.as_tuple().exponent == -2

    def test_four_decimal_price_is_not_silently_rounded_into_the_total(
        self, db_session, cashier, product
    ):
        """1.88 (the old rounded price) * 24 = 45.12, not 45.00."""
        service = SaleService(db_session)
        result = service.create(
            SaleCreate(
                items=[
                    SaleItemCreate(
                        product_id=product.id,
                        quantity=Decimal("24"),
                        unit_price=PRECISE_PRICE,
                    )
                ],
                payment_method=PaymentMethod.CASH,
            ),
            cashier_id=cashier.id,
        )

        assert result.total_amount != Decimal("45.12")
