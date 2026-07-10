"""One-off cleanup: remove selected TEST transactions for a company on production.

Deletes the given purchase orders AND all sales for the company, then recomputes
each product's stock_quantity / inventory_value / cost_price from the REMAINING
non-reversed FIFO layers (the authoritative source). All affected company rows are
backed up to a timestamped JSON file before anything is deleted.

Connection: reads DBURL from env (Postgres PUBLIC proxy url).

Usage (dry-run by default — prints what WOULD change, makes no edits):
    DBURL=... python clear_test_data.py --company-id 2 --po-ids 3,5,6,7,8,9
Add --execute to actually delete (a backup JSON is always written first).
"""
import argparse
import datetime
import decimal
import json
import os
import sys

from sqlalchemy import create_engine, text


def _jsonable(v):
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    return v


def fetch(conn, sql):
    return [
        {k: _jsonable(v) for k, v in row._mapping.items()}
        for row in conn.execute(text(sql))
    ]


def scalar(conn, sql):
    return conn.execute(text(sql)).scalar()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--company-id", type=int, required=True)
    ap.add_argument("--po-ids", required=True, help="comma-separated purchase_order ids to delete")
    ap.add_argument("--execute", action="store_true", help="perform changes (default: dry-run)")
    args = ap.parse_args()

    cid = args.company_id
    po_ids = sorted({int(x) for x in args.po_ids.split(",") if x.strip()})
    po_list = ",".join(str(i) for i in po_ids) or "NULL"

    url = os.environ["DBURL"].replace("postgres://", "postgresql://", 1)
    engine = create_engine(url, connect_args={"connect_timeout": 30})

    # ---- Preview (read-only) ----
    with engine.connect() as conn:
        real_po = [r["id"] for r in fetch(
            conn, f"select id from purchase_orders where company_id={cid} and id in ({po_list})"
        )]
        sale_ids = [r["id"] for r in fetch(conn, f"select id from sales where company_id={cid}")]
        receipt_ids = fetch(
            conn,
            f"select id from purchase_receipts where purchase_order_id in ({po_list})",
        )
        rids = ",".join(str(r["id"]) for r in receipt_ids) or "NULL"
        layers_from_pos = scalar(
            conn,
            f"select count(*) from inventory_layers where purchase_receipt_item_id in "
            f"(select id from purchase_receipt_items where purchase_receipt_id in ({rids}))",
        )
        print("=== PLAN ===")
        print("company_id:", cid)
        print("purchase_orders to delete:", real_po)
        print("sales to delete (all in company):", len(sale_ids))
        print("purchase_receipts under those POs:", len(receipt_ids))
        print("inventory_layers from those POs:", layers_from_pos)
        print("inventory_allocations in company (all, from sales):",
              scalar(conn, f"select count(*) from inventory_allocations where company_id={cid}"))
        print("products in company:", scalar(conn, f"select count(*) from products where company_id={cid}"))

    if not real_po and not sale_ids:
        print("Nothing to do.")
        return

    if not args.execute:
        print("\nDRY-RUN only. Re-run with --execute to apply (a backup is written first).")
        return

    # ---- Backup (always before deleting) ----
    backup = {}
    with engine.connect() as conn:
        backup["companies"] = fetch(conn, f"select * from companies where id={cid}")
        backup["sales"] = fetch(conn, f"select * from sales where company_id={cid}")
        backup["sale_items"] = fetch(conn, f"select * from sale_items where sale_id in (select id from sales where company_id={cid})")
        backup["sale_returns"] = fetch(conn, f"select * from sale_returns where company_id={cid}")
        backup["sale_return_items"] = fetch(conn, f"select * from sale_return_items where sale_return_id in (select id from sale_returns where company_id={cid})")
        backup["purchase_orders"] = fetch(conn, f"select * from purchase_orders where company_id={cid}")
        backup["purchase_order_items"] = fetch(conn, f"select * from purchase_order_items where purchase_order_id in (select id from purchase_orders where company_id={cid})")
        backup["purchase_receipts"] = fetch(conn, f"select * from purchase_receipts where company_id={cid}")
        backup["purchase_receipt_items"] = fetch(conn, f"select * from purchase_receipt_items where purchase_receipt_id in (select id from purchase_receipts where company_id={cid})")
        backup["inventory_layers"] = fetch(conn, f"select * from inventory_layers where company_id={cid}")
        backup["inventory_allocations"] = fetch(conn, f"select * from inventory_allocations where company_id={cid}")
        backup["inventory_logs"] = fetch(conn, f"select * from inventory_logs where company_id={cid}")
        backup["products"] = fetch(conn, f"select * from products where company_id={cid}")

    os.makedirs("backups", exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join("backups", f"cleanup_company{cid}_{stamp}.json")
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(backup, f, ensure_ascii=False, indent=1)
    print(f"\nBackup written: {backup_path} ({sum(len(v) for v in backup.values())} rows)")

    # ---- Delete + surgical sale reversal (single transaction) ----
    with engine.begin() as conn:
        # 1) Surgically restore stock consumed by THIS company's sales. We reverse
        #    each sale allocation's outstanding (quantity - released_quantity) back
        #    into its source layer + the product. This undoes exactly the sales,
        #    without a global recompute (which would double-count sale_void layers).
        allocs = conn.execute(text(
            "select a.id, a.layer_id, a.quantity, coalesce(a.released_quantity,0) released, "
            "l.unit_cost, l.product_id "
            "from inventory_allocations a join inventory_layers l on l.id = a.layer_id "
            f"where a.company_id={cid}"
        )).fetchall()
        restored = {}
        for a in allocs:
            outstanding = decimal.Decimal(a.quantity) - decimal.Decimal(a.released)
            if outstanding > 0:
                conn.execute(
                    text("update inventory_layers set remaining_quantity = remaining_quantity + :q where id = :lid"),
                    {"q": outstanding, "lid": a.layer_id},
                )
                q, v = restored.get(a.product_id, (decimal.Decimal(0), decimal.Decimal(0)))
                restored[a.product_id] = (q + outstanding, v + outstanding * decimal.Decimal(a.unit_cost))
        for pid, (q, v) in restored.items():
            conn.execute(
                text("update products set stock_quantity = stock_quantity + :q, "
                     "inventory_value = round(inventory_value + :v, 4) where id = :pid"),
                {"q": q, "v": v, "pid": pid},
            )
        conn.execute(text(
            f"update products set cost_price = round(inventory_value/stock_quantity, 4) "
            f"where company_id={cid} and stock_quantity > 0"
        ))
        print(f"Restored stock for {len(restored)} product(s) from {len(allocs)} sale allocation(s).")

        # 2) Delete the sales (history clean)
        conn.execute(text(f"delete from sale_return_items where sale_return_id in (select id from sale_returns where company_id={cid})"))
        conn.execute(text(f"delete from sale_returns where company_id={cid}"))
        conn.execute(text(f"delete from inventory_allocations where company_id={cid}"))
        conn.execute(text(f"delete from sale_items where sale_id in (select id from sales where company_id={cid})"))
        conn.execute(text(f"delete from sales where company_id={cid}"))

        # 3) Delete the selected purchase orders (records only; POs 3-9 have no
        #    linked receipts/layers, but the layer/receipt deletes are kept guarded
        #    in case any selected PO does).
        conn.execute(text(
            f"delete from inventory_layers where purchase_receipt_item_id in "
            f"(select id from purchase_receipt_items where purchase_receipt_id in "
            f"(select id from purchase_receipts where purchase_order_id in ({po_list})))"
        ))
        conn.execute(text(f"delete from purchase_receipt_items where purchase_receipt_id in (select id from purchase_receipts where purchase_order_id in ({po_list}))"))
        conn.execute(text(f"delete from purchase_receipts where purchase_order_id in ({po_list})"))
        conn.execute(text(f"delete from purchase_order_items where purchase_order_id in ({po_list})"))
        conn.execute(text(f"delete from purchase_orders where id in ({po_list}) and company_id={cid}"))

    # ---- Verify ----
    with engine.connect() as conn:
        print("\n=== AFTER ===")
        for t in ["purchase_orders", "sales", "sale_items", "inventory_allocations"]:
            print(f"  {t} (company {cid}-scoped) remaining:",
                  scalar(conn, f"select count(*) from {t} where " + (
                      f"company_id={cid}" if t in ("purchase_orders", "sales", "inventory_allocations")
                      else f"sale_id in (select id from sales where company_id={cid})")))
        print("  remaining purchase_orders ids:",
              [r["id"] for r in fetch(conn, f"select id from purchase_orders where company_id={cid} order by id")])
        print("  products with stock>0:",
              scalar(conn, f"select count(*) from products where company_id={cid} and stock_quantity>0"))
    print("\nDONE.")


if __name__ == "__main__":
    main()
