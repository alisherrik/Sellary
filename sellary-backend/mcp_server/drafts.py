"""The signed purchase draft.

`purchase_commit` accepts no line items of its own. Everything it will write is
inside the token issued by `purchase_preview`, so the thing the owner approved
and the thing that gets recorded are the same by construction rather than by
the model's good behaviour.

The token is bound to the company and the user who previewed it, so one leaked
between tenants — or between colleagues — is inert.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastmcp.exceptions import ToolError

from core.config import settings

DRAFT_TOKEN_TYPE = "mcp_purchase_draft"
DRAFT_TTL_MINUTES = 15


def issue_draft(company_id: int, user_id: int, plan: dict[str, Any]) -> str:
    payload = {
        "token_type": DRAFT_TOKEN_TYPE,
        "company_id": company_id,
        "user_id": user_id,
        "plan": plan,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=DRAFT_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def read_draft(token: str, company_id: int, user_id: int) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except jwt.ExpiredSignatureError:
        raise ToolError(
            "Черновик закупки устарел. Сформируйте список заново через "
            "purchase_preview."
        )
    except jwt.PyJWTError:
        raise ToolError("Черновик закупки повреждён. Сформируйте его заново.")

    if payload.get("token_type") != DRAFT_TOKEN_TYPE:
        raise ToolError("Это не черновик закупки.")
    if payload.get("company_id") != company_id or payload.get("user_id") != user_id:
        raise ToolError("Этот черновик принадлежит другому пользователю или компании.")

    plan = payload.get("plan")
    if not isinstance(plan, dict) or not plan.get("lines"):
        raise ToolError("Черновик закупки пуст.")
    return plan
