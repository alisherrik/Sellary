import random
from decimal import Decimal
from datetime import datetime, timedelta
from faker import Faker
from sqlalchemy import text
from core.database import SessionLocal
from models.category import Category
from models.product import Product
from models.user import User
from models.customer import Customer
from models.supplier import Supplier
from models.sale import Sale, SaleStatus, PaymentMethod
from models.sale_item import SaleItem
from models.inventory_log import InventoryLog
from models.sale_return import SaleReturn
from models.sale_return import SaleReturnItem
from core.security import get_password_hash

# Initialize Faker with Russian locale
fake = Faker('ru_RU')

def cleanup_data(db):
    print("🧹 Cleaning up existing data...")
    try:
        # Disable foreign key checks temporarily if needed, or delete in correct order
        # For Postgres, TRUNCATE CASCADE is efficiently brute force
        tables = [
            "sale_return_items", "sale_returns", 
            "inventory_logs", "sale_items", "sales", 
            "products", "categories", "customers", "suppliers",
            "purchase_order_items", "purchase_orders",
            "idempotency_keys"
        ]
        
        for table in tables:
            try:
                db.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))
            except Exception as e:
                print(f"⚠️ Could not truncate {table} (might not exist): {e}")
                
        db.commit()
        print("✅ Data wiped successfully.")
    except Exception as e:
        print(f"❌ Error during cleanup: {e}")
        db.rollback()

def create_demo_data():
    db = SessionLocal()
    try:
        # 1. Cleanup
        cleanup_data(db)
        
        print("🌱 Starting Russian Food Market demo data generation...")

        # 2. Ensure Users (Admin & Cashier)
        # We don't truncate users to avoid locking ourselves out, but we ensure they exist.
        # If users table was truncated (not in list above), we recreate them.
        
        print("👤 Checking/Creating Users...")
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            admin = User(
                username="admin", 
                email="admin@example.com",
                full_name="Администратор",
                hashed_password=get_password_hash("admin123"), 
                role="admin"
            )
            db.add(admin)
        
        cashier = db.query(User).filter(User.username == "cashier").first()
        if not cashier:
            cashier = User(
                username="cashier", 
                email="cashier@example.com",
                full_name="Кассир",
                hashed_password=get_password_hash("cashier123"), 
                role="cashier"
            )
            db.add(cashier)
        db.commit()
        print("✅ Users ready.")

        # 3. Create Categories (Russian)
        print("📂 Creating Categories...")
        categories_data = {
            "Фрукты": "Свежие фрукты и ягоды",
            "Овощи": "Свежие овощи и зелень",
            "Молочные продукты": "Молоко, сыр, йогурты",
            "Мясо и Птица": "Свежее мясо, курица, колбасы",
            "Выпечка": "Хлеб, булочки, пироги",
            "Напитки": "Вода, соки, газировка",
            "Бакалея": "Крупы, макароны, масло, консервы",
            "Сладости": "Конфеты, шоколад, печенье",
            "Заморозка": "Пельмени, овощные смеси, мороженое"
        }
        
        categories_map = {}
        for name, desc in categories_data.items():
            cat = Category(name=name, description=desc)
            db.add(cat)
            categories_map[name] = cat
        db.commit()
        for cat in categories_map.values(): db.refresh(cat)

        # 4. Create Suppliers
        print("🚚 Creating Suppliers...")
        supplier_names = [
            "ООО «Фермерские Продукты»", 
            "ЗАО «Молочный Мир»", 
            "ИП Иванов (Овощи)", 
            "Хлебозавод №1", 
            "Компания «Напитки Плюс»"
        ]
        suppliers = []
        for name in supplier_names:
            try:
                # Sanitize phone: keep only digits and +
                raw_phone = fake.phone_number()
                clean_phone = "".join(c for c in raw_phone if c.isdigit() or c == '+')
                
                sup = Supplier(
                    name=name[:100],
                    contact_person=fake.name()[:50],
                    phone=clean_phone[:20],
                    email=fake.email()[:50],
                    address=fake.address()
                )
                db.add(sup)
                db.flush() # Check for errors immediately
                suppliers.append(sup)
            except Exception as e:
                print(f"⚠️ Failed to create supplier {name}: {e}")
                db.rollback()
        db.commit()

        # 5. Create Products
        print("🍎 Creating Products...")
        products = []
        
        # Helper to generate food products
        food_products = [
            ("Фрукты", [("Яблоки Голден", 15.0), ("Бананы", 12.0), ("Апельсины", 18.0), ("Виноград Киш-миш", 25.0), ("Лимоны", 20.0)]),
            ("Овощи", [("Картофель", 5.0), ("Морковь", 6.0), ("Лук репчатый", 4.0), ("Помидоры Розовые", 22.0), ("Огурцы", 18.0)]),
            ("Молочные продукты", [("Молоко 3.2%", 10.0), ("Творог 9%", 15.0), ("Сметана 20%", 12.0), ("Сыр Российский", 65.0), ("Масло сливочное", 25.0)]),
            ("Мясо и Птица", [("Филе куриное", 35.0), ("Говядина мякоть", 85.0), ("Фарш домашний", 45.0), ("Колбаса Докторская", 40.0)]),
            ("Выпечка", [("Хлеб белый", 4.0), ("Батон нарезной", 4.5), ("Булочка с маком", 5.0), ("Пирожок с капустой", 6.0)]),
            ("Напитки", [("Вода без газа 1.5л", 5.0), ("Сок Яблочный 1л", 12.0), ("Кола 0.5л", 8.0), ("Чай черный", 15.0)]),
            ("Бакалея", [("Макароны Перья", 8.0), ("Рис Краснодарский", 12.0), ("Гречка", 15.0), ("Масло подсолнечное", 18.0)]),
            ("Сладости", [("Шоколад Молочный", 14.0), ("Печенье Овсяное", 10.0), ("Конфеты Ассорти", 55.0)]),
        ]

        total_products_target = 100
        count = 0
        
        for cat_name, items in food_products:
            cat = categories_map.get(cat_name)
            if not cat: continue
            
            for prod_name, base_price in items:
                try:
                    cost = Decimal(base_price * random.uniform(0.7, 0.9)).quantize(Decimal("0.01"))
                    sell = Decimal(base_price).quantize(Decimal("0.01"))
                    
                    prod = Product(
                        barcode=fake.ean13(),
                        name=prod_name[:100],
                        description=f"Свежие {prod_name.lower()} от поставщика"[:255],
                        category_id=cat.id,
                        cost_price=cost,
                        sell_price=sell,
                        tax_percent=Decimal("0.00"), 
                        stock_quantity=random.randint(20, 200),
                        min_stock_level=10,
                        is_active=True
                    )
                    db.add(prod)
                    db.flush()
                    products.append(prod)
                    
                    # Initial inventory log
                    log = InventoryLog(
                        product_id=prod.id,
                        user_id=admin.id,
                        quantity_change=prod.stock_quantity,
                        previous_quantity=0,
                        new_quantity=prod.stock_quantity,
                        reason="Начальный остаток",
                        reference_type="adjustment"
                    )
                    db.add(log)
                    db.flush()
                    
                    count += 1
                except Exception as e:
                    print(f"⚠️ Failed to create product {prod_name}: {e}")
                    db.rollback()
        
        db.commit()
        print(f"✅ Created {len(products)} products.")

        # 6. Create Customers
        print("👥 Creating Customers...")
        customers = []
        for _ in range(15):
            raw_phone = fake.phone_number()
            clean_phone = "".join(c for c in raw_phone if c.isdigit() or c == '+')
            
            cust = Customer(
                name=fake.name()[:50],
                email=fake.email()[:50],
                phone=clean_phone[:20],
                address=fake.address()[:200]
            )
            db.add(cust)
            customers.append(cust)
        db.commit()
        for c in customers: db.refresh(c)

        # 7. Create Sales History
        print("💰 Simulating Sales History...")
        users = [admin, cashier]
        
        # Last 30 days
        start_date = datetime.now() - timedelta(days=30)
        
        for i in range(50):
            try:
                sale_time = start_date + timedelta(days=random.randint(0, 30), hours=random.randint(9, 20))
                cashier_user = random.choice(users)
                customer = random.choice(customers) if random.random() > 0.4 else None
                
                # Create Sale
                sale = Sale(
                    customer_id=customer.id if customer else None,
                    cashier_id=cashier_user.id,
                    payment_method=random.choice(['cash', 'card', 'mobile']),
                    status=SaleStatus.COMPLETED,
                    created_at=sale_time,
                    notes="Покупка в магазине"[:50]
                )
                db.add(sale)
                db.flush()
                
                # Add Items
                subtotal = Decimal("0.00")
                num_items = random.randint(1, 8)
                sale_items_list = random.sample(products, num_items)
                
                original_items = []
                
                for prod in sale_items_list:
                    qty = random.randint(1, 5)
                    price = prod.sell_price
                    line_total = price * qty
                    
                    s_item = SaleItem(
                        sale_id=sale.id,
                        product_id=prod.id,
                        quantity=qty,
                        unit_price=price,
                        tax_percent=Decimal("0.00"),
                        tax_amount=Decimal("0.00"),
                        discount_amount=Decimal("0.00"),
                        subtotal=line_total,
                        total=line_total,
                        quantity_returned=0
                    )
                    db.add(s_item)
                    db.flush()
                    
                    subtotal += line_total
                    original_items.append(s_item)
                    
                    # Inventory Log
                    log = InventoryLog(
                        product_id=prod.id,
                        user_id=cashier_user.id,
                        quantity_change=-qty,
                        previous_quantity=prod.stock_quantity,
                        new_quantity=prod.stock_quantity - qty,
                        reason=f"Продажа #{sale.id}"[:255],
                        reference_type="sale",
                        reference_id=sale.id,
                        created_at=sale_time
                    )
                    db.add(log)
                    
                    # Update product stock (in-memory update only for simulation consistency)
                    prod.stock_quantity -= qty

                sale.subtotal = subtotal
                sale.tax_amount = Decimal("0.00")
                sale.total_amount = subtotal
                
                # Simulate Returns (10% chance)
                if random.random() < 0.1:
                    # Pick one item to return
                    item_to_return = random.choice(original_items)
                    return_qty = random.randint(1, item_to_return.quantity)
                    
                    item_to_return.quantity_returned = return_qty
                    sale.status = SaleStatus.PARTIALLY_RETURNED if return_qty < item_to_return.quantity else SaleStatus.RETURNED
                    
                    if all(i.quantity == i.quantity_returned for i in original_items):
                         sale.status = SaleStatus.RETURNED

                    # Create Return Record
                    ret = SaleReturn(
                        sale_id=sale.id,
                        user_id=cashier_user.id,
                        total_refund_amount=item_to_return.unit_price * return_qty,
                        refund_method='cash',
                        notes="Возврат товара"[:50],
                        created_at=sale_time + timedelta(hours=1)
                    )
                    db.add(ret)
                    db.flush()
                    
                    ret_item = SaleReturnItem(
                        sale_return_id=ret.id,
                        sale_item_id=item_to_return.id,
                        quantity_returned=return_qty,
                        refund_amount=item_to_return.unit_price * return_qty
                    )
                    db.add(ret_item)
                    
                    # Inventory Log for Return
                    pk = item_to_return.product_id
                    prod_ret = next(p for p in products if p.id == pk)
                    log_ret = InventoryLog(
                        product_id=pk,
                        user_id=cashier_user.id,
                        quantity_change=return_qty,
                        previous_quantity=prod_ret.stock_quantity,
                        new_quantity=prod_ret.stock_quantity + return_qty,
                        reason=f"Возврат по чеку #{sale.id}"[:255],
                        reference_type="return",
                        reference_id=ret.id,
                        created_at=sale_time + timedelta(hours=1)
                    )
                    db.add(log_ret)
                    prod_ret.stock_quantity += return_qty
                
                db.commit() # Commit transaction for this sale
            except Exception as e:
                print(f"⚠️ Failed to create sale/return: {e}")
                db.rollback()

        print("✅ Sales history generated.")
        print("✅ Sales history generated.")
        print("🎉 Demo data creation COMPLETE!")

    except Exception as e:
        print(f"❌ Critical error: {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    create_demo_data()
