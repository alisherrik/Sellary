"""Money accounts: balances, movements, transfers, and what must not change.

The shop that prompted this feature had no way to record that cash went to the
bank or that card takings were withdrawn and put in the drawer. Every such
movement showed up as a недостача or an излишек on the shift, and the owner
could not answer "how much is on the card".
"""
from decimal import Decimal

import pytest


def _accounts(client, headers):
    response = client.get("/api/money/accounts", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _till_id(client, headers) -> int:
    body = _accounts(client, headers)
    till = next(a for a in body["accounts"] if a["is_till"])
    return till["id"]


class TestAccounts:
    def test_the_till_appears_on_first_read(self, client, admin_headers):
        body = _accounts(client, admin_headers)
        tills = [a for a in body["accounts"] if a["is_till"]]
        assert len(tills) == 1
        assert tills[0]["name"] == "Касса"

    def test_a_card_sale_creates_that_card_s_account(
        self, client, db_session, test_sale, default_company, admin_headers
    ):
        from models.sale import PaymentMethod

        test_sale.payment_method = PaymentMethod.CARD
        test_sale.card_type = "dc"
        db_session.flush()

        body = _accounts(client, admin_headers)
        card_accounts = [a for a in body["accounts"] if a["card_type"] == "dc"]
        assert len(card_accounts) == 1
        # The sale's whole total landed on the bank, not in the drawer.
        assert Decimal(card_accounts[0]["balance"]) == Decimal("33.00")

    def test_a_cash_sale_lands_in_the_till(self, client, test_sale, admin_headers):
        body = _accounts(client, admin_headers)
        till = next(a for a in body["accounts"] if a["is_till"])
        assert Decimal(till["balance"]) == Decimal("33.00")

    def test_a_credit_sale_moves_no_money_anywhere(
        self, client, db_session, test_sale, admin_headers
    ):
        from models.sale import PaymentMethod

        test_sale.payment_method = PaymentMethod.CREDIT
        db_session.flush()
        body = _accounts(client, admin_headers)
        assert Decimal(body["total"]) == Decimal("0.00")

    def test_a_plain_account_can_be_added_by_hand(self, client, admin_headers):
        response = client.post(
            "/api/money/accounts",
            json={"name": "Сейф", "opening_balance": "500.00"},
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text
        assert Decimal(response.json()["balance"]) == Decimal("500.00")

    def test_two_plain_accounts_can_coexist(self, client, admin_headers):
        for name in ("Сейф", "Банк · расчётный"):
            response = client.post(
                "/api/money/accounts", json={"name": name}, headers=admin_headers
            )
            assert response.status_code == 201, response.text

    def test_the_till_cannot_be_switched_off(self, client, admin_headers):
        till_id = _till_id(client, admin_headers)
        response = client.patch(
            f"/api/money/accounts/{till_id}", json={"is_active": False}, headers=admin_headers
        )
        assert response.status_code == 400
        assert "смена" in response.json()["detail"].lower()


class TestMovements:
    @pytest.mark.no_auto_shift
    def test_till_movement_needs_an_open_shift(self, client, admin_headers):
        """Cash out of the drawer with no shift belongs to no reconciliation.

        It could also never be recorded into a closed shift, whose totals are
        frozen — so the only moment a till movement is accepted is while a
        shift is open, which is also the only moment the drawer is.
        """
        till_id = _till_id(client, admin_headers)
        response = client.post(
            "/api/money/movements",
            json={
                "account_id": till_id,
                "direction": "out",
                "amount": "150.00",
                "reason": "supplier_payment",
            },
            headers=admin_headers,
        )
        assert response.status_code == 409
        assert "Смена не открыта" in response.json()["detail"]

    def test_a_till_movement_lands_in_the_open_shift(self, client, admin_headers):
        till_id = _till_id(client, admin_headers)
        before = client.get("/api/shifts/current", headers=admin_headers).json()
        expected_before = Decimal(before["totals"]["expected_cash"])

        response = client.post(
            "/api/money/till",
            json={
                "account_id": till_id,
                "direction": "out",
                "amount": "150.00",
                "reason": "supplier_payment",
                "note": "Оплата за хлеб",
            },
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text

        after = client.get("/api/shifts/current", headers=admin_headers).json()
        totals = after["totals"]
        assert Decimal(totals["movements_out"]) == Decimal("150.00")
        assert Decimal(totals["expected_cash"]) == expected_before - Decimal("150.00")
        assert totals["movements"][0]["reason_label"] == "Оплата поставщику"
        assert totals["movements"][0]["note"] == "Оплата за хлеб"

    def test_cash_brought_in_raises_the_expected_drawer(self, client, admin_headers):
        till_id = _till_id(client, admin_headers)
        before = Decimal(
            client.get("/api/shifts/current", headers=admin_headers).json()["totals"][
                "expected_cash"
            ]
        )
        response = client.post(
            "/api/money/till",
            json={
                "account_id": till_id,
                "direction": "in",
                "amount": "300.00",
                "reason": "owner_deposit",
            },
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text
        after = client.get("/api/shifts/current", headers=admin_headers).json()["totals"]
        assert Decimal(after["movements_in"]) == Decimal("300.00")
        assert Decimal(after["expected_cash"]) == before + Decimal("300.00")

    def test_the_till_route_refuses_any_other_account(self, client, admin_headers):
        created = client.post(
            "/api/money/accounts", json={"name": "Сейф"}, headers=admin_headers
        ).json()
        response = client.post(
            "/api/money/till",
            json={
                "account_id": created["id"],
                "direction": "in",
                "amount": "10.00",
                "reason": "owner_deposit",
            },
            headers=admin_headers,
        )
        assert response.status_code == 400

    def test_a_non_till_account_needs_no_shift(self, client, admin_headers):
        created = client.post(
            "/api/money/accounts", json={"name": "Сейф", "opening_balance": "1000.00"},
            headers=admin_headers,
        ).json()
        response = client.post(
            "/api/money/movements",
            json={
                "account_id": created["id"],
                "direction": "out",
                "amount": "250.00",
                "reason": "expense",
            },
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text
        body = _accounts(client, admin_headers)
        safe = next(a for a in body["accounts"] if a["id"] == created["id"])
        assert Decimal(safe["balance"]) == Decimal("750.00")

    def test_a_transfer_leg_cannot_be_recorded_alone(self, client, admin_headers):
        created = client.post(
            "/api/money/accounts", json={"name": "Сейф"}, headers=admin_headers
        ).json()
        response = client.post(
            "/api/money/movements",
            json={
                "account_id": created["id"],
                "direction": "in",
                "amount": "10.00",
                "reason": "transfer_in",
            },
            headers=admin_headers,
        )
        # Money appearing from nowhere; transfers go through their own route.
        assert response.status_code == 422

    def test_a_reason_must_match_its_direction(self, client, admin_headers):
        created = client.post(
            "/api/money/accounts", json={"name": "Сейф"}, headers=admin_headers
        ).json()
        response = client.post(
            "/api/money/movements",
            json={
                "account_id": created["id"],
                "direction": "in",
                "amount": "10.00",
                "reason": "salary",
            },
            headers=admin_headers,
        )
        assert response.status_code == 422

    def test_amount_must_be_positive(self, client, admin_headers):
        created = client.post(
            "/api/money/accounts", json={"name": "Сейф"}, headers=admin_headers
        ).json()
        response = client.post(
            "/api/money/movements",
            json={
                "account_id": created["id"],
                "direction": "in",
                "amount": "0",
                "reason": "owner_deposit",
            },
            headers=admin_headers,
        )
        assert response.status_code == 422


class TestTransfers:
    def _two_accounts(self, client, headers):
        a = client.post(
            "/api/money/accounts", json={"name": "Сейф", "opening_balance": "1000.00"},
            headers=headers,
        ).json()
        b = client.post(
            "/api/money/accounts", json={"name": "Банк · расчётный"}, headers=headers
        ).json()
        return a, b

    def test_both_legs_are_written_together(self, client, admin_headers):
        source, target = self._two_accounts(client, admin_headers)
        response = client.post(
            "/api/money/transfers",
            json={
                "from_account_id": source["id"],
                "to_account_id": target["id"],
                "amount": "300.00",
                "note": "Снятие с карты",
            },
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text
        legs = response.json()
        assert len(legs) == 2
        assert {leg["direction"] for leg in legs} == {"in", "out"}
        # One group id, so the pair reads as one movement of money.
        assert len({leg["transfer_group"] for leg in legs}) == 1

        body = _accounts(client, admin_headers)
        by_id = {a["id"]: Decimal(a["balance"]) for a in body["accounts"]}
        assert by_id[source["id"]] == Decimal("700.00")
        assert by_id[target["id"]] == Decimal("300.00")
        # A transfer moves money, it does not create or destroy any.
        assert Decimal(body["total"]) == Decimal("1000.00")

    def test_a_transfer_to_itself_is_refused(self, client, admin_headers):
        source, _ = self._two_accounts(client, admin_headers)
        response = client.post(
            "/api/money/transfers",
            json={
                "from_account_id": source["id"],
                "to_account_id": source["id"],
                "amount": "10.00",
            },
            headers=admin_headers,
        )
        assert response.status_code == 409


class TestCorrections:
    def test_a_correction_records_the_difference(self, client, admin_headers):
        created = client.post(
            "/api/money/accounts", json={"name": "Сейф", "opening_balance": "1000.00"},
            headers=admin_headers,
        ).json()
        response = client.post(
            "/api/money/corrections",
            json={"account_id": created["id"], "actual_balance": "940.00"},
            headers=admin_headers,
        )
        assert response.status_code == 200, response.text
        movement = response.json()
        assert movement["direction"] == "out"
        assert Decimal(movement["amount"]) == Decimal("60.00")

        body = _accounts(client, admin_headers)
        safe = next(a for a in body["accounts"] if a["id"] == created["id"])
        assert Decimal(safe["balance"]) == Decimal("940.00")

    def test_correcting_to_the_current_balance_writes_nothing(self, client, admin_headers):
        created = client.post(
            "/api/money/accounts", json={"name": "Сейф", "opening_balance": "1000.00"},
            headers=admin_headers,
        ).json()
        response = client.post(
            "/api/money/corrections",
            json={"account_id": created["id"], "actual_balance": "1000.00"},
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert response.json() is None


class TestReportsAreUntouched:
    """Moving money between accounts is not revenue and not an expense.

    This is the promise the feature was designed around: the owner has to be
    able to write down that cash went to the bank without any sales figure
    moving underneath them.
    """

    def test_the_sales_summary_does_not_move(
        self, client, db_session, test_sale, admin_headers
    ):
        before = client.get("/api/sales/summary", headers=admin_headers)
        assert before.status_code == 200, before.text

        created = client.post(
            "/api/money/accounts", json={"name": "Сейф", "opening_balance": "5000.00"},
            headers=admin_headers,
        ).json()
        client.post(
            "/api/money/movements",
            json={
                "account_id": created["id"],
                "direction": "out",
                "amount": "1200.00",
                "reason": "bank_deposit",
            },
            headers=admin_headers,
        )

        after = client.get("/api/sales/summary", headers=admin_headers)
        assert after.json() == before.json()


class TestAccess:
    def test_a_plain_cashier_cannot_read_the_accounts(self, client, cashier_headers):
        response = client.get("/api/money/accounts", headers=cashier_headers)
        assert response.status_code == 403

    def test_a_company_without_finance_is_closed(
        self, client, db_session, default_company, admin_headers
    ):
        from models.company_module import CompanyModule

        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "finance",
        ).delete()
        db_session.flush()
        response = client.get("/api/money/accounts", headers=admin_headers)
        assert response.status_code == 403
        assert response.json()["detail"]["module"] == "finance"
