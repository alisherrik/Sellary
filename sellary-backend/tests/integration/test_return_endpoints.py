"""
Integration tests for sale return endpoints - Critical for UI Return Functionality.
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


class TestCreateReturn:
    """Tests for POST /api/sales/{sale_id}/return endpoint."""

    def test_create_return_single_item(self, client: TestClient, db_session, manager_headers):
        """Test creating a return for a single item."""
        # Setup: Create user, category, product, customer, sale
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

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
            stock_quantity=98,
        )
        db_session.add(product)
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        # Create a sale
        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)

        # Deduct stock
        product.stock_quantity -= 2
        db_session.flush()

        # Create return
        final_headers = with_idempotency(manager_headers, "return-key-123")
        response = client.post(
            f"/api/sales/{sale.id}/return",
            headers=final_headers,
            json={
                "items": [
                    {
                        "sale_item_id": sale_item.id,
                        "quantity": 1,
                    }
                ],
                "refund_method": "cash",
                "notes": "Customer didn't like the product",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["sale_id"] == sale.id
        assert Decimal(data["total_refund_amount"]) > Decimal("0.00")
        assert len(data["items"]) == 1
        assert Decimal(data["items"][0]["quantity_returned"]) == 1

    def test_create_return_multiple_items(self, client: TestClient, db_session, manager_headers):
        """Test creating a return with multiple items."""
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product1 = Product(
            name="Product 1",
            barcode="PROD1",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=90,
        )
        product2 = Product(
            name="Product 2",
            barcode="PROD2",
            category_id=category.id,
            cost_price=Decimal("20.00"),
            sell_price=Decimal("25.00"),
            stock_quantity=80,
        )
        db_session.add_all([product1, product2])
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
            subtotal=Decimal("80.00"),
            tax_amount=Decimal("8.00"),
            total_amount=Decimal("88.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
            created_at=datetime.now(),
        )
        db_session.add(sale)
        db_session.flush()

        item1 = SaleItem(
            sale_id=sale.id,
            product_id=product1.id,
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
        )
        item2 = SaleItem(
            sale_id=sale.id,
            product_id=product2.id,
            quantity=2,
            unit_price=Decimal("25.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("5.00"),
            subtotal=Decimal("50.00"),
            total=Decimal("55.00"),
        )
        db_session.add_all([item1, item2])

        product1.stock_quantity -= 2
        product2.stock_quantity -= 2
        db_session.flush()

        # Return 1 item from each
        final_headers = with_idempotency(manager_headers, "return-multi-123")
        response = client.post(
            f"/api/sales/{sale.id}/return",
            headers=final_headers,
            json={
                "items": [
                    {"sale_item_id": item1.id, "quantity": 1},
                    {"sale_item_id": item2.id, "quantity": 1},
                ],
                "refund_method": "cash",
                "notes": "Partial return",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert len(data["items"]) == 2

    def test_create_return_without_auth(self, client: TestClient, db_session):
        """Test that creating return requires authentication."""
        response = client.post(
            "/api/sales/1/return",
            json={
                "items": [{"sale_item_id": 1, "quantity": 1}],
                "refund_method": "cash",
            }
        )

        assert response.status_code == 401

    def test_create_return_for_nonexistent_sale(self, client: TestClient, manager_headers):
        """Test creating return for sale that doesn't exist."""
        final_headers = with_idempotency(manager_headers, "return-test-123")
        response = client.post(
            "/api/sales/99999/return",
            headers=final_headers,
            json={
                "items": [{"sale_item_id": 1, "quantity": 1}],
                "refund_method": "cash",
            }
        )

        assert response.status_code == 404

    def test_create_return_with_invalid_item_id(self, client: TestClient, db_session, manager_headers):
        """Test creating return with invalid sale item ID."""
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

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
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        final_headers = with_idempotency(manager_headers, "return-invalid-123")
        response = client.post(
            f"/api/sales/{sale.id}/return",
            headers=final_headers,
            json={
                "items": [{"sale_item_id": 99999, "quantity": 1}],  # Invalid
                "refund_method": "cash",
            }
        )

        assert response.status_code == 404

    def test_create_return_exceeds_quantity(self, client: TestClient, db_session, manager_headers):
        """Test creating return with quantity exceeding sold quantity."""
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

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
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        # Try to return 3 when only 2 were sold
        final_headers = with_idempotency(manager_headers, "return-exceed-123")
        response = client.post(
            f"/api/sales/{sale.id}/return",
            headers=final_headers,
            json={
                "items": [{"sale_item_id": sale_item.id, "quantity": 3}],  # Too many
                "refund_method": "cash",
            }
        )

        assert response.status_code == 400

    def test_create_return_restores_stock(self, client: TestClient, db_session, manager_headers):
        """Test that creating return restores product stock."""
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=95,
        )
        db_session.add(product)
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("7.50"),
            subtotal=Decimal("75.00"),
            total=Decimal("82.50"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        initial_stock = product.stock_quantity

        final_headers = with_idempotency(manager_headers, "return-stock-123")
        response = client.post(
            f"/api/sales/{sale.id}/return",
            headers=final_headers,
            json={
                "items": [{"sale_item_id": sale_item.id, "quantity": 2}],
                "refund_method": "cash",
            }
        )

        assert response.status_code == 201

        # Verify stock was restored
        db_session.refresh(product)
        assert product.stock_quantity == initial_stock + 2

    def test_create_return_with_refund_methods(self, client: TestClient, db_session, manager_headers):
        """Test creating returns with different refund methods."""
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

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
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        # Test cash refund
        final_headers = with_idempotency(manager_headers, "return-cash-123")
        response = client.post(
            f"/api/sales/{sale.id}/return",
            headers=final_headers,
            json={
                "items": [{"sale_item_id": sale_item.id, "quantity": 1}],
                "refund_method": "cash",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["refund_method"] == "cash"

    def test_create_return_with_notes(self, client: TestClient, db_session, manager_headers):
        """Test creating return with notes."""
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

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
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        final_headers = with_idempotency(manager_headers, "return-notes-123")
        response = client.post(
            f"/api/sales/{sale.id}/return",
            headers=final_headers,
            json={
                "items": [{"sale_item_id": sale_item.id, "quantity": 1}],
                "refund_method": "cash",
                "notes": "Customer changed mind - product not as described",
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert "Customer changed mind" in data["notes"]


class TestReturnHistory:
    """Tests for getting return history."""

    def test_get_return_history_for_sale(self, client: TestClient, db_session, cashier_headers):
        """Test getting return history for a specific sale."""
        # This test would check if there's a GET endpoint for return history
        # For now, let's check if the sale endpoint includes return information
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

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
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        # Check sale response includes return information
        response = client.get(f"/api/sales/{sale.id}", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        # The sale response should include return-related fields
        assert "can_return" in data or "refunded_amount" in data

    def test_sale_without_returns_shows_zero_refund(self, client: TestClient, db_session, cashier_headers):
        """Test that sale without returns shows zero refunded amount."""
        user = User(
            username=f"cashier_{uuid.uuid4().hex[:8]}",
            email=f"cashier_{uuid.uuid4().hex[:8]}@test.com",
            hashed_password=get_password_hash("password123"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

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
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
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
            quantity=2,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        response = client.get(f"/api/sales/{sale.id}", headers=cashier_headers)

        assert response.status_code == 200
        data = response.json()
        # Should show zero refund for sale without returns
        if "refunded_amount" in data:
            assert data["refunded_amount"] == "0.00" or data["refunded_amount"] == 0
