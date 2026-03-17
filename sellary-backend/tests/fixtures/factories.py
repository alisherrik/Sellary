"""
Test data factories for Sellary backend tests.
"""
import factory
from decimal import Decimal
from datetime import datetime

from models.user import User
from models.product import Product, ProductType
from models.category import Category
from models.customer import Customer
from models.sale import Sale, SaleStatus, PaymentMethod, SaleContextType
from models.sale_item import SaleItem


class UserFactory(factory.alchemy.SQLAlchemyModelFactory):
    """Factory for creating User instances."""

    class Meta:
        model = User
        sqlalchemy_session_persistence = "commit"

    username = factory.Sequence(lambda n: f"user_{n}")
    email = factory.Sequence(lambda n: f"user{n}@test.com")
    full_name = factory.Faker("name")
    hashed_password = factory.LazyAttribute(
        lambda obj: f"hashed_{obj.username}"  # Mock hashed password
    )
    role = "cashier"
    is_active = True


class AdminUserFactory(UserFactory):
    """Factory for creating admin users."""

    role = "admin"
    username = factory.Sequence(lambda n: f"admin_{n}")
    email = factory.Sequence(lambda n: f"admin{n}@test.com")


class ManagerUserFactory(UserFactory):
    """Factory for creating manager users."""

    role = "manager"
    username = factory.Sequence(lambda n: f"manager_{n}")
    email = factory.Sequence(lambda n: f"manager{n}@test.com")


class CategoryFactory(factory.alchemy.SQLAlchemyModelFactory):
    """Factory for creating Category instances."""

    class Meta:
        model = Category
        sqlalchemy_session_persistence = "commit"

    name = factory.Sequence(lambda n: f"Category {n}")
    description = factory.Faker("text", max_nb_chars=200)


class ProductFactory(factory.alchemy.SQLAlchemyModelFactory):
    """Factory for creating Product instances."""

    class Meta:
        model = Product
        sqlalchemy_session_persistence = "commit"

    name = factory.Sequence(lambda n: f"Product {n}")
    barcode = factory.Sequence(lambda n: f"BAR{n:06d}")
    description = factory.Faker("text", max_nb_chars=500)
    category = factory.SubFactory(CategoryFactory)
    cost_price = Decimal("10.00")
    sell_price = Decimal("15.00")
    tax_percent = Decimal("10.00")
    stock_quantity = 100
    min_stock_level = 5
    is_active = True
    product_type = ProductType.ITEM


class ProductDishFactory(ProductFactory):
    """Factory for creating dish products."""

    product_type = ProductType.DISH
    name = factory.Sequence(lambda n: f"Dish {n}")


class CustomerFactory(factory.alchemy.SQLAlchemyModelFactory):
    """Factory for creating Customer instances."""

    class Meta:
        model = Customer
        sqlalchemy_session_persistence = "commit"

    name = factory.Faker("name")
    email = factory.Faker("email")
    phone = factory.Faker("phone_number")
    address = factory.Faker("address")


class SaleFactory(factory.alchemy.SQLAlchemyModelFactory):
    """Factory for creating Sale instances."""

    class Meta:
        model = Sale
        sqlalchemy_session_persistence = "commit"

    customer = factory.SubFactory(CustomerFactory)
    cashier = factory.SubFactory(UserFactory)
    context_type = SaleContextType.RETAIL
    subtotal = Decimal("100.00")
    tax_amount = Decimal("10.00")
    discount_amount = Decimal("0.00")
    total_amount = Decimal("110.00")
    payment_method = PaymentMethod.CASH
    status = SaleStatus.COMPLETED
    notes = factory.Faker("text", max_nb_chars=500)


class SaleItemFactory(factory.alchemy.SQLAlchemyModelFactory):
    """Factory for creating SaleItem instances."""

    class Meta:
        model = SaleItem
        sqlalchemy_session_persistence = "commit"

    sale = factory.SubFactory(SaleFactory)
    product = factory.SubFactory(ProductFactory)
    quantity = 1
    unit_price = Decimal("15.00")
    tax_percent = Decimal("10.00")
    tax_amount = Decimal("1.50")
    discount_amount = Decimal("0.00")
    subtotal = Decimal("15.00")
    total = Decimal("16.50")


# ============================================================================
# Helper Functions
# ============================================================================

def create_test_product_with_stock(
    db_session,
    name: str = "Test Product",
    barcode: str = "TEST001",
    stock: int = 100,
    price: Decimal = Decimal("15.00"),
    category: Category = None,
) -> Product:
    """
    Helper function to create a product with specific stock level.
    """
    if category is None:
        category = CategoryFactory(name="Default Category")

    product = ProductFactory(
        name=name,
        barcode=barcode,
        stock_quantity=stock,
        sell_price=price,
        category=category,
    )
    return product


def create_test_sale_with_items(
    db_session,
    cashier: User,
    items: list[dict],
    customer: Customer = None,
) -> Sale:
    """
    Helper function to create a sale with specific items.

    Args:
        db_session: Database session
        cashier: User who made the sale
        items: List of dicts with product_id, quantity, unit_price, etc.
        customer: Optional customer

    Returns:
        Created Sale instance
    """
    from decimal import Decimal
    from repositories.product_repository import ProductRepository
    from repositories.sale_repository import SaleRepository

    product_repo = ProductRepository(db_session)
    sale_repo = SaleRepository(db_session)

    # Get products and lock them
    product_ids = [item["product_id"] for item in items]
    locked_products = product_repo.get_multiple_for_update(product_ids)
    product_map = {p.id: p for p in locked_products}

    # Calculate totals
    subtotal = Decimal("0.00")
    tax_amount = Decimal("0.00")
    sale_items = []
    stock_changes = []

    for item_data in items:
        product = product_map[item_data["product_id"]]
        quantity = item_data["quantity"]
        unit_price = Decimal(str(item_data["unit_price"]))
        tax_percent = Decimal(str(item_data.get("tax_percent", 10)))
        discount_amount = Decimal(str(item_data.get("discount_amount", 0)))

        item_subtotal = unit_price * quantity
        item_tax = item_subtotal * tax_percent / 100
        item_total = item_subtotal + item_tax - discount_amount

        sale_item = SaleItem(
            product_id=product.id,
            quantity=quantity,
            unit_price=unit_price,
            tax_percent=tax_percent,
            tax_amount=item_tax,
            discount_amount=discount_amount,
            subtotal=item_subtotal,
            total=item_total,
            created_at=datetime.now(),
        )
        sale_items.append(sale_item)

        subtotal += item_subtotal
        tax_amount += item_tax

        # Update stock
        previous_quantity = product.stock_quantity
        new_quantity = previous_quantity - quantity
        product.stock_quantity = new_quantity

        stock_changes.append({
            "product_id": product.id,
            "quantity_change": -quantity,
            "previous_quantity": previous_quantity,
            "new_quantity": new_quantity,
        })

    total_amount = subtotal + tax_amount

    # Create sale
    sale = Sale(
        customer_id=customer.id if customer else None,
        cashier_id=cashier.id,
        subtotal=subtotal,
        tax_amount=tax_amount,
        discount_amount=Decimal("0.00"),
        total_amount=total_amount,
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=datetime.now(),
    )

    sale = sale_repo.create(sale, sale_items)
    db_session.commit()
    db_session.refresh(sale)

    return sale
