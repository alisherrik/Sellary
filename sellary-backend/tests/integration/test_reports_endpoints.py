from datetime import datetime, timedelta

from models.reconciliation import Reconciliation
from services import reconciliation


class TestSettledHistoryStaysReadable:
    """A сверка closes a period for editing, never for reading."""

    def test_an_explicit_start_reaches_behind_the_cut_off(
        self, client, db_session, default_company, manager_headers
    ):
        cut_off = (datetime.utcnow() - timedelta(days=3)).date()
        db_session.add(
            Reconciliation(company_id=default_company.id, effective_from=cut_off)
        )
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)

        start = (datetime.utcnow() - timedelta(days=89)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        response = client.get(
            "/api/reports/profit",
            params={"days": 90, "start_date": start.isoformat()},
            headers=manager_headers,
        )

        assert response.status_code == 200
        assert response.json()["period_start"].startswith(start.date().isoformat())

    def test_without_a_start_the_floor_still_applies(
        self, client, db_session, default_company, manager_headers
    ):
        cut_off = (datetime.utcnow() - timedelta(days=3)).date()
        db_session.add(
            Reconciliation(company_id=default_company.id, effective_from=cut_off)
        )
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)

        response = client.get(
            "/api/reports/profit", params={"days": 90}, headers=manager_headers
        )

        assert response.status_code == 200
        assert response.json()["period_start"].startswith(cut_off.isoformat())
