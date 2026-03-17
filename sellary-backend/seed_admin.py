"""
Seed script to create an admin user for Sellary.
Run this after creating the database.
"""
from core.database import SessionLocal
from core.security import get_password_hash
from models.user import User


def create_admin_user():
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "admin").first()
        if existing:
            print("Admin user already exists.")
            return

        admin = User(
            username="admin",
            email="admin@example.com",
            full_name="System Administrator",
            hashed_password=get_password_hash("admin123"),
            role="admin",
            is_active=True,
        )
        db.add(admin)
        db.commit()
        print("Admin user created successfully!")
        print("Username: admin")
        print("Password: admin123")
        print("Please change the password after first login.")
    except Exception as e:
        print(f"Error creating admin user: {e}")
        db.rollback()
    finally:
        db.close()

def create_cashier_user():
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == "cashier").first()
        if existing:
            print("Cashier user already exists.")
            return

        cashier = User(
            username="cashier",
            email="cashier@example.com",
            full_name="Cashier",
            hashed_password=get_password_hash("cashier123"),
            role="cashier",
            is_active=True,
        )
        db.add(cashier)
        db.commit()
        print("Cashier user created successfully!")
        print("Username: cashier")
        print("Password: cashier123")
        print("Please change the password after first login.")
    except Exception as e:
        print(f"Error creating admin user: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    create_admin_user()
    create_cashier_user()
