"""Unit tests for the require_module dependency factory."""
import pytest
from fastapi import HTTPException

from api.dependencies import AuthContext, require_module
from models.company_membership import CompanyMembership
from models.membership_module_access import MembershipModuleAccess


def _ctx(db_session, user, company):
    membership = (
        db_session.query(CompanyMembership)
        .filter_by(user_id=user.id, company_id=company.id)
        .one()
    )
    return AuthContext(
        user=user,
        company=company,
        membership=membership,
        token_payload={},
        effective_role=membership.role,
    )


class TestRequireModule:
    def test_admin_bypasses(self, db_session, admin_user, default_company):
        checker = require_module("inventory", level="manager")
        auth = _ctx(db_session, admin_user, default_company)
        assert checker(auth=auth, db=db_session) is auth

    def test_no_grant_403(self, db_session, cashier_user, default_company):
        checker = require_module("inventory")
        auth = _ctx(db_session, cashier_user, default_company)
        with pytest.raises(HTTPException) as exc:
            checker(auth=auth, db=db_session)
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "module_access_denied"
        assert exc.value.detail["module"] == "inventory"

    def test_user_grant_passes_user_level(self, db_session, cashier_user, default_company):
        # backfill fixture already granted pos:user to cashier
        checker = require_module("pos")
        auth = _ctx(db_session, cashier_user, default_company)
        assert checker(auth=auth, db=db_session) is auth

    def test_user_grant_fails_manager_level(self, db_session, cashier_user, default_company):
        checker = require_module("pos", level="manager")
        auth = _ctx(db_session, cashier_user, default_company)
        with pytest.raises(HTTPException) as exc:
            checker(auth=auth, db=db_session)
        assert exc.value.status_code == 403

    def test_manager_grant_passes_both_levels(self, db_session, manager_user, default_company):
        auth = _ctx(db_session, manager_user, default_company)
        assert require_module("reports")(auth=auth, db=db_session) is auth
        assert require_module("reports", level="manager")(auth=auth, db=db_session) is auth

    def test_unknown_module_is_programming_error(self):
        with pytest.raises(ValueError):
            require_module("banking")
        with pytest.raises(ValueError):
            require_module("pos", level="root")

    def test_membership_none_403(self, db_session, super_admin_user, default_company):
        # super-admin company entry has membership=None but role admin -> bypass
        auth = AuthContext(
            user=super_admin_user,
            company=default_company,
            membership=None,
            token_payload={"super_admin_entry": True},
            effective_role="admin",
        )
        assert require_module("pos")(auth=auth, db=db_session) is auth
