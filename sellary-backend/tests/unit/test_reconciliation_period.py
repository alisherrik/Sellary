"""The floor fills in a missing period start, and never truncates an explicit one."""
from datetime import date, datetime, timedelta

from models.reconciliation import Reconciliation
from services import reconciliation
from services.purchase_report_service import PurchaseReportService
from services.report_service import ReportService


def declare(db_session, company, day):
    db_session.add(Reconciliation(company_id=company.id, effective_from=day))
    db_session.flush()
    reconciliation.invalidate(db_session, company.id)


def local_today(service):
    return datetime.now(service.tz()).date()


def test_without_a_reconciliation_nothing_changes(db_session, default_company):
    service = ReportService(db_session, default_company.id)
    start, _ = service.default_range(None, None, 30)
    assert start.date() == local_today(service) - timedelta(days=29)


def test_a_defaulted_range_starts_at_the_cut_off(db_session, default_company):
    service = ReportService(db_session, default_company.id)
    day = local_today(service) - timedelta(days=3)
    declare(db_session, default_company, day)

    start, _ = service.default_range(None, None, 90)

    assert start.date() == day


def test_the_purchase_report_uses_the_same_floor(db_session, default_company):
    service = PurchaseReportService(db_session, default_company.id)
    day = local_today(service) - timedelta(days=3)
    declare(db_session, default_company, day)

    start, _ = service.default_range(None, None, 90)

    assert start.date() == day


def test_an_explicit_start_is_honoured(db_session, default_company):
    service = ReportService(db_session, default_company.id)
    declare(db_session, default_company, local_today(service))
    explicit, _ = service.local_day_bounds(date(2026, 1, 1))

    start, _ = service.default_range(explicit, None, 30)

    assert start == explicit


def test_a_cut_off_older_than_the_window_does_not_lengthen_it(db_session, default_company):
    service = ReportService(db_session, default_company.id)
    declare(db_session, default_company, local_today(service) - timedelta(days=400))

    start, _ = service.default_range(None, None, 30)

    assert start.date() == local_today(service) - timedelta(days=29)


class TestSalesHistoryDefault:
    """The same floor, on the page a cashier actually browses."""

    def _sale(self, db_session, cashier, when):
        from decimal import Decimal

        from models.sale import PaymentMethod, Sale, SaleStatus
        from tests.conftest import add_sale_tenders

        sale = Sale(
            cashier_id=cashier.id,
            subtotal=Decimal("10.00"),
            tax_amount=Decimal("0.00"),
            total_amount=Decimal("10.00"),
            payment_method=PaymentMethod.CASH,
            status=SaleStatus.COMPLETED,
            created_at=when,
        )
        db_session.add(sale)
        db_session.flush()
        return add_sale_tenders(db_session, sale)

    def test_an_unbounded_browse_starts_at_the_cut_off(
        self, db_session, default_company, cashier_user
    ):
        from services.sale_service import SaleService

        service = SaleService(db_session, default_company.id)
        now = datetime.utcnow()
        old = self._sale(db_session, cashier_user, now - timedelta(days=10))
        recent = self._sale(db_session, cashier_user, now)
        declare(db_session, default_company, (now - timedelta(days=2)).date())

        sales, _ = service.get_all()

        assert [sale.id for sale in sales] == [recent.id]
        assert old.id not in [sale.id for sale in sales]

    def test_a_settled_receipt_is_still_findable_by_its_number(
        self, db_session, default_company, cashier_user
    ):
        from services.sale_service import SaleService

        service = SaleService(db_session, default_company.id)
        now = datetime.utcnow()
        old = self._sale(db_session, cashier_user, now - timedelta(days=10))
        declare(db_session, default_company, (now - timedelta(days=2)).date())

        sales, _ = service.get_all(sale_id=old.id)

        assert [sale.id for sale in sales] == [old.id]

    def test_a_settled_receipt_cannot_be_returned(
        self, db_session, default_company, cashier_user
    ):
        from services.sale_service import SaleService

        service = SaleService(db_session, default_company.id)
        now = datetime.utcnow()
        old = self._sale(db_session, cashier_user, now - timedelta(days=10))
        declare(db_session, default_company, (now - timedelta(days=2)).date())

        assert service.get_by_id(old.id).can_return is False
        assert service.get_by_id(self._sale(db_session, cashier_user, now).id).can_return is True
