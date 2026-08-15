"""How the money moved, not only where it ended up.

Read-only by design: recording a movement, transferring between accounts and
correcting a balance all stay in the app, where a person signs for them.
"""

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from services.money_service import MoneyService
from services.report_service import ReportService


@mcp.tool
def get_money_movements(
    period: str = "this_month",
    account_id: int | None = None,
    limit: int = 100,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Движения денег за период: приход, расход, переводы между счетами, с
    причиной и комментарием. Отвечает на «куда ушли деньги», когда остаток на
    счёте не сходится с ожиданием.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "finance")
        limit = max(1, min(int(limit), 500))
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        movements = MoneyService(db, auth.company_id).history(
            account_id=account_id, start=start, end=end, limit=limit
        )
        return {**echo, "movements": json_safe(movements)}
