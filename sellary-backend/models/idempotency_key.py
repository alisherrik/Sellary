"""
Idempotency Key model for preventing duplicate request processing.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.sql import func
from core.database import Base


class IdempotencyKey(Base):
    """
    Stores idempotency keys to prevent duplicate processing of requests.
    
    A unique constraint on (key, user_id, endpoint) ensures that the same
    idempotency key can only be used once per user per endpoint.
    """
    __tablename__ = "idempotency_keys"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(64), nullable=False)  # UUID format
    user_id = Column(Integer, nullable=False)
    endpoint = Column(String(255), nullable=False)
    request_hash = Column(String(64), nullable=False)  # SHA-256 hash of request body
    response_body = Column(Text, nullable=True)  # JSON response
    status_code = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    __table_args__ = (
        Index('ix_idempotency_key_user_endpoint', 'key', 'user_id', 'endpoint', unique=True),
    )
