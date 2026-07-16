"""Integration-only fixtures.

Ringing a sale now requires an open till shift (POST /api/sales returns 409
otherwise). Most sale-creating tests don't care about shifts, so open one for
the default company automatically. A test that exercises shift behaviour itself
marks `@pytest.mark.no_auto_shift` to start from a clean slate.
"""
from decimal import Decimal

import pytest

from models.cash_shift import CashShift, CashShiftStatus
from models.user import User


@pytest.fixture(autouse=True)
def auto_open_shift(request, db_session):
    if "no_auto_shift" in request.keywords:
        yield
        return

    company_id = db_session.info["default_company_id"]
    already_open = (
        db_session.query(CashShift)
        .filter(CashShift.company_id == company_id, CashShift.status == CashShiftStatus.OPEN)
        .first()
    )
    if already_open is None:
        opener = db_session.query(User).first()
        if opener is None:
            opener = User(
                username="shift-opener",
                email="shift-opener@test.com",
                hashed_password="x",
                role="admin",
            )
            db_session.add(opener)
            db_session.flush()
        db_session.add(
            CashShift(
                company_id=company_id,
                shift_number=1,
                status=CashShiftStatus.OPEN,
                opened_by_user_id=opener.id,
                opening_cash=Decimal("0.00"),
            )
        )
        db_session.flush()
    yield
