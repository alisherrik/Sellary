"""The FastMCP instance and the ASGI app that carries it.

Tool modules import `mcp` from here and register themselves by decorating, so
`build_mcp_app` imports them for their side effects. That is the only reason
those imports look unused.
"""

import logging

from starlette.routing import BaseRoute, Match, NoMatchFound, Route

from core.config import settings
from fastmcp import FastMCP
from mcp_server.oauth.provider import build_provider

logger = logging.getLogger(__name__)

INSTRUCTIONS = """\
Sellary — система учёта магазина: продажи, склад, закупки, касса, деньги.

Отчёты доступны только на чтение. Периоды задаются словами
(today, this_month, last_month, …) и считаются по часовому поясу компании —
не пересчитывайте даты вручную.

Закупка оформляется в два шага: purchase_preview показывает, что будет
создано, и ничего не пишет; purchase_commit выполняет ровно то, что было
показано. Всегда покажите результат preview владельцу и дождитесь его
подтверждения, прежде чем вызывать commit.

Продажи, возвраты и отмены через этот интерфейс недоступны — они делаются
на кассе.
"""

auth_provider = build_provider()

mcp: FastMCP = FastMCP(
    name="Sellary",
    version=settings.VERSION,
    instructions=INSTRUCTIONS,
    auth=auth_provider,
)


def _register_oauth_pages() -> None:
    """The human login flow, served from under the /mcp mount."""
    from mcp_server.oauth.routes import ROUTES

    for path, endpoint, methods in ROUTES:
        mcp.custom_route(path, methods=methods, include_in_schema=False)(endpoint)


class ExactPathRoute(BaseRoute):
    """Route one exact path to an ASGI app.

    Starlette's `Mount("/mcp")` only matches sub-paths: a request for `/mcp`
    itself falls through to `redirect_slashes` and comes back as a 307 to
    `/mcp/`. Clients are told to connect to `/mcp`, and paying a redirect on
    every MCP call — or meeting a client that will not follow one on POST —
    is not worth a trailing slash.
    """

    def __init__(self, path: str, app):
        self.path = path
        self.app = app

    def matches(self, scope):
        if scope["type"] == "http" and scope.get("path") == self.path:
            return Match.FULL, {"path_params": {}, "path": "/", "root_path": self.path}
        return Match.NONE, {}

    async def handle(self, scope, receive, send):
        await self.app({**scope, "path": "/", "raw_path": b"/"}, receive, send)

    def url_path_for(self, name: str, /, **path_params):
        raise NoMatchFound(name, path_params)


def build_mcp_app():
    """The ASGI app to mount at /mcp.

    Tool modules are imported here rather than at module scope so that importing
    `mcp_server.server` alone — as the OAuth layer does — cannot pull the whole
    service layer in behind it.
    """
    from mcp_server import (  # noqa: F401
        tools_catalog,
        tools_customers,
        tools_purchase,
        tools_reports,
        tools_sales,
    )

    _register_oauth_pages()
    return mcp.http_app(path="/")


PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource"


def well_known_routes() -> list[Route]:
    """Discovery documents, which must be served from the origin root.

    Clients look for `/.well-known/…` at the domain root, not under the mount
    prefix. Serving them from the wrong place is the quiet failure mode where a
    connector simply never authenticates.

    The bare `/.well-known/oauth-protected-resource` is added alongside the
    RFC 9728 path-aware form. The path-aware one is correct for a resource at
    `/mcp`, but clients differ on which they try first and an alias costs
    nothing next to a connector that silently refuses to log in.
    """
    routes = auth_provider.get_well_known_routes(mcp_path="/")

    paths = {route.path for route in routes}
    if PROTECTED_RESOURCE_PATH not in paths:
        for route in routes:
            if route.path.startswith(PROTECTED_RESOURCE_PATH):
                routes.append(
                    Route(
                        PROTECTED_RESOURCE_PATH,
                        endpoint=route.endpoint,
                        methods=route.methods,
                    )
                )
                break

    return routes
