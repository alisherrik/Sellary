from fastapi.testclient import TestClient

from core.security import get_password_hash
from models.company_membership import CompanyMembership
from models.user import User


class TestOwnerAuth:
    def test_owner_login_returns_owner_session_token(
        self,
        client: TestClient,
        super_admin_user,
        test_password,
    ):
        response = client.post(
            "/api/owner/auth/login",
            json={"username": super_admin_user.username, "password": test_password},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["access_token"]
        assert data["user"]["global_role"] == "super_admin"

    def test_owner_login_rejects_standard_users(
        self,
        client: TestClient,
        admin_user,
        test_password,
    ):
        response = client.post(
            "/api/owner/auth/login",
            json={"username": admin_user.username, "password": test_password},
        )

        assert response.status_code == 401

    def test_owner_session_requires_owner_token(
        self,
        client: TestClient,
        owner_headers,
    ):
        response = client.get("/api/owner/session", headers=owner_headers)

        assert response.status_code == 200
        assert response.json()["user"]["global_role"] == "super_admin"


class TestOwnerManagement:
    def test_owner_can_manage_users_companies_memberships_and_enter_company(
        self,
        client: TestClient,
        db_session,
        owner_headers,
        default_company,
        secondary_company,
    ):
        create_user_response = client.post(
            "/api/owner/users",
            headers=owner_headers,
            json={
                "username": "managed-user",
                "email": "managed@test.com",
                "full_name": "Managed User",
                "password": "password123",
                "is_active": True,
            },
        )
        assert create_user_response.status_code == 201
        managed_user_id = create_user_response.json()["id"]

        create_company_response = client.post(
            "/api/owner/companies",
            headers=owner_headers,
            json={
                "name": "Owner Created Company",
                "slug": "owner-created-company",
                "is_active": True,
            },
        )
        assert create_company_response.status_code == 201
        created_company_id = create_company_response.json()["id"]

        membership_response = client.post(
            "/api/owner/memberships",
            headers=owner_headers,
            json={
                "user_id": managed_user_id,
                "company_id": created_company_id,
                "role": "manager",
                "is_default": True,
                "is_active": True,
            },
        )
        assert membership_response.status_code == 201
        assert membership_response.json()["role"] == "manager"

        memberships_list = client.get("/api/owner/memberships", headers=owner_headers)
        assert memberships_list.status_code == 200
        assert any(
            membership["company_id"] == created_company_id
            and membership["user_id"] == managed_user_id
            for membership in memberships_list.json()
        )

        enter_response = client.post(
            f"/api/owner/companies/{default_company.id}/enter",
            headers=owner_headers,
        )
        assert enter_response.status_code == 200
        company_session = enter_response.json()
        assert company_session["current_company"]["id"] == default_company.id
        assert len(company_session["companies"]) == 1

        me_response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {company_session['access_token']}"},
        )
        assert me_response.status_code == 200
        assert me_response.json()["current_company"]["id"] == default_company.id
        assert len(me_response.json()["companies"]) == 1

        update_company_response = client.patch(
            f"/api/owner/companies/{secondary_company.id}",
            headers=owner_headers,
            json={"is_active": False},
        )
        assert update_company_response.status_code == 200
        assert update_company_response.json()["is_active"] is False

    def test_owner_user_list_includes_memberships(
        self,
        client: TestClient,
        owner_headers,
        default_company,
        db_session,
    ):
        user = User(
            username="listed-user",
            email="listed@test.com",
            full_name="Listed User",
            hashed_password=get_password_hash("password123"),
            global_role="standard",
            role="cashier",
            is_active=True,
        )
        db_session.add(user)
        db_session.flush()
        db_session.add(
            CompanyMembership(
                user_id=user.id,
                company_id=default_company.id,
                role="cashier",
                is_default=True,
                is_active=True,
            )
        )
        db_session.commit()

        response = client.get("/api/owner/users", headers=owner_headers)

        assert response.status_code == 200
        listed = next(item for item in response.json() if item["username"] == "listed-user")
        assert listed["memberships"][0]["company"]["id"] == default_company.id
