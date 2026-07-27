from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class McpConnection(BaseModel):
    """What the owner needs in order to connect an agent."""

    # The URL to paste into Claude. Everything else is discovered from it.
    url: str
    enabled: bool
    company_name: str


class McpAgent(BaseModel):
    """An agent that has been authorised against this company.

    One row per (client, user): the same person reconnecting Claude renews
    their own authorisation rather than adding another line, but two people
    each connecting Claude are two separate doors and are shown as two.
    """

    client_id: str
    client_name: Optional[str] = None
    user_id: int
    user_name: str
    connected_at: datetime
    expires_at: datetime
    scopes: List[str] = []


class McpAgentList(BaseModel):
    agents: List[McpAgent] = []
