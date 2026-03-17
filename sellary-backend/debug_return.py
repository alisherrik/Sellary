from core.database import SessionLocal
from services.sale_return_service import SaleReturnService
from models.sale import Sale, SaleStatus, PaymentMethod
from models.sale_return import SaleReturn, SaleReturnItem
from models.user import User
from models.inventory_log import InventoryLog
from schemas.sale_return import SaleReturnCreate, SaleReturnItemCreate
from decimal import Decimal

def debug_return():
    db = SessionLocal()
    try:
        # Get a cashier
        user = db.query(User).first()
        if not user:
            print("No user found")
            return

        # Find a COMPLETED sale with items
        sale = db.query(Sale).filter(Sale.status == SaleStatus.COMPLETED).first()
        
        if not sale:
            print("No completed sale found")
            return
            
        print(f"Testing return for Sale {sale.id}")
        
        if not sale.items:
            print("Sale has no items!")
            return
            
        sale_item = sale.items[0]
        qty_to_return = 1
        
        if sale_item.quantity < qty_to_return:
            print(f"Skipping item {sale_item.id}, qty {sale_item.quantity} too low")
            return
            
        print(f"Returning item {sale_item.id} (Product {sale_item.product_id}), Qty: {qty_to_return}")
        
        return_data = SaleReturnCreate(
            items=[
                SaleReturnItemCreate(
                    sale_item_id=sale_item.id,
                    quantity=qty_to_return
                )
            ],
            refund_method=PaymentMethod.CASH,
            notes="Debug Return"
        )
        
        # INLINED LOIC FOR DEBUGGING
        print(">> Debugging step-by-step...", flush=True)
        
        # INSPECT DB SCHEMA
        try:
            from sqlalchemy import inspect
            insp = inspect(db.get_bind())
            cols = insp.get_columns("sale_returns")
            print(">> Inspecting sale_returns columns:", flush=True)
            for c in cols:
                print(f"  - {c['name']}: {c['type']}", flush=True)
        except Exception as e:
            print(f"Error inspecting schema: {e}", flush=True)
            
        try:

            # 1. Sale
            print(f"  Fetching sale {sale.id}...")
            
            # 2. Status check
            print("  Checking status...")
            
            # 3. Item map
            sale_item_map = {item.id: item for item in sale.items}
            
            # 4. Product IDs
            product_ids = [sale_item.product_id] # simplified for 1 item
            
            # 5. Lock products
            # skip locking for debug script to avoid noise, just fetch
            print("  Fetching products...")
            from models.product import Product
            product = db.query(Product).get(sale_item.product_id)
            
            # 6. Create Return
            total_refund = Decimal("0.00")
            
            # Calc refund
            unit_refund = sale_item.total / sale_item.quantity
            item_refund = unit_refund * qty_to_return
            total_refund += item_refund
            
            print("  Creating SaleReturn object...")
            sale_return = SaleReturn(
                sale_id=sale.id,
                user_id=user.id,
                total_refund_amount=total_refund,
                refund_method=PaymentMethod.CASH, # Using enum
                notes="Debug Return"[:10] # Truncate to be safe
            )
            print("  Adding SaleReturn to session...")
            db.add(sale_return)
            print("  Flushing SaleReturn...")
            db.flush() # CRASH HERE IF refund_method ISSUE
            print("  OK SaleReturn flushed.")
            
            # 7. Return Item
            print("  Creating SaleReturnItem...")
            ret_item = SaleReturnItem(
                 sale_return_id=sale_return.id,
                 sale_item_id=sale_item.id,
                 quantity_returned=qty_to_return,
                 refund_amount=item_refund
            )
            db.add(ret_item)
            print("  Flushing SaleReturnItem...")
            db.flush()
            print("  OK SaleReturnItem flushed.")
            
            # 8. Update SaleItem
            print("  Updating SaleItem quantity_returned...")
            sale_item.quantity_returned += qty_to_return
            db.flush()
            print("  OK SaleItem updated.")
            
            # 9. Update Stock
            print("  Updating Product stock...")
            previous_quantity = product.stock_quantity
            new_quantity = previous_quantity + qty_to_return
            product.stock_quantity = new_quantity
            
            # 10. Inventory Log
            print("  Creating InventoryLog...")
            # Truncating reason just in case
            from models.inventory_log import InventoryLog
            log = InventoryLog(
                product_id=product.id,
                user_id=user.id,
                quantity_change=qty_to_return,
                previous_quantity=previous_quantity,
                new_quantity=new_quantity,
                reason=f"Return from Sale #{sale.id}"[:50], 
                reference_type="sale_return", # 11 chars
                reference_id=sale_return.id
            )
            db.add(log)
            print("  Flushing InventoryLog...")
            db.flush() # CRASH HERE IF inventory log ISSUE
            print("  OK InventoryLog flushed.")

            # 11. Update status
            print("  Updating Sale Status...")
            sale.status = SaleStatus.PARTIALLY_RETURNED
            db.flush()
            print("  OK Status updated.")
            
            db.commit()
            print("SUCCESS! Return committed.")
            
        except Exception as e:
            print(f"ERROR Return failed during step-by-step: {e}")
            import traceback
            traceback.print_exc()
            return
            
    except Exception as e:
        print(f"❌ Critical error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    import sys
    with open("debug_log.txt", "w", encoding="utf-8") as f:
        sys.stdout = f
        sys.stderr = f
        debug_return()
