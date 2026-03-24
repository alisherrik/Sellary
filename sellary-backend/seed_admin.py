"""
Seed a default company with admin and cashier accounts for local development.
"""
from bootstrap_utils import ensure_company, ensure_membership, ensure_schema, ensure_user
from core.database import SessionLocal

DEFAULT_COMPANY_NAME = "Sellary Demo"
DEFAULT_COMPANY_SLUG = "sellary-demo"


def seed_default_users() -> None:
    ensure_schema()
    db = SessionLocal()
    try:
        company, _ = ensure_company(
            db,
            name=DEFAULT_COMPANY_NAME,
            slug=DEFAULT_COMPANY_SLUG,
        )

        admin, admin_created = ensure_user(
            db,
            username="admin",
            email="admin@example.com",
            full_name="System Administrator",
            password="admin123",
            role="admin",
        )
        ensure_membership(db, user=admin, company=company, role="admin", is_default=True)

        cashier, cashier_created = ensure_user(
            db,
            username="cashier",
            email="cashier@example.com",
            full_name="Cashier",
            password="cashier123",
            role="cashier",
        )
        ensure_membership(db, user=cashier, company=company, role="cashier", is_default=True)

        db.commit()

        print("Default tenant seed complete.")
        print(f"Company: {company.name} ({company.slug})")
        print(f"Admin: admin / admin123 [{'created' if admin_created else 'existing'}]")
        print(f"Cashier: cashier / cashier123 [{'created' if cashier_created else 'existing'}]")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_default_users()
