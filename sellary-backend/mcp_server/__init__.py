"""MCP connector for Sellary.

Exposes the reporting surface and the batch-purchase flow to MCP clients
(Claude and anything else that speaks the protocol), mounted in-process at
`/mcp` so tools call the same `services/` layer the REST routers call.

`build_mcp_app` is imported lazily by `main.py` so that importing this package
never becomes a hard requirement for the rest of the backend.
"""

SCOPE_REPORTS = "sellary:reports"
SCOPE_PURCHASING = "sellary:purchasing"
SCOPES = [SCOPE_REPORTS, SCOPE_PURCHASING]

__all__ = ["SCOPES", "SCOPE_REPORTS", "SCOPE_PURCHASING"]
