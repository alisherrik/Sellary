from fastapi.testclient import TestClient

from core.security import get_password_hash
from models.company_membership import CompanyMembership
from models.user import User


class TestCompanyAdminEndpoints:
    def test_admin_users_lists_only_current_company_members(
        self,
        client: TestClient,
        db_session,
        admin_headers,
        default_company,
        secondary_company,
    ):
        default_user = User(
            username="default-member",
            email="default-member@test.com",
            full_name="Default Member",
            hashed_password=get_password_hash("password123"),
            global_role="standard",
            role="cashier",
            is_active=True,
        )
        secondary_user = User(
            username="secondary-member",
            email="secondary-member@test.com",
            full_name="Secondary Member",
            hashed_password=get_password_hash("password123"),
            global_role="standard",
            role="cashier",
            is_active=True,
        )
        db_session.add_all([default_user, secondary_user])
        db_session.flush()
        db_session.add_all(
            [
                CompanyMembership(
                    user_id=default_user.id,
                    company_id=default_company.id,
                    role="cashier",
                    is_default=True,
                    is_active=True,
                ),
                CompanyMembership(
                    user_id=secondary_user.id,
                    company_id=secondary_company.id,
                    role="cashier",
                    is_default=True,
                    is_active=True,
                ),
            ]
        )
        db_session.commit()

        response = client.get("/api/admin/users", headers=admin_headers)

        assert response.status_code == 200
        usernames = {item["username"] for item in response.json()}
        assert "default-member" in usernames
        assert "secondary-member" not in usernames

    def test_admin_can_create_user_and_membership_in_current_company(
        self,
        client: TestClient,
        db_session,
        admin_headers,
        default_company,
    ):
        response = client.post(
            "/api/admin/users",
            headers=admin_headers,
            json={
                "username": "company-user",
                "email": "company-user@test.com",
                "full_name": "Company User",
                "password": "password123",
                "role": "manager",
                "is_active": True,
                "is_default": True,
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["username"] == "company-user"
        assert data["memberships"][0]["company"]["id"] == default_company.id
        assert data["memberships"][0]["role"] == "manager"

    def test_admin_can_attach_existing_user_by_identifier(
        self,
        client: TestClient,
        db_session,
        admin_headers,
        default_company,
    ):
        user = User(
            username="attach-me",
            email="attach-me@test.com",
            full_name="Attach Me",
            hashed_password=get_password_hash("password123"),
            global_role="standard",
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        response = client.post(
            "/api/admin/memberships",
            headers=admin_headers,
            json={
                "identifier": "attach-me",
                "role": "cashier",
                "is_default": False,
                "is_active": True,
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["company_id"] == default_company.id
        assert data["user"]["username"] == "attach-me"

    def test_admin_cannot_update_membership_for_other_company(
        self,
        client: TestClient,
        db_session,
        admin_headers,
        secondary_company,
    ):
        user = User(
            username="other-company-user",
            email="other-company-user@test.com",
            full_name="Other Company User",
            hashed_password=get_password_hash("password123"),
            global_role="standard",
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.flush()
        membership = CompanyMembership(
            user_id=user.id,
            company_id=secondary_company.id,
            role="cashier",
            is_default=True,
            is_active=True,
        )
        db_session.add(membership)
        db_session.commit()

        response = client.patch(
            f"/api/admin/memberships/{membership.id}",
            headers=admin_headers,
            json={"role": "manager"},
        )

        assert response.status_code == 403


class TestMembershipModules:
    def _membership_id(self, db_session, user, company):
        from models.company_membership import CompanyMembership
        return (
            db_session.query(CompanyMembership)
            .filter_by(user_id=user.id, company_id=company.id)
            .one()
            .id
        )

    def test_get_modules(self, client, admin_headers, db_session, cashier_user, default_company):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["modules"] == {"pos": "user"}

    def test_put_replaces_grants(
        self, client, admin_headers, db_session, cashier_user, default_company
    ):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.put(
            f"/api/admin/memberships/{m_id}/modules",
            headers=admin_headers,
            json={"modules": {"inventory": "manager", "reports": "user"}},
        )
        assert resp.status_code == 200
        assert resp.json()["modules"] == {"inventory": "manager", "reports": "user"}
        get_resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=admin_headers)
        assert get_resp.json()["modules"] == {"inventory": "manager", "reports": "user"}

    def test_put_invalid_module_422(
        self, client, admin_headers, db_session, cashier_user, default_company
    ):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.put(
            f"/api/admin/memberships/{m_id}/modules",
            headers=admin_headers,
            json={"modules": {"banking": "user"}},
        )
        assert resp.status_code == 422

    def test_put_admin_target_400(
        self, client, admin_headers, db_session, admin_user, default_company
    ):
        m_id = self._membership_id(db_session, admin_user, default_company)
        resp = client.put(
            f"/api/admin/memberships/{m_id}/modules",
            headers=admin_headers,
            json={"modules": {"pos": "user"}},
        )
        assert resp.status_code == 400

    def test_foreign_company_membership_404(
        self, client, admin_headers, db_session, secondary_company, test_password
    ):
        from tests.conftest import _create_user_with_membership
        user = _create_user_with_membership(
            db_session,
            username="foreigner",
            email="foreigner@example.com",
            password=test_password,
            company=secondary_company,
            role="cashier",
        )
        m_id = self._membership_id(db_session, user, secondary_company)
        resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=admin_headers)
        assert resp.status_code == 404

    def test_non_admin_403(self, client, manager_headers, db_session, cashier_user, default_company):
        m_id = self._membership_id(db_session, cashier_user, default_company)
        resp = client.get(f"/api/admin/memberships/{m_id}/modules", headers=manager_headers)
        assert resp.status_code == 403
