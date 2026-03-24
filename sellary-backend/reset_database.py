"""
Destructive reset for fresh-start environments.

Drops all tables and recreates the schema from Alembic migrations.
"""
import argparse

from bootstrap_utils import drop_schema, ensure_schema


def main() -> None:
    parser = argparse.ArgumentParser(description="Drop and recreate the Sellary schema.")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm destructive reset without an interactive prompt.",
    )
    args = parser.parse_args()

    if not args.yes:
        print("Refusing to reset without --yes.")
        return

    print("Dropping all tables...")
    drop_schema()
    print("Recreating schema from migrations...")
    ensure_schema()
    print("Super admin sync complete if SUPER_ADMIN_* env values were configured.")
    print("Database reset complete.")


if __name__ == "__main__":
    main()
