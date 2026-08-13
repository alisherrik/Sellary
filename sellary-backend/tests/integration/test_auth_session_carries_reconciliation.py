"""The cut-off rides the session the client already fetches — no new endpoint."""
from datetime import date

from models.reconciliation import Reconciliation
from services import reconciliation


def test_the_session_carries_the_cut_off(client, db_session, default_company, admin_headers):
    assert client.get("/api/auth/me", headers=admin_headers).json()["reconciled_from"] is None

    db_session.add(
        Reconciliation(company_id=default_company.id, effective_from=date(2026, 8, 13))
    )
    db_session.flush()
    reconciliation.invalidate(db_session, default_company.id)

    body = client.get("/api/auth/me", headers=admin_headers).json()

    assert body["reconciled_from"] == "2026-08-13"


def test_another_companys_cut_off_never_appears(
    client, db_session, secondary_company, admin_headers
):
    db_session.add(
        Reconciliation(company_id=secondary_company.id, effective_from=date(2026, 8, 13))
    )
    db_session.flush()

    assert client.get("/api/auth/me", headers=admin_headers).json()["reconciled_from"] is None
