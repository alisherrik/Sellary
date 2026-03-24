"""
Bootstrap the first company and owner account for a fresh environment.
"""
import argparse

from bootstrap_utils import ensure_company, ensure_membership, ensure_schema, ensure_user
from core.database import SessionLocal


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap the initial Sellary company.")
    parser.add_argument("--company-name", required=True, help="Company display name")
    parser.add_argument("--company-slug", help="Optional company slug")
    parser.add_argument("--owner-username", required=True, help="Owner username")
    parser.add_argument("--owner-email", required=True, help="Owner email")
    parser.add_argument("--owner-password", required=True, help="Owner password")
    parser.add_argument("--owner-full-name", help="Owner full name")
    parser.add_argument(
        "--owner-role",
        default="admin",
        choices=["admin", "manager", "cashier"],
        help="Membership role for the owner account",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_schema()

    db = SessionLocal()
    try:
        company, company_created = ensure_company(
            db,
            name=args.company_name,
            slug=args.company_slug,
        )
        user, user_created = ensure_user(
            db,
            username=args.owner_username,
            email=args.owner_email,
            password=args.owner_password,
            full_name=args.owner_full_name,
            role=args.owner_role,
        )
        membership, membership_created = ensure_membership(
            db,
            user=user,
            company=company,
            role=args.owner_role,
            is_default=True,
        )
        db.commit()

        print("Bootstrap complete.")
        print(f"Company: {company.name} ({company.slug}) [{'created' if company_created else 'existing'}]")
        print(f"User: {user.username} [{'created' if user_created else 'existing'}]")
        print(
            "Membership: "
            f"{membership.role} [{'created' if membership_created else 'updated'}]"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
