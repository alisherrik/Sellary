"""The checker's SQL, rendered for the database it will actually run against.

The suite runs on SQLite, which accepts things Postgres refuses — `Sale.status` and
`SaleReturn.refund_method` are native Postgres enums, and the repo has already paid
for that difference once (see test_money_queries_compile_on_postgres.py). Every
statement the checker issues is compiled for Postgres here before it is executed.
"""
import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import CompileError

from services.consistency_service import ConsistencyService


def test_every_statement_the_checker_issues_compiles_for_postgres(db_session, default_company):
    rendered = []
    original = db_session.execute

    def recording(statement, *args, **kwargs):
        try:
            rendered.append(
                str(
                    statement.compile(
                        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
                    )
                )
            )
        except CompileError as exc:  # pragma: no cover - the failure we guard
            pytest.fail(f"checker SQL does not compile for Postgres: {exc}")
        return original(statement, *args, **kwargs)

    db_session.execute = recording
    try:
        ConsistencyService(db_session, default_company.id).run()
    finally:
        del db_session.execute

    assert rendered, "the checker issued no statements"
    assert not any("lower(" in sql.lower() for sql in rendered)
