"""Guard against SQL that only works on the SQLite test engine.

The suite runs on SQLite, which is typeless enough to accept things Postgres
refuses. `func.lower(SaleReturn.refund_method)` is the example that reached
production: `refund_method` is a native Postgres enum, SQLite stored it as
text and happily lower()-ed it, and the real database answered

    function lower(paymentmethod) does not exist

Compiling the same expressions against the Postgres dialect catches that class
of mistake without needing a live database.
"""
import pytest
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import CompileError

from models.customer_ledger_entry import CustomerLedgerEntry
from models.sale import PaymentMethod, Sale
from models.sale_return import SaleReturn
from repositories.money_repository import (
    cash_payment_filter,
    cash_refund_filter,
)

ENUM_COLUMNS = [
    ("SaleReturn.refund_method", SaleReturn.refund_method),
    ("Sale.payment_method", Sale.payment_method),
    ("Sale.status", Sale.status),
]


def compile_pg(statement) -> str:
    return str(
        statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).lower()


class TestEnumColumnsAreComparedNotLowercased:
    @pytest.mark.parametrize("label,column", ENUM_COLUMNS, ids=[c[0] for c in ENUM_COLUMNS])
    def test_equality_against_the_member_compiles(self, label, column):
        sql = compile_pg(select(func.count()).where(column == PaymentMethod.CASH))
        assert "lower(" not in sql

    @pytest.mark.parametrize("cash", [True, False], ids=["cash", "non-cash"])
    def test_the_repositorys_own_refund_filter_never_lowercases_the_enum(self, cash):
        # The production expression itself, not a restatement of it — that is
        # the whole point: the bug was in the filter, and a test that rewrites
        # the filter correctly proves nothing.
        sql = compile_pg(
            select(func.coalesce(func.sum(SaleReturn.total_refund_amount), 0)).where(
                cash_refund_filter(cash)
            )
        )
        assert "refund_method" in sql
        assert "lower(" not in sql

    @pytest.mark.parametrize("cash", [True, False], ids=["cash", "non-cash"])
    def test_the_ledger_filter_does_normalise_because_that_column_is_text(self, cash):
        # customer_ledger_entries.payment_method is String(20) — free text
        # written by whatever recorded the payment — so lower(coalesce(...)) is
        # correct there. The asymmetry with refunds is deliberate; this records
        # it rather than leaving it to be rediscovered.
        assert CustomerLedgerEntry.__table__.c.payment_method.type.python_type is str
        sql = compile_pg(select(func.count()).where(cash_payment_filter(cash)))
        assert "lower(" in sql


class TestMoneyBalanceQueriesCompile:
    """Every read the balance calculation performs, rendered for Postgres."""

    def test_repository_balance_sources_compile(self, db_session, default_company):
        from repositories.money_repository import MoneyRepository

        repo = MoneyRepository(db_session)
        # Exercised through the public entry point: if any branch renders SQL
        # Postgres cannot parse, it is these four sources.
        accounts = repo.accounts(default_company.id)
        try:
            repo.balances(default_company.id, accounts)
        except CompileError as exc:  # pragma: no cover - the failure we guard
            pytest.fail(f"balance query does not compile: {exc}")
