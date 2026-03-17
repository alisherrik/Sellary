"""
Script to fix producttype enum mismatch between database and Python code.
"""
from sqlalchemy import create_engine, text
from core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    output = []
    
    with engine.connect() as conn:
        # Check current enum values in database
        output.append("Checking current producttype enum values in database...")
        
        try:
            result = conn.execute(text("SELECT unnest(enum_range(NULL::producttype))::text")).fetchall()
            output.append(f"Current DB enum values: {[r[0] for r in result]}")
        except Exception as e:
            output.append(f"Error checking enum: {e}")
            
        # Check if there are any products with invalid producttype
        output.append("\nChecking products table...")
        try:
            result = conn.execute(text("SELECT DISTINCT product_type FROM products")).fetchall()
            output.append(f"Product types in database: {[r[0] for r in result]}")
        except Exception as e:
            output.append(f"Error checking products: {e}")
            
        # Check current enum definition in pg_enum
        output.append("\nChecking pg_enum for producttype...")
        try:
            result = conn.execute(text("""
                SELECT e.enumlabel 
                FROM pg_type t 
                JOIN pg_enum e ON t.oid = e.enumtypid 
                WHERE t.typname = 'producttype'
                ORDER BY e.enumsortorder
            """)).fetchall()
            output.append(f"Enum labels: {[r[0] for r in result]}")
        except Exception as e:
            output.append(f"Error: {e}")
    
    # Write to file
    result_text = "\n".join(output)
    with open("enum_check_result.txt", "w") as f:
        f.write(result_text)
    print(result_text)

if __name__ == "__main__":
    main()
