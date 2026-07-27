"""Resolving a dictated delivery against the catalogue.

This is the part of the connector most likely to be wrong, and the failure is
expensive in both directions: a bad merge corrupts the catalogue, a missed
match creates a duplicate product. The rule the tests encode is that nothing is
silently decided — every outcome is labelled and every adjustment reported.
"""

from decimal import Decimal

import pytest

from mcp_server.purchase_resolve import (
    LineError,
    resolve_lines,
    resolve_supplier,
)
from models.product import Product
from models.supplier import Supplier


@pytest.fixture
def catalogue(db_session):
    company_id = db_session.info["default_company_id"]
    products = [
        Product(
            company_id=company_id,
            name="Сахар песок 1кг",
            barcode="4600000000017",
            uom="dona",
            cost_price=Decimal("5.0000"),
            sell_price=Decimal("6.5000"),
            stock_quantity=Decimal("40.000"),
            min_stock_level=Decimal("5.000"),
            is_active=True,
        ),
        Product(
            company_id=company_id,
            name="Мука высший сорт 2кг",
            barcode="4600000000024",
            uom="dona",
            cost_price=Decimal("8.0000"),
            sell_price=Decimal("11.0000"),
            stock_quantity=Decimal("12.000"),
            min_stock_level=Decimal("5.000"),
            is_active=True,
        ),
        Product(
            company_id=company_id,
            name="Масло подсолнечное 1л",
            uom="dona",
            cost_price=Decimal("12.0000"),
            sell_price=Decimal("15.0000"),
            stock_quantity=Decimal("7.000"),
            min_stock_level=Decimal("5.000"),
            is_active=True,
        ),
        Product(
            company_id=company_id,
            name="Масло подсолнечное 5л",
            uom="dona",
            cost_price=Decimal("55.0000"),
            sell_price=Decimal("68.0000"),
            stock_quantity=Decimal("3.000"),
            min_stock_level=Decimal("2.000"),
            is_active=True,
        ),
    ]
    db_session.add_all(products)
    db_session.flush()
    return company_id


def _resolve(db_session, company_id, items, **kwargs):
    return resolve_lines(db_session, company_id, items, **kwargs)


class TestMatching:
    def test_an_exact_name_matches(self, db_session, catalogue):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.10"}],
        )
        assert lines[0].status == "matched"
        assert lines[0].product_name == "Сахар песок 1кг"
        assert lines[0].current_stock == Decimal("40.000")

    def test_a_barcode_matches_even_when_the_name_is_wrong(
        self, db_session, catalogue
    ):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [
                {
                    "query": "белый сахарок",
                    "barcode": "4600000000017",
                    "quantity": 5,
                    "unit_cost": "5.00",
                }
            ],
        )
        assert lines[0].status == "matched"
        assert lines[0].product_name == "Сахар песок 1кг"

    def test_case_and_spacing_do_not_defeat_the_match(self, db_session, catalogue):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "мука высший сорт 2кг", "quantity": 3, "unit_cost": "8.00"}],
        )
        assert lines[0].status == "matched"

    def test_an_explicit_product_id_overrides_all_guessing(
        self, db_session, catalogue
    ):
        target = (
            db_session.query(Product)
            .filter(Product.name == "Масло подсолнечное 5л")
            .one()
        )
        lines, _ = _resolve(
            db_session,
            catalogue,
            [
                {
                    "query": "совершенно другое название",
                    "product_id": target.id,
                    "quantity": 2,
                    "unit_cost": "55.00",
                }
            ],
        )
        assert lines[0].status == "matched"
        assert lines[0].product_id == target.id

    def test_an_unknown_explicit_id_is_an_error_not_a_new_product(
        self, db_session, catalogue
    ):
        with pytest.raises(LineError):
            _resolve(
                db_session,
                catalogue,
                [{"query": "что-то", "product_id": 999999, "quantity": 1, "unit_cost": "1"}],
            )


class TestAmbiguity:
    def test_two_equally_close_names_are_reported_rather_than_guessed(
        self, db_session, catalogue
    ):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Масло подсолнечное", "quantity": 6, "unit_cost": "12.00"}],
        )
        assert lines[0].status == "ambiguous"
        names = {candidate["name"] for candidate in lines[0].candidates}
        assert names == {"Масло подсолнечное 1л", "Масло подсолнечное 5л"}

    def test_an_ambiguous_line_carries_ids_to_disambiguate_with(
        self, db_session, catalogue
    ):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Масло подсолнечное", "quantity": 6, "unit_cost": "12.00"}],
        )
        assert all(c["product_id"] for c in lines[0].candidates)


class TestNewProducts:
    def test_an_unknown_name_becomes_a_proposed_product(self, db_session, catalogue):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Гречка ядрица 800г", "quantity": 20, "unit_cost": "7.00"}],
        )
        assert lines[0].status == "new"
        assert lines[0].product_name == "Гречка ядрица 800г"
        assert lines[0].product_id is None

    def test_a_missing_sell_price_is_derived_and_flagged_as_a_guess(
        self, db_session, catalogue
    ):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Гречка ядрица 800г", "quantity": 20, "unit_cost": "10.00"}],
            markup=Decimal("0.30"),
        )
        assert lines[0].sell_price == Decimal("13.0000")
        assert lines[0].sell_price_guessed is True
        assert any("Проверьте" in warning for warning in lines[0].warnings)

    def test_an_explicit_sell_price_is_taken_as_given(self, db_session, catalogue):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [
                {
                    "query": "Гречка ядрица 800г",
                    "quantity": 20,
                    "unit_cost": "10.00",
                    "sell_price": "14.50",
                }
            ],
        )
        assert lines[0].sell_price == Decimal("14.5000")
        assert lines[0].sell_price_guessed is False


class TestWarnings:
    def test_a_large_price_change_is_surfaced(self, db_session, catalogue):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "9.00"}],
        )
        assert lines[0].status == "matched"
        assert any("выше" in warning for warning in lines[0].warnings)

    def test_a_small_price_change_is_not_noise(self, db_session, catalogue):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.20"}],
        )
        assert lines[0].warnings == []

    def test_a_zero_cost_is_called_out(self, db_session, catalogue):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "0"}],
        )
        assert any("нулю" in warning for warning in lines[0].warnings)


class TestMerging:
    def test_the_same_product_twice_becomes_one_line(self, db_session, catalogue):
        lines, notes = _resolve(
            db_session,
            catalogue,
            [
                {"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.00"},
                {"query": "Сахар песок 1кг", "quantity": 30, "unit_cost": "6.00"},
            ],
        )
        assert len(lines) == 1
        assert lines[0].quantity == Decimal("40.000")
        assert notes, "a merge must be reported, never silent"

    def test_the_merged_cost_is_weighted_by_quantity(self, db_session, catalogue):
        """Averaging the two prices would be wrong whenever quantities differ."""
        lines, _ = _resolve(
            db_session,
            catalogue,
            [
                {"query": "Сахар песок 1кг", "quantity": 10, "unit_cost": "5.00"},
                {"query": "Сахар песок 1кг", "quantity": 30, "unit_cost": "6.00"},
            ],
        )
        # (10*5 + 30*6) / 40 = 5.75, not (5+6)/2 = 5.50
        assert lines[0].unit_cost == Decimal("5.7500")

    def test_new_products_are_never_merged_into_each_other(
        self, db_session, catalogue
    ):
        lines, _ = _resolve(
            db_session,
            catalogue,
            [
                {"query": "Совсем новый товар А", "quantity": 1, "unit_cost": "1.00"},
                {"query": "Совсем новый товар Б", "quantity": 2, "unit_cost": "2.00"},
            ],
        )
        assert len(lines) == 2


class TestInputValidation:
    def test_an_empty_list_is_refused(self, db_session, catalogue):
        with pytest.raises(LineError):
            _resolve(db_session, catalogue, [])

    def test_a_line_without_a_name_is_refused(self, db_session, catalogue):
        with pytest.raises(LineError):
            _resolve(db_session, catalogue, [{"quantity": 1, "unit_cost": "1"}])

    def test_a_zero_quantity_is_refused(self, db_session, catalogue):
        with pytest.raises(LineError) as exc:
            _resolve(
                db_session,
                catalogue,
                [{"query": "Сахар песок 1кг", "quantity": 0, "unit_cost": "5"}],
            )
        assert "количество" in str(exc.value)

    def test_an_unreadable_price_names_the_line(self, db_session, catalogue):
        with pytest.raises(LineError) as exc:
            _resolve(
                db_session,
                catalogue,
                [{"query": "Сахар песок 1кг", "quantity": 1, "unit_cost": "дорого"}],
            )
        assert "Строка 1" in str(exc.value)

    def test_a_comma_decimal_is_understood(self, db_session, catalogue):
        """People dictate prices as "5,50"; refusing that would be pedantry."""
        lines, _ = _resolve(
            db_session,
            catalogue,
            [{"query": "Сахар песок 1кг", "quantity": "2,5", "unit_cost": "5,50"}],
        )
        assert lines[0].quantity == Decimal("2.500")
        assert lines[0].unit_cost == Decimal("5.5000")


class TestSupplierResolution:
    @pytest.fixture
    def suppliers(self, db_session, catalogue):
        db_session.add_all(
            [
                Supplier(
                    company_id=catalogue,
                    name="ООО Ромашка",
                    phone="+992900000001",
                    is_active=True,
                ),
                Supplier(
                    company_id=catalogue,
                    name="Восток Трейд",
                    phone="+992900000002",
                    is_active=True,
                ),
            ]
        )
        db_session.flush()
        return catalogue

    def test_an_exact_name_resolves(self, db_session, suppliers):
        supplier = resolve_supplier(db_session, suppliers, "ООО Ромашка")
        assert supplier is not None and supplier.name == "ООО Ромашка"

    def test_a_close_name_resolves(self, db_session, suppliers):
        supplier = resolve_supplier(db_session, suppliers, "ромашка")
        assert supplier is not None and supplier.name == "ООО Ромашка"

    def test_an_unknown_supplier_is_never_invented(self, db_session, suppliers):
        """A supplier is a relationship with terms, not a label on a delivery."""
        assert resolve_supplier(db_session, suppliers, "Неизвестный поставщик") is None
