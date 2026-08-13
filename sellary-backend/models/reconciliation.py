from sqlalchemy import (
    JSON,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class Reconciliation(Base):
    """A day the shop counted everything and settled what came before it.

    `effective_from` is the first local day still OPEN: everything strictly before
    local midnight of it is settled and no longer editable.
    """

    __tablename__ = "company_reconciliations"
    __table_args__ = (
        Index("ix_company_reconciliations_company_effective", "company_id", "effective_from"),
    )

    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    effective_from = Column(Date, nullable=False)
    note = Column(String(500), nullable=True)
    checker_report = Column(JSON, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company", back_populates="reconciliations")
