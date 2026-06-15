"""
Pytest configuration and fixtures for Sellary backend tests.
"""
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# Add backend directory to Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from core.database import Base, get_db
from core.security import create_access_token, create_owner_access_token, get_password_hash
from main import app
from models.category import Category
from models.company import Company
from models.company_membership import CompanyMembership
from models.customer import Customer
from models.inventory_layer import InventoryLayer
from models.inventory_log import InventoryLog
from models.product import Product
from models.purchase_order import PurchaseOrder
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn
from models.supplier import Supplier
from models.user import User
from services.inventory_ledger_service import InventoryLedgerService


TEST_DATABASE_URL = "sqlite:///:memory:"

TENANT_MODELS = (
    Category,
    Customer,
    Product,
    Supplier,
    PurchaseOrder,
    Sale,
    SaleReturn,
    InventoryLog,
)


@pytest.fixture(scope="session")
def engine():
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
    connection = engine.connect()
    transaction = connection.begin()
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=connection)
    session = TestingSessionLocal()
    session.bind = connection

    company = Company(name="Test Company", slug="test-company", is_active=True)
    session.add(company)
    session.flush()
    session.info["default_company_id"] = company.id

    def apply_default_company(session_: Session, flush_context, instances) -> None:
        company_id = session_.info.get("default_company_id")
        if company_id is None:
          return
        for instance in session_.new:
            if isinstance(instance, TENANT_MODELS) and getattr(instance, "company_id", None) is None:
                instance.company_id = company_id

    event.listen(session, "before_flush", apply_default_company)

    try:
        yield session
    finally:
        event.remove(session, "before_flush", apply_default_company)
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture(scope="function")
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def test_password() -> str:
    return "testpassword123"


@pytest.fixture
def default_company(db_session: Session) -> Company:
    company_id = db_session.info["default_company_id"]
    return db_session.get(Company, company_id)


@pytest.fixture
def secondary_company(db_session: Session) -> Company:
    company = Company(name="Second Company", slug="second-company", is_active=True)
    db_session.add(company)
    db_session.flush()
    return company


def _create_user_with_membership(
    db_session: Session,
    *,
    username: str,
    email: str,
    password: str,
    role: str,
    company: Company,
    is_active: bool = True,
) -> User:
    user = User(
        username=username,
        email=email,
        full_name=f"Test {role.title()}",
        hashed_password=get_password_hash(password),
        global_role="standard",
        role=role,
        is_active=is_active,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        CompanyMembership(
            user_id=user.id,
            company_id=company.id,
            role=role,
            is_default=True,
            is_active=is_active,
        )
    )
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def admin_user(db_session: Session, default_company: Company, test_password: str) -> User:
    return _create_user_with_membership(
        db_session,
        username="admin",
        email="admin@test.com",
        password=test_password,
        role="admin",
        company=default_company,
    )


@pytest.fixture
def manager_user(db_session: Session, default_company: Company, test_password: str) -> User:
    return _create_user_with_membership(
        db_session,
        username="manager",
        email="manager@test.com",
        password=test_password,
        role="manager",
        company=default_company,
    )


@pytest.fixture
def cashier_user(db_session: Session, default_company: Company, test_password: str) -> User:
    return _create_user_with_membership(
        db_session,
        username="cashier",
        email="cashier@test.com",
        password=test_password,
        role="cashier",
        company=default_company,
    )


@pytest.fixture
def inactive_user(db_session: Session, default_company: Company, test_password: str) -> User:
    return _create_user_with_membership(
        db_session,
        username="inactive",
        email="inactive@test.com",
        password=test_password,
        role="cashier",
        company=default_company,
        is_active=False,
    )


@pytest.fixture
def super_admin_user(db_session: Session, test_password: str) -> User:
    user = User(
        username="owner",
        email="owner@test.com",
        full_name="Owner",
        hashed_password=get_password_hash(test_password),
        global_role="super_admin",
        role="admin",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _create_company_scoped_token(user: User, company_id: int, role: str) -> str:
    access_token_expires = timedelta(minutes=30)
    return create_access_token(
        data={
            "sub": user.username,
            "user_id": user.id,
            "company_id": company_id,
            "role": role,
            "global_role": user.global_role,
        },
        expires_delta=access_token_expires,
    )


def _create_owner_token(user: User) -> str:
    return create_owner_access_token(
        data={
            "sub": user.username,
            "user_id": user.id,
            "global_role": user.global_role,
        }
    )


@pytest.fixture
def admin_token(admin_user: User, default_company: Company) -> str:
    return _create_company_scoped_token(admin_user, default_company.id, "admin")


@pytest.fixture
def manager_token(manager_user: User, default_company: Company) -> str:
    return _create_company_scoped_token(manager_user, default_company.id, "manager")


@pytest.fixture
def cashier_token(cashier_user: User, default_company: Company) -> str:
    return _create_company_scoped_token(cashier_user, default_company.id, "cashier")


@pytest.fixture
def admin_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def manager_headers(manager_token: str) -> dict:
    return {"Authorization": f"Bearer {manager_token}"}


@pytest.fixture
def cashier_headers(cashier_token: str) -> dict:
    return {"Authorization": f"Bearer {cashier_token}"}


@pytest.fixture
def owner_token(super_admin_user: User) -> str:
    return _create_owner_token(super_admin_user)


@pytest.fixture
def owner_headers(owner_token: str) -> dict:
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture
def test_category(db_session: Session, default_company: Company) -> Category:
    import uuid

    category = Category(
        company_id=default_company.id,
        name=f"Test Category {uuid.uuid4().hex[:8]}",
        description="A test category",
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category


def _back_product_with_opening_layer(db_session: Session, product: Product) -> Product:
    """Make a directly-created fixture product ledger-consistent.

    Inserts a single ``opening_balance`` FIFO layer covering the product's
    requested ``stock_quantity`` and sets ``inventory_value = stock * cost`` so
    the product satisfies the ledger invariant (stock is backed by layers and
    inventory_value matches). Used by fixtures that build products by hand
    instead of going through ``ProductService.create``.
    """
    quantity = Decimal(product.stock_quantity or 0)
    unit_cost = Decimal(product.cost_price or 0)
    product.inventory_value = (quantity * unit_cost).quantize(Decimal("0.0001"))
    if quantity > 0:
        layer = InventoryLayer(
            company_id=product.company_id,
            product_id=product.id,
            source_type="opening_balance",
            source_id=None,
            original_quantity=quantity,
            remaining_quantity=quantity,
            unit_cost=unit_cost,
        )
        db_session.add(layer)
        db_session.flush()
    return product


@pytest.fixture
def test_product(db_session: Session, default_company: Company, test_category: Category) -> Product:
    import uuid

    product = Product(
        company_id=default_company.id,
        name="Test Product",
        barcode=f"TEST{uuid.uuid4().hex[:8]}",
        description="A test product",
        category_id=test_category.id,
        cost_price=Decimal("10.00"),
        sell_price=Decimal("15.00"),
        tax_percent=Decimal("10.00"),
        stock_quantity=100,
        min_stock_level=5,
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()
    _back_product_with_opening_layer(db_session, product)
    db_session.refresh(product)
    return product


@pytest.fixture
def test_products_bulk(db_session: Session, default_company: Company, test_category: Category) -> list[Product]:
    products = []
    for i in range(5):
        product = Product(
            company_id=default_company.id,
            name=f"Test Product {i}",
            barcode=f"BAR{i:06d}",
            description=f"Test product number {i}",
            category_id=test_category.id,
            cost_price=Decimal(f"{10 + i}.00"),
            sell_price=Decimal(f"{15 + i}.00"),
            tax_percent=Decimal("10.00"),
            stock_quantity=100 - i * 10,
            min_stock_level=5,
            is_active=True,
        )
        db_session.add(product)
        products.append(product)

    db_session.flush()
    for product in products:
        _back_product_with_opening_layer(db_session, product)
        db_session.refresh(product)
    return products


@pytest.fixture
def layered_product(
    db_session: Session,
    default_company: Company,
    test_category: Category,
    admin_user: User,
) -> Product:
    """A product whose 5 units span two FIFO layers (2 @ 10, then 3 @ 20).

    Built through the ledger so layers, allocations, balance and logs stay
    consistent for FIFO consumption tests.
    """
    import uuid

    product = Product(
        company_id=default_company.id,
        name="Layered Product",
        barcode=f"LAYER{uuid.uuid4().hex[:8]}",
        description="A layered test product",
        category_id=test_category.id,
        cost_price=Decimal("0.00"),
        sell_price=Decimal("30.00"),
        tax_percent=Decimal("0.00"),
        stock_quantity=Decimal("0"),
        inventory_value=Decimal("0.0000"),
        min_stock_level=5,
        is_active=True,
    )
    db_session.add(product)
    db_session.flush()

    ledger = InventoryLedgerService(db_session, product.company_id)
    ledger.add_layer(product, Decimal("2"), Decimal("10"), "opening_balance", None, admin_user.id)
    ledger.add_layer(product, Decimal("3"), Decimal("20"), "purchase_receipt", None, admin_user.id)
    db_session.flush()
    db_session.refresh(product)
    return product


@pytest.fixture
def test_customer(db_session: Session, default_company: Company) -> Customer:
    import uuid

    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        company_id=default_company.id,
        name="Test Customer",
        email=f"customer{uid}@test.com",
        phone=f"+992123{uid}",
        address="Test Address 123",
    )
    db_session.add(customer)
    db_session.commit()
    db_session.refresh(customer)
    return customer


@pytest.fixture
def test_sale(
    db_session: Session,
    default_company: Company,
    test_customer: Customer,
    cashier_user: User,
    test_product: Product,
) -> Sale:
    sale = Sale(
        company_id=default_company.id,
        customer_id=test_customer.id,
        cashier_id=cashier_user.id,
        subtotal=Decimal("30.00"),
        tax_amount=Decimal("3.00"),
        discount_amount=Decimal("0.00"),
        total_amount=Decimal("33.00"),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=datetime.now(),
    )
    db_session.add(sale)
    db_session.flush()

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
        unit_cost_at_sale=test_product.cost_price,
        cost_total_at_sale=(Decimal("2") * test_product.cost_price).quantize(Decimal("0.01")),
        created_at=datetime.now(),
    )
    db_session.add(sale_item)
    db_session.flush()

    # Consume the sold units through the FIFO ledger so layers/allocations and
    # the product balance stay consistent with the new invariants.
    ledger = InventoryLedgerService(db_session, test_product.company_id)
    ledger.consume_fifo(
        product=test_product,
        quantity=Decimal("2"),
        consumer_type="sale_item",
        consumer_id=sale_item.id,
        sale_item_id=sale_item.id,
        user_id=cashier_user.id,
        reason=f"Sale #{sale.id}",
        reference_type="sale",
        reference_id=sale.id,
    )

    db_session.flush()
    db_session.refresh(sale)
    return sale


def create_auth_headers(username: str, user_id: int, company_id: int, role: str) -> dict:
    token = create_access_token(
        data={
            "sub": username,
            "user_id": user_id,
            "company_id": company_id,
            "role": role,
            "global_role": "standard",
        },
        expires_delta=timedelta(minutes=30),
    )
    return {"Authorization": f"Bearer {token}"}
