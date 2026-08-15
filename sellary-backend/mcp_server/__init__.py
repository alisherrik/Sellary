"""MCP connector for Sellary.

Exposes the reporting surface and the batch-purchase flow to MCP clients
(Claude and anything else that speaks the protocol), mounted in-process at
`/mcp` so tools call the same `services/` layer the REST routers call.

`build_mcp_app` is imported lazily by `main.py` so that importing this package
never becomes a hard requirement for the rest of the backend.
"""

SCOPE_REPORTS = "sellary:reports"
SCOPE_PURCHASING = "sellary:purchasing"
# Row-level reads — a receipt, a customer's debt, a movement — as opposed to the
# aggregates on SCOPE_REPORTS. Its own scope so that widening what the connector
# can read means asking again, rather than quietly upgrading tokens already issued.
SCOPE_RECORDS = "sellary:records"
SCOPES = [SCOPE_REPORTS, SCOPE_RECORDS, SCOPE_PURCHASING]

__all__ = ["SCOPES", "SCOPE_REPORTS", "SCOPE_RECORDS", "SCOPE_PURCHASING"]
