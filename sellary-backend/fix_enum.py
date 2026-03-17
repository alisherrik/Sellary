from core.database import SessionLocal
from sqlalchemy import text

def fix_enum():
    db = SessionLocal()
    try:
        print("Fixing SaleStatus enum...")
        # We need to execute raw SQL.
        # ALTER TYPE ADD VALUE cannot run inside a transaction block in older Postgres, 
        # but usually fine in newer. However, to be safe, we'll try standard execution.
        # If it fails, we might need isolation_level="AUTOCOMMIT".
        
        # Check current values?
        # SELECT unnest(enum_range(NULL::salestatus));
        
        try:
            db.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'partially_returned'"))
            db.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'returned'"))
            db.commit()
            print("✅ Enum updated successfully.")
        except Exception as e:
            db.rollback()
            print(f"❌ Failed to update enum: {e}")
            # Try with autocommit via engine
            print("Retrying with AUTOCOMMIT...")
            engine = db.get_bind()
            with engine.connect() as conn:
                conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                conn.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'partially_returned'"))
                conn.execute(text("ALTER TYPE salestatus ADD VALUE IF NOT EXISTS 'returned'"))
            print("✅ Enum updated via AUTOCOMMIT.")
            
    except Exception as e:
        print(f"❌ Critical error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    fix_enum()
