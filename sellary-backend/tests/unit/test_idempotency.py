"""
Unit tests for idempotency service and audit functionality.
"""
import pytest
from decimal import Decimal
from datetime import datetime

from core.idempotency import IdempotencyService, IdempotencyConflictError
from models.idempotency_key import IdempotencyKey
from models.user import User
from core.security import get_password_hash


class TestIdempotencyService:
    """Tests for idempotency key management."""

    def test_store_and_retrieve_response(self, db_session):
        """Test storing and retrieving cached response."""
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="admin",
        )
        db_session.add(user)
        db_session.flush()

        service = IdempotencyService(db_session)

        # Store a response
        service.store_response(
            key="test-key-123",
            user_id=user.id,
            endpoint="/api/test",
            request_body={"param": "value"},
            response_body={"result": "success"},
            status_code=200,
        )

        # Retrieve the response
        cached = service.get_cached_response(
            key="test-key-123",
            user_id=user.id,
            endpoint="/api/test",
            request_body={"param": "value"},
        )

        assert cached is not None
        response_body, status_code = cached
        assert response_body == {"result": "success"}
        assert status_code == 200

    def test_get_nonexistent_key(self, db_session):
        """Test getting response for nonexistent key."""
        service = IdempotencyService(db_session)

        cached = service.get_cached_response(
            key="nonexistent-key",
            user_id=1,
            endpoint="/api/test",
            request_body={},
        )

        assert cached is None

    def test_duplicate_key_raises_error(self, db_session):
        """Test that duplicate idempotency key raises error."""
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="admin",
        )
        db_session.add(user)
        db_session.flush()

        service = IdempotencyService(db_session)

        # Store first response
        service.store_response(
            key="duplicate-key",
            user_id=user.id,
            endpoint="/api/test",
            request_body={},
            response_body={"result": "first"},
            status_code=200,
        )

        # Try to store with same key - should raise error
        with pytest.raises(IdempotencyConflictError):
            service.store_response(
                key="duplicate-key",
                user_id=user.id,
                endpoint="/api/test",
                request_body={},
                response_body={"result": "second"},
                status_code=200,
            )

    def test_different_request_bodies_different_keys(self, db_session):
        """Test that different request bodies create different idempotency records."""
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="admin",
        )
        db_session.add(user)
        db_session.flush()

        service = IdempotencyService(db_session)

        # Store first request
        service.store_response(
            key="key-123",
            user_id=user.id,
            endpoint="/api/test",
            request_body={"param": "value1"},
            response_body={"result": "first"},
            status_code=200,
        )

        # Store second request with different body (should work)
        service.store_response(
            key="key-456",  # Different key
            user_id=user.id,
            endpoint="/api/test",
            request_body={"param": "value2"},  # Different body
            response_body={"result": "second"},
            status_code=200,
        )

        # Both should be retrievable
        cached1 = service.get_cached_response(
            key="key-123",
            user_id=user.id,
            endpoint="/api/test",
            request_body={"param": "value1"},
        )
        cached2 = service.get_cached_response(
            key="key-456",
            user_id=user.id,
            endpoint="/api/test",
            request_body={"param": "value2"},
        )

        assert cached1 is not None
        assert cached2 is not None
        assert cached1[0] == {"result": "first"}
        assert cached2[0] == {"result": "second"}

    def test_idempotency_key_has_timestamp(self, db_session):
        """Test that idempotency keys have created_at timestamps."""
        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="admin",
        )
        db_session.add(user)
        db_session.flush()

        service = IdempotencyService(db_session)

        service.store_response(
            key="expire-test",
            user_id=user.id,
            endpoint="/api/test",
            request_body={},
            response_body={},
            status_code=200,
        )

        # Check that the key has a creation timestamp
        keys = db_session.query(IdempotencyKey).filter(
            IdempotencyKey.key == "expire-test"
        ).all()

        assert len(keys) == 1
        assert keys[0].created_at is not None
        assert keys[0].created_at <= datetime.now()


class TestInventoryAuditTrail:
    """Tests for inventory audit trail functionality."""

    def test_inventory_log_records_changes(self, db_session):
        """Test that inventory logs record all changes."""
        from models.product import Product, ProductType
        from models.category import Category
        from models.inventory_log import InventoryLog

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

        # Create an inventory log
        log = InventoryLog(
            product_id=product.id,
            user_id=1,
            quantity_change=-10,
            previous_quantity=100,
            new_quantity=90,
            reason="Manual adjustment",
            reference_type="manual_adjust",
        )
        db_session.add(log)
        db_session.flush()

        # Retrieve and verify
        logs = db_session.query(InventoryLog).filter(
            InventoryLog.product_id == product.id
        ).all()

        assert len(logs) == 1
        assert logs[0].quantity_change == -10
        assert logs[0].previous_quantity == 100
        assert logs[0].new_quantity == 90
        assert logs[0].reason == "Manual adjustment"
        assert logs[0].reference_type == "manual_adjust"

    def test_inventory_log_includes_user_info(self, db_session):
        """Test that inventory logs include user information."""
        from models.product import Product, ProductType
        from models.category import Category
        from models.inventory_log import InventoryLog

        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        user = User(
            username="testuser",
            email="test@test.com",
            hashed_password=get_password_hash("password"),
            role="manager",
        )
        db_session.add(user)
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

        log = InventoryLog(
            product_id=product.id,
            user_id=user.id,
            quantity_change=-5,
            previous_quantity=100,
            new_quantity=95,
            reason="Test",
        )
        db_session.add(log)
        db_session.flush()

        # Retrieve with user info
        from sqlalchemy.orm import joinedload
        log_with_user = db_session.query(InventoryLog).options(
            joinedload(InventoryLog.user)
        ).first()

        assert log_with_user is not None
        assert log_with_user.user is not None
        assert log_with_user.user.username == "testuser"

    def test_inventory_log_references(self, db_session):
        """Test that inventory logs can reference sales/purchase orders."""
        from models.product import Product, ProductType
        from models.category import Category
        from models.inventory_log import InventoryLog

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

        # Create log referencing a sale
        log = InventoryLog(
            product_id=product.id,
            user_id=1,
            quantity_change=-2,
            previous_quantity=100,
            new_quantity=98,
            reason="Sale #123",
            reference_type="sale",
            reference_id=123,
        )
        db_session.add(log)
        db_session.flush()

        logs = db_session.query(InventoryLog).filter(
            InventoryLog.reference_type == "sale"
        ).all()

        assert len(logs) == 1
        assert logs[0].reference_id == 123
