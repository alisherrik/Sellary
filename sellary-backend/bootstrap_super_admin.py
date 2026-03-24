"""
Manual fallback to bootstrap or update the owner-facing super admin account.
"""
from core.database import SessionLocal
from bootstrap_utils import ensure_super_admin


def main() -> None:
    db = SessionLocal()
    try:
        result = ensure_super_admin(db=db, strict=True)
        assert result is not None
        user, created = result
        db.commit()
        db.refresh(user)

        status = "created" if created else "updated"
        print(f"Super admin {status}: {user.username} ({user.email})")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
