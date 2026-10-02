"""A period runs from the previous cut-off to the day before this one."""
from datetime import date

from models.reconciliation import Reconciliation
from services import reconciliation


def declare(db_session, company, day):
    row = Reconciliation(company_id=company.id, effective_from=day)
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)
    return row


def test_no_reconciliations_means_no_periods(db_session, default_company):
    assert reconciliation.periods(db_session, default_company.id) == []


def test_the_oldest_period_has_no_start(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))

    period = reconciliation.periods(db_session, default_company.id)[0]

    assert period.start_day is None
    assert period.end_day == date(2026, 4, 30)
    assert period.index == 1


def test_a_later_period_starts_where_the_previous_one_ended(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))
    declare(db_session, default_company, date(2026, 6, 1))

    newest, oldest = reconciliation.periods(db_session, default_company.id)

    assert newest.start_day == date(2026, 5, 1)
    assert newest.end_day == date(2026, 5, 31)
    assert newest.index == 2
    assert oldest.index == 1


def test_index_counts_from_the_oldest_so_it_does_not_shift(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))
    declare(db_session, default_company, date(2026, 6, 1))
    declare(db_session, default_company, date(2026, 7, 1))

    assert [p.index for p in reconciliation.periods(db_session, default_company.id)] == [3, 2, 1]


def test_another_company_is_not_visible(db_session, default_company, secondary_company):
    declare(db_session, secondary_company, date(2026, 5, 1))

    assert reconciliation.periods(db_session, default_company.id) == []


def test_period_finds_one_by_its_reconciliation_id(db_session, default_company):
    declare(db_session, default_company, date(2026, 5, 1))
    row = declare(db_session, default_company, date(2026, 6, 1))

    found = reconciliation.period(db_session, default_company.id, row.id)

    assert found.id == row.id
    assert found.start_day == date(2026, 5, 1)


def test_period_returns_none_for_an_unknown_id(db_session, default_company):
    assert reconciliation.period(db_session, default_company.id, 9999) is None
