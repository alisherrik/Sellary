"""Module-access enforcement on POS routers.

cashier fixture has pos:user (backfill); manager has all modules at manager.
"""


def _no_grant_headers(client, db_session, default_company, test_password):
    """Create a member with zero module grants and return auth headers."""
    from tests.conftest import _create_user_with_membership, _create_company_scoped_token
    from models.membership_module_access import MembershipModuleAccess
    from models.company_membership import CompanyMembership

    user = _create_user_with_membership(
        db_session,
        username="nomods",
        email="nomods@example.com",
        password=test_password,
        company=default_company,
        role="cashier",
    )
    membership = (
        db_session.query(CompanyMembership)
        .filter_by(user_id=user.id, company_id=default_company.id)
        .one()
    )
    db_session.query(MembershipModuleAccess).filter_by(membership_id=membership.id).delete()
    db_session.flush()
    token = _create_company_scoped_token(user, default_company.id, "cashier")
    return {"Authorization": f"Bearer {token}"}


class TestPosModuleAccess:
    def test_no_grant_cannot_list_sales(
        self, client, db_session, default_company, test_password
    ):
        headers = _no_grant_headers(client, db_session, default_company, test_password)
        resp = client.get("/api/sales", headers=headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_access_denied"

    def test_pos_user_can_list_sales(self, client, cashier_headers):
        assert client.get("/api/sales", headers=cashier_headers).status_code == 200

    def test_pos_user_cannot_cancel_sale(self, client, cashier_headers):
        resp = client.post(
            "/api/sales/999999/cancel",
            headers={**cashier_headers, "Idempotency-Key": "modtest-cancel-0001"},
            json={},
        )
        # 403 module check must fire BEFORE 404 lookup
        assert resp.status_code == 403

    def test_manager_cancel_reaches_lookup(self, client, manager_headers):
        resp = client.post(
            "/api/sales/999999/cancel",
            headers={**manager_headers, "Idempotency-Key": "modtest-cancel-0002"},
            json={"reason": "Тестовая отмена"},
        )
        assert resp.status_code == 404

    def test_no_grant_cannot_list_customers(
        self, client, db_session, default_company, test_password
    ):
        headers = _no_grant_headers(client, db_session, default_company, test_password)
        assert client.get("/api/customers", headers=headers).status_code == 403

    def test_no_grant_cannot_open_shift(
        self, client, db_session, default_company, test_password
    ):
        headers = _no_grant_headers(client, db_session, default_company, test_password)
        resp = client.post("/api/shifts/open", headers=headers, json={"opening_cash": 0})
        assert resp.status_code == 403
