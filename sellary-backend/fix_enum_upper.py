from core.database import SessionLocal
from sqlalchemy import text

def fix_enum_upper():
    db = SessionLocal()
    try:
        print("Fixing SaleStatus enum (Uppercase)...")
        try:
            db.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'PARTIALLY_RETURNED'"))
            db.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'RETURNED'"))
            db.commit()
            print("✅ Enum updated successfully (Uppercase).")
        except Exception as e:
            db.rollback()
            print(f"❌ Failed to update enum: {e}")
            # Try with autocommit via engine
            print("Retrying with AUTOCOMMIT...")
            engine = db.get_bind()
            with engine.connect() as conn:
                conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                conn.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'PARTIALLY_RETURNED'"))
                conn.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'RETURNED'"))
            print("✅ Enum updated via AUTOCOMMIT (Uppercase).")
            
    except Exception as e:
        print(f"❌ Critical error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    fix_enum_upper()
