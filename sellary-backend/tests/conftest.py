"""
Pytest configuration and fixtures for Sellary backend tests.
"""
import os
import sys
from pathlib import Path
from typing import Generator, AsyncGenerator
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

# Add backend directory to Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from core.database import Base, get_db
from core.security import create_access_token, get_password_hash
from core.config import settings
from main import app
from models.user import User
from models.product import Product, ProductType
from models.category import Category
from models.customer import Customer
from models.sale import Sale, SaleStatus, PaymentMethod, SaleContextType
from models.sale_item import SaleItem


# ============================================================================
# Database Fixtures
# ============================================================================

# Use in-memory SQLite for fast tests
TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="session")
def engine():
    """Create test database engine."""
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def db_session(engine) -> Generator[Session, None, None]:
    """
    Create a new database session for each test.
    All changes are rolled back after each test.
    """
    connection = engine.connect()
    transaction = connection.begin()
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=connection)
    session = TestingSessionLocal()

    # Bind the session to the connection
    session.bind = connection

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture(scope="function")
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """Create a test client with database dependency override."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


# ============================================================================
# Authentication Fixtures
# ============================================================================

@pytest.fixture
def test_password() -> str:
    """Standard test password."""
    return "testpassword123"


@pytest.fixture
def admin_user(db_session: Session, test_password: str) -> User:
    """Create an admin user for testing."""
    admin = User(
        username="admin",
        email="admin@test.com",
        full_name="Test Admin",
        hashed_password=get_password_hash(test_password),
        role="admin",
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def manager_user(db_session: Session, test_password: str) -> User:
    """Create a manager user for testing."""
    manager = User(
        username="manager",
        email="manager@test.com",
        full_name="Test Manager",
        hashed_password=get_password_hash(test_password),
        role="manager",
        is_active=True,
    )
    db_session.add(manager)
    db_session.commit()
    db_session.refresh(manager)
    return manager


@pytest.fixture
def cashier_user(db_session: Session, test_password: str) -> User:
    """Create a cashier user for testing."""
    cashier = User(
        username="cashier",
        email="cashier@test.com",
        full_name="Test Cashier",
        hashed_password=get_password_hash(test_password),
        role="cashier",
        is_active=True,
    )
    db_session.add(cashier)
    db_session.commit()
    db_session.refresh(cashier)
    return cashier


@pytest.fixture
def inactive_user(db_session: Session, test_password: str) -> User:
    """Create an inactive user for testing."""
    inactive = User(
        username="inactive",
        email="inactive@test.com",
        full_name="Inactive User",
        hashed_password=get_password_hash(test_password),
        role="cashier",
        is_active=False,
    )
    db_session.add(inactive)
    db_session.commit()
    db_session.refresh(inactive)
    return inactive


@pytest.fixture
def admin_token(admin_user: User) -> str:
    """Create JWT token for admin user."""
    access_token_expires = timedelta(minutes=30)
    token = create_access_token(
        data={"sub": admin_user.username, "user_id": admin_user.id, "role": admin_user.role},
        expires_delta=access_token_expires,
    )
    return token


@pytest.fixture
def manager_token(manager_user: User) -> str:
    """Create JWT token for manager user."""
    access_token_expires = timedelta(minutes=30)
    token = create_access_token(
        data={"sub": manager_user.username, "user_id": manager_user.id, "role": manager_user.role},
        expires_delta=access_token_expires,
    )
    return token


@pytest.fixture
def cashier_token(cashier_user: User) -> str:
    """Create JWT token for cashier user."""
    access_token_expires = timedelta(minutes=30)
    token = create_access_token(
        data={"sub": cashier_user.username, "user_id": cashier_user.id, "role": cashier_user.role},
        expires_delta=access_token_expires,
    )
    return token


@pytest.fixture
def admin_headers(admin_token: str) -> dict:
    """Create headers with admin authorization token."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def manager_headers(manager_token: str) -> dict:
    """Create headers with manager authorization token."""
    return {"Authorization": f"Bearer {manager_token}"}


@pytest.fixture
def cashier_headers(cashier_token: str) -> dict:
    """Create headers with cashier authorization token."""
    return {"Authorization": f"Bearer {cashier_token}"}


# ============================================================================
# Model Entity Fixtures
# ============================================================================

@pytest.fixture
def test_category(db_session: Session) -> Category:
    """Create a test category."""
    import uuid
    category = Category(
        name=f"Test Category {uuid.uuid4().hex[:8]}",
        description="A test category",
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category


@pytest.fixture
def test_product(db_session: Session, test_category: Category) -> Product:
    """Create a test product."""
    from models.product import ProductType
    import uuid
    product = Product(
        name=f"Test Product {uuid.uuid4().hex[:8]}",
        barcode=f"TEST{uuid.uuid4().hex[:8]}",
        description="A test product",
        category_id=test_category.id,
        cost_price=10.00,
        sell_price=15.00,
        tax_percent=10.00,
        stock_quantity=100,
        min_stock_level=5,
        is_active=True,
        product_type=ProductType.ITEM,
    )
    db_session.add(product)
    db_session.flush()
    db_session.refresh(product)
    return product


@pytest.fixture
def test_products_bulk(db_session: Session, test_category: Category) -> list[Product]:
    """Create multiple test products."""
    from models.product import ProductType
    products = []
    for i in range(5):
        product = Product(
            name=f"Test Product {i}",
            barcode=f"BAR{i:06d}",
            description=f"Test product number {i}",
            category_id=test_category.id,
            cost_price=10.00 + i,
            sell_price=15.00 + i,
            tax_percent=10.00,
            stock_quantity=100 - i * 10,
            min_stock_level=5,
            is_active=True,
            product_type=ProductType.ITEM,
        )
        db_session.add(product)
        products.append(product)

    db_session.flush()
    for product in products:
        db_session.refresh(product)
    return products


@pytest.fixture
def test_customer(db_session: Session) -> Customer:
    """Create a test customer."""
    import uuid
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        name=f"Test Customer {uid}",
        email=f"customer{uid}@test.com",
        phone=f"+992 123 {uid}",
        address="Test Address 123",
    )
    db_session.add(customer)
    db_session.commit()
    db_session.refresh(customer)
    return customer


@pytest.fixture
def test_sale(
    db_session: Session,
    test_customer: Customer,
    cashier_user: User,
    test_product: Product
) -> Sale:
    """Create a test sale with items."""
    # Create sale with explicit created_at to avoid SQLite storing "now()" string
    sale = Sale(
        customer_id=test_customer.id,
        cashier_id=cashier_user.id,
        context_type=SaleContextType.RETAIL,
        subtotal=Decimal("30.00"),
        tax_amount=Decimal("3.00"),
        discount_amount=Decimal("0.00"),
        total_amount=Decimal("33.00"),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=datetime.now(),
    )
    db_session.add(sale)
    db_session.flush()  # Get the sale ID

    # Create sale item
    sale_item = SaleItem(
        sale_id=sale.id,
        product_id=test_product.id,
        quantity=2,
        unit_price=Decimal("15.00"),
        tax_percent=Decimal("10.00"),
        tax_amount=Decimal("3.00"),
        discount_amount=Decimal("0.00"),
        subtotal=Decimal("30.00"),
        total=Decimal("33.00"),
        created_at=datetime.now(),
    )
    db_session.add(sale_item)

    # Update product stock
    test_product.stock_quantity -= 2

    db_session.flush()
    db_session.refresh(sale)
    return sale


# ============================================================================
# Helper Functions
# ============================================================================

def create_auth_headers(username: str, user_id: int, role: str) -> dict:
    """Helper to create authorization headers."""
    access_token_expires = timedelta(minutes=30)
    token = create_access_token(
        data={"sub": username, "user_id": user_id, "role": role},
        expires_delta=access_token_expires,
    )
    return {"Authorization": f"Bearer {token}"}
