"""The freeze predicate: one rule, read on the company's clock."""
from datetime import date, datetime

import pytest

from models.reconciliation import Reconciliation
from services import reconciliation
from services.reconciliation import ReconciliationClosed


def declare(db_session, company, day):
    db_session.add(Reconciliation(company_id=company.id, effective_from=day))
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)


class TestOpenFrom:
    def test_a_shop_that_never_reconciled_has_no_floor(self, db_session, default_company):
        assert reconciliation.open_from(db_session, default_company.id) is None

    def test_the_latest_declaration_wins(self, db_session, default_company):
        declare(db_session, default_company, date(2026, 7, 1))
        declare(db_session, default_company, date(2026, 8, 1))
        assert reconciliation.open_from(db_session, default_company.id) == date(2026, 8, 1)

    def test_another_company_keeps_its_own(self, db_session, default_company, secondary_company):
        declare(db_session, default_company, date(2026, 8, 1))
        assert reconciliation.open_from(db_session, secondary_company.id) is None

    def test_the_memo_is_cleared_by_invalidate(self, db_session, default_company):
        assert reconciliation.open_from(db_session, default_company.id) is None
        declare(db_session, default_company, date(2026, 8, 1))
        assert reconciliation.open_from(db_session, default_company.id) == date(2026, 8, 1)


class TestFrozenReason:
    def test_nothing_is_frozen_without_a_reconciliation(self, db_session, default_company):
        assert (
            reconciliation.frozen_reason(
                db_session, default_company.id, datetime(2020, 1, 1), "Чек"
            )
            is None
        )

    def test_the_day_itself_is_open(self, db_session, default_company):
        declare(db_session, default_company, date(2026, 8, 13))
        assert (
            reconciliation.frozen_reason(
                db_session, default_company.id, datetime(2026, 8, 13, 0, 30), "Чек"
            )
            is None
        )

    def test_the_day_before_is_closed_and_says_so_in_russian(self, db_session, default_company):
        declare(db_session, default_company, date(2026, 8, 13))
        reason = reconciliation.frozen_reason(
            db_session, default_company.id, datetime(2026, 8, 12, 6, 0), "Чек"
        )
        assert reason is not None
        assert "12.08.2026" in reason and "13.08.2026" in reason

    def test_the_local_day_decides_not_the_utc_one(self, db_session, default_company):
        # 2026-08-12 21:00 UTC is 2026-08-13 01:00 in Dushanbe: an open day.
        default_company.timezone = "Asia/Dushanbe"
        db_session.flush()
        declare(db_session, default_company, date(2026, 8, 13))

        assert (
            reconciliation.frozen_reason(
                db_session, default_company.id, datetime(2026, 8, 12, 21, 0), "Чек"
            )
            is None
        )
        assert reconciliation.frozen_reason(
            db_session, default_company.id, datetime(2026, 8, 12, 17, 0), "Чек"
        )


class TestAssertOpen:
    def test_it_raises_on_a_settled_document(self, db_session, default_company):
        declare(db_session, default_company, date(2026, 8, 13))
        with pytest.raises(ReconciliationClosed):
            reconciliation.assert_open(
                db_session, default_company.id, datetime(2026, 8, 1), "Чек"
            )

    def test_it_is_silent_on_an_open_one(self, db_session, default_company):
        declare(db_session, default_company, date(2026, 8, 13))
        reconciliation.assert_open(
            db_session, default_company.id, datetime(2026, 8, 20), "Чек"
        )


def test_open_from_instant_is_local_midnight(db_session, default_company):
    default_company.timezone = "Asia/Dushanbe"
    db_session.flush()
    declare(db_session, default_company, date(2026, 8, 13))

    moment = reconciliation.open_from_instant(db_session, default_company.id)

    assert moment.date() == date(2026, 8, 13)
    assert (moment.hour, moment.minute) == (0, 0)
    assert moment.utcoffset().total_seconds() == 5 * 3600
