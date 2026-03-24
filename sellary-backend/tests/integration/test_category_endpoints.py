"""
Integration tests for category endpoints.
"""
from fastapi.testclient import TestClient

from models.category import Category


class TestCreateCategory:
    """Tests for POST /api/categories endpoint."""

    def test_create_category_as_admin(self, client: TestClient, db_session, admin_headers):
        """Admin can create a category."""
        response = client.post(
            "/api/categories",
            headers=admin_headers,
            json={"name": "Fruits", "description": "Fresh fruits"},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Fruits"
        assert data["description"] == "Fresh fruits"
        assert data["is_active"] is True

        created = db_session.query(Category).filter(Category.name == "Fruits").first()
        assert created is not None

    def test_create_category_as_manager(self, client: TestClient, manager_headers):
        """Manager can create a category."""
        response = client.post(
            "/api/categories",
            headers=manager_headers,
            json={"name": "Drinks"},
        )

        assert response.status_code == 201
        assert response.json()["name"] == "Drinks"

    def test_create_category_as_cashier_forbidden(self, client: TestClient, cashier_headers):
        """Cashier cannot create a category."""
        response = client.post(
            "/api/categories",
            headers=cashier_headers,
            json={"name": "Snacks"},
        )

        assert response.status_code == 403

    def test_create_category_with_duplicate_name(self, client: TestClient, db_session, admin_headers):
        """Duplicate category names are rejected."""
        existing = Category(name="Bakery", description="Bread")
        db_session.add(existing)
        db_session.commit()

        response = client.post(
            "/api/categories",
            headers=admin_headers,
            json={"name": "Bakery", "description": "Duplicate"},
        )

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()
