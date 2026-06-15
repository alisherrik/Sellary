from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from core.database import Base


class ReversalOperation(Base):
    __tablename__ = "reversal_operations"
    __table_args__ = (
        Index(
            "ix_reversal_operations_company_entity",
            "company_id",
            "entity_type",
            "entity_id",
        ),
    )

    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(Integer, nullable=False)
    operation_type = Column(String(40), nullable=False)
    reason = Column(Text, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    impact = Column(
        JSON,
        nullable=False,
        default=dict,
        server_default=text("'{}'::json"),
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company", back_populates="reversal_operations")
    user = relationship("User")
