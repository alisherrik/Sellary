# Sellary MCP Server — Implementation Plan

Spec: `docs/superpowers/specs/2026-07-27-sellary-mcp-server-design.md`
Date: 2026-07-27
Target: `sellary-backend/`, deployed to Railway with the existing backend service.

All commands run from `sellary-backend/` with the venv active
(`.venv\Scripts\python.exe` on Windows).

---

## Phase 0 — Dependency

**0.1** Add `fastmcp>=3.4,<4` to `requirements.txt`, below `cryptography`.

**0.2** Install and confirm nothing broke. `fastmcp` upgrades `starlette`
(1.0.0 → 1.3.x); FastAPI is compatible but the suite must prove it.

```
.venv\Scripts\pip.exe install -r requirements.txt
.venv\Scripts\python.exe -m compileall api core models repositories schemas services main.py
.venv\Scripts\pytest.exe tests/unit -q
```

Gate: compileall clean, unit suite no worse than before the install.

---

## Phase 1 — OAuth storage

**1.1** `models/oauth.py` — three models, all standard SQLAlchemy, no company
scoping on `oauth_clients` (a client is global; the company lives on the grant).

```python
class OAuthClient(Base):
    __tablename__ = "oauth_clients"
    client_id: str, primary key
    client_secret_hash: str | None      # None for public clients
    client_name: str | None
    redirect_uris: JSON (list[str])
    grant_types: JSON (list[str])
    response_types: JSON (list[str])
    scope: str | None
    token_endpoint_auth_method: str
    created_at: datetime

class OAuthAuthCode(Base):
    __tablename__ = "oauth_auth_codes"
    code: str, primary key
    client_id, user_id, company_id
    redirect_uri: str
    redirect_uri_provided_explicitly: bool
    code_challenge: str
    scopes: JSON (list[str])
    resource: str | None
    expires_at: datetime
    created_at: datetime

class OAuthRefreshToken(Base):
    __tablename__ = "oauth_refresh_tokens"
    token_hash: str, primary key
    client_id, user_id, company_id
    scopes: JSON (list[str])
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime
```

Index `oauth_refresh_tokens.user_id` and `oauth_auth_codes.expires_at`.

**1.2** Register the models in `models/__init__.py` so `Base.metadata` sees them.

**1.3** Alembic revision `20260727_1000-e2f3a4b5c6d7_add_oauth_tables.py`, with
`down_revision = "d1e2f3a4b5c6"` (the money-accounts head — the one
`railway.toml` currently pins). Plain `create_table` ×3, `drop_table` ×3 in
downgrade. No enums — the two Postgres enum traps that bit the money-accounts
migration do not apply here, and this keeps it that way.

**1.4** Update `railway.toml`: `preDeployCommand = "alembic upgrade e2f3a4b5c6d7"`.

Gate: `alembic upgrade head` then `alembic downgrade -1` then `upgrade` again,
clean, against a local Postgres.

---

## Phase 2 — OAuth provider

**2.1** `mcp_server/oauth/store.py` — a thin data layer over the three tables.
Opens its own `SessionLocal()` per call and closes it; the provider is called
from async context but the ORM is sync, so every store method is a plain
function wrapped by the provider.

```python
def get_client(client_id) -> OAuthClient | None
def save_client(info) -> None
def save_auth_code(code, *, client_id, user_id, company_id, ...) -> None
def take_auth_code(code) -> row | None      # SELECT then DELETE, one transaction
def save_refresh_token(token, *, ...) -> None
def take_refresh_token(token) -> row | None # rotation: consume and reissue
def revoke_refresh_token(token) -> None
def purge_expired() -> int
```

`take_auth_code` and `take_refresh_token` delete inside the same transaction as
the read. That single-use property is the whole security value of the code.

**2.2** `mcp_server/oauth/provider.py` — `SellaryOAuthProvider(OAuthProvider)`.

- `__init__`: `base_url` from `settings.MCP_PUBLIC_BASE_URL`,
  `client_registration_options=ClientRegistrationOptions(enabled=True,
  valid_scopes=SCOPES, default_scopes=SCOPES)`,
  `revocation_options=RevocationOptions(enabled=True)`,
  `required_scopes=[]`.
- `register_client` / `get_client` → store.
- `authorize(client, params)` → mint a signed `txn` JWT carrying the params,
  return `f"{base}/mcp/oauth/login?txn={txn}"`.
- `load_authorization_code` → store lookup, expiry check, client match.
- `exchange_authorization_code` → consume the code, mint the Sellary JWT via
  `create_access_token` with `mcp=True` and the scopes, mint a refresh token,
  return `OAuthToken`.
- `load_refresh_token` / `exchange_refresh_token` → rotate: consume the old
  refresh token, issue a new pair.
- `verify_token(token)` → `decode_access_token`; reject unless
  `token_type == "access"` and `claims.get("mcp") is True`; return `AccessToken`
  with the full claims dict attached.
- `revoke_token` → store.

**2.3** `mcp_server/oauth/routes.py` — three Starlette routes plus their POST
handlers, added to the mounted app as custom routes.

- `GET/POST /mcp/oauth/login` — username + password form. On POST,
  `AuthService(db).authenticate_user(...)`. Attempt counter inside the `txn`
  JWT; 5 failures invalidates it.
- `GET/POST /mcp/oauth/company` — lists the user's active companies. Auto-skips
  to consent when there is exactly one.
- `GET/POST /mcp/oauth/consent` — shows client name, company name, and the two
  scopes in plain Russian. On approve, `store.save_auth_code(...)` and redirect
  to `redirect_uri?code=…&state=…`.

The `txn` JWT accumulates state across the three steps (`user_id` after login,
`company_id` after company). It is signed with `SECRET_KEY` and expires in 15
minutes. Re-signing at each step is what carries state forward — no server-side
session.

**2.4** `mcp_server/oauth/templates.py` — three `render_*` functions returning
HTML strings. Inline CSS, no assets, no JS. Russian labels. A shared shell with
the Sellary name and an error slot.

Gate: unit tests for `verify_token` (rejects a normal session token, accepts an
MCP token, rejects expired), and for auth-code single use.

---

## Phase 3 — MCP core

**3.1** `mcp_server/context.py`

```python
@dataclass
class McpAuth:
    user: User
    company: Company
    membership: CompanyMembership | None
    role: str
    scopes: list[str]
    company_id: int

@contextmanager
def mcp_session() -> Iterator[tuple[Session, McpAuth]]:
    """Open a DB session and resolve the caller from the MCP access token."""
```

Resolution mirrors `api/dependencies.get_auth_context`: membership lookup by
`(user_id, company_id, is_active)`, company active check, user active check.
The super-admin company-entry branch is **not** carried over — an MCP connector
is a normal user session, and a global admin backdoor over a chat interface is
not something anyone asked for.

```python
def require_module(auth, db, module: str, level: str = "user") -> None
```

Same two-layer check as `api/dependencies.require_module`: company module set
first (admins do not bypass it), then the membership grant. Raises `ToolError`
with a Russian message.

**3.2** `mcp_server/periods.py`

```python
PERIODS = ("today", "yesterday", "this_week", "last_week", "this_month",
           "last_month", "last_7_days", "last_30_days", "last_90_days",
           "this_year", "custom")

def resolve_period(service, period, start_date=None, end_date=None
                   ) -> tuple[datetime, datetime, dict]
```

Boundaries come from `ReportService.local_day_bounds`, which already anchors on
`companies.timezone`. The third element is the echo block every tool includes:
`{"period", "start", "end", "timezone"}`.

Weeks start Monday. `this_week` runs Monday to today, `last_week` is the full
previous Monday–Sunday.

**3.3** `mcp_server/server.py` — the FastMCP instance, the provider wired in as
`auth`, tool modules imported for their registration side effects, plus a
`build_mcp_app()` returning `mcp.http_app(path="/")`.

**3.4** `main.py` — mount it.

```python
mcp_app = build_mcp_app()
app = FastAPI(..., lifespan=_combined_lifespan(mcp_app))
app.mount("/mcp", mcp_app)
```

The existing lifespan (`ensure_customer_credit_schema`, `ensure_super_admin`)
must run *and* the MCP session manager must start. Wrap both in one
`asynccontextmanager` rather than replacing ours with theirs — dropping
`ensure_super_admin` would break bootstrap.

The two well-known routes must be served from the **root** app, not from under
`/mcp`, because that is where clients look. `provider.get_well_known_routes()`
supplies them; add each to the root app.

Gate: `python main.py` starts; `GET /health` and both well-known documents
answer; `POST /mcp` without a token returns 401 with `WWW-Authenticate`.

---

## Phase 4 — Report tools

**4.1** `mcp_server/tools_reports.py` — twelve tools. Each follows one shape:

```python
@mcp.tool
def get_profit_report(period: str = "this_month",
                      start_date: str | None = None,
                      end_date: str | None = None) -> dict:
    """Прибыль и себестоимость за период: выручка, COGS, валовая прибыль, маржа."""
    with mcp_session() as (db, auth):
        require_module(auth, db, "reports")
        service = ReportService(db, auth.company_id)
        start, end, echo = resolve_period(service, period, start_date, end_date)
        report = service.get_profit_report(start, end)
        return {**echo, **_money(report)}
```

Docstrings are the tool description the model reads, so they are written in the
owner's language and say what the number *means*, not which service produced it.

Tools and their sources:

| Tool | Module | Service call |
|---|---|---|
| `get_dashboard` | reports | `ReportService.get_dashboard_widgets()` |
| `get_sales_summary` | reports | `SaleService.get_summary(start, end)` |
| `get_daily_sales` | reports | `ReportService.get_daily_sales` |
| `get_profit_report` | reports | `ReportService.get_profit_report` |
| `get_top_products` | reports | `ReportService.get_top_products` |
| `get_purchase_summary` | purchasing | `PurchaseReportService.summary` |
| `get_purchases_by_supplier` | purchasing | `PurchaseReportService.by_supplier` |
| `get_purchases_by_product` | purchasing | `PurchaseReportService.by_product` |
| `get_outstanding_orders` | purchasing | `PurchaseReportService.outstanding` |
| `get_current_shift` | register | `CashShiftService.get_current` + `totals_for` |
| `list_shifts` | register | shift query + `totals_for`, period-filtered |
| `get_money_accounts` | finance | `MoneyService` overview |

**4.2** `mcp_server/tools_catalog.py` — three tools:

| Tool | Module | Service call |
|---|---|---|
| `search_products` | inventory | `ProductService.search` |
| `get_low_stock` | inventory | `ProductService.get_low_stock` |
| `list_suppliers` | purchasing | `SupplierService.get_all` |

**4.3** Serialisation helper. `Decimal` is not JSON-serialisable and money must
not become a float. One `_json_safe()` walks the structure and renders `Decimal`
as a string with the right scale — money 2dp, quantities 3dp, unit prices 4dp,
per the project's existing precision rule. Datetimes become ISO strings.

Gate: integration test per tool against seeded data; a token scoped to company A
returns nothing belonging to company B.

---

## Phase 5 — Purchase tools

**5.1** `mcp_server/drafts.py`

```python
def issue_draft(company_id, user_id, plan: dict) -> str   # JWT, 15 min
def read_draft(token, company_id, user_id) -> dict        # raises ToolError
```

`read_draft` re-checks `company_id` and `user_id` against the caller, so a token
leaked between tenants is inert.

**5.2** `mcp_server/purchase_resolve.py` — pure resolution logic, no writes, so
it can be unit-tested without a purchase order in sight.

```python
@dataclass
class ResolvedLine:
    status: Literal["matched", "ambiguous", "new"]
    query: str
    product_id: int | None
    product_name: str
    quantity: Decimal
    unit_cost: Decimal
    sell_price: Decimal | None
    sell_price_guessed: bool
    uom: str
    candidates: list[dict]      # ambiguous only
    warnings: list[str]

def resolve_lines(db, company_id, items, *, markup=Decimal("0.30")
                  ) -> tuple[list[ResolvedLine], list[str]]
```

Matching order: barcode exact → name exact (case-insensitive) → `rapidfuzz`
`token_set_ratio >= 88`. Several candidates at or above threshold →
`ambiguous`, listed with ids. Duplicate lines resolving to the same product are
merged, quantity summed, cost weighted-averaged, and the merge reported as a
warning.

Per-line warnings: cost differs from the product's current cost by more than
20 percent; unit cost is zero.

**5.3** `mcp_server/tools_purchase.py`

```python
@mcp.tool
def purchase_preview(supplier: str, items: list[dict],
                     markup_percent: float = 30.0) -> dict
```

Requires `purchasing` at `user`. Resolves the supplier by exact then fuzzy name;
an unknown supplier is an error listing the known ones — suppliers are not
created implicitly, because a supplier is a relationship with payment terms, not
a label. Returns the resolved lines, the totals, the warnings, and
`draft_token`.

```python
@mcp.tool
def purchase_commit(draft_token: str, mode: str = "receive") -> dict
```

Requires `purchasing` at `manager`. Reads the draft; refuses if any line is
`ambiguous`. Then, in one transaction:

1. `ProductService.create` for every `new` line, `stock_quantity=0`.
2. `PurchaseOrderService.create(PurchaseOrderCreate(...))`.
3. If `mode == "receive"`: `send(po_id)`, then `receive_items(po_id,
   ReceiveItemsRequest(items=[{"item_id", "quantity_to_receive"}...]),
   user_id)`.

Wrapped in `IdempotencyService` with
`key = "mcp-po-" + sha256(draft_token).hexdigest()[:32]` and
`endpoint = "mcp:purchase_commit"`, so a repeated commit replays the first
result. Returns the order id, status, totals, created product ids, and any
warnings carried from the preview.

Gate: unit tests for resolution (all four outcomes, merge, warnings); integration
test that a commit creates the products, the order and the stock, and that a
second commit with the same token creates nothing and returns the same order id.

---

## Phase 6 — Tests, docs, deploy

**6.1** Tests

- `tests/unit/test_mcp_periods.py` — every period across a non-UTC company
  timezone; month and year boundaries; `custom` validation.
- `tests/unit/test_mcp_drafts.py` — round-trip, expiry, wrong company, wrong
  user, tampered payload.
- `tests/unit/test_mcp_purchase_resolve.py` — matched, ambiguous, new, merge,
  cost-drift warning, guessed sell price.
- `tests/unit/test_mcp_oauth_tokens.py` — `verify_token` accepts MCP tokens and
  rejects session tokens; auth code is single-use.
- `tests/integration/test_mcp_oauth_flow.py` — register → authorize → login →
  company → consent → code → token → refresh, against the test app.
- `tests/integration/test_mcp_tools.py` — each report tool against seeded data;
  cross-company isolation; purchase preview/commit including double commit.

Remember the project's test rule: `session.flush()`, never `session.commit()` —
isolation is by transaction rollback.

**6.2** Docs

- `DOCUMENTATION.md` — an MCP section: endpoint, how to connect, the tool table.
- `CLAUDE.md` and `AGENTS.md` — the `mcp_server/` package in the architecture
  section, kept consistent with each other.
- `docs/MCP_CONNECTOR_GUIDE.md` — Russian, for the owner: paste the URL into
  Claude, log in, pick the company, approve; what to ask it; what it will not do.

**6.3** Gates before commit

```
.venv\Scripts\python.exe -m compileall api core models repositories schemas services mcp_server main.py
.venv\Scripts\pytest.exe tests/unit tests/integration -q
```

**6.4** Deploy

Commit, push to `main`. Railway builds from the root `Dockerfile`, runs
`alembic upgrade e2f3a4b5c6d7`, restarts. Then verify against production:

- `GET /health` → healthy
- `GET /.well-known/oauth-protected-resource` → JSON naming the AS
- `GET /.well-known/oauth-authorization-server` → JSON with
  `registration_endpoint` and `code_challenge_methods_supported: ["S256"]`
- `POST /mcp` unauthenticated → 401 with `WWW-Authenticate: Bearer …
  resource_metadata=…`
- a real connect from claude.ai completes and lists seventeen tools

**6.5** Report to the owner: the connector URL, what to paste where, and the
first three questions worth asking it.

---

## Risks

**Starlette upgrade.** `fastmcp` moves starlette from 1.0.0 to 1.3.x under an
otherwise untouched FastAPI. Phase 0 runs the suite before a line of MCP code is
written, so if this breaks, it breaks alone and is diagnosable.

**Mount path and well-known paths.** Clients fetch
`/.well-known/oauth-protected-resource` from the origin root; the MCP app is
mounted at `/mcp`. Serving the metadata from the wrong place is the most likely
reason a connect fails silently. Phase 3's gate checks both documents from the
root before any tool exists.

**Sync ORM under async tools.** FastMCP tools may be sync functions; FastMCP runs
sync tools in a worker thread, so `SessionLocal()` per call is safe. Tools stay
sync deliberately — making them async would put a sync ORM inside an event loop.

**Two Alembic heads.** This repository has two; `railway.toml` pins an explicit
revision rather than `head` for exactly that reason. The new revision chains off
`d1e2f3a4b5c6` and the pin moves with it. Verify the chain locally before push.
