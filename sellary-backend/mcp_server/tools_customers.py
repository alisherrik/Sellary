"""Who owes the shop money, and where that debt came from.

A balance here is derived from the ledger on every read — it is never a stored
column, so it cannot disagree with the sales that produced it.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from repositories.customer_repository import CustomerRepository
from services.customer_ledger_service import CustomerLedgerService


@mcp.tool
def list_customers(query: str | None = None, limit: int = 50) -> dict:
    """Список клиентов магазина, при необходимости с поиском по имени или
    телефону. Нужен, чтобы найти клиента перед тем, как смотреть его долг.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "customers")
        limit = max(1, min(int(limit), 200))
        customers = CustomerRepository(db).get_all(
            auth.company_id, limit=limit, search=query
        )
        return {
            "total": len(customers),
            "customers": [
                {"id": row.id, "name": row.name, "phone": row.phone}
                for row in customers
            ],
        }


@mcp.tool
def get_customer_debt(customer_id: int) -> dict:
    """Долг одного клиента и вся его история: продажи в долг, погашения,
    корректировки после возвратов и отмен. Положительный баланс — клиент должен
    магазину.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "customers")
        service = CustomerLedgerService(db, auth.company_id)
        try:
            ledger = service.get_customer_ledger(customer_id)
        except ValueError as exc:
            raise ToolError(str(exc))
        return json_safe(ledger)
