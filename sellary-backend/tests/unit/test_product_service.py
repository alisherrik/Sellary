"""
Unit tests for ProductService.
"""
import pytest
from decimal import Decimal

from services.product_service import ProductService
from models.product import Product
from models.category import Category
from schemas.product import ProductCreate, ProductUpdate


class TestGetById:
    """Tests for getting product by ID."""

    def test_get_existing_product(self, db_session):
        """Test getting an existing product by ID."""
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

        service = ProductService(db_session)
        result = service.get_by_id(product.id)

        assert result is not None
        assert result.id == product.id
        assert result.name == "Test Product"

    def test_get_nonexistent_product(self, db_session):
        """Test getting a product that doesn't exist."""
        service = ProductService(db_session)
        result = service.get_by_id(99999)

        assert result is None


class TestGetByBarcode:
    """Tests for getting product by barcode."""

    def test_get_product_by_valid_barcode(self, db_session):
        """Test getting a product by valid barcode."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product = Product(
            name="Test Product",
            barcode="BARCODE123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
        )
        db_session.add(product)
        db_session.commit()

        service = ProductService(db_session)
        result = service.get_by_barcode("BARCODE123")

        assert result is not None
        assert result.barcode == "BARCODE123"

    def test_get_product_by_invalid_barcode(self, db_session):
        """Test getting a product by invalid barcode."""
        service = ProductService(db_session)
        result = service.get_by_barcode("INVALID999")

        assert result is None


class TestGetAll:
    """Tests for getting all products with filters."""

    def test_get_all_products(self, db_session):
        """Test getting all products without filters."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        for i in range(5):
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

        service = ProductService(db_session)
        products, total = service.get_all()

        assert len(products) == 5
        assert total == 5

    def test_get_all_with_pagination(self, db_session):
        """Test pagination of products."""
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

        service = ProductService(db_session)
        products, total = service.get_all(skip=0, limit=5)

        assert len(products) == 5
        assert total == 10

    def test_get_all_with_search(self, db_session):
        """Test searching products by name."""
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

        service = ProductService(db_session)
        products, total = service.get_all(search="Apple")

        assert len(products) == 1
        assert products[0].name == "Apple iPhone"

    def test_get_all_with_category_filter(self, db_session):
        """Test filtering products by category."""
        cat1 = Category(name="Category 1")
        cat2 = Category(name="Category 2")
        db_session.add_all([cat1, cat2])
        db_session.flush()

        prod1 = Product(
            name="Product 1",
            barcode="BAR1",
            category_id=cat1.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        prod2 = Product(
            name="Product 2",
            barcode="BAR2",
            category_id=cat2.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add_all([prod1, prod2])
        db_session.commit()

        service = ProductService(db_session)
        products, total = service.get_all(category_id=cat1.id)

        assert len(products) == 1
        assert products[0].category_id == cat1.id

    def test_get_all_excludes_inactive_products(self, db_session):
        """Test that inactive products are not returned by default."""
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
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=False,
        )
        db_session.add_all([active_product, inactive_product])
        db_session.commit()

        service = ProductService(db_session)
        products, total = service.get_all()

        assert len(products) == 1
        assert products[0].name == "Active Product"


class TestCreate:
    """Tests for creating products."""

    def test_create_product(self, db_session):
        """Test creating a product successfully."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.commit()

        product_create = ProductCreate(
            barcode="NEW123",
            name="New Product",
            description="A new product",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=50,
            min_stock_level=5,
            is_active=True,
        )

        service = ProductService(db_session)
        result = service.create(product_create)

        assert result.id is not None
        assert result.barcode == "NEW123"
        assert result.name == "New Product"

    def test_create_product_with_duplicate_barcode(self, db_session):
        """Test creating a product with duplicate barcode raises error."""
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

        product_create = ProductCreate(
            barcode="DUP123",  # Duplicate
            name="New Product",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=50,
        )

        service = ProductService(db_session)
        with pytest.raises(ValueError, match="barcode.*already exists"):
            service.create(product_create)

    def test_create_product_with_invalid_category(self, db_session):
        """Test creating a product with invalid category raises error."""
        product_create = ProductCreate(
            barcode="NEW123",
            name="New Product",
            category_id=99999,  # Invalid category
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=50,
        )

        service = ProductService(db_session)
        with pytest.raises(ValueError, match="Category.*not found"):
            service.create(product_create)

    def test_create_product_without_category(self, db_session):
        """Test creating a product without category."""
        product_create = ProductCreate(
            barcode="NEW123",
            name="New Product",
            category_id=None,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=50,
        )

        service = ProductService(db_session)
        result = service.create(product_create)

        assert result.id is not None
        assert result.category_id is None


class TestUpdate:
    """Tests for updating products."""

    def test_update_product(self, db_session):
        """Test updating a product successfully."""
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

        product_update = ProductUpdate(
            name="Updated Name",
            sell_price=Decimal("20.00"),
        )

        service = ProductService(db_session)
        result = service.update(product.id, product_update)

        assert result.name == "Updated Name"
        assert result.sell_price == Decimal("20.00")
        assert result.barcode == "TEST123"  # Unchanged

    def test_update_nonexistent_product(self, db_session):
        """Test updating a product that doesn't exist."""
        product_update = ProductUpdate(name="Updated Name")

        service = ProductService(db_session)
        with pytest.raises(ValueError, match="Product.*not found"):
            service.update(99999, product_update)

    def test_update_product_partial_fields(self, db_session):
        """Test updating only specific fields of a product."""
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
            description="Original Description",
        )
        db_session.add(product)
        db_session.commit()

        product_update = ProductUpdate(
            name="Updated Name",
        )

        service = ProductService(db_session)
        result = service.update(product.id, product_update)

        assert result.name == "Updated Name"
        assert result.description == "Original Description"  # Unchanged
        assert result.cost_price == Decimal("10.00")  # Unchanged


class TestDelete:
    """Tests for deleting products."""

    def test_delete_existing_product(self, db_session):
        """Test deleting an existing product."""
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

        service = ProductService(db_session)
        result = service.delete(product.id)

        assert result is True

        db_session.refresh(product)
        assert product.is_active is False

        db_session.expire_all()
        deleted_product = service.get_by_id(product.id)
        assert deleted_product is not None
        assert deleted_product.is_active is False

    def test_delete_nonexistent_product(self, db_session):
        """Test deleting a product that doesn't exist."""
        service = ProductService(db_session)
        result = service.delete(99999)

        assert result is False


class TestGetLowStock:
    """Tests for getting low stock products."""

    def test_get_low_stock_products(self, db_session):
        """Test getting products with low stock."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        low_stock = Product(
            name="Low Stock",
            barcode="LOW123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=2,  # Below min_stock_level
            min_stock_level=5,
            is_active=True,
        )
        normal_stock = Product(
            name="Normal Stock",
            barcode="NORM123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,  # Above min_stock_level
            min_stock_level=5,
            is_active=True,
        )
        db_session.add_all([low_stock, normal_stock])
        db_session.commit()

        service = ProductService(db_session)
        result = service.get_low_stock()

        assert len(result) == 1
        assert result[0].name == "Low Stock"

    def test_get_low_stock_excludes_inactive(self, db_session):
        """Test that inactive products are excluded from low stock."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        inactive_low_stock = Product(
            name="Inactive Low Stock",
            barcode="INACT123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=1,
            min_stock_level=5,
            is_active=False,  # Inactive
        )
        db_session.add(inactive_low_stock)
        db_session.commit()

        service = ProductService(db_session)
        result = service.get_low_stock()

        assert len(result) == 0


class TestSearch:
    """Tests for searching products."""

    def test_search_by_name(self, db_session):
        """Test searching products by name."""
        category = Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        product1 = Product(
            name="Apple iPhone 15",
            barcode="APP123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        product2 = Product(
            name="Apple iPhone 14",
            barcode="APP124",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        product3 = Product(
            name="Samsung Galaxy",
            barcode="SAM123",
            category_id=category.id,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add_all([product1, product2, product3])
        db_session.commit()

        service = ProductService(db_session)
        results = service.search("Apple")

        assert len(results) == 2

    def test_search_by_barcode(self, db_session):
        """Test searching products by barcode."""
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

        service = ProductService(db_session)
        results = service.search("SEARCH123")

        assert len(results) == 1
        assert results[0].barcode == "SEARCH123"

    def test_search_with_limit(self, db_session):
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

        service = ProductService(db_session)
        results = service.search("Product", limit=5)

        assert len(results) == 5


class TestToResponse:
    """Tests for converting product to response schema."""

    def test_to_response_includes_profit_percent(self, db_session):
        """Test that response includes calculated profit percentage."""
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

        service = ProductService(db_session)
        # Use get_all which returns ProductResponse with profit_percent
        results, total = service.get_all()
        result = next(r for r in results if r.id == product.id)

        # Profit should be 50% ((15-10)/10 * 100)
        assert result.profit_percent == Decimal("50.00")

    def test_to_response_includes_category(self, db_session):
        """Test that response includes category information."""
        category = Category(name="Electronics")
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

        service = ProductService(db_session)
        # Use get_all which returns ProductResponse with category dict
        results, total = service.get_all()
        result = next(r for r in results if r.id == product.id)

        assert result.category is not None
        assert result.category["name"] == "Electronics"

    def test_to_response_with_null_category(self, db_session):
        """Test response when product has no category."""
        product = Product(
            name="Test Product",
            barcode="TEST123",
            category_id=None,
            cost_price=Decimal("10.00"),
            sell_price=Decimal("15.00"),
            stock_quantity=100,
            is_active=True,
        )
        db_session.add(product)
        db_session.commit()

        service = ProductService(db_session)
        result = service.get_by_id(product.id)

        assert result.category is None
