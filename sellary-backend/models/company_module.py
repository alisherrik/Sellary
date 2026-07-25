from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class CompanyModule(Base):
    """Company-level module enablement. A row means the company has it.

    This is the commercial layer — what the customer bought. It is owner-
    controlled and intersected with the per-membership grant to decide what a
    given user may open.
    """

    __tablename__ = "company_modules"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module = Column(String(20), nullable=False)
    enabled_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "module", name="uq_company_modules_company_module"),
    )

    company = relationship("Company", back_populates="modules")
