# Sellary MCP Server — Design

Date: 2026-07-27
Status: approved (owner delegated design decisions)
Scope: an MCP server that lets Claude (and any MCP client) read every Sellary
report and record a batch purchase, over OAuth, with no copy-paste of tokens.

## Why

The owner of a shop does not want to open a dashboard to learn what happened
today. They want to ask. Two jobs came out of that:

1. **Reports.** Turnover, profit and loss, shifts, purchases, stock, money
   accounts — everything the reports module already computes, reachable
   conversationally.
2. **Batch purchase (zakupka).** A delivery arrives with twenty lines. Some of
   those products are not in the catalogue yet. Today that is twenty manual
   forms. The owner wants to dictate the delivery once, see exactly what will
   happen, approve it once, and have it recorded.

Both are served by one MCP server. Reports are read-only. The purchase is the
only write, and it is deliberately two-phase so the approval is real.

## Non-goals

- No sale creation. The register is a physical workflow with a shift, a till and
  a customer standing there; it does not belong in a chat window.
- No returns, no voids, no cancellations. Those reverse money and must stay in
  the hands of a manager looking at the actual record.
- No customer or user administration.
- No expiry/lot modelling. That is a separate, larger piece of work
  (`2026-05-21-sellary-retail-flow-review.md`, section 8) and the MCP server
  does not depend on it.

## Architecture

### One process, not two

The MCP server is mounted **inside the existing FastAPI backend** as an ASGI
sub-application at `/mcp`, using FastMCP 3.x `http_app()`.

```
sellary-backend/
  main.py                 # mounts mcp_app at /mcp, adopts its lifespan
  mcp_server/
    __init__.py
    server.py             # FastMCP instance, mounts tool modules
    context.py            # token -> AuthContext, module checks, DB session
    periods.py            # "this_month" -> (start, end) on company timezone
    tools_reports.py      # read-only report tools
    tools_catalog.py      # product/supplier lookup tools
    tools_purchase.py     # purchase_preview / purchase_commit
    drafts.py             # signed purchase-draft tokens
    oauth/
      provider.py         # SellaryOAuthProvider(OAuthProvider)
      store.py            # DB-backed client/code/refresh storage
      routes.py           # login + company-select + consent HTML
      templates.py        # server-rendered pages (no JS framework)
  models/oauth.py         # OAuthClient, OAuthAuthCode, OAuthRefreshToken
```

The alternative — a separate MCP process calling the REST API over HTTP — was
rejected. It doubles the deploy, doubles the latency, and forces a second copy
of the auth logic. In-process, the tools call the same `services/` layer the
routers call, with the same `company_id` scoping, so tenant isolation is
inherited rather than reimplemented.

Layering is respected: **tools call services, never repositories or models
directly.** A tool is the MCP equivalent of a router — a thin adapter.

### Request path

```
Claude ──HTTP──> /mcp (streamable HTTP)
                   │
                   ├─ verify_token: decode JWT -> AccessToken(claims)
                   │
                   └─ tool fn
                        ├─ mcp_context(): opens SessionLocal, rebuilds
                        │                 AuthContext, checks module grant
                        ├─ Service(db, company_id).method(...)
                        └─ returns plain dict/list (JSON-serialisable)
```

Each tool call gets its own `SessionLocal()`, committed on success and rolled
back on failure, then closed. No session is shared between calls.

## Authentication

### The shape of it

Sellary's MCP server is both the OAuth **Authorization Server** and the
**Resource Server**. This is permitted by the MCP spec and is the right call
here: the user store, the company memberships and the module grants all already
live in this database. Delegating to an external identity provider would mean
mirroring all of that.

FastMCP's `OAuthProvider` base class supplies the protocol surface — metadata
documents, `/register`, `/authorize`, `/token`, `/revoke`, PKCE enforcement, the
`WWW-Authenticate` challenge on 401. We implement storage and the human step.

Endpoints published (all under the backend's public origin,
`https://sellary-production-30ec.up.railway.app`):

| Path | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | RS metadata, points at the AS |
| `/.well-known/oauth-authorization-server` | AS metadata |
| `/mcp/oauth/register` | Dynamic Client Registration (RFC 7591) |
| `/mcp/oauth/authorize` | starts the human flow |
| `/mcp/oauth/token` | code → tokens, refresh → tokens |
| `/mcp/oauth/revoke` | revocation |
| `/mcp` | the MCP endpoint itself |

Dynamic Client Registration is **enabled**. That is what makes "paste the URL,
press Connect" work — the client registers itself. Without it the owner would
have to hand-create a client id, which defeats the point.

PKCE with S256 is required. No implicit grant, no password grant.

### The human step

`authorize()` cannot answer on its own: it does not know who the human is, and
in Sellary knowing the human is not enough — a user may belong to several
companies, and a token is meaningless until a company is chosen.

So `authorize()` stores the incoming `AuthorizationParams` under a random
transaction id (15-minute TTL) and redirects the browser to our own page:

```
/mcp/oauth/authorize          (FastMCP route)
      │ stores txn, redirects
      ▼
/mcp/oauth/login?txn=…        POST username + password
      │  -> AuthService.authenticate_user
      ▼
/mcp/oauth/company?txn=…      POST company_id  (skipped if exactly one)
      │  -> membership must be active, company must be active
      ▼
/mcp/oauth/consent?txn=…      shows client name + what access is granted
      │  POST approve
      ▼
redirect_uri?code=…&state=…
```

Three separate pages rather than one, because the company choice must happen
after authentication (we cannot list a user's companies before we know who they
are) and consent must show the company that was actually chosen. The pages are
server-rendered HTML in Russian, matching the rest of the product's UI language.
No JS framework — these are three forms.

Login failures are rate-limited per transaction (5 attempts, then the
transaction is destroyed) so the authorize endpoint cannot be used as a password
oracle.

### Tokens

The access token issued is **the existing company-scoped Sellary JWT**, with two
extra claims:

```json
{
  "sub": "alisher", "user_id": 7, "company_id": 3, "role": "admin",
  "global_role": "user", "ses": 1769500000,
  "token_type": "access",
  "mcp": true,
  "scopes": ["sellary:reports", "sellary:purchasing"]
}
```

Reusing the format means `verify_token` is a thin wrapper over
`decode_access_token`, and the AuthContext rebuild inside a tool is the same
membership lookup `get_auth_context` already performs. One auth model, not two.

The `mcp: true` claim is checked by the MCP layer and by nothing else, so an MCP
token is accepted at `/mcp` and — because the REST routers do not check it —
also at `/api/*`. That is intentional and safe: the token carries exactly the
same authority as a normal login by the same user in the same company, no more.
The reverse is blocked: a normal session token has no `mcp` claim and is
rejected at `/mcp`.

Lifetimes: access token 24 hours (shorter than the 7-day web session, because a
connector token sits in a third party's storage), refresh token 60 days,
sliding. Authorization codes live 60 seconds and are single-use — consumed by
deletion inside the same transaction that issues the tokens.

### Scopes

Two scopes, mapped onto the module system rather than invented alongside it:

- `sellary:reports` — every read-only tool
- `sellary:purchasing` — the purchase preview/commit pair

Both are requested by default. A scope is necessary but not sufficient: the tool
still checks the company's module set and the membership's grant through the
same rules `require_module()` applies. A cashier with no `reports` grant gets
nothing from `get_profit_report`, whatever their token says.

### Storage

Three tables, one migration:

- `oauth_clients` — `client_id` (PK), `client_secret_hash`, `client_name`,
  `redirect_uris` (JSON), `grant_types`, `scopes`, `created_at`. Written by DCR.
- `oauth_auth_codes` — `code` (PK), `client_id`, `user_id`, `company_id`,
  `redirect_uri`, `code_challenge`, `scopes`, `resource`, `expires_at`.
  Deleted on use.
- `oauth_refresh_tokens` — `token_hash` (PK), `client_id`, `user_id`,
  `company_id`, `scopes`, `expires_at`, `revoked_at`.

Secrets and refresh tokens are stored hashed (SHA-256; these are
high-entropy random strings, not passwords, so a KDF buys nothing). Authorization
codes are stored in the clear because they live 60 seconds and are deleted on
first use.

Pending authorize transactions are **not** a table — they are signed, encrypted
cookies plus a signed `txn` parameter, 15-minute TTL. They carry no long-lived
authority and adding a fourth table for something that expires in a quarter hour
is not worth the migration.

## Tool catalogue

Seventeen tools. Names are verbs from the caller's point of view; descriptions
are written for a model choosing between them, not for a developer.

### Time periods

Every report tool takes a `period` string rather than raw dates, because date
arithmetic is where models make silent mistakes:

`today | yesterday | this_week | last_week | this_month | last_month |
last_7_days | last_30_days | last_90_days | this_year | custom`

`custom` requires `start_date` and `end_date` (ISO dates). All boundaries are
resolved on `companies.timezone` through `ReportService.local_day_bounds`, so
"today" ends when the shop's day ends, not when UTC rolls over. Every response
echoes the resolved range and the timezone used, so the model can state the
period it actually reported on.

### Reports (module `reports`)

| Tool | Returns |
|---|---|
| `get_dashboard` | today's turnover, sales count, average check, low-stock count |
| `get_sales_summary` | turnover, sale count, average check, payment-method split |
| `get_daily_sales` | per-day revenue and count series |
| `get_profit_report` | revenue, COGS, gross profit, margin percent |
| `get_top_products` | best sellers by revenue with quantity and profit |

### Purchasing (module `purchasing`)

| Tool | Returns |
|---|---|
| `get_purchase_summary` | spend and delivery count for the period |
| `get_purchases_by_supplier` | spend per supplier |
| `get_purchases_by_product` | spend per product, dearest first |
| `get_outstanding_orders` | sent but not fully received |
| `list_suppliers` | supplier lookup by name |

### Register (module `register`)

| Tool | Returns |
|---|---|
| `get_current_shift` | the open shift with live totals, or null |
| `list_shifts` | closed shifts with totals, counted cash, discrepancy |

### Inventory (module `inventory`)

| Tool | Returns |
|---|---|
| `search_products` | name/barcode search with stock, cost, sell price |
| `get_low_stock` | products at or below their minimum level |

### Finance (module `finance`)

| Tool | Returns |
|---|---|
| `get_money_accounts` | account balances and the period's movements |

### Purchase recording (module `purchasing`, manager level)

| Tool | Effect |
|---|---|
| `purchase_preview` | resolves a delivery against the catalogue; writes nothing |
| `purchase_commit` | creates missing products, the order, and the receipt |

## The purchase flow

This is the only place the MCP server writes, so its shape matters more than the
rest of the design put together.

### Two phases, one approval

```
purchase_preview(supplier, items[])
        │
        │  no writes. Resolves every line. Returns a plan and a draft_token.
        ▼
  Claude shows the plan to the owner in plain language
        │
        │  owner says "ha"
        ▼
purchase_commit(draft_token)
        │
        │  executes exactly the plan that was previewed. Nothing else.
        ▼
  order created, goods received, stock and money moved
```

The `draft_token` is what makes the approval meaningful. It is a JWT signed with
`SECRET_KEY`, 15-minute TTL, carrying `company_id`, `user_id`, and the fully
resolved plan. `purchase_commit` takes no line items of its own — it can only
execute what is inside the token. So the thing the owner approved and the thing
that gets written are the same thing by construction, not by the model's good
behaviour.

### Line resolution

Each input line is `{query, quantity, unit_cost, sell_price?, uom?, barcode?}`.
`query` is whatever the owner said — a name, a barcode, anything.

Resolution order, first match wins:

1. exact barcode match
2. exact name match, case-insensitive
3. fuzzy name match with `rapidfuzz.token_set_ratio >= 88` (already a dependency)

Each line comes back as one of:

- **`matched`** — one product, high confidence. Shows the current cost so a
  changed purchase price is visible.
- **`ambiguous`** — several candidates above threshold. Listed with ids; the
  model must re-run the preview with an explicit `product_id`. A commit with an
  ambiguous line is refused.
- **`new`** — nothing matched. The preview shows the product that *would* be
  created: name, uom, cost price, sell price, category.

For a `new` line the sell price is taken from `sell_price` if given. If it is
not, it is derived as `cost * (1 + markup)` with a default markup of 30 percent,
and the line is flagged `sell_price_guessed: true`. The preview labels these
explicitly so the owner is choosing to accept a guess rather than discovering
one later. A commit where any line has a guessed sell price is allowed — the
owner saw it — but the flag is repeated in the commit result.

### Warnings, not silent behaviour

The preview surfaces, per line and in aggregate:

- purchase price differs from the product's current cost by more than 20 percent
- duplicate lines for the same resolved product (they are merged, and the merge
  is reported)
- unit cost of zero
- total value of the delivery

Nothing is silently corrected. Anything the preview did to the input is stated.

### Commit

`purchase_commit(draft_token, mode)` where `mode` is:

- `receive` (default) — create the order, send it, receive it in full. The goods
  are in the building; this is the normal case.
- `draft` — create the order only, leave it in `draft` for someone to receive
  later.

Order of operations inside one transaction:

1. Create every `new` product via `ProductService.create` with
   `stock_quantity = 0`. Stock arrives through the receipt, never through a
   direct write — the FIFO ledger has to see it.
2. Create the purchase order via `PurchaseOrderService.create`.
3. If `mode == "receive"`: `send()` then `receive_items()` for the full ordered
   quantity, which runs the FIFO ledger, updates weighted-average cost and
   writes the inventory log.

Idempotency uses the existing `idempotency_keys` table with
`key = "mcp-po-" + sha256(draft_token)[:32]` and
`endpoint = "mcp:purchase_commit"`. A retried commit — a dropped connection, an
over-eager client, the owner saying "ha" twice — returns the original result and
creates nothing. This is the same mechanism `/api/purchase-orders/{id}/receive`
already relies on.

Permission: `purchasing` at `manager` level, matching the REST receive endpoint.
Preview needs only `purchasing` at `user` level — looking is not buying.

## Errors

Tool errors are returned as `ToolError` with a message written for a human, in
Russian, because the model will read it aloud to the owner. An error says what
went wrong and what to do:

- module not enabled for the company → "Модуль «Закупки» не подключён для этой
  компании."
- membership grant missing → "У вас нет доступа к отчётам. Обратитесь к
  администратору."
- expired draft → "Черновик закупки устарел. Проверьте список заново."
- ambiguous line → names the candidates.

Stack traces and SQL never reach the model. Unexpected exceptions are logged
server-side and surface as a generic failure.

## Testing

- **Unit** — period resolution across timezones and month boundaries; line
  resolution (exact, fuzzy, ambiguous, new); draft token round-trip, expiry, and
  cross-company rejection; scope-to-module mapping.
- **Integration** — full OAuth dance against the test app (register → authorize →
  login → company → consent → code → token → refresh); a token for company A
  cannot read company B's numbers; each report tool against seeded data; the
  purchase preview/commit pair, including double-commit returning the identical
  order and creating nothing the second time.
- The existing CI gate (`python -m compileall …`) must stay green, and the
  starlette upgrade that `fastmcp` pulls in must not break the existing suite.

## Deployment

`fastmcp>=3.4,<4` is added to `requirements.txt`; the root `Dockerfile` needs no
change. The Alembic revision for the three OAuth tables is pinned in
`railway.toml`'s `preDeployCommand` — that file names an explicit revision
rather than `head` because two heads exist in this repository.

The connector URL the owner pastes into Claude is:

```
https://sellary-production-30ec.up.railway.app/mcp
```

Verification after deploy: `/health` still answers, the two well-known documents
return valid JSON, an unauthenticated `POST /mcp` returns 401 carrying a
`WWW-Authenticate` header with `resource_metadata`, and a real connect from
claude.ai completes the login → company → consent flow and lists seventeen
tools.
