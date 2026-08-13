"""Declaring a reconciliation, and the four things that refuse it."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from models.reconciliation import Reconciliation
from services import reconciliation


def today_for(db_session, company):
    from services.company_time import company_tz

    return datetime.now(company_tz(db_session, company.id)).date()


@pytest.mark.no_auto_shift
class TestCreate:
    """A reconciliation is declared between shifts — see `auto_open_shift`."""

    def test_an_open_shift_refuses_it(self, client, admin_headers, db_session, default_company):
        from models.cash_shift import CashShift, CashShiftStatus
        from models.user import User

        db_session.add(
            CashShift(
                company_id=default_company.id,
                shift_number=99,
                status=CashShiftStatus.OPEN,
                opened_by_user_id=db_session.query(User).first().id,
                opening_cash=Decimal("0.00"),
            )
        )
        db_session.flush()

        response = client.post(
            "/api/reconciliation",
            json={"effective_from": str(today_for(db_session, default_company))},
            headers=admin_headers,
        )

        assert response.status_code == 409
        assert "смену" in response.json()["detail"]

    def test_a_manager_cannot_declare_one(self, client, manager_headers):
        response = client.post(
            "/api/reconciliation",
            json={"effective_from": str(date(2026, 8, 13))},
            headers=manager_headers,
        )
        assert response.status_code == 403

    def test_an_admin_declares_it_and_it_comes_back(
        self, client, admin_headers, db_session, default_company
    ):
        day = today_for(db_session, default_company)

        response = client.post(
            "/api/reconciliation", json={"effective_from": str(day)}, headers=admin_headers
        )

        assert response.status_code == 201, response.text
        assert response.json()["effective_from"] == str(day)

        listing = client.get("/api/reconciliation", headers=admin_headers)
        assert listing.json()["latest"]["effective_from"] == str(day)

    def test_a_future_date_is_refused(self, client, admin_headers, db_session, default_company):
        day = today_for(db_session, default_company) + timedelta(days=1)

        response = client.post(
            "/api/reconciliation", json={"effective_from": str(day)}, headers=admin_headers
        )

        assert response.status_code == 409
        assert "будущем" in response.json()["detail"]

    def test_a_freeze_never_moves_backwards(
        self, client, admin_headers, db_session, default_company
    ):
        day = today_for(db_session, default_company)
        db_session.add(Reconciliation(company_id=default_company.id, effective_from=day))
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)

        response = client.post(
            "/api/reconciliation",
            json={"effective_from": str(day - timedelta(days=1))},
            headers=admin_headers,
        )

        assert response.status_code == 409
        assert "позже" in response.json()["detail"]

    def test_drift_blocks_the_freeze(
        self, client, admin_headers, db_session, default_company, test_product
    ):
        # The balance leaves its layers behind: the checker must refuse to let
        # that be frozen into an uneditable opening position.
        test_product.stock_quantity = Decimal("999")
        db_session.flush()

        blocked = client.post(
            "/api/reconciliation",
            json={"effective_from": str(today_for(db_session, default_company))},
            headers=admin_headers,
        )

        assert blocked.status_code == 409
        assert blocked.json()["detail"]["findings"][0]["check"] == "stock_vs_layers"

    def test_known_drift_can_be_acknowledged_and_is_recorded(
        self, client, admin_headers, db_session, default_company, test_product
    ):
        test_product.stock_quantity = Decimal("999")
        db_session.flush()

        forced = client.post(
            "/api/reconciliation",
            json={
                "effective_from": str(today_for(db_session, default_company)),
                "acknowledge_violations": True,
            },
            headers=admin_headers,
        )

        assert forced.status_code == 201
        stored = db_session.query(Reconciliation).order_by(Reconciliation.id.desc()).first()
        assert stored.checker_report


class TestCheckEndpoint:
    def test_it_reports_the_same_findings_the_service_would(
        self, client, admin_headers, db_session, default_company, test_product
    ):
        clean = client.get("/api/reconciliation/check", headers=admin_headers)
        assert clean.status_code == 200
        assert clean.json()["clean"] is True

        test_product.stock_quantity = Decimal("999")
        db_session.flush()

        dirty = client.get("/api/reconciliation/check", headers=admin_headers)
        assert dirty.json()["clean"] is False
        assert dirty.json()["findings"][0]["check"] == "stock_vs_layers"
