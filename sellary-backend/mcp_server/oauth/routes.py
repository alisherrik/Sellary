"""The human half of the authorization flow: login, company, consent.

`/authorize` cannot answer on its own. It does not know who is asking, and in
Sellary knowing the person is still not enough — a user may belong to several
companies and a token means nothing until one is chosen. So the OAuth endpoint
parks the request and these three pages resolve it.

Order matters and is not cosmetic. The company list cannot be shown before
authentication, and consent must name the company that was actually picked —
otherwise the user approves one thing and receives another.
"""

import logging
from urllib.parse import urlencode

from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from core.database import SessionLocal
from mcp_server.oauth import store, templates
from mcp_server.oauth.transaction import (
    TransactionError,
    decode_txn,
    register_failed_attempt,
    with_values,
)
from services.auth_service import AuthService

logger = logging.getLogger(__name__)


def _error(message: str, status: int = 400) -> HTMLResponse:
    return HTMLResponse(templates.render_error(message), status_code=status)


def _companies_for(db, user_id: int) -> list[dict]:
    return [
        {"id": company.id, "name": company.name}
        for company in AuthService(db).get_companies_for_user(user_id)
    ]


def _redirect_target_is_registered(txn_payload: dict) -> bool:
    """Re-check the redirect against the client's registration.

    The MCP SDK already validated it before `authorize()` ran, and the value
    travels inside a JWT we signed, so this cannot normally be subverted. It is
    re-checked anyway because a registration can change between authorize and
    consent, and because an open redirect should be prevented here rather than
    inherited from a library three layers away.
    """
    client = store.get_client(txn_payload.get("client_id", ""))
    if client is None:
        return False
    return txn_payload.get("redirect_uri") in client.redirect_uris


def _redirect_with(txn_payload: dict, **params: str) -> RedirectResponse:
    """Hand control back to the client's redirect_uri."""
    query = {key: value for key, value in params.items() if value is not None}
    state = txn_payload.get("state")
    if state:
        query["state"] = state
    separator = "&" if "?" in txn_payload["redirect_uri"] else "?"
    return RedirectResponse(
        f"{txn_payload['redirect_uri']}{separator}{urlencode(query)}", status_code=302
    )


# ------------------------------------------------------------------- login


async def login_page(request: Request) -> Response:
    try:
        payload = decode_txn(request.query_params.get("txn"))
    except TransactionError as exc:
        return _error(str(exc))
    return HTMLResponse(
        templates.render_login(
            request.query_params["txn"], payload.get("client_name", "")
        )
    )


async def login_submit(request: Request) -> Response:
    form = await request.form()
    raw_txn = str(form.get("txn") or "")
    try:
        payload = decode_txn(raw_txn)
    except TransactionError as exc:
        return _error(str(exc))

    username = str(form.get("username") or "").strip()
    password = str(form.get("password") or "")

    db = SessionLocal()
    try:
        user = AuthService(db).authenticate(username, password)
        if user is None:
            try:
                next_txn = register_failed_attempt(payload)
            except TransactionError as exc:
                return _error(str(exc), status=429)
            return HTMLResponse(
                templates.render_login(
                    next_txn,
                    payload.get("client_name", ""),
                    error="Неверный логин или пароль.",
                ),
                status_code=401,
            )

        companies = _companies_for(db, user.id)
        if not companies:
            return _error("У этого пользователя нет доступа ни к одной компании.", 403)

        next_txn = with_values(
            payload, user_id=user.id, user_label=user.full_name or user.username
        )
        # One company is not a choice, so do not stage a page that asks for it.
        if len(companies) == 1:
            next_txn = with_values(
                decode_txn(next_txn),
                company_id=companies[0]["id"],
                company_name=companies[0]["name"],
            )
            return RedirectResponse(f"/mcp/oauth/consent?txn={next_txn}", status_code=303)

        return RedirectResponse(f"/mcp/oauth/company?txn={next_txn}", status_code=303)
    finally:
        db.close()


# ----------------------------------------------------------------- company


async def company_page(request: Request) -> Response:
    try:
        payload = decode_txn(request.query_params.get("txn"))
    except TransactionError as exc:
        return _error(str(exc))
    if not payload.get("user_id"):
        return _error("Сначала выполните вход.", 400)

    db = SessionLocal()
    try:
        companies = _companies_for(db, payload["user_id"])
    finally:
        db.close()

    return HTMLResponse(
        templates.render_company(request.query_params["txn"], companies)
    )


async def company_submit(request: Request) -> Response:
    form = await request.form()
    try:
        payload = decode_txn(str(form.get("txn") or ""))
    except TransactionError as exc:
        return _error(str(exc))
    if not payload.get("user_id"):
        return _error("Сначала выполните вход.", 400)

    try:
        company_id = int(str(form.get("company_id") or ""))
    except ValueError:
        return _error("Компания не выбрана.", 400)

    db = SessionLocal()
    try:
        companies = _companies_for(db, payload["user_id"])
    finally:
        db.close()

    # Re-check against the user's own list: the form value is client-controlled
    # and must never be trusted to name a company they do not belong to.
    chosen = next((c for c in companies if c["id"] == company_id), None)
    if chosen is None:
        return _error("У вас нет доступа к этой компании.", 403)

    next_txn = with_values(
        payload, company_id=chosen["id"], company_name=chosen["name"]
    )
    return RedirectResponse(f"/mcp/oauth/consent?txn={next_txn}", status_code=303)


# ----------------------------------------------------------------- consent


async def consent_page(request: Request) -> Response:
    try:
        payload = decode_txn(request.query_params.get("txn"))
    except TransactionError as exc:
        return _error(str(exc))
    if not payload.get("user_id") or not payload.get("company_id"):
        return _error("Сессия авторизации неполная. Начните заново.", 400)

    return HTMLResponse(
        templates.render_consent(
            request.query_params["txn"],
            payload.get("client_name", ""),
            payload.get("company_name", ""),
            payload.get("user_label", ""),
            list(payload.get("scopes") or []),
        )
    )


async def consent_submit(request: Request) -> Response:
    form = await request.form()
    try:
        payload = decode_txn(str(form.get("txn") or ""))
    except TransactionError as exc:
        return _error(str(exc))
    if not payload.get("user_id") or not payload.get("company_id"):
        return _error("Сессия авторизации неполная. Начните заново.", 400)

    if not _redirect_target_is_registered(payload):
        return _error(
            "Адрес возврата приложения больше не зарегистрирован. "
            "Начните подключение заново.",
            400,
        )

    if str(form.get("decision")) != "approve":
        return _redirect_with(payload, error="access_denied")

    code = store.new_token()
    store.save_auth_code(
        code,
        store.GrantRecord(
            client_id=payload["client_id"],
            user_id=payload["user_id"],
            company_id=payload["company_id"],
            scopes=list(payload.get("scopes") or []),
            redirect_uri=payload["redirect_uri"],
            redirect_uri_provided_explicitly=bool(
                payload.get("redirect_uri_provided_explicitly", True)
            ),
            code_challenge=payload.get("code_challenge"),
            resource=payload.get("resource"),
        ),
    )
    logger.info(
        "MCP authorization granted: user=%s company=%s client=%s",
        payload["user_id"],
        payload["company_id"],
        payload["client_id"],
    )
    return _redirect_with(payload, code=code)


ROUTES = [
    ("/oauth/login", login_page, ["GET"]),
    ("/oauth/login", login_submit, ["POST"]),
    ("/oauth/company", company_page, ["GET"]),
    ("/oauth/company", company_submit, ["POST"]),
    ("/oauth/consent", consent_page, ["GET"]),
    ("/oauth/consent", consent_submit, ["POST"]),
]
