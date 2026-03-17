from core.database import SessionLocal
from sqlalchemy import text

def check_enum():
    db = SessionLocal()
    try:
        print("Checking SaleStatus enum values...")
        result = db.execute(text("SELECT unnest(enum_range(NULL::salestatus))")).fetchall()
        print("Current Enum Values in DB:")
        for r in result:
            print(f" - '{r[0]}'")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check_enum()
