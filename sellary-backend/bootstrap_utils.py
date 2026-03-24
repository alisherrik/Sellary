import re
from pathlib import Path
from typing import Optional, Tuple

from alembic import command
from alembic.config import Config
from sqlalchemy import or_
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from sqlalchemy.schema import MetaData, Table

from core.config import settings
from core.database import Base, engine
from core.security import get_password_hash
from models.company import Company
from models.company_membership import CompanyMembership
from models.user import User

REQUIRED_SUPER_ADMIN_ENV_KEYS = (
    "SUPER_ADMIN_USERNAME",
    "SUPER_ADMIN_EMAIL",
    "SUPER_ADMIN_PASSWORD",
)
ALEMBIC_VERSION_TABLE = "alembic_version"


def slugify_company_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower())
    slug = slug.strip("-")
    return slug or "company"


def ensure_schema() -> None:
    if engine.dialect.name != "sqlite":
        run_migrations_to_head()
        return

    Base.metadata.create_all(bind=engine)

    session = Session(bind=engine)
    try:
        ensure_super_admin(db=session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def run_migrations_to_head() -> None:
    alembic_config = Config(str(Path(__file__).with_name("alembic.ini")))
    alembic_config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
    command.upgrade(alembic_config, "head")


def has_unmanaged_schema() -> bool:
    table_names = set(inspect(engine).get_table_names())
    return bool(table_names) and ALEMBIC_VERSION_TABLE not in table_names


def drop_schema() -> None:
    Base.metadata.drop_all(bind=engine)
    version_table = Table(ALEMBIC_VERSION_TABLE, MetaData())
    version_table.drop(bind=engine, checkfirst=True)


def ensure_super_admin(
    db: Session,
    *,
    strict: bool = False,
) -> Tuple[User, bool] | None:
    missing = [key for key in REQUIRED_SUPER_ADMIN_ENV_KEYS if not getattr(settings, key)]
    if missing:
        if strict:
            missing_keys = ", ".join(missing)
            raise SystemExit(f"Missing required super admin env values: {missing_keys}")
        return None

    user = (
        db.query(User)
        .filter(
            or_(
                User.username == settings.SUPER_ADMIN_USERNAME,
                User.email == settings.SUPER_ADMIN_EMAIL,
            )
        )
        .first()
    )
    created = user is None

    if user is None:
        user = User(
            username=settings.SUPER_ADMIN_USERNAME,
            email=settings.SUPER_ADMIN_EMAIL,
            full_name=settings.SUPER_ADMIN_FULL_NAME,
            hashed_password=get_password_hash(settings.SUPER_ADMIN_PASSWORD),
            role="admin",
            global_role="super_admin",
            is_active=True,
        )
        db.add(user)
    else:
        user.username = settings.SUPER_ADMIN_USERNAME
        user.email = settings.SUPER_ADMIN_EMAIL
        user.full_name = settings.SUPER_ADMIN_FULL_NAME
        user.hashed_password = get_password_hash(settings.SUPER_ADMIN_PASSWORD)
        user.role = "admin"
        user.global_role = "super_admin"
        user.is_active = True

    db.flush()
    return user, created


def get_company(
    db: Session,
    *,
    company_id: Optional[int] = None,
    slug: Optional[str] = None,
    name: Optional[str] = None,
) -> Optional[Company]:
    query = db.query(Company)
    if company_id is not None:
        return query.filter(Company.id == company_id).first()
    if slug:
        return query.filter(Company.slug == slug).first()
    if name:
        return query.filter(Company.name == name).first()
    return None


def ensure_company(
    db: Session,
    *,
    name: str,
    slug: Optional[str] = None,
    is_active: bool = True,
) -> Tuple[Company, bool]:
    normalized_slug = slugify_company_name(slug or name)

    existing = get_company(db, slug=normalized_slug) or get_company(db, name=name)
    if existing:
        if not existing.slug:
            existing.slug = normalized_slug
        existing.name = name
        existing.is_active = is_active
        db.flush()
        return existing, False

    company = Company(name=name, slug=normalized_slug, is_active=is_active)
    db.add(company)
    db.flush()
    return company, True


def ensure_user(
    db: Session,
    *,
    username: str,
    email: str,
    password: Optional[str] = None,
    full_name: Optional[str] = None,
    role: str = "cashier",
    is_active: bool = True,
) -> Tuple[User, bool]:
    existing = (
        db.query(User)
        .filter(or_(User.username == username, User.email == email))
        .first()
    )
    if existing:
        if full_name is not None:
            existing.full_name = full_name
        existing.is_active = is_active
        db.flush()
        return existing, False

    if password is None:
        raise ValueError("Password is required when creating a new user")

    user = User(
        username=username,
        email=email,
        full_name=full_name,
        hashed_password=get_password_hash(password),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user, True


def ensure_membership(
    db: Session,
    *,
    user: User,
    company: Company,
    role: str,
    is_default: Optional[bool] = None,
    is_active: bool = True,
) -> Tuple[CompanyMembership, bool]:
    existing = (
        db.query(CompanyMembership)
        .filter(
            CompanyMembership.user_id == user.id,
            CompanyMembership.company_id == company.id,
        )
        .first()
    )
    should_be_default = is_default
    if should_be_default is None:
        has_default = (
            db.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == user.id,
                CompanyMembership.is_default == True,
            )
            .count()
            > 0
        )
        should_be_default = not has_default

    if should_be_default:
        (
            db.query(CompanyMembership)
            .filter(CompanyMembership.user_id == user.id)
            .update({"is_default": False})
        )

    if existing:
        existing.role = role
        existing.is_active = is_active
        existing.is_default = should_be_default
        db.flush()
        return existing, False

    membership = CompanyMembership(
        user_id=user.id,
        company_id=company.id,
        role=role,
        is_default=should_be_default,
        is_active=is_active,
    )
    db.add(membership)
    db.flush()
    return membership, True
