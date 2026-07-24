from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base

MODULES = ("pos", "inventory", "purchasing", "shop", "reports")
LEVELS = ("user", "manager")


class MembershipModuleAccess(Base):
    """Per-membership module grant. No row = no access. Admin role bypasses."""

    __tablename__ = "membership_module_access"

    id = Column(Integer, primary_key=True, index=True)
    membership_id = Column(
        Integer,
        ForeignKey("company_memberships.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module = Column(String(20), nullable=False)
    level = Column(String(10), nullable=False, default="user")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("membership_id", "module", name="uq_module_access_membership_module"),
    )

    membership = relationship("CompanyMembership", backref="module_access")
