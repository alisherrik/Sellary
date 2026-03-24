"""
Create or reuse a company and attach a user membership without manual DB edits.
"""
import argparse

from bootstrap_utils import ensure_company, ensure_membership, ensure_schema, ensure_user
from core.database import SessionLocal
from models.user import User


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Attach a user to a company.")
    parser.add_argument("--company-name", required=True, help="Company display name")
    parser.add_argument("--company-slug", help="Optional company slug")
    parser.add_argument("--username", required=True, help="User username")
    parser.add_argument("--email", help="User email (required if the user does not exist)")
    parser.add_argument("--password", help="User password (required if the user does not exist)")
    parser.add_argument("--full-name", help="User full name")
    parser.add_argument(
        "--role",
        default="cashier",
        choices=["admin", "manager", "cashier"],
        help="Membership role inside the company",
    )
    parser.add_argument(
        "--default-company",
        action="store_true",
        help="Make this company the user's default company",
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
        if args.email is None:
            user = db.query(User).filter(User.username == args.username).first()
            if user is None:
                raise ValueError("--email is required when creating a new user")
            if args.full_name is not None:
                user.full_name = args.full_name
            user_created = False
        else:
            user, user_created = ensure_user(
                db,
                username=args.username,
                email=args.email,
                password=args.password,
                full_name=args.full_name,
                role=args.role,
            )

        membership, membership_created = ensure_membership(
            db,
            user=user,
            company=company,
            role=args.role,
            is_default=args.default_company,
        )
        db.commit()

        print("Company assignment complete.")
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
