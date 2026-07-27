"""Settings screen for the AI connector: the URL, who is connected, cutting one off."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_module
from core.database import get_db
from schemas.mcp import McpAgentList, McpConnection
from services.mcp_admin_service import McpAdminService

router = APIRouter(prefix="/mcp-connector", tags=["mcp-connector"])


@router.get("/connection", response_model=McpConnection)
def get_connection(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("ai")),
):
    """The URL to paste into Claude, and whether the connector is switched on."""
    return McpAdminService(db, auth.company_id).connection()


@router.get("/agents", response_model=McpAgentList)
def list_agents(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("ai")),
):
    """Agents currently able to reach this company's data."""
    return McpAdminService(db, auth.company_id).agents()


@router.delete("/agents/{client_id}/{user_id}", status_code=204)
def revoke_agent(
    client_id: str,
    user_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_module("ai", "manager")),
):
    """Stop one agent renewing its access for one user.

    The access token it already holds runs until it expires; switching the
    module off is what closes the door immediately.
    """
    struck = McpAdminService(db, auth.company_id).revoke(client_id, user_id)
    if struck == 0:
        raise HTTPException(status_code=404, detail="Подключение не найдено")
    db.commit()
