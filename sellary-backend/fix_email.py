from core.database import SessionLocal
from models.user import User

def fix_admin_email():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "admin").first()
        if user:
            print(f"Found admin user. Current email: {user.email}")
            user.email = "admin@example.com"
            db.commit()
            print(f"Updated admin email to: {user.email}")
        else:
            print("Admin user not found.")
    except Exception as e:
        print(f"Error updating email: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    fix_admin_email()
