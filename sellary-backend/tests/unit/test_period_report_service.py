"""A period's figures are the reports it is made of, recomputed on every read."""
from datetime import date, datetime, timedelta
from decimal import Decimal

from models.reconciliation import Reconciliation
from models.sale import PaymentMethod, Sale, SaleStatus
from services import reconciliation
from services.period_report_service import PeriodReportService
from tests.conftest import add_sale_tenders


def declare(db_session, company, day):
    row = Reconciliation(company_id=company.id, effective_from=day)
    db_session.add(row)
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)
    return row


def sell(db_session, cashier, when, amount="10.00"):
    sale = Sale(
        cashier_id=cashier.id,
        subtotal=Decimal(amount),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal(amount),
        payment_method=PaymentMethod.CASH,
        status=SaleStatus.COMPLETED,
        created_at=when,
    )
    db_session.add(sale)
    db_session.flush()
    return add_sale_tenders(db_session, sale)


def test_no_reconciliations_means_an_empty_list(db_session, default_company):
    result = PeriodReportService(db_session, default_company.id).list()

    assert result.total == 0
    assert result.periods == []


def test_a_sale_inside_the_window_is_counted(db_session, default_company, cashier_user):
    inside = datetime.utcnow() - timedelta(days=5)
    sell(db_session, cashier_user, inside, "40.00")
    declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())

    row = PeriodReportService(db_session, default_company.id).list().periods[0]

    assert row.sold == Decimal("40.00")


def test_a_sale_after_the_cut_off_is_not(db_session, default_company, cashier_user):
    declare(db_session, default_company, (datetime.utcnow() - timedelta(days=1)).date())
    sell(db_session, cashier_user, datetime.utcnow(), "40.00")

    row = PeriodReportService(db_session, default_company.id).list().periods[0]

    assert row.sold == Decimal("0.00")


def test_a_sale_on_the_last_settled_day_is_counted(
    db_session, default_company, cashier_user
):
    """The boundary: end_day runs to 23:59:59.999999 local."""
    end_day = datetime.utcnow() - timedelta(days=1)
    sell(db_session, cashier_user, end_day.replace(hour=23, minute=30), "7.00")
    declare(db_session, default_company, datetime.utcnow().date())

    row = PeriodReportService(db_session, default_company.id).list().periods[0]

    assert row.sold == Decimal("7.00")


def test_the_page_is_newest_first_and_total_counts_them_all(
    db_session, default_company
):
    declare(db_session, default_company, date(2026, 5, 1))
    declare(db_session, default_company, date(2026, 6, 1))
    declare(db_session, default_company, date(2026, 7, 1))

    result = PeriodReportService(db_session, default_company.id).list(limit=2)

    assert result.total == 3
    assert [row.index for row in result.periods] == [3, 2]
