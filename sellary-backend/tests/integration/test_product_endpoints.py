"""
Integration tests for product endpoints.
"""
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient

from models.product import Product, ProductType
from models.category import Category


class TestListProducts:
    """Tests for GET /api/products endpoint."""

    def test_list_products_without_auth(self, client: TestClient, db_session):
        """Test that listing products requires authentication."""
        response = client.get("/api/products")
        assert response.status_code == 401

    def test_list_products_with_auth(self, client: TestClient, db_session, cashier_headers):
        """Test listing products with authentication."""
        # Create test products
        category = Category(name="Electronics")
        db_session.add(category)
        db_session.flush()

        for i in range(3):
            product = Product(
                name=f"Product {i}",
                barcode=f"BAR{i}",
                category_id=category.id,
                cost_price=Decimal("10.00"),
                sell_price=Decimal("15.00"),
                stock_quantity=100,
                is_active=True,
            )
            db_session.add(product)
        db_session.commit()

        response = client.get("/api/products", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 3

    def test_list_products_with_pagination(self, client: TestClient, db_session, cashier_headers):
        """Test product list pagination."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        for i in range(10):
            product = Product(
                name=f"Product {i}",
                barcode=f"BAR{i}",
                category_id=category.id,
                cost_price=Decimal("10.00"),
                sell_price=Decimal("15.00"),
                stock_quantity=100,
                is_active=True,
            )
            db_session.add(product)
        db_session.commit()

        response = client.get(
            "/api/products?skip=0&limit=5",
            headers=cashier_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 5

    def test_list_products_with_search(self, client: TestClient, db_session, cashier_headers):
        """Test searching products."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product1 = Product(
            name="Apple iPhone",
            barcode="APP123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        product2 = Product(
            name="Samsung Galaxy",
            barcode="SAM123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add_all([product1, product2])
        db_session.commit()

        response = client.get("/api/products?search=Apple", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Apple iPhone"

    def test_list_products_with_category_filter(self, client: TestClient, db_session, cashier_headers):
        """Test filtering products by category."""
        cat1 = Category(name="Electronics")
        cat2 = Category(name="Clothing")
        db_session.add_all([cat1, cat2])
        db_session.flush()

        prod1 = Product(
            name="Laptop",
            barcode="ELEC1",
            category_id=cat1.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        prod2 = Product(
            name="Shirt",
            barcode="CLOTH1",
            category_id=cat2.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add_all([prod1, prod2])
        db_session.commit()

        response = client.get(f"/api/products?category_id={cat1.id}", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Laptop"


class TestGetProduct:
    """Tests for GET /api/products/{id} endpoint."""

    def test_get_product_by_id(self, client: TestClient, db_session, cashier_headers):
        """Test getting a product by ID."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        response = client.get(f"/api/products/{product.id}", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == product.id
        assert data["name"] == "Test Product"
        assert data["barcode"] == "TEST123"

    def test_get_nonexistent_product(self, client: TestClient, cashier_headers):
        """Test getting a product that doesn't exist."""
        response = client.get("/api/products/99999", headers=cashier_headers)

        assert response.status_code == 404

    def test_get_product_without_auth(self, client: TestClient, db_session):
        """Test getting a product without authentication."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        response = client.get(f"/api/products/{product.id}")

        assert response.status_code == 401


class TestGetProductByBarcode:
    """Tests for GET /api/products/barcode/{barcode} endpoint."""

    def test_get_product_by_valid_barcode(self, client: TestClient, db_session, cashier_headers):
        """Test getting a product by valid barcode."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="SEARCH123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        response = client.get(f"/api/products/barcode/SEARCH123", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["barcode"] == "SEARCH123"

    def test_get_product_by_invalid_barcode(self, client: TestClient, cashier_headers):
        """Test getting a product by invalid barcode."""
        response = client.get("/api/products/barcode/INVALID999", headers=cashier_headers)

        assert response.status_code == 404


class TestSearchProducts:
    """Tests for GET /api/products/search endpoint."""

    def test_search_by_name(self, client: TestClient, db_session, cashier_headers):
        """Test searching products by name."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Apple iPhone 15",
            barcode="APP123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        response = client.get("/api/products/search?q=Apple", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Apple iPhone 15"

    def test_search_with_limit(self, client: TestClient, db_session, cashier_headers):
        """Test search with result limit."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        for i in range(10):
            product = Product(
                name=f"Product {i}",
                barcode=f"SEARCH{i}",
                category_id=category.id,
                cost_price=Decimal("10.00"),
                sell_price=Decimal("15.00"),
                stock_quantity=100,
                is_active=True,
            )
            db_session.add(product)
        db_session.commit()

        response = client.get("/api/products/search?q=Product&limit=5", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 5

    def test_search_empty_query(self, client: TestClient, cashier_headers):
        """Test search with empty query."""
        response = client.get("/api/products/search?q=", headers=cashier_headers)

        assert response.status_code == 422  # Validation error


class TestGetLowStock:
    """Tests for GET /api/products/low-stock endpoint."""

    def test_get_low_stock_products(self, client: TestClient, db_session, cashier_headers):
        """Test getting products with low stock."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        low_stock = Product(
            name="Low Stock Product",
            barcode="LOW123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=2,
            min_stock_level=5,
            is_active=True,
        )
        normal_stock = Product(
            name="Normal Stock Product",
            barcode="NORM123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            min_stock_level=5,
            is_active=True,
        )
        db_session.add_all([low_stock, normal_stock])
        db_session.commit()

        response = client.get("/api/products/low-stock", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Low Stock Product"


class TestCreateProduct:
    """Tests for POST /api/products endpoint."""

    def test_create_product_as_admin(self, client: TestClient, db_session, admin_headers):
        """Test creating a product as admin."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.commit()

        response = client.post(
            "/api/products",
            headers=admin_headers,
            json={
                "name": "New Product",
                "barcode": "NEW123",
                "category_id": category.id,
                "cost_price": "10.00",
                "sell_price": "15.00",
                "tax_percent": "10.00",
                "stock_quantity": 50,
                "min_stock_level": 5,
                "is_active": True,
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "New Product"
        assert data["barcode"] == "NEW123"

    def test_create_product_as_manager(self, client: TestClient, db_session, manager_headers):
        """Test creating a product as manager."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.commit()

        response = client.post(
            "/api/products",
            headers=manager_headers,
            json={
                "name": "New Product",
                "barcode": "NEW123",
                "category_id": category.id,
                "cost_price": "10.00",
                "sell_price": "15.00",
                "stock_quantity": 50,
            }
        )

        assert response.status_code == 201

    def test_create_product_as_cashier_forbidden(self, client: TestClient, cashier_headers):
        """Test that cashier cannot create products."""
        response = client.post(
            "/api/products",
            headers=cashier_headers,
            json={
                "name": "New Product",
                "barcode": "NEW123",
                "cost_price": "10.00",
                "sell_price": "15.00",
                "stock_quantity": 50,
            }
        )

        assert response.status_code == 403  # Forbidden

    def test_create_product_with_duplicate_barcode(self, client: TestClient, db_session, admin_headers):
        """Test creating a product with duplicate barcode."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        existing = Product(
            name="Existing",
            barcode="DUP123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(existing)
        db_session.commit()

        response = client.post(
            "/api/products",
            headers=admin_headers,
            json={
                "name": "New Product",
                "barcode": "DUP123",  # Duplicate
                "category_id": category.id,
                "cost_price": "10.00",
                "sell_price": "15.00",
                "stock_quantity": 50,
            }
        )

        assert response.status_code == 400

    def test_create_product_without_auth(self, client: TestClient):
        """Test creating a product without authentication."""
        response = client.post(
            "/api/products",
            json={
                "name": "New Product",
                "barcode": "NEW123",
                "cost_price": "10.00",
                "sell_price": "15.00",
                "stock_quantity": 50,
            }
        )

        assert response.status_code == 401


class TestUpdateProduct:
    """Tests for PUT /api/products/{id} endpoint."""

    def test_update_product_as_admin(self, client: TestClient, db_session, admin_headers):
        """Test updating a product as admin."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Original Name",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(product)
        db_session.commit()

        response = client.put(
            f"/api/products/{product.id}",
            headers=admin_headers,
            json={
                "name": "Updated Name",
                "sell_price": "20.00",
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["sell_price"] == "20.00"

    def test_update_product_as_manager(self, client: TestClient, db_session, manager_headers):
        """Test updating a product as manager."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Original Name",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(product)
        db_session.commit()

        response = client.put(
            f"/api/products/{product.id}",
            headers=manager_headers,
            json={"name": "Updated Name"}
        )

        assert response.status_code == 200

    def test_update_product_as_cashier_forbidden(self, client: TestClient, db_session, cashier_headers):
        """Test that cashier cannot update products."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(product)
        db_session.commit()

        response = client.put(
            f"/api/products/{product.id}",
            headers=cashier_headers,
            json={"name": "Updated Name"}
        )

        assert response.status_code == 403  # Forbidden

    def test_update_nonexistent_product(self, client: TestClient, admin_headers):
        """Test updating a product that doesn't exist."""
        response = client.put(
            "/api/products/99999",
            headers=admin_headers,
            json={"name": "Updated Name"}
        )

        assert response.status_code == 404


class TestDeleteProduct:
    """Tests for DELETE /api/products/{id} endpoint."""

    def test_delete_product_as_admin(self, client: TestClient, db_session, admin_headers):
        """Test deleting a product as admin."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(product)
        db_session.commit()

        response = client.delete(f"/api/products/{product.id}", headers=admin_headers)

        assert response.status_code == 204

        # Verify product is deleted
        get_response = client.get(f"/api/products/{product.id}", headers=admin_headers)
        assert get_response.status_code == 404

    def test_delete_product_as_manager(self, client: TestClient, db_session, manager_headers):
        """Test deleting a product as manager."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(product)
        db_session.commit()

        response = client.delete(f"/api/products/{product.id}", headers=manager_headers)

        assert response.status_code == 204

    def test_delete_product_as_cashier_forbidden(self, client: TestClient, db_session, cashier_headers):
        """Test that cashier cannot delete products."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(product)
        db_session.commit()

        response = client.delete(f"/api/products/{product.id}", headers=cashier_headers)

        assert response.status_code == 403  # Forbidden

    def test_delete_nonexistent_product(self, client: TestClient, admin_headers):
        """Test deleting a product that doesn't exist."""
        response = client.delete("/api/products/99999", headers=admin_headers)

        assert response.status_code == 404
