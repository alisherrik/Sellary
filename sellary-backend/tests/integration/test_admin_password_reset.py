"""Password reset: the only recovery path for a member who forgot theirs."""

from core.security import verify_password
from models.company_membership import CompanyMembership
from models.user import User


def _member_id(db_session, company_id: int, username: str) -> int:
    return (
        db_session.query(User.id)
        .join(CompanyMembership, CompanyMembership.user_id == User.id)
        .filter(CompanyMembership.company_id == company_id, User.username == username)
        .scalar()
    )


class TestCompanyAdminPasswordReset:
    def test_admin_resets_a_member_password(
        self, client, admin_headers, cashier_user, db_session, default_company, test_password
    ):
        user_id = _member_id(db_session, default_company.id, "cashier")

        resp = client.put(
            f"/api/admin/users/{user_id}/password",
            headers=admin_headers,
            json={"password": "brand-new-secret"},
        )
        assert resp.status_code == 204

        db_session.expire_all()
        user = db_session.get(User, user_id)
        assert verify_password("brand-new-secret", user.hashed_password)
        # The old one must stop working, or a reset resets nothing.
        assert not verify_password(test_password, user.hashed_password)

    def test_password_is_hashed_not_stored_raw(
        self, client, admin_headers, cashier_user, db_session, default_company
    ):
        user_id = _member_id(db_session, default_company.id, "cashier")
        client.put(
            f"/api/admin/users/{user_id}/password",
            headers=admin_headers,
            json={"password": "another-secret-1"},
        )
        db_session.expire_all()
        assert db_session.get(User, user_id).hashed_password != "another-secret-1"

    def test_short_password_is_rejected(
        self, client, admin_headers, cashier_user, db_session, default_company
    ):
        user_id = _member_id(db_session, default_company.id, "cashier")
        resp = client.put(
            f"/api/admin/users/{user_id}/password",
            headers=admin_headers,
            json={"password": "short"},
        )
        assert resp.status_code == 422

    def test_admin_cannot_reset_a_stranger(self, client, admin_headers):
        # A user who is not a member of this company must not be reachable.
        resp = client.put(
            "/api/admin/users/999999/password",
            headers=admin_headers,
            json={"password": "brand-new-secret"},
        )
        assert resp.status_code == 404

    def test_cashier_cannot_reset_anyone(
        self, client, cashier_headers, cashier_user, db_session, default_company
    ):
        user_id = _member_id(db_session, default_company.id, "cashier")
        resp = client.put(
            f"/api/admin/users/{user_id}/password",
            headers=cashier_headers,
            json={"password": "brand-new-secret"},
        )
        assert resp.status_code == 403
