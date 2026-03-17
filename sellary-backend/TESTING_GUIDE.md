# Testing Guide for Sellary Backend

## Overview
Comprehensive unit and integration tests for the FastAPI backend using pytest.

## Test Statistics
- **Total Tests**: 180 tests
- **Unit Tests**: 91 tests (test_security.py, test_auth_service.py, test_product_service.py, test_sale_service.py)
- **Integration Tests**: 89 tests (test_auth_endpoints.py, test_product_endpoints.py, test_sales_endpoints.py, test_customers_endpoints.py)

## Test Structure
```
tests/
├── conftest.py                      # Pytest configuration & fixtures
├── pytest.ini                       # Pytest settings
├── unit/                            # Unit tests for services
│   ├── test_auth_service.py         # 24 tests
│   ├── test_product_service.py      # 31 tests
│   ├── test_sale_service.py         # 24 tests
│   └── test_security.py             # 22 tests
├── integration/                     # Integration tests for API endpoints
│   ├── test_auth_endpoints.py       # 20 tests
│   ├── test_product_endpoints.py    # 30 tests
│   ├── test_sales_endpoints.py      # 24 tests
│   └── test_customers_endpoints.py  # 15 tests
└── fixtures/
    └── factories.py                 # Test data factories
```

## Quick Start

### Install Dependencies
```bash
cd sellary-backend
.venv\Scripts\pip install pytest pytest-asyncio pytest-cov pytest-mock httpx factory-boy freezegun
```

### Run All Tests
```bash
.venv\Scripts\pytest.exe -v
```

### Run Unit Tests Only
```bash
.venv\Scripts\pytest.exe tests/unit/ -v
```

### Run Integration Tests Only
```bash
.venv\Scripts\pytest.exe tests/integration/ -v
```

### Run Specific Test File
```bash
.venv\Scripts\pytest.exe tests/unit/test_security.py -v
```

### Run Specific Test Class
```bash
.venv\Scripts\pytest.exe tests/unit/test_security.py::TestPasswordHashing -v
```

### Run Specific Test
```bash
.venv\Scripts\pytest.exe tests/unit/test_security.py::TestPasswordHashing::test_password_hashing_is_verifiable -v
```

### Run with Coverage Report
```bash
.venv\Scripts\pytest.exe --cov=. --cov-report=html
```
Then open `htmlcov/index.html` in your browser to view the coverage report.

### Run with Coverage (Terminal Output)
```bash
.venv\Scripts\pytest.exe --cov=. --cov-report=term-missing
```

## Test Coverage
Current coverage: **~30%** overall

### Service Layer Coverage
- `auth_service.py`: 39%
- `product_service.py`: 48%
- `sale_service.py`: 19%
- `calculation_service.py`: 61%
- `security.py`: 100%

### API Routes Coverage
- `auth.py`: 55%
- `products.py`: 45%
- `sales.py`: 27%
- `customers.py`: 48%

## Test Fixtures
The following fixtures are available in `tests/conftest.py`:

### Database Fixtures
- `engine` - Creates test database engine
- `db_session` - Creates isolated database session (rolled back after each test)
- `client` - FastAPI TestClient with database override

### Authentication Fixtures
- `test_password` - Standard test password
- `admin_user` - Admin user for testing
- `manager_user` - Manager user for testing
- `cashier_user` - Cashier user for testing
- `inactive_user` - Inactive user for testing
- `admin_token` - JWT token for admin user
- `manager_token` - JWT token for manager user
- `cashier_token` - JWT token for cashier user
- `admin_headers` - Headers with admin authorization
- `manager_headers` - Headers with manager authorization
- `cashier_headers` - Headers with cashier authorization

### Model Entity Fixtures
- `test_category` - Test category (with unique name)
- `test_product` - Test product
- `test_products_bulk` - Multiple test products
- `test_customer` - Test customer (with unique data)
- `test_sale` - Test sale with items

## Test Categories

### Authentication Tests
- Valid/invalid credentials
- Token generation and validation
- User registration
- Role-based access control
- Inactive user handling

### Sales Tests
- Sale creation with items
- Stock deduction logic
- Sale cancellation with stock restoration
- State transitions
- Transaction rollback on error
- Total calculations (subtotal, tax, discount)

### Product Tests
- CRUD operations
- Barcode lookup
- Search functionality
- Low stock detection
- Category filtering

### Customer Tests
- CRUD operations
- Search functionality
- Pagination
- Input validation

## Best Practices

### When Writing New Tests:
1. **Use fixtures** - Use existing fixtures for database, authentication, and test data
2. **Isolation** - Each test should be independent and not affect other tests
3. **Clear names** - Use descriptive test names that explain what is being tested
4. **One assertion** - Focus on testing one thing per test when possible
5. **Arrange-Act-Assert** - Structure tests clearly: setup, execute, verify

### Example Test Structure:
```python
def test_create_product_with_valid_data(self, db_session):
    """Test creating a product successfully."""
    # Arrange
    category = Category(name="Test Category")
    db_session.add(category)
    db_session.commit()

    product_create = ProductCreate(
        barcode="NEW123",
        name="New Product",
        category_id=category.id,
        cost_price=Decimal("10.00"),
        sell_price=Decimal("15.00"),
        stock_quantity=50,
    )

    # Act
    service = ProductService(db_session)
    result = service.create(product_create)

    # Assert
    assert result.id is not None
    assert result.barcode == "NEW123"
```

## Troubleshooting

### Tests Failing with "UNIQUE constraint failed"
This happens when test data fixtures are not properly isolated. The database session now uses transaction rollback, but if you're still seeing this issue:
1. Make sure each test uses unique data
2. Use `uuid.uuid4().hex[:8]` to generate unique identifiers
3. Don't commit changes that should be rolled back

### Import Errors
Make sure you're running tests from the `sellary-backend` directory and using the virtual environment:
```bash
cd sellary-backend
.venv\Scripts\pytest.exe tests/ -v
```

### Database Not Being Cleaned Up
The `db_session` fixture uses transaction rollback, but if you see leftover data:
1. Make sure you're not using `session.commit()` in tests (use `session.flush()` instead)
2. Check that the fixture is using the proper connection and transaction isolation

## CI/CD Integration
For CI/CD pipelines, run:
```bash
.venv\Scripts\pytest.exe --cov=. --cov-report=xml --cov-report=term --junitxml=test-results.xml
```

## Next Steps
1. Increase test coverage to 80%+ for services
2. Add tests for remaining modules (inventory, suppliers, purchase orders, reports)
3. Add performance/load tests
4. Add end-to-end tests with real PostgreSQL database
