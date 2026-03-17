"""
Unit tests for SaleReturnService - Critical for UI Return Functionality.
"""
import pytest
from decimal import Decimal
from datetime import datetime

from services.sale_return_service import SaleReturnService
from models.sale import Sale, SaleStatus, PaymentMethod, SaleContextType
from models.sale_item import SaleItem
from models.sale_return import SaleReturn, SaleReturnItem
from models.product import Product, ProductType
from models.category import Category
from models.customer import Customer
from models.user import User
from core.security import get_password_hash
from schemas.sale_return import SaleReturnCreate, SaleReturnItemCreate
from core.state_machine import StateTransitionError


class TestProcessReturn:
    """Tests for processing sale returns."""

    def test_process_return_single_item(self, db_session):
        """Test processing a return for a single item."""
        # Setup: Create a user
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

        # Setup: Create category and product
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=90,  # After some sales
            product_type=ProductType.ITEM,
        )
        db_session.add(product)
        db_session.flush()

        # Setup: Create a customer
        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        # Setup: Create a sale with items
        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
            context_type=SaleContextType.RETAIL,
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

        # Process return of 1 item
        return_data = SaleReturnCreate(
            items=[
                SaleReturnItemCreate(
                    sale_item_id=sale_item.id,
                    quantity=1,
                )
            ],
            refund_method=PaymentMethod.CASH,
            notes="Customer didn't want item",
        )

        service = SaleReturnService(db_session)
        result = service.process_return(sale.id, return_data, user.id)

        assert result.id is not None
        assert result.total_refund_amount > 0
        assert len(result.items) == 1
        assert result.items[0].quantity_returned == 1

        # Verify stock was restored (started at 90, deducted 2, restored 1 = 89)
        db_session.refresh(product)
        assert product.stock_quantity == 89  # 90 - 2 + 1 = 89

    def test_process_return_multiple_items(self, db_session):
        """Test processing a return with multiple items."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            stock_quantity=95,
            product_type=ProductType.ITEM,
        )
        product2 = Product(
            name="Product 2",
            barcode="PROD2",
            category_id=category.id,
            cost_price=Decimal("20.00"),
            sell_price=Decimal("25.00"),
            stock_quantity=80,
            product_type=ProductType.ITEM,
        )
        db_session.add_all([product1, product2])
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
            context_type=SaleContextType.RETAIL,
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
            created_at=datetime.now(),
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
            created_at=datetime.now(),
        )
        db_session.add_all([item1, item2])

        product1.stock_quantity -= 2
        product2.stock_quantity -= 2
        db_session.flush()

        # Return 1 item from each
        return_data = SaleReturnCreate(
            items=[
                SaleReturnItemCreate(sale_item_id=item1.id, quantity=1),
                SaleReturnItemCreate(sale_item_id=item2.id, quantity=1),
            ],
            refund_method=PaymentMethod.CASH,
            notes="Partial return",
        )

        service = SaleReturnService(db_session)
        result = service.process_return(sale.id, return_data, user.id)

        assert len(result.items) == 2
        assert result.total_refund_amount > 0

    def test_process_return_nonexistent_sale(self, db_session):
        """Test processing return for nonexistent sale."""
        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=1, quantity=1)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        with pytest.raises(ValueError, match="not found"):
            service.process_return(99999, return_data, 1)

    def test_process_return_cancelled_sale(self, db_session):
        """Test that cancelled sales cannot be returned."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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
            status=SaleStatus.CANCELLED,  # Cancelled
            created_at=datetime.now(),
        )
        db_session.add(sale)
        db_session.flush()

        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=1, quantity=1)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        with pytest.raises(StateTransitionError):
            service.process_return(sale.id, return_data, user.id)

    def test_process_return_invalid_sale_item_id(self, db_session):
        """Test returning item that doesn't exist in sale."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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

        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=99999, quantity=1)],  # Invalid
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        with pytest.raises(ValueError, match="not found in sale"):
            service.process_return(sale.id, return_data, user.id)

    def test_process_return_exceeds_available_quantity(self, db_session):
        """Test that returning more than sold quantity fails."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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

        # Try to return 3 items when only 2 were sold
        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=sale_item.id, quantity=3)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        with pytest.raises(ValueError, match="Cannot return.*Only 2 available"):
            service.process_return(sale.id, return_data, user.id)

    def test_process_return_restores_stock(self, db_session):
        """Test that processing return restores product stock."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            stock_quantity=95,  # After sale deduction
            product_type=ProductType.ITEM,
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

        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=sale_item.id, quantity=2)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        service.process_return(sale.id, return_data, user.id)

        # Verify stock was restored
        db_session.refresh(product)
        assert product.stock_quantity == 97  # 95 + 2

    def test_process_return_creates_inventory_log(self, db_session):
        """Test that processing return creates inventory log."""
        from models.inventory_log import InventoryLog

        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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

        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=sale_item.id, quantity=1)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        service.process_return(sale.id, return_data, user.id)

        # Check inventory log was created
        logs = db_session.query(InventoryLog).filter(
            InventoryLog.reference_type == "sale_return"
        ).all()

        assert len(logs) == 1
        assert logs[0].quantity_change == 1  # Stock restored
        assert logs[0].reason == f"Return from Sale #{sale.id}"

    def test_process_return_full_return_updates_status(self, db_session):
        """Test that returning all items marks sale as RETURNED."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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

        # Return all items
        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=sale_item.id, quantity=2)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        service.process_return(sale.id, return_data, user.id)

        # Verify sale status changed to RETURNED
        db_session.refresh(sale)
        assert sale.status == SaleStatus.RETURNED

    def test_process_return_partial_return_updates_status(self, db_session):
        """Test that partial return marks sale as PARTIALLY_RETURNED."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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

        # Return only 1 of 2 items
        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=sale_item.id, quantity=1)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        service.process_return(sale.id, return_data, user.id)

        # Verify sale status changed to PARTIALLY_RETURNED
        db_session.refresh(sale)
        assert sale.status == SaleStatus.PARTIALLY_RETURNED


class TestGetReturnsForSale:
    """Tests for getting returns for a sale."""

    def test_get_returns_for_sale(self, db_session):
        """Test getting all returns for a sale."""
        from models.sale_return import SaleReturn

        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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

        # Create a return
        sale_return = SaleReturn(
            sale_id=sale.id,
            user_id=user.id,
            total_refund_amount=Decimal("16.50"),
            refund_method=PaymentMethod.CASH,
        )
        db_session.add(sale_return)
        db_session.flush()

        service = SaleReturnService(db_session)
        returns = service.get_returns_for_sale(sale.id)

        assert len(returns) == 1
        assert returns[0].sale_id == sale.id

    def test_get_returns_for_nonexistent_sale(self, db_session):
        """Test getting returns for sale that doesn't exist."""
        service = SaleReturnService(db_session)
        returns = service.get_returns_for_sale(99999)

        assert len(returns) == 0


class TestRefundCalculation:
    """Tests for refund amount calculation."""

    def test_refund_calculation_single_item(self, db_session):
        """Test correct refund calculation for single item."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
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

        # Item: $30 subtotal + $3 tax = $33 total for 2 items
        # Per item: $16.50
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

        # Return 1 item, should get $16.50 refund
        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=sale_item.id, quantity=1)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        result = service.process_return(sale.id, return_data, user.id)

        # Refund should be half of total
        expected = Decimal("33.00") / 2
        assert result.total_refund_amount == expected

    def test_refund_calculation_with_discount(self, db_session):
        """Test refund calculation when original sale had discount."""
        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
        )
        db_session.add(product)
        db_session.flush()

        customer = Customer(name="Test Customer")
        db_session.add(customer)
        db_session.flush()

        # Sale with $5 discount: $30 + $3 tax - $5 = $28 total
        sale = Sale(
            customer_id=customer.id,
            cashier_id=user.id,
            subtotal=Decimal("30.00"),
            tax_amount=Decimal("3.00"),
            discount_amount=Decimal("5.00"),
            total_amount=Decimal("28.00"),
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
            discount_amount=Decimal("5.00"),
            subtotal=Decimal("30.00"),
            total=Decimal("28.00"),
            created_at=datetime.now(),
        )
        db_session.add(sale_item)
        db_session.flush()

        # Return 1 item, should get $14.00 refund (half of $28)
        return_data = SaleReturnCreate(
            items=[SaleReturnItemCreate(sale_item_id=sale_item.id, quantity=1)],
            refund_method=PaymentMethod.CASH,
        )

        service = SaleReturnService(db_session)
        result = service.process_return(sale.id, return_data, user.id)

        expected = Decimal("28.00") / 2
        assert result.total_refund_amount == expected


class TestRestaurantSales:
    """Tests for restaurant-specific sale functionality."""

    def test_create_restaurant_sale_with_table(self, db_session):
        """Test creating a restaurant sale with table assignment."""
        from schemas.sale import SaleCreate, SaleItemCreate
        from services.sale_service import SaleService

        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
            role="cashier",
        )
        db_session.add(user)
        db_session.flush()

        category = Category(name="Restaurant Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Dish",
            barcode="DISH001",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            product_type=ProductType.DISH,  # Restaurant dish
        )
        db_session.add(product)
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
            payment_method="cash",
            discount_amount=Decimal("0.00"),
            context_type="restaurant",
            table_name="Table 5",
        )

        service = SaleService(db_session)
        result = service.create(sale_create, user.id)

        assert result.context_type == "restaurant"
        assert result.table_name == "Table 5"

    def test_get_sales_filtered_by_restaurant_context(self, db_session):
        """Test filtering sales by restaurant context."""
        from schemas.sale import SaleCreate, SaleItemCreate
        from services.sale_service import SaleService

        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
        )
        db_session.add(product)
        db_session.flush()

        # Create retail sale
        retail_sale = SaleCreate(
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
            payment_method="cash",
            discount_amount=Decimal("0.00"),
            context_type="retail",
        )

        # Create restaurant sale
        restaurant_sale = SaleCreate(
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
            payment_method="cash",
            discount_amount=Decimal("0.00"),
            context_type="restaurant",
            table_name="Table 1",
        )

        service = SaleService(db_session)
        service.create(retail_sale, user.id)
        service.create(restaurant_sale, user.id)

        # Get only restaurant sales
        from models.sale import SaleContextType
        sales, total = service.get_all(context_type=SaleContextType.RESTAURANT)

        assert total == 1
        assert all(s.context_type == "restaurant" for s in sales)

    def test_get_sales_with_table_filtering(self, db_session):
        """Test that restaurant sales include table information."""
        from schemas.sale import SaleCreate, SaleItemCreate
        from services.sale_service import SaleService

        user = User(
            username="cashier",
            email="cashier@test.com",
            hashed_password=get_password_hash("password"),
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
            product_type=ProductType.ITEM,
        )
        db_session.add(product)
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
            payment_method="cash",
            discount_amount=Decimal("0.00"),
            context_type="restaurant",
            table_name="Table 5",
        )

        service = SaleService(db_session)
        result = service.create(sale_create, user.id)

        # Verify table information is included
        assert result.table_name == "Table 5"
        assert result.context_type == "restaurant"
