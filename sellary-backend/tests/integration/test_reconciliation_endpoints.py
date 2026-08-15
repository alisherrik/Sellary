from datetime import date, datetime, timedelta

from models.reconciliation import Reconciliation
from services import reconciliation


def declare(db_session, company, day, **extra):
    row = Reconciliation(company_id=company.id, effective_from=day, **extra)
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)
    return row


class TestPeriodEndpoints:
    def test_list_is_empty_before_the_first_сверка(
        self, client, default_company, manager_headers
    ):
        response = client.get("/api/reconciliation/periods", headers=manager_headers)

        assert response.status_code == 200
        assert response.json() == {"total": 0, "periods": []}

    def test_list_returns_newest_first_with_both_figures(
        self, client, db_session, default_company, manager_headers
    ):
        declare(db_session, default_company, date(2026, 5, 1))
        declare(db_session, default_company, date(2026, 6, 1))

        body = client.get(
            "/api/reconciliation/periods", headers=manager_headers
        ).json()

        assert body["total"] == 2
        assert [row["index"] for row in body["periods"]] == [2, 1]
        assert body["periods"][0]["start_day"] == "2026-05-01"
        assert body["periods"][0]["end_day"] == "2026-05-31"
        assert body["periods"][1]["start_day"] is None
        assert "purchased" in body["periods"][0]
        assert "sold" in body["periods"][0]

    def test_detail_is_addressable_by_its_reconciliation_id(
        self, client, db_session, default_company, manager_headers
    ):
        row = declare(db_session, default_company, date(2026, 6, 1), note="Июнь")

        body = client.get(
            f"/api/reconciliation/periods/{row.id}", headers=manager_headers
        ).json()

        assert body["id"] == row.id
        assert body["note"] == "Июнь"
        assert body["late_arrivals"]["count"] == 0

    def test_detail_404s_on_an_unknown_id(
        self, client, default_company, manager_headers
    ):
        response = client.get(
            "/api/reconciliation/periods/9999", headers=manager_headers
        )

        assert response.status_code == 404

    def test_another_companys_period_is_not_reachable(
        self, client, db_session, default_company, secondary_company, manager_headers
    ):
        row = declare(db_session, secondary_company, date(2026, 6, 1))

        response = client.get(
            f"/api/reconciliation/periods/{row.id}", headers=manager_headers
        )

        assert response.status_code == 404

    def test_a_cashier_is_refused(self, client, default_company, cashier_headers):
        response = client.get("/api/reconciliation/periods", headers=cashier_headers)

        assert response.status_code == 403
