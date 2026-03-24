"""
Idempotency service for preventing duplicate request processing.

Provides concurrency-safe idempotency checking and storage using
database-level unique constraints and company-scoped request records.
"""
import hashlib
import json
from typing import Any, Optional, Tuple

from fastapi import HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.idempotency_key import IdempotencyKey


class IdempotencyConflictError(Exception):
    """Raised when the same key is reused with a different request body."""
    def __init__(self, key: str):
        self.key = key
        self.message = f"Idempotency key '{key}' was already used with a different request body"
        super().__init__(self.message)


class IdempotencyService:
    """
    Service for handling idempotency checks and storage.
    
    Usage:
        service = IdempotencyService(db)
        
        # Check if request was already processed
        cached = service.get_cached_response(key, company_id, user_id, endpoint, request_body)
        if cached:
            return cached  # Return stored response
            
        # Process request normally...
        response_data = process_request()
        
        # Store the response
        service.store_response(key, company_id, user_id, endpoint, request_body, response_data, 201)
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    @staticmethod
    def hash_request_body(body: Any) -> str:
        """Create a deterministic hash of the request body."""
        if body is None:
            body_str = ""
        elif isinstance(body, (dict, list)):
            # Sort keys for deterministic hashing
            body_str = json.dumps(body, sort_keys=True, default=str)
        else:
            body_str = str(body)
        return hashlib.sha256(body_str.encode()).hexdigest()
    
    def get_cached_response(
        self,
        key: str,
        company_id: int,
        user_id: int,
        endpoint: str,
        request_body: Any,
    ) -> Optional[Tuple[dict, int]]:
        """
        Check if an idempotent request was already processed.
        
        Args:
            key: Idempotency key from request header
            company_id: ID of the active company/tenant
            user_id: ID of the authenticated user
            endpoint: Endpoint path (e.g., "/api/sales")
            request_body: Request body for hash comparison
            
        Returns:
            Tuple of (response_body, status_code) if found, None otherwise
            
        Raises:
            IdempotencyConflictError: If key was used with different request body
        """
        existing = self.db.query(IdempotencyKey).filter(
            IdempotencyKey.key == key,
            IdempotencyKey.company_id == company_id,
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.endpoint == endpoint,
        ).first()
        
        if not existing:
            return None
        
        # Verify request body matches
        current_hash = self.hash_request_body(request_body)
        if existing.request_hash != current_hash:
            raise IdempotencyConflictError(key)
        
        # Return cached response
        response_body = json.loads(existing.response_body) if existing.response_body else {}
        return (response_body, existing.status_code)
    
    def store_response(
        self,
        key: str,
        company_id: int,
        user_id: int,
        endpoint: str,
        request_body: Any,
        response_body: Any,
        status_code: int,
    ) -> None:
        """
        Store the response for an idempotent request.
        
        This should be called BEFORE committing the main transaction,
        so that the idempotency record is created atomically with the
        business logic changes.
        
        Args:
            key: Idempotency key from request header
            company_id: ID of the active company/tenant
            user_id: ID of the authenticated user
            endpoint: Endpoint path
            request_body: Original request body
            response_body: Response to cache
            status_code: HTTP status code
        """
        request_hash = self.hash_request_body(request_body)

        existing = self.db.query(IdempotencyKey).filter(
            IdempotencyKey.key == key,
            IdempotencyKey.company_id == company_id,
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.endpoint == endpoint,
        ).first()
        if existing is not None:
            raise IdempotencyConflictError(key)
        
        # Serialize response body
        if isinstance(response_body, dict):
            response_json = json.dumps(response_body, default=str)
        else:
            # Handle Pydantic models
            response_json = json.dumps(
                response_body.dict() if hasattr(response_body, 'dict') else str(response_body),
                default=str
            )
        
        idempotency_record = IdempotencyKey(
            key=key,
            company_id=company_id,
            user_id=user_id,
            endpoint=endpoint,
            request_hash=request_hash,
            response_body=response_json,
            status_code=status_code,
        )
        
        try:
            self.db.add(idempotency_record)
            self.db.flush()  # Flush to detect conflicts before commit
        except IntegrityError as exc:
            # Race condition: another request stored the key first
            self.db.rollback()
            raise IdempotencyConflictError(key) from exc


def get_idempotency_key(request: Request) -> Optional[str]:
    """Extract idempotency key from request headers."""
    return request.headers.get("Idempotency-Key")


def require_idempotency_key(request: Request) -> str:
    """
    Extract idempotency key from request headers, raising error if missing.
    Use this as a FastAPI dependency for endpoints that require idempotency.
    """
    key = get_idempotency_key(request)
    if not key:
        raise HTTPException(
            status_code=400,
            detail="Idempotency-Key header is required for this operation"
        )
    
    # Validate format (should be UUID-like)
    if len(key) < 16 or len(key) > 64:
        raise HTTPException(
            status_code=400,
            detail="Idempotency-Key must be between 16 and 64 characters"
        )
    
    return key
