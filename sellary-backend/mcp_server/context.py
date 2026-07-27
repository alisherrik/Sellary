"""Turning an MCP access token back into a caller.

A tool needs the same three things a REST handler needs: a database session,
the company it is allowed to touch, and proof that this member may open this
module. This module supplies all three, mirroring `api/dependencies.py` rather
than inventing a parallel set of rules.

One deliberate difference: the super-admin company-entry branch is not carried
over. A global administrator reaching into any tenant is a deliberate operator
action taken through the owner panel, not something a chat connector should be
able to do quietly.
"""

import logging
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator

from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_access_token
from sqlalchemy.orm import Session, joinedload

from core.database import SessionLocal
from core.modules import LEVEL_RANK, MODULES
from models.company import Company
from models.company_membership import CompanyMembership
from models.membership_module_access import MembershipModuleAccess
from models.user import User
from repositories.company_module_repository import CompanyModuleRepository

logger = logging.getLogger(__name__)

CONNECTOR_MODULE = "ai"

MODULE_LABELS_RU = {
    "ai": "ИИ-коннектор",
    "register": "Касса",
    "sales": "Продажи",
    "customers": "Клиенты",
    "inventory": "Товары",
    "purchasing": "Закупки",
    "shop": "Магазин",
    "reports": "Отчёты",
    "finance": "Финансы",
}


@dataclass
class McpAuth:
    user: User
    company: Company
    membership: CompanyMembership | None
    role: str
    scopes: list[str]

    @property
    def company_id(self) -> int:
        return self.company.id


def _resolve(db: Session) -> McpAuth:
    token = get_access_token()
    if token is None:
        raise ToolError("Не авторизовано. Переподключите приложение к Sellary.")

    claims = token.claims or {}
    user_id = claims.get("user_id")
    company_id = claims.get("company_id")
    if user_id is None or company_id is None:
        raise ToolError("Токен не привязан к компании. Переподключите приложение.")

    membership = (
        db.query(CompanyMembership)
        .options(
            joinedload(CompanyMembership.user),
            joinedload(CompanyMembership.company),
        )
        .filter(
            CompanyMembership.user_id == user_id,
            CompanyMembership.company_id == company_id,
            CompanyMembership.is_active == True,  # noqa: E712
        )
        .first()
    )
    if membership is None or membership.company is None or membership.user is None:
        raise ToolError("Доступ к компании отозван. Переподключите приложение.")
    if not membership.company.is_active:
        raise ToolError("Компания отключена.")
    if not membership.user.is_active:
        raise ToolError("Учётная запись отключена.")

    auth = McpAuth(
        user=membership.user,
        company=membership.company,
        membership=membership,
        role=membership.role,
        scopes=list(token.scopes or []),
    )

    # The connector's own switch, checked on every call rather than only at
    # connect time. Turning it off has to shut the door on tokens that were
    # already issued — a switch that only stops *new* connections is not a
    # switch, and the tokens live for a day.
    if not CompanyModuleRepository(db).has_module(auth.company_id, CONNECTOR_MODULE):
        raise ToolError(
            "ИИ-коннектор отключён для этой компании. "
            "Включить его может владелец в настройках модулей."
        )

    return auth


@contextmanager
def mcp_session() -> Iterator[tuple[Session, McpAuth]]:
    """One session per tool call: committed on success, rolled back on failure.

    Tools are synchronous and FastMCP runs them in a worker thread, so a
    short-lived synchronous session here never touches the event loop.
    """
    db = SessionLocal()
    try:
        auth = _resolve(db)
        yield db, auth
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def require_module(
    auth: McpAuth, db: Session, module: str, level: str = "user"
) -> None:
    """The same two layers `api.dependencies.require_module` enforces.

    Company first — a company that has not bought a module is closed to its own
    admin — then the individual grant, which admins bypass.
    """
    if module not in MODULES:
        raise ValueError(f"Unknown module: {module}")

    label = MODULE_LABELS_RU.get(module, module)

    if not CompanyModuleRepository(db).has_module(auth.company_id, module):
        raise ToolError(f"Модуль «{label}» не подключён для этой компании.")

    if auth.role == "admin":
        return

    grant = None
    if auth.membership is not None:
        grant = (
            db.query(MembershipModuleAccess)
            .filter(
                MembershipModuleAccess.membership_id == auth.membership.id,
                MembershipModuleAccess.module == module,
            )
            .first()
        )

    if grant is None or LEVEL_RANK.get(grant.level, 0) < LEVEL_RANK[level]:
        if level == "manager":
            raise ToolError(
                f"Для этого действия нужны права руководителя в модуле «{label}». "
                "Обратитесь к администратору."
            )
        raise ToolError(
            f"У вас нет доступа к модулю «{label}». Обратитесь к администратору."
        )


def require_scope(auth: McpAuth, scope: str) -> None:
    """A scope is necessary but never sufficient — the module check still runs."""
    if scope not in auth.scopes:
        raise ToolError(
            "Приложению не выдано это разрешение. Переподключите его к Sellary "
            "и подтвердите доступ."
        )
