# MCP read parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the connector eyes on everything the owner can see in the web app — individual receipts, customer debts, money movements, stock movements, write-offs, purchase orders, shop orders, shifts, the consistency checker and the сверка archive — without adding a single new write.

**Architecture:** One new OAuth scope, `sellary:records`, for row-level reads; aggregates stay on `sellary:reports`. Eighteen tools split into six new modules by domain, each following the existing shape exactly: `mcp_session()` → `require_scope` → `require_module` → call the service → `json_safe`. A tool is the MCP equivalent of a router and holds no business logic.

**Tech Stack:** Python 3 / FastMCP 3.x / SQLAlchemy 2 / pytest.

**Spec:** `docs/superpowers/specs/2026-08-15-period-reports-and-mcp-parity-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-15-period-reports.md` (PR 2). Task 8 here calls `PeriodReportService`, which that plan creates. Everything else is independent.

Branch: `feat/mcp-read-parity`

---

## Before you start

Read `sellary-backend/mcp_server/tools_reports.py` end to end. It is the reference
implementation and every tool in this plan copies its shape. Four things to carry over
without thinking about them again:

- The docstring is what the model reads when choosing a tool, so it is written in Russian
  for the shopkeeper who will hear the answer. It says what the number *means*, never which
  service produced it.
- `json_safe` (`mcp_server/serialization.py`) renders Pydantic models, Decimals, enums and
  datetimes correctly, including per-field precision. Never call `float()` on money.
- Period arguments go through `resolve_period` (`mcp_server/periods.py`). Never do date
  arithmetic in a tool.
- `require_scope` then `require_module`. A scope is necessary and never sufficient.

**Environment.** Run everything from `sellary-backend/` with the venv active. On Windows:
`.venv\Scripts\python.exe`, `.venv\Scripts\pytest.exe`. Test isolation is transaction
rollback, so use `session.flush()`, never `session.commit()`.

## What must NOT be built

Ten capabilities are excluded on safety grounds and the spec explains each. If you find
yourself writing a tool that rings a sale, records a refund, voids anything, opens or
closes a shift, adjusts stock by a delta, runs a stocktake, corrects a money-account
balance, declares a сверка, edits memberships or passwords, or revokes an MCP agent —
stop. That is the spec being violated, not a gap you found.

`purchase_preview` / `purchase_commit` stay the only writes on this connector.

## File structure

| File | Responsibility |
|---|---|
| `mcp_server/__init__.py` | modify — declare `SCOPE_RECORDS` |
| `mcp_server/oauth/templates.py` | modify — the Russian consent label for it |
| `mcp_server/server.py` | modify — import the new tool modules |
| `mcp_server/tools_sales.py` | **new** — receipts and returns |
| `mcp_server/tools_customers.py` | **new** — customers and their debts |
| `mcp_server/tools_finance.py` | **new** — money movements |
| `mcp_server/tools_inventory.py` | **new** — stock movements, write-offs, valuation, categories, product list |
| `mcp_server/tools_purchasing.py` | **new** — purchase orders |
| `mcp_server/tools_admin.py` | **new** — shop orders, shifts, the checker, the сверка archive |
| `tests/integration/test_mcp_tools.py` | modify — scope and module enforcement per tool |
| `tests/integration/test_mcp_read_tools.py` | **new** — the behaviour of the 18 |

`tools_reports.py` is already 300 lines. Do not grow it.

---

### Task 1: The `sellary:records` scope

**Why:** Every existing read tool asks for `SCOPE_REPORTS`, whatever module it guards — so
that scope has come to mean "read". Hanging customer debts and individual receipts on it
would **silently widen every token already issued**: someone who consented to «Просмотр
отчётов» did not consent to an agent reading named customers' balances.

Per-module scopes were considered and rejected — nine scopes duplicate the module registry,
and `require_module` already enforces it on every call.

**Files:**
- Modify: `sellary-backend/mcp_server/__init__.py`
- Modify: `sellary-backend/mcp_server/oauth/templates.py:134-137`
- Test: `sellary-backend/tests/integration/test_mcp_oauth_flow.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_oauth_flow.py`:

```python
def test_the_records_scope_is_offered_and_labelled():
    """A new read capability must be consented to, not inherited."""
    from mcp_server import SCOPE_RECORDS, SCOPES
    from mcp_server.oauth.templates import render_consent

    assert SCOPE_RECORDS in SCOPES

    page = render_consent(
        txn="t",
        client_name="Claude",
        company_name="Магазин",
        user_label="Алишер",
        scopes=[SCOPE_RECORDS],
    )

    assert SCOPE_RECORDS not in page, "the raw scope leaked instead of its label"
    assert "чеки" in page
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_mcp_oauth_flow.py -k records -v`
Expected: FAIL — `ImportError: cannot import name 'SCOPE_RECORDS'`.

- [ ] **Step 3: Write the implementation**

Replace the body of `sellary-backend/mcp_server/__init__.py` below the docstring:

```python
SCOPE_REPORTS = "sellary:reports"
SCOPE_PURCHASING = "sellary:purchasing"
# Row-level reads — a receipt, a customer's debt, a movement — as opposed to the
# aggregates on SCOPE_REPORTS. Its own scope so that widening what the connector
# can read means asking again, rather than quietly upgrading tokens already issued.
SCOPE_RECORDS = "sellary:records"
SCOPES = [SCOPE_REPORTS, SCOPE_RECORDS, SCOPE_PURCHASING]

__all__ = ["SCOPES", "SCOPE_REPORTS", "SCOPE_RECORDS", "SCOPE_PURCHASING"]
```

In `sellary-backend/mcp_server/oauth/templates.py`, extend the `labels` map at line 134:

```python
    labels = {
        "sellary:reports": "Просмотр отчётов: продажи, прибыль, смены, склад, деньги",
        "sellary:records": "Просмотр записей: чеки, долги клиентов, движения денег и склада",
        "sellary:purchasing": "Оформление закупок: создание заказов и приход товара",
    }
```

`provider.py:56-57` already sets `default_scopes=list(SCOPES)`, so newly registered clients
pick this up. Tokens issued before it do not carry it and get the existing message —
«Приложению не выдано это разрешение. Переподключите его к Sellary» — which is exactly
right.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_oauth_flow.py -v`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/__init__.py sellary-backend/mcp_server/oauth/templates.py sellary-backend/tests/integration/test_mcp_oauth_flow.py
git commit -m "feat(mcp): a separate permission for reading records, not only totals"
```

---

### Task 2: Receipts and returns

**Why:** `get_sales_summary` answers «сколько наторговали» and nothing answers «покажи чек
№1043». `/sales` in the app has a full server-side filter set and a receipt detail; the
connector has none of it.

**Files:**
- Create: `sellary-backend/mcp_server/tools_sales.py`
- Modify: `sellary-backend/mcp_server/server.py:85`
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Create `sellary-backend/tests/integration/test_mcp_read_tools.py`. It reuses the fixtures
already defined in `tests/integration/test_mcp_tools.py` — copy `_SharedSession`, the
`as_user` fixture and `_call` from there verbatim (they are 40 lines and the two files must
not import each other's private helpers).

```python
"""The read-only tools against real data.

Same harness as `test_mcp_tools.py`: tools are called as plain functions, the
access token is stubbed, and the session factory is swapped so the suite's
transaction survives the tool's own commit.
"""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError
from mcp.server.auth.provider import AccessToken

from mcp_server import SCOPE_PURCHASING, SCOPE_RECORDS, SCOPE_REPORTS
from mcp_server import context as mcp_context
from mcp_server import tools_sales
from models.sale import PaymentMethod, Sale, SaleStatus
from tests.conftest import add_sale_tenders


class _SharedSession:
    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def commit(self):
        self._session.flush()

    def close(self):
        pass

    def rollback(self):
        pass


@pytest.fixture
def as_user(monkeypatch, db_session):
    def _install(
        user, company, scopes=(SCOPE_REPORTS, SCOPE_RECORDS, SCOPE_PURCHASING)
    ):
        token = AccessToken(
            token="test-token",
            client_id="test-client",
            scopes=list(scopes),
            subject=str(user.id),
            claims={
                "user_id": user.id,
                "company_id": company.id,
                "mcp": True,
                "scopes": list(scopes),
            },
        )
        monkeypatch.setattr(mcp_context, "get_access_token", lambda: token)
        monkeypatch.setattr(
            mcp_context, "SessionLocal", lambda: _SharedSession(db_session)
        )
        return token

    return _install


def _call(tool, **kwargs):
    """`@mcp.tool` registers and returns the function unchanged."""
    return tool(**kwargs)


@pytest.fixture
def a_sale(db_session, cashier_user):
    sale = Sale(
        cashier_id=cashier_user.id,
        subtotal=Decimal("25.00"),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal("25.00"),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=datetime.utcnow() - timedelta(hours=1),
    )
    db_session.add(sale)
    db_session.flush()
    return add_sale_tenders(db_session, sale)


class TestSalesTools:
    def test_get_sale_returns_the_receipt(
        self, as_user, admin_user, default_company, a_sale
    ):
        as_user(admin_user, default_company)

        result = _call(tools_sales.get_sale, sale_id=a_sale.id)

        assert result["id"] == a_sale.id
        assert result["total_amount"] == "25.00"

    def test_get_sale_does_not_reach_another_company(
        self, as_user, admin_user, default_company, second_company, db_session, cashier_user
    ):
        other = Sale(
            company_id=second_company.id,
            cashier_id=cashier_user.id,
            subtotal=Decimal("9.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("9.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
        )
        db_session.add(other)
        db_session.flush()
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_sales.get_sale, sale_id=other.id)

    def test_list_sales_finds_it(self, as_user, admin_user, default_company, a_sale):
        as_user(admin_user, default_company)

        result = _call(tools_sales.list_sales, period="today")

        assert result["total"] >= 1
        assert any(row["id"] == a_sale.id for row in result["sales"])

    def test_the_records_scope_is_required(
        self, as_user, admin_user, default_company, a_sale
    ):
        as_user(admin_user, default_company, scopes=(SCOPE_REPORTS,))

        with pytest.raises(ToolError) as exc:
            _call(tools_sales.get_sale, sale_id=a_sale.id)

        assert "разрешение" in str(exc.value)
```

Use whatever the second-company fixture in `tests/conftest.py` is called (defined around
line 148) and rename the parameter to match. If `Sale` does not carry `company_id`
directly, set the tenant the way `tests/conftest.py` does elsewhere.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_mcp_read_tools.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_server.tools_sales'`.

- [ ] **Step 3: Write the implementation**

Create `sellary-backend/mcp_server/tools_sales.py`:

```python
"""Individual receipts.

`get_sales_summary` says how much was taken; these say what was actually sold and
to whom. Read-only: a sale is rung at the till, never here.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from services.report_service import ReportService
from services.sale_return_service import SaleReturnService
from services.sale_service import SaleService


@mcp.tool
def get_sale(sale_id: int) -> dict:
    """Один чек целиком: позиции, цены, способы оплаты, что из него возвращали.
    Используйте, когда владелец спрашивает про конкретную продажу — «что было
    в чеке №1043».
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "sales")
        sale = SaleService(db, auth.company_id).get_by_id(sale_id)
        if sale is None:
            raise ToolError(f"Чек №{sale_id} не найден.")
        return json_safe(sale)


@mcp.tool
def list_sales(
    period: str = "today",
    search: str | None = None,
    payment_method: str | None = None,
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Список чеков за период — с суммой, кассиром, способом оплаты и статусом.
    `search` ищет по номеру чека, товару или клиенту. Нужен, чтобы найти
    продажу, о которой спрашивают, и потом открыть её через get_sale.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "sales")
        limit = max(1, min(int(limit), 200))
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        sales, total = SaleService(db, auth.company_id).get_all(
            limit=limit,
            start_date=start,
            end_date=end,
            search=search,
            payment_method=payment_method,
        )
        return {**echo, "total": total, "sales": json_safe(sales)}


@mcp.tool
def list_sale_returns(sale_id: int) -> dict:
    """Возвраты, оформленные по одному чеку: что вернули, на какую сумму и когда.
    Возврат сначала гасит долг клиента, поэтому выданные деньги могут быть меньше
    стоимости возвращённого товара.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "sales")
        returns = SaleReturnService(db, auth.company_id).get_returns_for_sale(sale_id)
        return {"sale_id": sale_id, "count": len(returns), "returns": json_safe(returns)}
```

Check `SaleReturnService.__init__` before writing that last tool — if it does not take
`company_id`, construct it the way `api/sales.py` does.

In `sellary-backend/mcp_server/server.py:85`, extend the lazy import:

```python
    from mcp_server import (  # noqa: F401
        tools_catalog,
        tools_purchase,
        tools_reports,
        tools_sales,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_read_tools.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/tools_sales.py sellary-backend/mcp_server/server.py sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "feat(mcp): read a receipt, not only the day's total"
```

---

### Task 3: Customers and their debts

**Why:** `customers` is one of three modules with zero tools. The app shows ledger-derived
balances, a «С долгом» filter with counts, and a full debt ledger; the connector cannot
name a single debtor.

**Files:**
- Create: `sellary-backend/mcp_server/tools_customers.py`
- Modify: `sellary-backend/mcp_server/server.py`
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_read_tools.py`, and add
`from mcp_server import tools_customers` to its imports:

```python
class TestCustomerTools:
    def test_list_customers_returns_the_shop_s_customers(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.customer import Customer

        db_session.add(
            Customer(company_id=default_company.id, name="Иван Петров", phone="+992900000002")
        )
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_customers.list_customers)

        assert any(row["name"] == "Иван Петров" for row in result["customers"])

    def test_a_customer_with_no_debt_reports_zero(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.customer import Customer

        customer = Customer(company_id=default_company.id, name="Без долга")
        db_session.add(customer)
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_customers.get_customer_debt, customer_id=customer.id)

        assert result["balance"] == "0.00"
        assert result["entries"] == []

    def test_the_customers_module_is_required(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.company_module import CompanyModule

        as_user(admin_user, default_company)
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "customers",
        ).delete()
        db_session.flush()

        with pytest.raises(ToolError) as exc:
            _call(tools_customers.list_customers)

        assert "Клиенты" in str(exc.value)
```

`Customer` may have more non-nullable columns than `name`; open
`sellary-backend/models/customer.py` and fill them in.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Customer`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_server.tools_customers'`.

- [ ] **Step 3: Write the implementation**

Create `sellary-backend/mcp_server/tools_customers.py`:

```python
"""Who owes the shop money, and where that debt came from.

A balance here is derived from the ledger on every read — it is never a stored
column, so it cannot disagree with the sales that produced it.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.serialization import json_safe, money
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
        customers, total = CustomerRepository(db).get_all(
            auth.company_id, limit=limit, search=query
        )
        return {
            "total": total,
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
        return {
            "customer_id": customer_id,
            "balance": money(service.get_customer_balance(customer_id)),
            **json_safe(ledger),
        }
```

Open `services/customer_ledger_service.py` before writing this: confirm the constructor
takes `(db, company_id)`, what `CustomerLedgerResponse` actually contains (the test asserts
`entries`), and how a missing customer is signalled. Match the real names — do not invent
an `entries` field if the response calls it something else, change the test instead.

Extend the lazy import in `sellary-backend/mcp_server/server.py` with `tools_customers`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Customer`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/tools_customers.py sellary-backend/mcp_server/server.py sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "feat(mcp): who owes the shop money"
```

---

### Task 4: Money movements

**Why:** `get_money_accounts` says where the money sits and nothing says how it got there.
The balance is the answer to «сколько»; the movements are the answer to «почему».

**Files:**
- Create: `sellary-backend/mcp_server/tools_finance.py`
- Modify: `sellary-backend/mcp_server/server.py`
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_read_tools.py` and import
`tools_finance`:

```python
class TestFinanceTools:
    def test_movements_come_back_for_the_period(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_finance.get_money_movements, period="this_month")

        assert "movements" in result
        assert result["period"] == "this_month"

    def test_the_finance_module_is_required(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.company_module import CompanyModule

        as_user(admin_user, default_company)
        db_session.query(CompanyModule).filter(
            CompanyModule.company_id == default_company.id,
            CompanyModule.module == "finance",
        ).delete()
        db_session.flush()

        with pytest.raises(ToolError) as exc:
            _call(tools_finance.get_money_movements)

        assert "Финансы" in str(exc.value)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Finance`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_server.tools_finance'`.

- [ ] **Step 3: Write the implementation**

Read `services/money_service.py:346` first and match `history()`'s real signature.

Create `sellary-backend/mcp_server/tools_finance.py`:

```python
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
            account_id=account_id, start_date=start, end_date=end, limit=limit
        )
        return {**echo, "movements": json_safe(movements)}
```

Extend the lazy import in `server.py` with `tools_finance`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Finance`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/tools_finance.py sellary-backend/mcp_server/server.py sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "feat(mcp): where the money went"
```

---

### Task 5: Stock movements, write-offs, valuation, categories, product list

**Why:** `search_products` needs a query string, so the catalogue cannot be browsed;
nothing shows why a stock figure changed; and write-offs — a whole document type with a
reason and a disposition — are invisible, so «сколько испортилось» has no answer.

**Files:**
- Create: `sellary-backend/mcp_server/tools_inventory.py`
- Modify: `sellary-backend/mcp_server/server.py`
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_read_tools.py` and import
`tools_inventory`:

```python
class TestInventoryTools:
    def test_the_catalogue_can_be_browsed_without_a_query(
        self, as_user, admin_user, default_company, test_product
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.list_products, limit=10)

        assert result["total"] >= 1
        assert any(row["id"] == test_product.id for row in result["products"])

    def test_search_products_still_requires_its_query(self):
        """The existing tool's meaning must not change under connected agents."""
        import inspect

        from mcp_server import tools_catalog

        signature = inspect.signature(tools_catalog.search_products)
        assert signature.parameters["query"].default is inspect.Parameter.empty

    def test_stock_movements_come_back(
        self, as_user, admin_user, default_company, test_product
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.get_stock_movements, product_id=test_product.id)

        assert "movements" in result

    def test_write_offs_summarise_by_reason(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.get_write_off_summary, period="this_month")

        assert result["period"] == "this_month"

    def test_valuation_reports_what_the_stock_is_worth(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.get_inventory_valuation)

        assert result is not None

    def test_categories_come_back(self, as_user, admin_user, default_company, test_category):
        as_user(admin_user, default_company)

        result = _call(tools_inventory.list_categories)

        assert any(row["id"] == test_category.id for row in result["categories"])
```

Use whatever the product and category fixtures in `tests/conftest.py` are actually called
(defined around lines 382 and 394) and rename the parameters to match.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Inventory`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_server.tools_inventory'`.

- [ ] **Step 3: Write the implementation**

Open `services/inventory_service.py:161` (`get_logs`), `services/stock_write_off_service.py:144,147`
(`list`, `summary`), `services/product_service.py:43` (`get_all`) and
`repositories/category_repository.py` first, and match their real signatures.

Create `sellary-backend/mcp_server/tools_inventory.py`:

```python
"""What is on the shelf, what moved it, and what left as spoilage.

Read-only. Counting stock is a document with a human author, and a delta applied
to whatever the server currently holds is the failure this codebase already
suffered — neither belongs on this channel.
"""

from mcp_server import SCOPE_RECORDS, SCOPE_REPORTS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe, quantity, unit_price
from mcp_server.server import mcp
from repositories.category_repository import CategoryRepository
from services.inventory_service import InventoryService
from services.product_service import ProductService
from services.report_service import ReportService
from services.stock_write_off_service import StockWriteOffService


@mcp.tool
def list_products(query: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    """Каталог товаров с остатками и ценами, страницами. В отличие от
    search_products, работает и без поискового запроса — чтобы просто посмотреть,
    что вообще есть в магазине.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        limit = max(1, min(int(limit), 200))
        products, total = ProductService(db, auth.company_id).get_all(
            skip=max(0, int(offset)), limit=limit, search=query
        )
        return {
            "total": total,
            "products": [
                {
                    "id": row.id,
                    "name": row.name,
                    "barcode": row.barcode,
                    "uom": row.uom,
                    "stock_quantity": quantity(row.stock_quantity),
                    "cost_price": unit_price(row.cost_price),
                    "sell_price": unit_price(row.sell_price),
                }
                for row in products
            ],
        }


@mcp.tool
def list_categories() -> dict:
    """Категории товаров магазина."""
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        categories = CategoryRepository(db).get_all(auth.company_id)
        return {
            "categories": [{"id": row.id, "name": row.name} for row in categories]
        }


@mcp.tool
def get_stock_movements(
    product_id: int | None = None,
    period: str = "last_30_days",
    limit: int = 100,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """История движения остатков: приход, продажа, возврат, списание, пересчёт —
    с причиной и количеством. Отвечает на «почему остаток стал таким».
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "inventory")
        limit = max(1, min(int(limit), 500))
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        logs = InventoryService(db, auth.company_id).get_logs(
            product_id=product_id, start_date=start, end_date=end, limit=limit
        )
        return {**echo, "movements": json_safe(logs)}


@mcp.tool
def list_write_offs(
    period: str = "this_month",
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Акты списания за период: что списали, по какой причине и куда оно делось —
    выброшено или возвращено поставщику. Списания не входят в оборот.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "inventory")
        limit = max(1, min(int(limit), 200))
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        write_offs, total = StockWriteOffService(db, auth.company_id).list(
            start_date=start, end_date=end, limit=limit
        )
        return {**echo, "total": total, "write_offs": json_safe(write_offs)}


@mcp.tool
def get_write_off_summary(
    period: str = "this_month",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Сводка списаний за период — по причинам и по тому, вернули ли товар
    поставщику. Отвечает на «сколько мы потеряли на порче».
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        start, end, echo = resolve_period(
            ReportService(db, auth.company_id), period, start_date, end_date
        )
        summary = StockWriteOffService(db, auth.company_id).summary(start, end)
        return {**echo, **json_safe(summary)}


@mcp.tool
def get_inventory_valuation() -> dict:
    """Во сколько магазину обходится товар, который сейчас лежит на складе —
    по закупочной цене. Это не выручка и не прибыль, а связанные деньги.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "inventory")
        return json_safe(InventoryService(db, auth.company_id).get_inventory_value())
```

Extend the lazy import in `server.py` with `tools_inventory`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Inventory`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/tools_inventory.py sellary-backend/mcp_server/server.py sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "feat(mcp): browse the catalogue and see what moved the stock"
```

---

### Task 6: Purchase orders

**Why:** The connector can create a purchase order and cannot read one back — not even the
one it just committed. `get_outstanding_orders` only returns `sent` and
`partially_received` (`purchase_report_service.py:333`), and `purchase_commit` leaves an
order at `received` or `draft`, so it never appears there.

**Files:**
- Create: `sellary-backend/mcp_server/tools_purchasing.py`
- Modify: `sellary-backend/mcp_server/server.py`
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_read_tools.py` and import
`tools_purchasing`:

```python
class TestPurchasingTools:
    def test_an_order_can_be_read_back_after_it_is_created(
        self, as_user, admin_user, default_company, db_session
    ):
        from models.purchase_order import PurchaseOrder, PurchaseOrderStatus
        from models.supplier import Supplier

        supplier = Supplier(company_id=default_company.id, name="ООО Ромашка", is_active=True)
        db_session.add(supplier)
        db_session.flush()
        order = PurchaseOrder(
            company_id=default_company.id,
            supplier_id=supplier.id,
            status=PurchaseOrderStatus.RECEIVED,
            total_amount=Decimal("100.00"),
        )
        db_session.add(order)
        db_session.flush()
        as_user(admin_user, default_company)

        result = _call(tools_purchasing.get_purchase_order, purchase_order_id=order.id)

        assert result["id"] == order.id
        assert result["total_amount"] == "100.00"

    def test_an_unknown_order_is_an_error_not_an_empty_answer(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_purchasing.get_purchase_order, purchase_order_id=99999)
```

`PurchaseOrder` may need more non-nullable columns; open
`sellary-backend/models/purchase_order.py` and fill them in. The status enum is native
Postgres — pass the enum member, never a string.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Purchasing`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_server.tools_purchasing'`.

- [ ] **Step 3: Write the implementation**

Create `sellary-backend/mcp_server/tools_purchasing.py`:

```python
"""Reading purchase orders back.

`purchase_commit` writes one and returns a summary; this is how the model checks
what it actually created, and how the owner asks about an older delivery.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.periods import resolve_period
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from services.purchase_order_service import PurchaseOrderService
from services.purchase_report_service import PurchaseReportService


@mcp.tool
def get_purchase_order(purchase_order_id: int) -> dict:
    """Один заказ поставщику целиком: позиции, сколько заказано, сколько принято,
    сколько осталось, статус. Используйте, чтобы проверить, что именно было
    оформлено, в том числе после purchase_commit.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "purchasing")
        order = PurchaseOrderService(db, auth.company_id).get_by_id(purchase_order_id)
        if order is None:
            raise ToolError(f"Заказ №{purchase_order_id} не найден.")
        return json_safe(order)


@mcp.tool
def list_purchase_orders(
    period: str = "last_30_days",
    supplier_id: int | None = None,
    status: str | None = None,
    limit: int = 50,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Заказы поставщикам за период — с поставщиком, суммой и статусом.
    В отличие от get_outstanding_orders, показывает и принятые, и черновики.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "purchasing")
        limit = max(1, min(int(limit), 200))
        start, end, echo = resolve_period(
            PurchaseReportService(db, auth.company_id), period, start_date, end_date
        )
        orders, total = PurchaseOrderService(db, auth.company_id).get_all(
            limit=limit,
            supplier_id=supplier_id,
            status=status,
            start_date=start,
            end_date=end,
        )
        return {**echo, "total": total, "orders": json_safe(orders)}
```

Extend the lazy import in `server.py` with `tools_purchasing`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Purchasing`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/tools_purchasing.py sellary-backend/mcp_server/server.py sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "feat(mcp): read back the purchase order it just created"
```

---

### Task 7: Shop orders, one shift, the checker

**Why:** Three loose ends. `shop` is the last module with zero tools. `list_shifts` gives
no single-shift lookup, so «что было в смене вчера» is unanswerable. And the checker —
`ConsistencyService`, the thing that recomputes every derived figure from an independent
source — is invisible, so the agent cannot verify its own figures.

Reading the checker is the useful half of сверка. Declaring one stays out.

**Files:**
- Create: `sellary-backend/mcp_server/tools_admin.py`
- Modify: `sellary-backend/mcp_server/server.py`
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_read_tools.py` and import
`tools_admin`:

```python
class TestAdminTools:
    def test_shop_orders_come_back(self, as_user, admin_user, default_company):
        as_user(admin_user, default_company)

        result = _call(tools_admin.list_shop_orders)

        assert "orders" in result

    def test_the_checker_reports_clean_or_not(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_admin.run_consistency_check)

        assert isinstance(result["clean"], bool)
        assert isinstance(result["findings"], list)

    def test_the_checker_is_refused_to_a_manager(
        self, as_user, manager_user, default_company
    ):
        """It spans stock and cash, so it mirrors its REST guard: admin only."""
        as_user(manager_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_admin.run_consistency_check)

    def test_a_shift_that_does_not_exist_is_an_error(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_admin.get_shift, shift_id=99999)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Admin`
Expected: FAIL — `ModuleNotFoundError: No module named 'mcp_server.tools_admin'`.

- [ ] **Step 3: Write the implementation**

Read `services/order_service.py:181` (`list_orders_for_company`),
`services/cash_shift_service.py:195,366` (`get_current`, `totals_for`) and
`services/consistency_service.py` (what `run()` returns) and match the real signatures.

Create `sellary-backend/mcp_server/tools_admin.py`:

```python
"""Cross-domain reads: the shop queue, one shift, and the books check.

`run_consistency_check` and the сверка archive are not module-gated — they span
stock and cash, so they mirror their REST guards against the caller's role
instead. Declaring a сверка is deliberately absent: freezing a period needs a
human signature.
"""

from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.serialization import json_safe
from mcp_server.server import mcp
from models.cash_shift import CashShift as CashShiftModel
from services.cash_shift_service import CashShiftService
from services.consistency_service import ConsistencyService
from services.order_service import OrderService


@mcp.tool
def list_shop_orders(status: str | None = None, limit: int = 50) -> dict:
    """Заказы из Telegram-магазина: кто заказал, что, на какую сумму и в каком
    состоянии заказ. Нужен, чтобы понять, что ждёт обработки.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "shop")
        limit = max(1, min(int(limit), 200))
        orders = OrderService(db).list_orders_for_company(
            auth.company_id, status=status, limit=limit
        )
        return {"orders": json_safe(orders)}


@mcp.tool
def get_shift(shift_id: int | None = None) -> dict:
    """Одна смена: когда открыта и закрыта, кем, сколько наторговали, что
    насчитали в кассе и какое расхождение. Без shift_id возвращает открытую
    смену; если открытой нет, скажет об этом.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        require_module(auth, db, "register")
        service = CashShiftService(db, auth.company_id)
        if shift_id is None:
            shift = service.get_current()
            if shift is None:
                return {"shift": None, "message": "Открытой смены сейчас нет."}
        else:
            shift = (
                db.query(CashShiftModel)
                .filter(
                    CashShiftModel.id == shift_id,
                    CashShiftModel.company_id == auth.company_id,
                )
                .first()
            )
            if shift is None:
                raise ToolError(f"Смена №{shift_id} не найдена.")
        return {"shift": json_safe(shift), "totals": json_safe(service.totals_for(shift))}


@mcp.tool
def run_consistency_check() -> dict:
    """Проверка сходимости учёта: сверяет каждую производную цифру с независимым
    источником — остатки с партиями, долги с журналом, кассу с движениями.
    `drift` означает расхождение, которое нужно чинить; `known` — записанный
    факт, вроде чека, пришедшего с кассы задним числом.
    Ничего не изменяет.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_RECORDS)
        if auth.role != "admin":
            raise ToolError("Проверку учёта может запускать только администратор.")
        findings = ConsistencyService(db, auth.company_id).run()
        return {
            "clean": not any(item.bucket == "drift" for item in findings),
            "findings": json_safe([item.__dict__ for item in findings]),
        }
```

Extend the lazy import in `server.py` with `tools_admin`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Admin`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/tools_admin.py sellary-backend/mcp_server/server.py sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "feat(mcp): the shop queue, one shift, and the books check"
```

---

### Task 8: The сверка archive

**Why:** The whole point of the periods work is that the owner can ask «сколько я купил и
сколько продал за май». He should be able to ask it in chat too.

**Requires:** `services/period_report_service.py` from
`docs/superpowers/plans/2026-08-15-period-reports.md` Task 6–8. If that is not merged,
stop here and finish this task after it lands.

**Files:**
- Modify: `sellary-backend/mcp_server/tools_admin.py`
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_read_tools.py`:

```python
class TestPeriodTools:
    def test_periods_are_empty_before_the_first_сверка(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        result = _call(tools_admin.list_periods)

        assert result["total"] == 0

    def test_a_period_reports_bought_and_sold(
        self, as_user, admin_user, default_company, db_session
    ):
        from datetime import date

        from models.reconciliation import Reconciliation
        from services import reconciliation

        row = Reconciliation(company_id=default_company.id, effective_from=date(2026, 6, 1))
        db_session.add(row)
        db_session.flush()
        reconciliation.invalidate(db_session, default_company.id)
        as_user(admin_user, default_company)

        listed = _call(tools_admin.list_periods)
        detail = _call(tools_admin.get_period_report, reconciliation_id=row.id)

        assert listed["total"] == 1
        assert detail["end_day"] == "2026-05-31"
        assert "purchased" in detail
        assert "sold" in detail

    def test_an_unknown_period_is_an_error(
        self, as_user, admin_user, default_company
    ):
        as_user(admin_user, default_company)

        with pytest.raises(ToolError):
            _call(tools_admin.get_period_report, reconciliation_id=9999)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Period`
Expected: FAIL — `AttributeError: module 'mcp_server.tools_admin' has no attribute 'list_periods'`.

- [ ] **Step 3: Write the implementation**

Append to `sellary-backend/mcp_server/tools_admin.py`, extending its imports with
`from mcp_server import SCOPE_REPORTS` and
`from services.period_report_service import PeriodReportService`:

```python
@mcp.tool
def list_periods(limit: int = 12, offset: int = 0) -> dict:
    """Закрытые периоды — каждый закрыт своей сверкой — с тем, сколько за период
    закупили и сколько продали. Отвечает на «покажи по месяцам, что я купил и
    что продал».
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports", "manager")
        limit = max(1, min(int(limit), 60))
        return json_safe(
            PeriodReportService(db, auth.company_id).list(
                limit=limit, offset=max(0, int(offset))
            )
        )


@mcp.tool
def get_period_report(reconciliation_id: int) -> dict:
    """Отчёт по одному закрытому периоду: закуплено, продано, себестоимость,
    прибыль, списания, возвраты, кто и когда провёл сверку. Цифры считаются
    заново при каждом запросе, поэтому всегда совпадают с остальными отчётами.
    `late_arrivals` — чеки, пробитые внутри периода, но дошедшие до сервера
    после его закрытия; из-за них итог может отличаться от того, что видели
    в день сверки.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_REPORTS)
        require_module(auth, db, "reports", "manager")
        detail = PeriodReportService(db, auth.company_id).detail(reconciliation_id)
        if detail is None:
            raise ToolError(f"Период №{reconciliation_id} не найден.")
        return json_safe(detail)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/integration/test_mcp_read_tools.py -v -k Period`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add sellary-backend/mcp_server/tools_admin.py sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "feat(mcp): ask a closed period what it bought and sold"
```

---

### Task 9: Pin the tool surface

**Why:** The connector opens a live door into the company's data. A tool must not be able
to appear without a deliberate change to a test that says what the surface is.

**Files:**
- Test: `sellary-backend/tests/integration/test_mcp_read_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `sellary-backend/tests/integration/test_mcp_read_tools.py`:

```python
EXPECTED_TOOLS = {
    # aggregates — sellary:reports
    "get_dashboard",
    "get_sales_summary",
    "get_daily_sales",
    "get_profit_report",
    "get_top_products",
    "get_purchase_summary",
    "get_purchases_by_product",
    "get_purchases_by_supplier",
    "get_outstanding_orders",
    "get_low_stock",
    "get_money_accounts",
    "get_current_shift",
    "list_shifts",
    "search_products",
    "list_suppliers",
    "list_products",
    "list_categories",
    "get_write_off_summary",
    "get_inventory_valuation",
    "list_periods",
    "get_period_report",
    # rows — sellary:records
    "get_sale",
    "list_sales",
    "list_sale_returns",
    "list_customers",
    "get_customer_debt",
    "get_money_movements",
    "get_stock_movements",
    "list_write_offs",
    "get_purchase_order",
    "list_purchase_orders",
    "list_shop_orders",
    "get_shift",
    "run_consistency_check",
    # the only writes
    "purchase_preview",
    "purchase_commit",
}


async def test_the_tool_surface_is_exactly_what_we_meant_to_ship():
    """A new tool on this connector is a deliberate act, not a side effect."""
    from mcp_server.server import build_mcp_app, mcp

    build_mcp_app()
    tools = await mcp.get_tools()

    assert set(tools) == EXPECTED_TOOLS
```

- [ ] **Step 2: Run the test**

Run: `pytest tests/integration/test_mcp_read_tools.py -k surface -v`
Expected: it either passes, or fails with a set difference. If it fails, the difference is
the truth — reconcile `EXPECTED_TOOLS` against the tool names actually registered by
`tools_reports.py`, `tools_catalog.py` and `tools_purchase.py` (the aggregate half of the
list above was written from reading them, so a mismatch means a name was mistyped here, not
that a tool is missing).

If `mcp.get_tools()` is not the accessor in this FastMCP version, find the right one by
reading `mcp_server/server.py` and the installed `fastmcp` package, and keep the assertion.
If the test must be synchronous, drop `async` and call the sync accessor.

- [ ] **Step 3: Commit**

```bash
git add sellary-backend/tests/integration/test_mcp_read_tools.py
git commit -m "test(mcp): the tool surface cannot grow by accident"
```

---

### Task 10: Full suite and the docs

**Files:**
- Modify: `CLAUDE.md` — the «MCP connector» section
- Modify: `AGENTS.md` — the same section
- Modify: `docs/MCP_CONNECTOR_GUIDE.md`

- [ ] **Step 1: Run everything**

Run: `pytest tests/integration tests/unit`
Expected: PASS.

Run: `python -m compileall api core models repositories schemas services main.py`
Expected: no errors.

Note that `mcp_server/` is **not** in the compile gate. Add a syntax check by hand:

Run: `python -m compileall mcp_server`
Expected: no errors.

- [ ] **Step 2: Update the two agent guides**

Replace the sentence «Reports are read-only. The only write is the two-phase purchase…» in
the «MCP connector» section of `CLAUDE.md`, and mirror it into `AGENTS.md`:

```markdown
Reads come in two permissions. `sellary:reports` covers aggregates — dashboards,
summaries, valuations, the сверка archive. `sellary:records` covers rows — a
receipt, a customer's debt ledger, a money movement, a stock movement, a purchase
order, a shop order, a shift. They are separate because widening what an agent can
read must mean asking the owner again, not silently upgrading a token already
issued; `provider.py` grants both to newly registered clients, and an older token
gets «Приложению не выдано это разрешение» until it reconnects.

The only write is still the two-phase purchase. Ten capabilities are excluded on
purpose and listed in `docs/superpowers/specs/2026-08-15-period-reports-and-mcp-parity-design.md`:
ringing a sale, refunds, voids, opening or closing a shift, delta stock
adjustment, stocktake, balance correction, declaring a сверка, staff and password
administration, and revoking an MCP agent. Each one either moves money outward, is
a physical count that needs a human author, or edits the agent's own authority.
```

- [ ] **Step 3: Update the owner-facing guide**

In `docs/MCP_CONNECTOR_GUIDE.md`, extend the Russian list of what Claude can do with the
new capabilities (чеки, долги клиентов, движения денег и склада, списания, заказы
поставщикам, заказы из магазина, смены, проверка учёта, отчёты по закрытым периодам), and
state plainly that Claude still cannot ring a sale, оформить возврат, аннулировать чек,
открыть или закрыть смену, or корректировать остаток и баланс счёта.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md docs/MCP_CONNECTOR_GUIDE.md
git commit -m "docs: what the connector can read now, and what stays out"
```

---

## Definition of done

- [ ] `pytest tests/integration tests/unit` passes from `sellary-backend/`
- [ ] `python -m compileall api core models repositories schemas services main.py` is clean
- [ ] `python -m compileall mcp_server` is clean
- [ ] `test_the_tool_surface_is_exactly_what_we_meant_to_ship` passes with 36 names
- [ ] Every new tool has a Russian docstring written for the shopkeeper
- [ ] `git grep -n "mcp.tool" sellary-backend/mcp_server | wc -l` equals 36
- [ ] No new write tool: `git grep -n "def \(create\|update\|delete\|record\|adjust\|open\|close\|void\|refund\)" sellary-backend/mcp_server/tools_*.py`
      returns only `tools_purchase.py`
- [ ] `tools_reports.py` has not grown
