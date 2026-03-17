"""
Unit tests for SaleService.
"""
import pytest
from decimal import Decimal
from datetime import datetime

from services.sale_service import SaleService
from models.sale import Sale, SaleStatus, PaymentMethod, SaleContextType
from models.sale_item import SaleItem
from models.product import Product, ProductType
from models.category import Category
from models.customer import Customer
from models.user import User
from schemas.sale import SaleCreate, SaleItemCreate
from core.security import get_password_hash


class TestGetById:
    """Tests for getting sale by ID."""

    def test_get_existing_sale(self, db_session, test_sale):
        """Test getting an existing sale by ID."""
        service = SaleService(db_session)
        result = service.get_by_id(test_sale.id)

        assert result is not None
        assert result.id == test_sale.id
        assert result.total_amount == test_sale.total_amount

    def test_get_nonexistent_sale(self, db_session):
        """Test getting a sale that doesn't exist."""
        service = SaleService(db_session)
        result = service.get_by_id(99999)

        assert result is None


class TestGetAll:
    """Tests for getting all sales with filters."""

    def test_get_all_sales(self, db_session):
        """Test getting all sales without filters."""
        # Create test data
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
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        # Create multiple sales
        for i in range(3):
            sale = Sale(
                customer_id=customer.id,
                cashier_id=cashier.id,
                subtotal=Decimal(f"{100 + i * 10}.00"),
                tax_amount=Decimal(f"{10 + i}.00"),
                total_amount=Decimal(f"{110 + i * 10}.00"),
                payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED,
                created_at=datetime.now(),
            )
            db_session.add(sale)
        db_session.commit()

        service = SaleService(db_session)
        sales, total = service.get_all()

        assert len(sales) == 3
        assert total == 3

    def test_get_all_with_pagination(self, db_session):
        """Test pagination of sales."""
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
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        for i in range(10):
            sale = Sale(
                customer_id=customer.id,
                cashier_id=cashier.id,
                subtotal=Decimal("100.00"),
                tax_amount=Decimal("10.00"),
                total_amount=Decimal("110.00"),
                payment_method=PaymentMethod.CASH,
                status=SaleStatus.COMPLETED,
            )
            db_session.add(sale)
        db_session.commit()

        service = SaleService(db_session)
        sales, total = service.get_all(skip=0, limit=5)

        assert len(sales) == 5
        assert total == 10

    def test_get_all_filters_by_cashier(self, db_session):
        """Test filtering sales by cashier."""
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

        cashier1 = User(
            username="cashier1",
            email="cashier1@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        cashier2 = User(
            username="cashier2",
            email="cashier2@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add_all([cashier1, cashier2])
        db_session.flush()

        sale1 = Sale(
            customer_id=customer.id,
            cashier_id=cashier1.id,
            subtotal=Decimal("100.00"),
            tax_amount=Decimal("10.00"),
            total_amount=Decimal("110.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
        )
        sale2 = Sale(
            customer_id=customer.id,
            cashier_id=cashier2.id,
            subtotal=Decimal("100.00"),
            tax_amount=Decimal("10.00"),
            total_amount=Decimal("110.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
        )
        db_session.add_all([sale1, sale2])
        db_session.commit()

        service = SaleService(db_session)
        sales, total = service.get_all(cashier_id=cashier1.id)

        assert len(sales) == 1
        assert sales[0].cashier_id == cashier1.id

    def test_get_all_returns_only_completed(self, db_session):
        """Test that cancelled sales are not returned by default."""
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
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        completed_sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("100.00"),
            tax_amount=Decimal("10.00"),
            total_amount=Decimal("110.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
        )
        cancelled_sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("100.00"),
            tax_amount=Decimal("10.00"),
            total_amount=Decimal("110.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.CANCELLED,
        )
        db_session.add_all([completed_sale, cancelled_sale])
        db_session.commit()

        service = SaleService(db_session)
        sales, total = service.get_all()

        assert len(sales) == 1
        assert sales[0].status == SaleStatus.COMPLETED


class TestCreateSale:
    """Tests for creating sales."""

    def test_create_sale_with_items(self, db_session):
        """Test creating a sale with multiple items."""
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

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale_create = SaleCreate(
            customer_id=None,
            items=[
                SaleItemCreate(
                    product_id=product.id,
                    quantity=2,
                    unit_price=Decimal("15.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        result = service.create(sale_create, cashier_id=cashier.id)

        assert result.id is not None
        assert result.total_amount == Decimal("33.00")  # 30 + 3 tax
        assert len(result.items) == 1

        # Verify stock was deducted
        db_session.refresh(product)
        assert product.stock_quantity == 98

    def test_create_sale_deducts_stock(self, db_session):
        """Test that creating a sale deducts product stock."""
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

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale_create = SaleCreate(
            customer_id=None,
            items=[
                SaleItemCreate(
                    product_id=product.id,
                    quantity=5,
                    unit_price=Decimal("15.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        service.create(sale_create, cashier_id=cashier.id)

        db_session.refresh(product)
        assert product.stock_quantity == 95

    def test_create_sale_with_inactive_product(self, db_session):
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

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale_create = SaleCreate(
            customer_id=None,
            items=[
                SaleItemCreate(
                    product_id=product.id,
                    quantity=1,
                    unit_price=Decimal("15.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        with pytest.raises(ValueError, match="not active"):
            service.create(sale_create, cashier_id=cashier.id)

    def test_create_sale_with_nonexistent_product(self, db_session):
        """Test that creating a sale with nonexistent product fails."""
        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale_create = SaleCreate(
            customer_id=None,
            items=[
                SaleItemCreate(
                    product_id=99999,  # Nonexistent
                    quantity=1,
                    unit_price=Decimal("15.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        with pytest.raises(ValueError, match="not found"):
            service.create(sale_create, cashier_id=cashier.id)

    def test_create_sale_with_nonexistent_customer(self, db_session):
        """Test that creating a sale with nonexistent customer fails."""
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

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale_create = SaleCreate(
            customer_id=99999,  # Nonexistent
            items=[
                SaleItemCreate(
                    product_id=product.id,
                    quantity=1,
                    unit_price=Decimal("15.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        with pytest.raises(ValueError, match="Customer.*not found"):
            service.create(sale_create, cashier_id=cashier.id)

    def test_create_sale_calculates_totals_correctly(self, db_session):
        """Test that sale totals are calculated correctly."""
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

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        # 2 items at $20 each = $40 subtotal
        # 10% tax = $4
        # Total = $44
        sale_create = SaleCreate(
            customer_id=None,
            items=[
                SaleItemCreate(
                    product_id=product.id,
                    quantity=2,
                    unit_price=Decimal("20.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        result = service.create(sale_create, cashier_id=cashier.id)

        assert result.subtotal == Decimal("40.00")
        assert result.tax_amount == Decimal("4.00")
        assert result.total_amount == Decimal("44.00")

    def test_create_sale_with_discount(self, db_session):
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

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale_create = SaleCreate(
            customer_id=None,
            items=[
                SaleItemCreate(
                    product_id=product.id,
                    quantity=1,
                    unit_price=Decimal("20.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("5.00"),  # $5 discount
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        result = service.create(sale_create, cashier_id=cashier.id)

        assert result.subtotal == Decimal("20.00")
        assert result.tax_amount == Decimal("2.00")
        assert result.discount_amount == Decimal("5.00")
        assert result.total_amount == Decimal("17.00")  # 20 + 2 - 5

    def test_create_sale_creates_inventory_log(self, db_session):
        """Test that creating a sale creates inventory log entries."""
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

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        sale_create = SaleCreate(
            customer_id=None,
            items=[
                SaleItemCreate(
                    product_id=product.id,
                    quantity=3,
                    unit_price=Decimal("15.00"),
                    tax_percent=Decimal("10.00"),
                    discount_amount=Decimal("0.00"),
                )
            ],
            payment_method=PaymentMethod.CASH,
            discount_amount=Decimal("0.00"),
            context_type=SaleContextType.RETAIL,
        )

        service = SaleService(db_session)
        result = service.create(sale_create, cashier_id=cashier.id)

        # Check inventory log was created
        from models.inventory_log import InventoryLog
        logs = db_session.query(InventoryLog).filter(
            InventoryLog.product_id == product.id
        ).all()

        assert len(logs) == 1
        assert logs[0].quantity_change == -3
        assert logs[0].previous_quantity == 100
        assert logs[0].new_quantity == 97
        assert logs[0].reference_type == "sale"
        assert logs[0].reference_id == result.id


class TestCancelSale:
    """Tests for canceling sales."""

    def test_cancel_sale_restores_stock(self, db_session):
        """Test that canceling a sale restores product stock."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        # Create a sale
        sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            total_amount=Decimal("33.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
        )
        db_session.add(sale)
        db_session.flush()

        sale_item = SaleItem(
            sale_id=sale.id,
            product_id=product.id,
            quantity=5,
            unit_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
        )
        db_session.add(sale_item)

        # Deduct stock
        product.stock_quantity -= 5
        db_session.commit()

        # Verify stock was deducted
        assert product.stock_quantity == 95

        # Cancel the sale
        service = SaleService(db_session)
        result = service.cancel(sale.id, cashier.id)

        # Verify stock was restored
        db_session.refresh(product)
        assert product.stock_quantity == 100
        assert result.status == SaleStatus.CANCELLED

    def test_cancel_nonexistent_sale(self, db_session):
        """Test canceling a sale that doesn't exist."""
        service = SaleService(db_session)
        with pytest.raises(ValueError, match="not found"):
            service.cancel(99999, 1)

    def test_cancel_already_cancelled_sale(self, db_session):
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
            username="cashier",
            email="cashier@test.com",
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

        service = SaleService(db_session)
        with pytest.raises(Exception):  # StateTransitionError
            service.cancel(sale.id, cashier.id)

    def test_cancel_creates_inventory_log(self, db_session):
        """Test that canceling a sale creates inventory log entries."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username="cashier",
            email="cashier@test.com",
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
        )
        db_session.add(sale)
        db_session.flush()

        sale_item = SaleItem(
            sale_id=sale.id,
            product_id=product.id,
            quantity=3,
            unit_price=Decimal("15.00"),
            tax_amount=Decimal("3.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("33.00"),
        )
        db_session.add(sale_item)

        product.stock_quantity -= 3
        db_session.commit()

        # Cancel the sale
        service = SaleService(db_session)
        service.cancel(sale.id, cashier.id)

        # Check inventory log was created
        from models.inventory_log import InventoryLog
        logs = db_session.query(InventoryLog).filter(
            InventoryLog.reference_type == "sale_cancel"
        ).all()

        assert len(logs) == 1
        assert logs[0].quantity_change == 3  # Stock restored
        assert logs[0].previous_quantity == 97
        assert logs[0].new_quantity == 100


class TestToResponse:
    """Tests for converting sale to response schema."""

    def test_to_response_includes_items(self, db_session, test_sale):
        """Test that response includes sale items."""
        service = SaleService(db_session)
        result = service.get_by_id(test_sale.id)

        assert len(result.items) == 1
        assert result.items[0]["product_name"] == "Test Product"

    def test_to_response_includes_customer_info(self, db_session, test_sale):
        """Test that response includes customer information."""
        service = SaleService(db_session)
        result = service.get_by_id(test_sale.id)

        assert result.customer_name is not None
        assert result.customer_name == "Test Customer"

    def test_to_response_includes_cashier_info(self, db_session, test_sale):
        """Test that response includes cashier information."""
        service = SaleService(db_session)
        result = service.get_by_id(test_sale.id)

        assert result.cashier_name is not None

    def test_to_response_can_return_flag(self, db_session):
        """Test that can_return flag is set correctly."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        completed_sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            total_amount=Decimal("33.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
        )
        db_session.add(completed_sale)
        db_session.commit()

        service = SaleService(db_session)
        result = service.get_by_id(completed_sale.id)

        assert result.can_return is True

    def test_to_response_cancelled_sale_cannot_return(self, db_session):
        """Test that cancelled sales cannot be returned."""
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

        customer = Customer(name="Test Customer")
        db_session.add(customer)

        cashier = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(cashier)
        db_session.flush()

        cancelled_sale = Sale(
            customer_id=customer.id,
            cashier_id=cashier.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            total_amount=Decimal("33.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.CANCELLED,
        )
        db_session.add(cancelled_sale)
        db_session.commit()

        service = SaleService(db_session)
        result = service.get_by_id(cancelled_sale.id)

        assert result.can_return is False
