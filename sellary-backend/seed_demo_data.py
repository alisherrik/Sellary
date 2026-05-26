"""
Seed deterministic multi-company demo data for local development.

The script scopes all demo data to a single company and safely re-seeds that
company by clearing only its tenant-owned records first.
"""
import argparse
from datetime import datetime, timedelta
from decimal import Decimal

from bootstrap_utils import ensure_company, ensure_membership, ensure_schema, ensure_user
from core.database import SessionLocal
from models.category import Category
from models.customer import Customer
from models.idempotency_key import IdempotencyKey
from models.inventory_log import InventoryLog
from models.product import Product
from models.purchase_order import PurchaseOrder
from models.purchase_order_item import PurchaseOrderItem
from models.sale import PaymentMethod, Sale, SaleStatus
from models.sale_item import SaleItem
from models.sale_return import SaleReturn, SaleReturnItem
from models.supplier import Supplier


DEFAULT_COMPANY_NAME = "Sellary Demo"
DEFAULT_COMPANY_SLUG = "sellary-demo"

CATEGORY_PRODUCT_MAP: dict[str, list[tuple[str, Decimal, Decimal, int]]] = {
    "Beverages": [
        ("Water 1.5L", Decimal("3.00"), Decimal("5.00"), 120),
        ("Cola 0.5L", Decimal("4.00"), Decimal("7.00"), 90),
        ("Lemon Tea", Decimal("5.00"), Decimal("8.00"), 70),
    ],
    "Snacks": [
        ("Potato Chips", Decimal("6.00"), Decimal("10.00"), 60),
        ("Chocolate Bar", Decimal("3.50"), Decimal("6.00"), 100),
        ("Salted Nuts", Decimal("8.00"), Decimal("12.00"), 40),
    ],
    "Bakery": [
        ("Bread", Decimal("2.00"), Decimal("4.00"), 80),
        ("Croissant", Decimal("3.00"), Decimal("6.00"), 35),
        ("Cheese Pie", Decimal("7.00"), Decimal("12.00"), 24),
    ],
}

CUSTOMER_SEED = [
    ("John Doe", "+992900000001", "john@example.com"),
    ("Jane Smith", "+992900000002", "jane@example.com"),
    ("Acme Office", "+992900000003", "office@acme.test"),
    ("Walk-in VIP", "+992900000004", "vip@example.com"),
]

SUPPLIER_SEED = [
    ("Fresh Foods LLC", "Rahim Supplier", "+992555100001", "sales@freshfoods.test"),
    ("City Drinks", "Nodira Vendor", "+992555100002", "hello@citydrinks.test"),
    ("Bakehouse Co", "Aziz Baker", "+992555100003", "ops@bakehouse.test"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed deterministic Sellary demo data.")
    parser.add_argument("--company-name", default=DEFAULT_COMPANY_NAME, help="Target company name")
    parser.add_argument("--company-slug", default=DEFAULT_COMPANY_SLUG, help="Target company slug")
    parser.add_argument("--admin-password", default="admin123", help="Admin password if admin is created")
    parser.add_argument("--cashier-password", default="cashier123", help="Cashier password if cashier is created")
    return parser.parse_args()


def delete_company_data(db, company_id: int) -> None:
    sale_return_ids = [
        sale_return_id
        for sale_return_id, in db.query(SaleReturn.id).filter(SaleReturn.company_id == company_id).all()
    ]
    sale_ids = [sale_id for sale_id, in db.query(Sale.id).filter(Sale.company_id == company_id).all()]
    purchase_order_ids = [
        po_id
        for po_id, in db.query(PurchaseOrder.id).filter(PurchaseOrder.company_id == company_id).all()
    ]

    if sale_return_ids:
        db.query(SaleReturnItem).filter(SaleReturnItem.sale_return_id.in_(sale_return_ids)).delete(
            synchronize_session=False
        )
    if sale_ids:
        db.query(SaleItem).filter(SaleItem.sale_id.in_(sale_ids)).delete(synchronize_session=False)
    if purchase_order_ids:
        db.query(PurchaseOrderItem).filter(
            PurchaseOrderItem.purchase_order_id.in_(purchase_order_ids)
        ).delete(synchronize_session=False)

    db.query(InventoryLog).filter(InventoryLog.company_id == company_id).delete(synchronize_session=False)
    db.query(SaleReturn).filter(SaleReturn.company_id == company_id).delete(synchronize_session=False)
    db.query(Sale).filter(Sale.company_id == company_id).delete(synchronize_session=False)
    db.query(PurchaseOrder).filter(PurchaseOrder.company_id == company_id).delete(synchronize_session=False)
    db.query(IdempotencyKey).filter(IdempotencyKey.company_id == company_id).delete(synchronize_session=False)
    db.query(Product).filter(Product.company_id == company_id).delete(synchronize_session=False)
    db.query(Category).filter(Category.company_id == company_id).delete(synchronize_session=False)
    db.query(Customer).filter(Customer.company_id == company_id).delete(synchronize_session=False)
    db.query(Supplier).filter(Supplier.company_id == company_id).delete(synchronize_session=False)
    db.flush()


def seed_demo_data() -> None:
    args = parse_args()
    ensure_schema()

    db = SessionLocal()
    try:
        company, company_created = ensure_company(
            db,
            name=args.company_name,
            slug=args.company_slug,
        )

        admin, admin_created = ensure_user(
            db,
            username="admin",
            email="admin@example.com",
            password=args.admin_password,
            full_name="System Administrator",
            role="admin",
        )
        ensure_membership(db, user=admin, company=company, role="admin", is_default=True)

        cashier, cashier_created = ensure_user(
            db,
            username="cashier",
            email="cashier@example.com",
            password=args.cashier_password,
            full_name="Front Cashier",
            role="cashier",
        )
        ensure_membership(db, user=cashier, company=company, role="cashier", is_default=True)

        delete_company_data(db, company.id)

        categories: dict[str, Category] = {}
        barcode_counter = 1
        products: list[Product] = []

        for category_name, product_rows in CATEGORY_PRODUCT_MAP.items():
            category = Category(
                company_id=company.id,
                name=category_name,
                description=f"Demo {category_name.lower()} catalog",
            )
            db.add(category)
            db.flush()
            categories[category_name] = category

            for product_name, cost_price, sell_price, stock_quantity in product_rows:
                product = Product(
                    company_id=company.id,
                    name=product_name,
                    barcode=f"DEMO-{barcode_counter:05d}",
                    description=f"Demo product for {category_name}",
                    category_id=category.id,
                    cost_price=cost_price,
                    sell_price=sell_price,
                    tax_percent=Decimal("10.00"),
                    stock_quantity=stock_quantity,
                    min_stock_level=max(5, stock_quantity // 8),
                    is_active=True,
                )
                barcode_counter += 1
                db.add(product)
                db.flush()
                products.append(product)

                db.add(
                    InventoryLog(
                        company_id=company.id,
                        product_id=product.id,
                        user_id=admin.id,
                        quantity_change=stock_quantity,
                        previous_quantity=0,
                        new_quantity=stock_quantity,
                        reason="Demo opening stock",
                        reference_type="seed",
                    )
                )

        customers: list[Customer] = []
        for name, phone, email in CUSTOMER_SEED:
            customer = Customer(
                company_id=company.id,
                name=name,
                phone=phone,
                email=email,
                address="Demo customer address",
                is_active=True,
            )
            db.add(customer)
            db.flush()
            customers.append(customer)

        for supplier_name, contact_person, phone, email in SUPPLIER_SEED:
            db.add(
                Supplier(
                    company_id=company.id,
                    name=supplier_name,
                    contact_person=contact_person,
                    phone=phone,
                    email=email,
                    address="Demo supplier address",
                    is_active=True,
                )
            )

        sale_blueprints = [
            {
                "customer": customers[0],
                "cashier": cashier,
                "payment_method": PaymentMethod.CASH,
                "items": [(products[0], 2), (products[3], 1)],
                "discount": Decimal("0.00"),
                "created_at": datetime.now() - timedelta(days=2, hours=1),
            },
            {
                "customer": customers[1],
                "cashier": cashier,
                "payment_method": PaymentMethod.CARD,
                "items": [(products[1], 1), (products[4], 3)],
                "discount": Decimal("2.00"),
                "created_at": datetime.now() - timedelta(days=1, hours=2),
            },
        ]

        seeded_sales: list[Sale] = []
        for blueprint in sale_blueprints:
            subtotal = Decimal("0.00")
            tax_amount = Decimal("0.00")
            sale = Sale(
                company_id=company.id,
                customer_id=blueprint["customer"].id if blueprint["customer"] else None,
                cashier_id=blueprint["cashier"].id,
                subtotal=Decimal("0.00"),
                tax_amount=Decimal("0.00"),
                discount_amount=blueprint["discount"],
                total_amount=Decimal("0.00"),
                payment_method=blueprint["payment_method"],
                status=SaleStatus.COMPLETED,
                notes="Demo seeded sale",
                created_at=blueprint["created_at"],
            )
            db.add(sale)
            db.flush()

            for product, quantity in blueprint["items"]:
                line_subtotal = (product.sell_price * quantity).quantize(Decimal("0.01"))
                line_tax = (line_subtotal * Decimal("0.10")).quantize(Decimal("0.01"))
                line_total = line_subtotal + line_tax
                sale_item = SaleItem(
                    sale_id=sale.id,
                    product_id=product.id,
                    quantity=quantity,
                    quantity_returned=0,
                    unit_price=product.sell_price,
                    tax_percent=Decimal("10.00"),
                    tax_amount=line_tax,
                    discount_amount=Decimal("0.00"),
                    subtotal=line_subtotal,
                    total=line_total,
                    created_at=blueprint["created_at"],
                )
                db.add(sale_item)

                previous_quantity = product.stock_quantity
                product.stock_quantity = previous_quantity - quantity

                db.add(
                    InventoryLog(
                        company_id=company.id,
                        product_id=product.id,
                        user_id=blueprint["cashier"].id,
                        quantity_change=-quantity,
                        previous_quantity=previous_quantity,
                        new_quantity=product.stock_quantity,
                        reason=f"Demo sale #{sale.id}",
                        reference_type="sale",
                        reference_id=sale.id,
                        created_at=blueprint["created_at"],
                    )
                )

                subtotal += line_subtotal
                tax_amount += line_tax

            sale.subtotal = subtotal
            sale.tax_amount = tax_amount
            sale.total_amount = subtotal + tax_amount - blueprint["discount"]
            seeded_sales.append(sale)

        # Add one partial return so refund/report flows have realistic demo data.
        return_sale = seeded_sales[0]
        return_item = return_sale.items[0]
        return_quantity = 1
        refund_unit = (return_item.total / return_item.quantity).quantize(Decimal("0.01"))
        refund_amount = (refund_unit * return_quantity).quantize(Decimal("0.01"))

        return_item.quantity_returned += return_quantity
        returned_product = next(product for product in products if product.id == return_item.product_id)
        previous_quantity = returned_product.stock_quantity
        returned_product.stock_quantity = previous_quantity + return_quantity

        sale_return = SaleReturn(
            company_id=company.id,
            sale_id=return_sale.id,
            user_id=cashier.id,
            total_refund_amount=refund_amount,
            refund_method=PaymentMethod.CASH,
            notes="Demo partial return",
            created_at=datetime.now() - timedelta(hours=2),
        )
        db.add(sale_return)
        db.flush()

        db.add(
            SaleReturnItem(
                sale_return_id=sale_return.id,
                sale_item_id=return_item.id,
                quantity_returned=return_quantity,
                refund_amount=refund_amount,
            )
        )
        db.add(
            InventoryLog(
                company_id=company.id,
                product_id=returned_product.id,
                user_id=cashier.id,
                quantity_change=return_quantity,
                previous_quantity=previous_quantity,
                new_quantity=returned_product.stock_quantity,
                reason=f"Demo return #{sale_return.id}",
                reference_type="sale_return",
                reference_id=sale_return.id,
                created_at=sale_return.created_at,
            )
        )
        return_sale.status = SaleStatus.PARTIALLY_RETURNED

        db.commit()

        print("Demo data seed complete.")
        print(f"Company: {company.name} ({company.slug}) [{'created' if company_created else 'existing'}]")
        print(f"Admin: {admin.username} [{'created' if admin_created else 'existing'}]")
        print(f"Cashier: {cashier.username} [{'created' if cashier_created else 'existing'}]")
        print(f"Categories: {len(categories)}")
        print(f"Products: {len(products)}")
        print(f"Customers: {len(customers)}")
        print(f"Sales: {len(seeded_sales)}")
        print("Returns: 1")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo_data()
