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
from models.inventory_layer import InventoryLayer
from models.product import Product
from models.category import Category
from models.customer import Customer
from models.user import User
from core.security import get_password_hash


def with_idempotency(headers: dict, key: str) -> dict:
    normalized_key = key if len(key) >= 16 else f"{key}-tenant-safe"
    return {**headers, "Idempotency-Key": normalized_key}


def back_with_layer(db_session, product):
    """Give a hand-built product an opening FIFO layer so it can be sold.

    Under the FIFO ledger a sale consumes from inventory layers; products built
    inline in a test carry stock_quantity but no layers, so they must be backed
    before the create-sale endpoint can allocate them.
    """
    quantity = Decimal(product.stock_quantity or 0)
    unit_cost = Decimal(product.cost_price or 0)
    product.inventory_value = (quantity * unit_cost).quantize(Decimal("0.0001"))
    if quantity > 0:
        db_session.add(
            InventoryLayer(
                company_id=product.company_id,
                product_id=product.id,
                source_type="opening_balance",
                source_id=None,
                original_quantity=quantity,
                remaining_quantity=quantity,
                unit_cost=unit_cost,
            )
        )
        db_session.flush()
    return product


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

    def _seed_completed_sales(self, db_session, company_id, cashier_id, count):
        """Insert ``count`` completed sales with strictly increasing timestamps."""
        base = datetime(2030, 1, 1, 8, 0, 0)
        created = []
        for i in range(count):
            sale = Sale(
                company_id=company_id,
                cashier_id=cashier_id,
                subtotal=Decimal("10.00"),
                tax_amount=Decimal("0.00"),
                total_amount=Decimal("10.00"),
                payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED,
                created_at=base.replace(minute=i),
            )
            db_session.add(sale)
            created.append(sale)
        db_session.flush()
        return created

    def test_list_sales_exposes_total_count_header(
        self, client: TestClient, db_session, default_company, cashier_user, cashier_headers
    ):
        """The list endpoint reports the full tenant total via X-Total-Count so
        the client can paginate beyond a single page."""
        self._seed_completed_sales(db_session, default_company.id, cashier_user.id, 3)

        response = client.get(
            "/api/sales", params={"skip": 0, "limit": 2}, headers=cashier_headers
        )

        assert response.status_code == 200
        assert len(response.json()) == 2  # page is capped by limit
        assert response.headers["X-Total-Count"] == "3"  # total ignores the limit

    def test_list_sales_paginates_with_skip(
        self, client: TestClient, db_session, default_company, cashier_user, cashier_headers
    ):
        """skip/limit walk the full history in disjoint pages (older sales are
        reachable on later pages, not lost)."""
        self._seed_completed_sales(db_session, default_company.id, cashier_user.id, 3)

        page1 = client.get(
            "/api/sales", params={"skip": 0, "limit": 2}, headers=cashier_headers
        )
        page2 = client.get(
            "/api/sales", params={"skip": 2, "limit": 2}, headers=cashier_headers
        )

        ids1 = [s["id"] for s in page1.json()]
        ids2 = [s["id"] for s in page2.json()]

        assert len(ids1) == 2
        assert len(ids2) == 1
        assert set(ids1).isdisjoint(ids2)  # no overlap between pages
        assert len(set(ids1) | set(ids2)) == 3  # together they cover everything
        assert page2.headers["X-Total-Count"] == "3"

    def test_search_sales_by_misspelled_product_name(
        self,
        client: TestClient,
        db_session,
        cashier_headers,
        test_sale,
        test_product,
    ):
        test_product.name = "Кола"
        db_session.flush()

        response = client.get(
            "/api/sales",
            params={"search": "колаа"},
            headers=cashier_headers,
        )

        assert response.status_code == 200
        assert [sale["id"] for sale in response.json()] == [test_sale.id]

    def test_search_sales_by_total_sold_quantity(
        self,
        client: TestClient,
        db_session,
        cashier_headers,
        default_company,
        cashier_user,
        test_product,
    ):
        test_product.name = "Quantity Product"
        test_product.barcode = "QTYSAFE"
        sale = Sale(
            id=900001,
            company_id=default_company.id,
            customer_id=None,
            cashier_id=cashier_user.id,
            subtotal=Decimal("31.00"),
            tax_amount=Decimal("3.00"),
            discount_amount=Decimal("0.00"),
            total_amount=Decimal("34.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
            created_at=datetime(2034, 3, 4, 5, 6, 7),
        )
        db_session.add(sale)
        db_session.flush()
        db_session.add_all(
            [
                SaleItem(
                    sale_id=sale.id,
                    product_id=test_product.id,
                    quantity=Decimal("7"),
                    sold_quantity=Decimal("7"),
                    unit_price=Decimal("2.00"),
                    tax_percent=Decimal("0.00"),
                    tax_amount=Decimal("0.00"),
                    discount_amount=Decimal("0.00"),
                    subtotal=Decimal("14.00"),
                    total=Decimal("14.00"),
                ),
                SaleItem(
                    sale_id=sale.id,
                    product_id=test_product.id,
                    quantity=Decimal("5"),
                    sold_quantity=Decimal("5"),
                    unit_price=Decimal("4.00"),
                    tax_percent=Decimal("0.00"),
                    tax_amount=Decimal("0.00"),
                    discount_amount=Decimal("0.00"),
                    subtotal=Decimal("20.00"),
                    total=Decimal("20.00"),
                ),
            ]
        )
        db_session.flush()

        response = client.get(
            "/api/sales",
            params={"search": "12"},
            headers=cashier_headers,
        )

        assert response.status_code == 200
        assert sale.id in [result["id"] for result in response.json()]

    def test_search_suggestions_return_close_typed_value(
        self,
        client: TestClient,
        db_session,
        cashier_headers,
        test_sale,
        test_product,
    ):
        test_product.name = "Кола"
        db_session.flush()

        response = client.get(
            "/api/sales/search-suggestions",
            params={"q": "колаа"},
            headers=cashier_headers,
        )

        assert response.status_code == 200
        assert response.json()[0] == {
            "kind": "product",
            "label": "Кола",
            "value": "Кола",
            "score": response.json()[0]["score"],
        }
        assert response.json()[0]["score"] >= 82

    def test_sales_search_rejects_overlong_query(
        self, client: TestClient, cashier_headers
    ):
        response = client.get(
            "/api/sales",
            params={"search": "x" * 101},
            headers=cashier_headers,
        )

        assert response.status_code == 422

    def test_return_status_group_filters_on_server(
        self, client: TestClient, db_session, cashier_headers, cashier_user
    ):
        db_session.add_all(
            [
                Sale(
                    cashier_id=cashier_user.id,
                    subtotal=Decimal("10"),
                    tax_amount=Decimal("0"),
                    discount_amount=Decimal("0"),
                    total_amount=Decimal("10"),
                    payment_method=PaymentMethod.CASH,
                    status=SaleStatus.RETURNED,
                ),
                Sale(
                    cashier_id=cashier_user.id,
                    subtotal=Decimal("20"),
                    tax_amount=Decimal("0"),
                    discount_amount=Decimal("0"),
                    total_amount=Decimal("20"),
                    payment_method=PaymentMethod.CASH,
                    status=SaleStatus.PARTIALLY_RETURNED,
                ),
                Sale(
                    cashier_id=cashier_user.id,
                    subtotal=Decimal("30"),
                    tax_amount=Decimal("0"),
                    discount_amount=Decimal("0"),
                    total_amount=Decimal("30"),
                    payment_method=PaymentMethod.CASH,
                    status=SaleStatus.COMPLETED,
                ),
            ]
        )
        db_session.flush()

        response = client.get(
            "/api/sales",
            params={"status_group": "returns"},
            headers=cashier_headers,
        )

        assert response.status_code == 200
        assert {sale["status"] for sale in response.json()} == {
            "returned",
            "partially_returned",
        }

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
        db_session.flush()
        back_with_layer(db_session, product)
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
        db_session.flush()
        back_with_layer(db_session, product1)
        back_with_layer(db_session, product2)
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
        db_session.flush()
        back_with_layer(db_session, product)
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
        db_session.flush()
        back_with_layer(db_session, product)
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
    """Tests for the DEPRECATED POST /api/sales/{id}/cancel endpoint.

    The endpoint is now admin-only, requires a ``{"reason": ...}`` body and
    routes through the annulment (void) service, returning a VoidResult.
    Cashiers and managers can no longer cancel sales.
    """

    def _build_legacy_sale(self, db_session, qty=5):
        """A legacy (pre-ledger) sale: stock bumped directly, no allocations."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode=f"TEST{uuid.uuid4().hex[:8]}",
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
            quantity=qty,
            unit_price=Decimal("15.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
            unit_cost_at_sale=Decimal("10.00"),
            cost_total_at_sale=Decimal("50.00"),
        )
        db_session.add(sale_item)
        product.stock_quantity -= qty
        db_session.commit()
        return sale, product

    def test_cancel_sale_as_admin_with_reason(self, client: TestClient, db_session, admin_headers):
        """Admin can cancel a sale via the deprecated endpoint with a reason,
        and the FIFO-backed restock restores stock (legacy: via void layer)."""
        sale, product = self._build_legacy_sale(db_session, qty=5)
        assert product.stock_quantity == 95

        response = client.post(
            f"/api/sales/{sale.id}/cancel",
            json={"reason": "Отмена администратором"},
            headers=with_idempotency(admin_headers, "sale-cancel-success"),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cancelled"
        assert data["entity_type"] == "sale"
        assert data["entity_id"] == sale.id

        # Verify stock was restored through the ledger
        db_session.refresh(product)
        assert product.stock_quantity == 100

    @pytest.mark.parametrize("headers_fixture", ["manager_headers", "cashier_headers"])
    def test_cancel_sale_forbidden_for_non_admin(
        self, client: TestClient, db_session, request, headers_fixture
    ):
        """Managers and cashiers may no longer cancel sales."""
        sale, _ = self._build_legacy_sale(db_session)
        headers = with_idempotency(
            request.getfixturevalue(headers_fixture), "sale-cancel-forbidden"
        )
        response = client.post(
            f"/api/sales/{sale.id}/cancel",
            json={"reason": "Попытка отмены"},
            headers=headers,
        )
        assert response.status_code == 403

    def test_cancel_sale_requires_reason(self, client: TestClient, db_session, admin_headers):
        """A reason of fewer than 3 characters is rejected with 422."""
        sale, _ = self._build_legacy_sale(db_session)
        response = client.post(
            f"/api/sales/{sale.id}/cancel",
            json={"reason": "x"},
            headers=with_idempotency(admin_headers, "sale-cancel-no-reason"),
        )
        assert response.status_code == 422

    def test_cancel_nonexistent_sale(self, client: TestClient, admin_headers):
        """Test canceling a sale that doesn't exist."""
        response = client.post(
            "/api/sales/99999/cancel",
            json={"reason": "Несуществующая продажа"},
            headers=with_idempotency(admin_headers, "sale-cancel-missing"),
        )
        assert response.status_code == 404

    def test_cancel_already_cancelled_sale(self, client: TestClient, db_session, admin_headers):
        """Test that canceling an already annulled sale fails with 409."""
        sale, _ = self._build_legacy_sale(db_session)

        first = client.post(
            f"/api/sales/{sale.id}/cancel",
            json={"reason": "Первая отмена"},
            headers=with_idempotency(admin_headers, "sale-cancel-conflict-1"),
        )
        assert first.status_code == 200

        second = client.post(
            f"/api/sales/{sale.id}/cancel",
            json={"reason": "Вторая отмена"},
            headers=with_idempotency(admin_headers, "sale-cancel-conflict-2"),
        )
        assert second.status_code == 409


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
        db_session.flush()
        back_with_layer(db_session, product)
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
        db_session.flush()
        back_with_layer(db_session, product)
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
