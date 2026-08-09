"""Read-only: compare products.stock_quantity against the FIFO layers.

The layers are the truth; stock_quantity is a cache. Writes nothing.
"""

from sqlalchemy import text

from core.database import SessionLocal

QUERY = text(
    """
    SELECT c.name AS company,
           p.id,
           p.name,
           p.stock_quantity AS cached,
           COALESCE(l.layer_sum, 0) AS ledger,
           l.layer_count
    FROM products p
    JOIN companies c ON c.id = p.company_id
    LEFT JOIN (
        SELECT product_id,
               SUM(remaining_quantity) AS layer_sum,
               COUNT(*) AS layer_count
        FROM inventory_layers
        WHERE reversed_at IS NULL
        GROUP BY product_id
    ) l ON l.product_id = p.id
    WHERE p.stock_quantity <> COALESCE(l.layer_sum, 0)
    ORDER BY c.name, p.name
    """
)


def main():
    db = SessionLocal()
    try:
        rows = db.execute(QUERY).fetchall()
    finally:
        db.close()

    if not rows:
        print("No drift: every product matches its layers.")
        return

    no_layers = [r for r in rows if not r.layer_count]
    print(f"{len(rows)} product(s) drifted; {len(no_layers)} have no layers at all.\n")
    print(f"{'company':<20} {'id':>6} {'product':<40} {'cached':>10} {'ledger':>10} {'diff':>10}")
    for r in rows:
        flag = "  <- no layers" if not r.layer_count else ""
        print(
            f"{r.company[:20]:<20} {r.id:>6} {r.name[:40]:<40} "
            f"{r.cached:>10} {r.ledger:>10} {r.cached - r.ledger:>10}{flag}"
        )


if __name__ == "__main__":
    main()
