"""
Integration tests for the multi-company authentication contract.
"""
from fastapi.testclient import TestClient

from core.security import get_password_hash
from models.company_membership import CompanyMembership
from models.user import User


def create_user_with_membership(db_session, company, *, username: str, email: str, password: str, role: str):
    user = User(
        username=username,
        email=email,
        full_name=f"{username.title()} User",
        hashed_password=get_password_hash(password),
        global_role="standard",
        role=role,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        CompanyMembership(
            user_id=user.id,
            company_id=company.id,
            role=role,
            is_default=True,
            is_active=True,
        )
    )
    db_session.commit()
    db_session.refresh(user)
    return user


class TestLoginAndCompanySelection:
    def test_login_returns_login_token_and_company_list(
        self,
        client: TestClient,
        db_session,
        default_company,
    ):
        password = "test_password_123"
        create_user_with_membership(
            db_session,
            default_company,
            username="testuser",
            email="test@test.com",
            password=password,
            role="cashier",
        )

        response = client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": password},
        )

        assert response.status_code == 200
        data = response.json()
        assert "login_token" in data
        assert "access_token" not in data
        assert data["token_type"] == "bearer"
        assert data["user"]["username"] == "testuser"
        assert data["companies"][0]["id"] == default_company.id
        assert data["companies"][0]["role"] == "cashier"

    def test_select_company_exchanges_login_token_for_access_token(
        self,
        client: TestClient,
        db_session,
        default_company,
    ):
        password = "test_password_123"
        create_user_with_membership(
            db_session,
            default_company,
            username="selector",
            email="selector@test.com",
            password=password,
            role="manager",
        )

        login_response = client.post(
            "/api/auth/login",
            json={"username": "selector", "password": password},
        )
        login_token = login_response.json()["login_token"]

        response = client.post(
            "/api/auth/select-company",
            headers={"Authorization": f"Bearer {login_token}"},
            json={"company_id": default_company.id},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["current_company"]["id"] == default_company.id
        assert data["current_company"]["role"] == "manager"
        assert data["user"]["username"] == "selector"

    def test_switch_company_mints_new_company_scoped_session(
        self,
        client: TestClient,
        db_session,
        default_company,
        secondary_company,
    ):
        password = "test_password_123"
        user = create_user_with_membership(
            db_session,
            default_company,
            username="shared-user",
            email="shared@test.com",
            password=password,
            role="admin",
        )
        db_session.add(
            CompanyMembership(
                user_id=user.id,
                company_id=secondary_company.id,
                role="manager",
                is_default=False,
                is_active=True,
            )
        )
        db_session.commit()

        login_response = client.post(
            "/api/auth/login",
            json={"username": "shared-user", "password": password},
        )
        login_token = login_response.json()["login_token"]
        first_session = client.post(
            "/api/auth/select-company",
            headers={"Authorization": f"Bearer {login_token}"},
            json={"company_id": default_company.id},
        )
        access_token = first_session.json()["access_token"]

        switch_response = client.post(
            "/api/auth/switch-company",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"company_id": secondary_company.id},
        )

        assert switch_response.status_code == 200
        data = switch_response.json()
        assert data["current_company"]["id"] == secondary_company.id
        assert data["current_company"]["role"] == "manager"
        assert len(data["companies"]) == 2


class TestSessionAndRegistration:
    def test_me_returns_user_company_and_company_list(
        self,
        client: TestClient,
        db_session,
        default_company,
    ):
        password = "test_password_123"
        create_user_with_membership(
            db_session,
            default_company,
            username="me-user",
            email="me@test.com",
            password=password,
            role="cashier",
        )

        login_response = client.post(
            "/api/auth/login",
            json={"username": "me-user", "password": password},
        )
        login_token = login_response.json()["login_token"]
        session_response = client.post(
            "/api/auth/select-company",
            headers={"Authorization": f"Bearer {login_token}"},
            json={"company_id": default_company.id},
        )
        access_token = session_response.json()["access_token"]

        response = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["user"]["username"] == "me-user"
        assert data["current_company"]["id"] == default_company.id
        assert len(data["companies"]) == 1

    def test_register_requires_admin_context_and_adds_membership(
        self,
        client: TestClient,
        db_session,
        admin_headers,
        default_company,
    ):
        response = client.post(
            "/api/auth/register",
            headers=admin_headers,
            json={
                "username": "newuser",
                "email": "newuser@test.com",
                "full_name": "New User",
                "password": "password123",
                "role": "cashier",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["username"] == "newuser"
        assert "role" not in data

        user = db_session.query(User).filter(User.username == "newuser").first()
        membership = (
            db_session.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == user.id,
                CompanyMembership.company_id == default_company.id,
            )
            .first()
        )
        assert membership is not None
        assert membership.role == "cashier"

    def test_register_rejects_non_admin(
        self,
        client: TestClient,
        cashier_headers,
    ):
        response = client.post(
            "/api/auth/register",
            headers=cashier_headers,
            json={
                "username": "blockeduser",
                "email": "blocked@test.com",
                "full_name": "Blocked User",
                "password": "password123",
                "role": "cashier",
            },
        )

        assert response.status_code == 403
