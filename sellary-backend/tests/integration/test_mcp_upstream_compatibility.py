"""Remote MCP reads retain scopes, tenant boundaries and discoverable contracts."""

import asyncio
from datetime import date, datetime

import pytest
from fastmcp.exceptions import ToolError

from mcp_server import SCOPE_RECORDS, SCOPE_REPORTS, tools_admin
from mcp_server.server import mcp
from models.cash_shift import CashShift, CashShiftStatus
from models.company_membership import CompanyMembership
from models.membership_module_access import MembershipModuleAccess
from models.order import Order
from models.reconciliation import Reconciliation
from models.telegram_user import TelegramUser
from services import reconciliation
from tests.integration.test_mcp_tools import as_user


def _grant(db, user, company, module, level):
    membership = db.query(CompanyMembership).filter_by(
        user_id=user.id, company_id=company.id
    ).one()
    grant = db.query(MembershipModuleAccess).filter_by(
        membership_id=membership.id, module=module
    ).first()
    if grant is None:
        db.add(MembershipModuleAccess(
            membership_id=membership.id, module=module, level=level
        ))
    else:
        grant.level = level
    db.flush()
    return membership


def _period(db, company, *, day=1, checker_report=None):
    row = Reconciliation(
        company_id=company.id,
        effective_from=date(2026, 9, day),
        checker_report=checker_report,
    )
    db.add(row)
    db.flush()
    reconciliation.invalidate(db, company.id)
    return row


def test_compatibility_tools_have_typed_schemas_and_read_annotations():
    registered = {tool.name: tool for tool in asyncio.run(mcp.list_tools())}
    names = {
        "list_shop_orders", "get_shift", "run_consistency_check",
        "list_periods", "get_period_report",
    }
    for name in names:
        tool = registered[name]
        assert tool.annotations.readOnlyHint is True
        assert tool.annotations.destructiveHint is False
        assert tool.annotations.idempotentHint is True
        assert tool.output_schema["properties"]
    assert registered["list_periods"].parameters["properties"]["limit"]["maximum"] == 60
    assert registered["list_shop_orders"].parameters["properties"]["offset"]["minimum"] == 0
    assert registered["get_period_report"].parameters["properties"]["reconciliation_id"]["exclusiveMinimum"] == 0


def test_get_shift_includes_opening_notes(as_user, db_session, admin_user, default_company):
    as_user(admin_user, default_company, scopes=(SCOPE_RECORDS,))
    shift = db_session.query(CashShift).filter_by(
        company_id=default_company.id, status=CashShiftStatus.OPEN
    ).one()
    shift.opening_notes = "Комментарий при открытии"
    db_session.flush()
    result = tools_admin.get_shift(shift.id)
    assert result["shift"]["id"] == shift.id
    assert result["shift"]["opening_notes"] == "Комментарий при открытии"
    assert result["totals"]["expected_cash"] is not None


@pytest.mark.no_auto_shift
def test_empty_current_shift_keeps_legacy_shape(as_user, admin_user, default_company):
    as_user(admin_user, default_company, scopes=(SCOPE_RECORDS,))
    assert tools_admin.get_shift() == {
        "shift": None, "message": "Открытой смены сейчас нет."
    }


def test_get_shift_refuses_other_company(
    as_user, db_session, admin_user, default_company, secondary_company
):
    other = CashShift(
        company_id=secondary_company.id,
        shift_number=1,
        status=CashShiftStatus.CLOSED,
        opened_at=datetime(2026, 8, 1),
        closed_at=datetime(2026, 8, 2),
        opened_by_user_id=admin_user.id,
        opening_cash=99,
    )
    db_session.add(other)
    db_session.flush()
    as_user(admin_user, default_company, scopes=(SCOPE_RECORDS,))
    with pytest.raises(ToolError, match="не найдена"):
        tools_admin.get_shift(other.id)


@pytest.mark.parametrize("tool", ["get_shift", "list_shop_orders", "run_consistency_check"])
def test_record_reads_refuse_report_only_scope(as_user, admin_user, default_company, tool):
    as_user(admin_user, default_company, scopes=(SCOPE_REPORTS,))
    with pytest.raises(ToolError, match="разрешение"):
        getattr(tools_admin, tool)()


def test_get_shift_enforces_register_member_grant(
    as_user, db_session, manager_user, default_company
):
    membership = db_session.query(CompanyMembership).filter_by(
        user_id=manager_user.id, company_id=default_company.id
    ).one()
    db_session.query(MembershipModuleAccess).filter_by(
        membership_id=membership.id, module="register"
    ).delete()
    db_session.flush()
    as_user(manager_user, default_company, scopes=(SCOPE_RECORDS,))
    with pytest.raises(ToolError, match="Касса"):
        tools_admin.get_shift()


def test_shop_orders_have_continuation_status_filter_and_tenant_scope(
    as_user, db_session, admin_user, default_company, secondary_company
):
    shopper = TelegramUser(telegram_id=987654, first_name="Compatibility shopper")
    db_session.add(shopper)
    db_session.flush()
    ours = []
    for index, (company, status) in enumerate([
        (default_company, "pending"),
        (default_company, "pending"),
        (default_company, "ready"),
        (secondary_company, "pending"),
    ], start=1):
        row = Order(
            company_id=company.id,
            telegram_user_id=shopper.id,
            order_number=index,
            status=status,
            fulfillment_type="pickup",
            contact_phone="+992900000000",
            contact_name="Compatibility shopper",
            subtotal=10,
            total_amount=10,
        )
        db_session.add(row)
        db_session.flush()
        if company.id == default_company.id and status == "pending":
            ours.append(row.id)
    as_user(admin_user, default_company, scopes=(SCOPE_RECORDS,))
    first = tools_admin.list_shop_orders(status="pending", limit=1)
    second = tools_admin.list_shop_orders(status="pending", limit=1, offset=first["next_offset"])
    assert first["total"] == 2 and first["has_more"]
    assert second["count"] == 1 and not second["has_more"]
    assert {row["id"] for row in first["orders"] + second["orders"]} == set(ours)


def test_shop_orders_enforce_member_shop_grant(
    as_user, db_session, manager_user, default_company
):
    membership = db_session.query(CompanyMembership).filter_by(
        user_id=manager_user.id, company_id=default_company.id
    ).one()
    db_session.query(MembershipModuleAccess).filter_by(
        membership_id=membership.id, module="shop"
    ).delete()
    db_session.flush()
    as_user(manager_user, default_company, scopes=(SCOPE_RECORDS,))
    with pytest.raises(ToolError, match="Магазин"):
        tools_admin.list_shop_orders()


def test_period_list_has_continuation_and_is_tenant_scoped(
    as_user, db_session, admin_user, default_company, secondary_company
):
    ours = [_period(db_session, default_company, day=day) for day in (1, 2, 3)]
    _period(db_session, secondary_company)
    as_user(admin_user, default_company, scopes=(SCOPE_REPORTS,))
    first = tools_admin.list_periods(limit=2)
    second = tools_admin.list_periods(limit=2, offset=first["next_offset"])
    assert first["total"] == 3 and first["count"] == 2 and first["has_more"]
    assert second["count"] == 1 and not second["has_more"]
    assert {row["id"] for row in first["periods"] + second["periods"]} == {row.id for row in ours}


@pytest.mark.parametrize("tool", ["list_periods", "get_period_report"])
def test_period_reads_need_reports_manager_grant(
    as_user, db_session, manager_user, default_company, tool
):
    _grant(db_session, manager_user, default_company, "reports", "user")
    as_user(manager_user, default_company, scopes=(SCOPE_REPORTS,))
    args = {} if tool == "list_periods" else {"reconciliation_id": 1}
    with pytest.raises(ToolError, match="руководителя"):
        getattr(tools_admin, tool)(**args)


def test_period_reports_refuse_record_only_scope(as_user, admin_user, default_company):
    as_user(admin_user, default_company, scopes=(SCOPE_RECORDS,))
    with pytest.raises(ToolError, match="разрешение"):
        tools_admin.list_periods()
    with pytest.raises(ToolError, match="разрешение"):
        tools_admin.get_period_report(1)


@pytest.mark.parametrize("role", ["user", "manager", "admin"])
def test_period_checker_report_respects_role_beyond_module_grant(
    as_user, db_session, cashier_user, manager_user, admin_user, default_company, role
):
    finding = {
        "check": "stock", "company_id": default_company.id, "subject": "product:1",
        "expected": "4", "actual": "2", "bucket": "drift", "note": "Recorded drift",
    }
    row = _period(db_session, default_company, checker_report=[finding])
    user = {"user": cashier_user, "manager": manager_user, "admin": admin_user}[role]
    if role == "user":
        membership = _grant(db_session, user, default_company, "ai", "user")
        membership.role = "user"
        _grant(db_session, user, default_company, "reports", "manager")
    as_user(user, default_company, scopes=(SCOPE_REPORTS,))
    result = tools_admin.get_period_report(row.id)
    assert result["checker_report"] == (None if role == "user" else [finding])


def test_period_detail_refuses_other_company(
    as_user, db_session, admin_user, default_company, secondary_company
):
    other = _period(db_session, secondary_company)
    as_user(admin_user, default_company, scopes=(SCOPE_REPORTS,))
    with pytest.raises(ToolError, match="не найден"):
        tools_admin.get_period_report(other.id)


def test_legacy_checker_wrapper_accepts_records_and_keeps_admin_guard(
    as_user, admin_user, manager_user, default_company
):
    as_user(admin_user, default_company, scopes=(SCOPE_RECORDS,))
    result = tools_admin.run_consistency_check(limit=1, offset=0, bucket="known")
    assert result["count"] <= 1 and "clean" in result and "findings" in result
    as_user(manager_user, default_company, scopes=(SCOPE_RECORDS,))
    with pytest.raises(ToolError, match="администратор"):
        tools_admin.run_consistency_check()
