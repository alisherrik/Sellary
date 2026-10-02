from decimal import Decimal

from models.product import Product
from services.inventory_service import InventoryService


def test_valuation_includes_all_active_products_only_in_its_company(
    db_session, default_company, secondary_company
):
    db_session.add_all(
        [
            Product(
                company_id=default_company.id,
                name=f"Valuation product {index:03d}",
                barcode=f"VALUATION-{index}",
                cost_price=Decimal("2.5000"),
                sell_price=Decimal("5.0000"),
                stock_quantity=Decimal("1.125"),
                inventory_value=Decimal("3.4567"),
                is_active=True,
            )
            for index in range(125)
        ]
        + [
            Product(
                company_id=default_company.id,
                name="Archived valuation product",
                barcode="VALUATION-ARCHIVED",
                cost_price=Decimal("1"),
                sell_price=Decimal("2"),
                stock_quantity=Decimal("900"),
                inventory_value=Decimal("900"),
                is_active=False,
            ),
            Product(
                company_id=secondary_company.id,
                name="Foreign valuation product",
                barcode="VALUATION-FOREIGN",
                cost_price=Decimal("1"),
                sell_price=Decimal("2"),
                stock_quantity=Decimal("800"),
                inventory_value=Decimal("800"),
                is_active=True,
            ),
        ]
    )
    db_session.flush()

    assert InventoryService(db_session, default_company.id).get_inventory_value() == {
        "total_value": "432.09",
        "total_products": 125,
        "total_items": Decimal("140.625"),
    }
