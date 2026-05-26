"""
Unit tests for InventoryService.
"""
import pytest
from decimal import Decimal

from services.inventory_service import InventoryService
from models.product import Product
from models.category import Category
from models.inventory_log import InventoryLog


class TestGetLogs:
    """Tests for getting inventory logs."""

    def test_get_logs(self, db_session):
        """Test getting inventory logs."""
        from core.security import get_password_hash
        from models.user import User

        # Create a user first
        user = User(
            username="testuser",
            email="test@test.com",
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
        )
        db_session.add(product)
        db_session.flush()

        # Create an inventory log
        log = InventoryLog(
            product_id=product.id,
            user_id=user.id,
            quantity_change=-5,
            previous_quantity=100,
            new_quantity=95,
            reason="Test adjustment",
        )
        db_session.add(log)
        db_session.flush()

        service = InventoryService(db_session)
        logs, total = service.get_logs()

        assert len(logs) >= 1
        assert total >= 1

    def test_get_logs_with_pagination(self, db_session):
        """Test pagination of inventory logs."""
        from core.security import get_password_hash
        from models.user import User

        # Create a user first
        user = User(
            username="testuser",
            email="test@test.com",
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
        )
        db_session.add(product)
        db_session.flush()

        # Create multiple logs
        for i in range(10):
            log = InventoryLog(
                product_id=product.id,
                user_id=user.id,
                quantity_change=-1,
                previous_quantity=100 - i,
                new_quantity=99 - i,
                reason=f"Test adjustment {i}",
            )
            db_session.add(log)
        db_session.flush()

        service = InventoryService(db_session)
        logs, total = service.get_logs(skip=0, limit=5)

        assert len(logs) == 5
        assert total == 10

    def test_get_logs_filtered_by_product(self, db_session):
        """Test filtering logs by product."""
        from core.security import get_password_hash
        from models.user import User

        # Create a user first
        user = User(
            username="testuser",
            email="test@test.com",
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
            barcode="TEST1",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        product2 = Product(
            name="Product 2",
            barcode="TEST2",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=50,
        )
        db_session.add_all([product1, product2])
        db_session.flush()

        log1 = InventoryLog(
            product_id=product1.id,
            user_id=user.id,
            quantity_change=-5,
            previous_quantity=100,
            new_quantity=95,
            reason="Test 1",
        )
        log2 = InventoryLog(
            product_id=product2.id,
            user_id=user.id,
            quantity_change=-3,
            previous_quantity=50,
            new_quantity=47,
            reason="Test 2",
        )
        db_session.add_all([log1, log2])
        db_session.flush()

        service = InventoryService(db_session)
        logs, total = service.get_logs(product_id=product1.id)

        assert len(logs) == 1
        assert logs[0].product_id == product1.id


class TestAdjustStock:
    """Tests for adjusting stock."""

    def test_adjust_stock_decrease(self, db_session):
        """Test decreasing stock quantity."""
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

        from schemas.inventory_log import InventoryAdjustment
        adjustment = InventoryAdjustment(
            product_id=product.id,
            quantity_change=-10,
            reason="Damaged goods",
        )

        service = InventoryService(db_session)
        result = service.adjust_stock(adjustment, user_id=1)

        # Result is the product object
        db_session.refresh(product)
        assert product.stock_quantity == 90

    def test_adjust_stock_increase(self, db_session):
        """Test increasing stock quantity."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=50,
        )
        db_session.add(product)
        db_session.flush()

        from schemas.inventory_log import InventoryAdjustment
        adjustment = InventoryAdjustment(
            product_id=product.id,
            quantity_change=20,
            reason="Stock received",
        )

        service = InventoryService(db_session)
        result = service.adjust_stock(adjustment, user_id=1)

        db_session.refresh(product)
        assert product.stock_quantity == 70

    def test_adjust_stock_creates_log(self, db_session):
        """Test that adjusting stock creates an inventory log."""
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

        from schemas.inventory_log import InventoryAdjustment
        adjustment = InventoryAdjustment(
            product_id=product.id,
            quantity_change=-5,
            reason="Test adjustment",
        )

        service = InventoryService(db_session)
        service.adjust_stock(adjustment, user_id=1)

        # Check that a log was created
        logs = db_session.query(InventoryLog).filter(
            InventoryLog.product_id == product.id
        ).all()

        assert len(logs) == 1
        assert logs[0].quantity_change == -5
        assert logs[0].previous_quantity == 100
        assert logs[0].new_quantity == 95
        assert logs[0].reason == "Test adjustment"

    def test_adjust_stock_insufficient_stock(self, db_session):
        """Test that adjusting below zero fails."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=10,
        )
        db_session.add(product)
        db_session.flush()

        from schemas.inventory_log import InventoryAdjustment
        adjustment = InventoryAdjustment(
            product_id=product.id,
            quantity_change=-20,  # More than available
            reason="Test",
        )

        service = InventoryService(db_session)
        with pytest.raises(ValueError, match="Insufficient stock"):
            service.adjust_stock(adjustment, user_id=1)

    def test_adjust_stock_nonexistent_product(self, db_session):
        """Test adjusting stock for nonexistent product."""
        from schemas.inventory_log import InventoryAdjustment
        adjustment = InventoryAdjustment(
            product_id=99999,
            quantity_change=5,
            reason="Test",
        )

        service = InventoryService(db_session)
        with pytest.raises(ValueError, match="not found"):
            service.adjust_stock(adjustment, user_id=1)


class TestGetInventoryValue:
    """Tests for getting inventory valuation."""

    def test_get_inventory_value(self, db_session):
        """Test calculating total inventory value."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product1 = Product(
            name="Product 1",
            barcode="TEST1",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        product2 = Product(
            name="Product 2",
            barcode="TEST2",
            category_id=category.id,
            cost_price=Decimal("20.00"),
            sell_price=Decimal("30.00"),
            stock_quantity=50,
            is_active=True,
        )
        db_session.add_all([product1, product2])
        db_session.flush()

        service = InventoryService(db_session)
        value = service.get_inventory_value()

        # Expected: (100 * 10) + (50 * 20) = 1000 + 1000 = 2000
        # Service returns dict with total_value, total_products, total_items
        assert "total_value" in value
        assert value["total_value"] == "2000.00" or value["total_value"] == Decimal("2000.00")

    def test_get_inventory_value_excludes_inactive(self, db_session):
        """Test that inactive products are excluded from valuation."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        active_product = Product(
            name="Active Product",
            barcode="ACT123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        inactive_product = Product(
            name="Inactive Product",
            barcode="INACT123",
            category_id=category.id,
            cost_price=Decimal("50.00"),
            sell_price=Decimal("75.00"),
            stock_quantity=200,
            is_active=False,
        )
        db_session.add_all([active_product, inactive_product])
        db_session.flush()

        service = InventoryService(db_session)
        value = service.get_inventory_value()

        # Should only include active product: 100 * 10 = 1000
        # Inactive product: 200 * 50 = 10000 (should be excluded)
        assert "total_value" in value
        assert value["total_value"] == "1000.00" or value["total_value"] == Decimal("1000.00")

    def test_get_inventory_value_empty_inventory(self, db_session):
        """Test valuation with no products."""
        service = InventoryService(db_session)
        value = service.get_inventory_value()

        # Returns dict with total_value, total_products, total_items
        assert "total_value" in value
        assert value["total_value"] == "0.00" or value["total_value"] == Decimal("0.00")
