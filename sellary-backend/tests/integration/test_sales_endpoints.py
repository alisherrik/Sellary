"""
Integration tests for sales endpoints.
"""
import pytest
import uuid
from decimal import Decimal
from datetime import datetime
from fastapi.testclient import TestClient

from models.sale import Sale, SaleStatus, PaymentMethod
from models.sale_item import SaleItem
from models.product import Product
from models.category import Category
from models.customer import Customer
from models.user import User
from core.security import get_password_hash


def with_idempotency(headers: dict, key: str) -> dict:
    normalized_key = key if len(key) >= 16 else f"{key}-tenant-safe"
    return {**headers, "Idempotency-Key": normalized_key}


class TestListSales:
    """Tests for GET /api/sales endpoint."""

    def test_list_sales_without_auth(self, client: TestClient):
        """Test that listing sales requires authentication."""
        response = client.get("/api/sales")
        assert response.status_code == 401

    def test_list_sales_with_auth(self, client: TestClient, db_session, cashier_headers):
        """Test listing sales with authentication."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            total_amount=Decimal("33.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
            created_at=datetime.now(),
        )
        db_session.add(sale)
        db_session.commit()

        response = client.get("/api/sales", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1

    def test_list_sales_with_pagination(self, client: TestClient, db_session, cashier_headers):
        """Test sales list pagination."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        for i in range(10):
            sale = Sale(
                customer_id=customer.id,
                cashier_id=cashier.id,
                subtotal=Decimal(f"{100 + i}.00"),
                tax_amount=Decimal("10.00"),
                total_amount=Decimal(f"{110 + i}.00"),
                payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED,
            )
            db_session.add(sale)
        db_session.commit()

        response = client.get("/api/sales?skip=0&limit=5", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 5


class TestGetSale:
    """Tests for GET /api/sales/{id} endpoint."""

    def test_get_sale_by_id(self, client: TestClient, db_session, cashier_headers):
        """Test getting a sale by ID."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            total_amount=Decimal("33.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
            created_at=datetime.now(),
        )
        db_session.add(sale)
        db_session.commit()

        response = client.get(f"/api/sales/{sale.id}", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == sale.id
        assert data["total_amount"] == "33.00"

    def test_get_nonexistent_sale(self, client: TestClient, cashier_headers):
        """Test getting a sale that doesn't exist."""
        response = client.get("/api/sales/99999", headers=cashier_headers)
        assert response.status_code == 404


class TestCreateSale:
    """Tests for POST /api/sales endpoint."""

    def test_create_sale_with_items(self, client: TestClient, db_session, cashier_headers):
        """Test creating a sale with items."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-create-items"),
            json={
                "customer_id": None,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 2,
                        "unit_price": "15.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "0.00",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["total_amount"] == "33.00"  # 30 + 3 tax
        assert len(data["items"]) == 1

        # Verify stock was deducted
        db_session.refresh(product)
        assert product.stock_quantity == 98

    def test_create_sale_with_multiple_items(self, client: TestClient, db_session, cashier_headers):
        """Test creating a sale with multiple items."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product1 = Product(
            name="Product 1",
            barcode="TEST1",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=100,
            is_active=True,
        )
        product2 = Product(
            name="Product 2",
            barcode="TEST2",
            category_id=category.id,
            cost_price=Decimal("20.00"),
            sell_price=Decimal("25.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=50,
            is_active=True,
        )
        db_session.add_all([product1, product2])
        db_session.commit()

        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-create-multiple"),
            json={
                "customer_id": None,
                "items": [
                    {
                        "product_id": product1.id,
                        "quantity": 2,
                        "unit_price": "15.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    },
                    {
                        "product_id": product2.id,
                        "quantity": 1,
                        "unit_price": "25.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "0.00",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert len(data["items"]) == 2

    def test_create_sale_with_customer(self, client: TestClient, db_session, cashier_headers):
        """Test creating a sale with a customer."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.commit()

        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-create-customer"),
            json={
                "customer_id": customer.id,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 1,
                        "unit_price": "15.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "0.00",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["customer_name"] == "Test Customer"

    def test_create_sale_with_inactive_product_fails(self, client: TestClient, db_session, cashier_headers):
        """Test that creating a sale with inactive product fails."""
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
            is_active=False,  # Inactive
        )
        db_session.add(product)
        db_session.commit()

        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-create-inactive"),
            json={
                "customer_id": None,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 1,
                        "unit_price": "15.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "0.00",
            }
        )

        assert response.status_code == 400

    def test_create_sale_with_nonexistent_product_fails(self, client: TestClient, cashier_headers):
        """Test that creating a sale with nonexistent product fails."""
        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-create-missing-product"),
            json={
                "customer_id": None,
                "items": [
                    {
                        "product_id": 99999,  # Nonexistent
                        "quantity": 1,
                        "unit_price": "15.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "0.00",
            }
        )

        assert response.status_code == 400

    def test_create_sale_with_discount(self, client: TestClient, db_session, cashier_headers):
        """Test creating a sale with discount."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("20.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-create-discount"),
            json={
                "customer_id": None,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 2,
                        "unit_price": "20.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "5.00",  # $5 discount
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["subtotal"] == "40.00"
        assert data["tax_amount"] == "4.00"
        assert data["discount_amount"] == "5.00"
        assert data["total_amount"] == "39.00"  # 40 + 4 - 5


class TestCancelSale:
    """Tests for POST /api/sales/{id}/cancel endpoint."""

    def test_cancel_sale(self, client: TestClient, db_session, cashier_headers):
        """Test canceling a sale."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            total_amount=Decimal("33.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
            created_at=datetime.now(),
        )
        db_session.add(sale)
        db_session.flush()

        sale_item = SaleItem(
            sale_id=sale.id,
            product_id=product.id,
            quantity=5,
            unit_price=Decimal("15.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
        )
        db_session.add(sale_item)

        product.stock_quantity -= 5
        db_session.commit()

        # Verify stock was deducted
        assert product.stock_quantity == 95

        response = client.post(
            f"/api/sales/{sale.id}/cancel",
            headers=with_idempotency(cashier_headers, "sale-cancel-success"),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cancelled"

        # Verify stock was restored
        db_session.refresh(product)
        assert product.stock_quantity == 100

    def test_cancel_nonexistent_sale(self, client: TestClient, cashier_headers):
        """Test canceling a sale that doesn't exist."""
        response = client.post(
            "/api/sales/99999/cancel",
            headers=with_idempotency(cashier_headers, "sale-cancel-missing"),
        )
        assert response.status_code == 404

    def test_cancel_already_cancelled_sale(self, client: TestClient, db_session, cashier_headers):
        """Test that canceling an already cancelled sale fails."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            total_amount=Decimal("33.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.CANCELLED,  # Already cancelled
        )
        db_session.add(sale)
        db_session.commit()

        response = client.post(
            f"/api/sales/{sale.id}/cancel",
            headers=with_idempotency(cashier_headers, "sale-cancel-conflict"),
        )
        assert response.status_code == 409


class TestSaleResponse:
    """Tests for sale response format."""

    def test_sale_response_includes_items(self, client: TestClient, db_session, cashier_headers):
        """Test that sale response includes items."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-response-items"),
            json={
                "customer_id": None,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 2,
                        "unit_price": "15.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "0.00",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert "items" in data
        assert len(data["items"]) == 1
        assert "product_name" in data["items"][0]
        assert data["items"][0]["product_name"] == "Test Product"

    def test_sale_response_includes_customer_info(self, client: TestClient, db_session, cashier_headers):
        """Test that sale response includes customer info."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)

        customer = Customer(name="John Doe")
        db_session.add(customer)
        db_session.commit()

        response = client.post(
            "/api/sales",
            headers=with_idempotency(cashier_headers, "sale-response-customer"),
            json={
                "customer_id": customer.id,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 1,
                        "unit_price": "15.00",
                        "tax_percent": "10.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payment_method": "cash",
                "discount_amount": "0.00",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["customer_name"] == "John Doe"
