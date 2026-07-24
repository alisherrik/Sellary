"""Unit tests for the MembershipModuleAccess model."""
import pytest
from sqlalchemy.exc import IntegrityError

from models.company_membership import CompanyMembership
from models.membership_module_access import MembershipModuleAccess, MODULES, LEVELS


class TestMembershipModuleAccessModel:
    def _make_membership(self, db_session, user, company):
        return (
            db_session.query(CompanyMembership)
            .filter_by(user_id=user.id, company_id=company.id)
            .one()
        )

    def test_module_and_level_constants(self):
        assert MODULES == ("pos", "inventory", "purchasing", "shop", "reports")
        assert LEVELS == ("user", "manager")

    def test_create_grant(self, db_session, cashier_user, default_company):
        membership = self._make_membership(db_session, cashier_user, default_company)
        grant = MembershipModuleAccess(
            membership_id=membership.id, module="inventory", level="user"
        )
        db_session.add(grant)
        db_session.flush()
        assert grant.id is not None

    def test_duplicate_module_rejected(self, db_session, cashier_user, default_company):
        membership = self._make_membership(db_session, cashier_user, default_company)
        db_session.add(
            MembershipModuleAccess(membership_id=membership.id, module="shop", level="user")
        )
        db_session.flush()
        db_session.add(
            MembershipModuleAccess(membership_id=membership.id, module="shop", level="manager")
        )
        with pytest.raises(IntegrityError):
            db_session.flush()
