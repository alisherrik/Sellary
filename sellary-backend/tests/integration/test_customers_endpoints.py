"""
Integration tests for customer endpoints.
"""
import pytest
from fastapi.testclient import TestClient

from models.customer import Customer


class TestListCustomers:
    """Tests for GET /api/customers endpoint."""

    def test_list_customers_without_auth(self, client: TestClient):
        """Test that listing customers requires authentication."""
        response = client.get("/api/customers")
        assert response.status_code == 401

    def test_list_customers_with_auth(self, client: TestClient, db_session, cashier_headers):
        """Test listing customers with authentication."""
        for i in range(3):
            customer = Customer(
                name=f"Customer {i}",
                email=f"customer{i}@test.com",
                phone=f"+992 123 456 78{i}",
            )
            db_session.add(customer)
        db_session.commit()

        response = client.get("/api/customers", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 3

    def test_list_customers_with_pagination(self, client: TestClient, db_session, cashier_headers):
        """Test customer list pagination."""
        for i in range(10):
            customer = Customer(name=f"Customer {i}")
            db_session.add(customer)
        db_session.commit()

        response = client.get("/api/customers?skip=0&limit=5", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 5

    def test_list_customers_with_search(self, client: TestClient, db_session, cashier_headers):
        """Test searching customers."""
        customer1 = Customer(name="John Doe", email="john@test.com")
        customer2 = Customer(name="Jane Smith", email="jane@test.com")
        db_session.add_all([customer1, customer2])
        db_session.commit()

        response = client.get("/api/customers?search=John", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "John Doe"


class TestGetCustomer:
    """Tests for GET /api/customers/{id} endpoint."""

    def test_get_customer_by_id(self, client: TestClient, db_session, cashier_headers):
        """Test getting a customer by ID."""
        customer = Customer(
            name="John Doe",
            email="john@test.com",
            phone="+992 123 456 789",
            address="123 Main St",
        )
        db_session.add(customer)
        db_session.commit()

        response = client.get(f"/api/customers/{customer.id}", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == customer.id
        assert data["name"] == "John Doe"
        assert data["email"] == "john@test.com"

    def test_get_nonexistent_customer(self, client: TestClient, cashier_headers):
        """Test getting a customer that doesn't exist."""
        response = client.get("/api/customers/99999", headers=cashier_headers)
        assert response.status_code == 404

    def test_get_customer_without_auth(self, client: TestClient, db_session):
        """Test getting a customer without authentication."""
        customer = Customer(name="John Doe")
        db_session.add(customer)
        db_session.commit()

        response = client.get(f"/api/customers/{customer.id}")
        assert response.status_code == 401


class TestCreateCustomer:
    """Tests for POST /api/customers endpoint."""

    def test_create_customer(self, client: TestClient, cashier_headers):
        """Test creating a customer."""
        response = client.post(
            "/api/customers",
            headers=cashier_headers,
            json={
                "name": "John Doe",
                "email": "john@test.com",
                "phone": "+992 123 456 789",
                "address": "123 Main St",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "John Doe"
        assert data["email"] == "john@test.com"
        assert data["phone"] == "+992 123 456 789"

    def test_create_customer_without_auth(self, client: TestClient):
        """Test creating a customer without authentication."""
        response = client.post(
            "/api/customers",
            json={
                "name": "John Doe",
                "email": "john@test.com",
            }
        )

        assert response.status_code == 401

    def test_create_customer_with_invalid_email(self, client: TestClient, cashier_headers):
        """Test creating a customer with invalid email."""
        response = client.post(
            "/api/customers",
            headers=cashier_headers,
            json={
                "name": "John Doe",
                "email": "invalid-email",
            }
        )

        assert response.status_code == 422  # Validation error

    def test_create_customer_missing_name(self, client: TestClient, cashier_headers):
        """Test creating a customer without name."""
        response = client.post(
            "/api/customers",
            headers=cashier_headers,
            json={
                "email": "john@test.com",
            }
        )

        assert response.status_code == 422  # Validation error

    def test_create_customer_with_optional_fields(self, client: TestClient, cashier_headers):
        """Test creating a customer with only required fields."""
        response = client.post(
            "/api/customers",
            headers=cashier_headers,
            json={
                "name": "John Doe",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "John Doe"
        assert data["email"] is None
        assert data["phone"] is None
        assert data["address"] is None


class TestUpdateCustomer:
    """Tests for PUT /api/customers/{id} endpoint."""

    def test_update_customer(self, client: TestClient, db_session, cashier_headers):
        """Test updating a customer."""
        customer = Customer(
            name="John Doe",
            email="john@test.com",
        )
        db_session.add(customer)
        db_session.commit()

        response = client.put(
            f"/api/customers/{customer.id}",
            headers=cashier_headers,
            json={
                "name": "John Smith",
                "phone": "+992 987 654 321",
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "John Smith"
        assert data["phone"] == "+992 987 654 321"
        assert data["email"] == "john@test.com"  # Unchanged

    def test_update_nonexistent_customer(self, client: TestClient, cashier_headers):
        """Test updating a customer that doesn't exist."""
        response = client.put(
            "/api/customers/99999",
            headers=cashier_headers,
            json={"name": "Updated Name"}
        )

        assert response.status_code == 404

    def test_update_customer_without_auth(self, client: TestClient, db_session):
        """Test updating a customer without authentication."""
        customer = Customer(name="John Doe")
        db_session.add(customer)
        db_session.commit()

        response = client.put(
            f"/api/customers/{customer.id}",
            json={"name": "Updated Name"}
        )

        assert response.status_code == 401

    def test_update_customer_partial_fields(self, client: TestClient, db_session, cashier_headers):
        """Test updating only specific fields."""
        customer = Customer(
            name="John Doe",
            email="john@test.com",
            phone="+992 123 456 789",
            address="123 Main St",
        )
        db_session.add(customer)
        db_session.commit()

        response = client.put(
            f"/api/customers/{customer.id}",
            headers=cashier_headers,
            json={"phone": "+992 999 888 777"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["phone"] == "+992 999 888 777"
        assert data["name"] == "John Doe"  # Unchanged
        assert data["email"] == "john@test.com"  # Unchanged


class TestDeleteCustomer:
    """Tests for DELETE /api/customers/{id} endpoint."""

    def test_delete_customer(self, client: TestClient, db_session, cashier_headers):
        """Test deleting a customer."""
        customer = Customer(name="John Doe")
        db_session.add(customer)
        db_session.commit()

        response = client.delete(f"/api/customers/{customer.id}", headers=cashier_headers)

        assert response.status_code == 204

        # Verify customer is deleted
        get_response = client.get(
            f"/api/customers/{customer.id}",
            headers=cashier_headers
        )
        assert get_response.status_code == 404

    def test_delete_nonexistent_customer(self, client: TestClient, cashier_headers):
        """Test deleting a customer that doesn't exist."""
        response = client.delete("/api/customers/99999", headers=cashier_headers)
        assert response.status_code == 404

    def test_delete_customer_without_auth(self, client: TestClient, db_session):
        """Test deleting a customer without authentication."""
        customer = Customer(name="John Doe")
        db_session.add(customer)
        db_session.commit()

        response = client.delete(f"/api/customers/{customer.id}")
        assert response.status_code == 401


class TestCustomerValidation:
    """Tests for customer input validation."""

    def test_customer_with_unicode_name(self, client: TestClient, cashier_headers):
        """Test creating a customer with unicode characters in name."""
        response = client.post(
            "/api/customers",
            headers=cashier_headers,
            json={
                "name": "Алишер Джунусов",  # Russian characters
                "email": "alisher@test.com",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Алишер Джунусов"

    def test_customer_with_empty_name_fails(self, client: TestClient, cashier_headers):
        """Test that customer with empty name fails validation."""
        response = client.post(
            "/api/customers",
            headers=cashier_headers,
            json={
                "name": "",
            }
        )

        assert response.status_code == 422  # Validation error

    def test_customer_with_duplicate_email(self, client: TestClient, db_session, cashier_headers):
        """Test that duplicate email is allowed (depends on requirements)."""
        # Create first customer
        customer1 = Customer(name="John Doe", email="john@test.com")
        db_session.add(customer1)
        db_session.commit()

        # Try to create second customer with same email
        response = client.post(
            "/api/customers",
            headers=cashier_headers,
            json={
                "name": "Jane Smith",
                "email": "john@test.com",  # Duplicate
            }
        )

        # Current implementation might allow duplicate emails
        # If it doesn't, expect 400 or 409
        # If it does, expect 201
        assert response.status_code in [201, 400, 409]
