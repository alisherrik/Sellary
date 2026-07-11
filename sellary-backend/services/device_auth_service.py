"""Device-auth business logic for the offline-first cashier (C2).

The device credential is an opaque ``secrets.token_urlsafe(48)`` string stored
only as its sha256 hex digest. ``/refresh`` verifies it in constant time, re-
checks the pinned membership (same invariant as ``get_auth_context``), and mints
a normal ``token_type="access"`` 24h JWT that every protected endpoint accepts.
"""
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from core.config import settings
from core.security import create_access_token
from models.cashier_device import CashierDevice
from models.company_membership import CompanyMembership
from repositories.cashier_device_repository import CashierDeviceRepository


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_aware_utc(dt: datetime) -> datetime:
    """Normalise a possibly-naive stored datetime to aware UTC for comparison."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class DeviceAuthError(Exception):
    """Carries an HTTP status + detail for the router to surface."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class DeviceAuthService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = CashierDeviceRepository(db)

    def register(
        self,
        company_id: int,
        user_id: int,
        name: Optional[str],
        device_id: Optional[str],
    ) -> Tuple[CashierDevice, str]:
        """Register (or self-heal re-register) the shop's single cashier device.

        Deactivates any prior active device for the company (1-device/shop),
        then rotates the row that matches ``device_id`` if it exists, else
        inserts a new one. Returns ``(device, plaintext_token)``.
        """
        for existing in self.repo.get_active_by_company(company_id):
            existing.is_active = False

        token = secrets.token_urlsafe(48)
        token_hash = _hash_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.DEVICE_TOKEN_EXPIRE_DAYS
        )

        device = self.repo.get_by_device_id(device_id) if device_id else None
        if device is not None:
            device.company_id = company_id
            device.user_id = user_id
            device.name = name
            device.token_hash = token_hash
            device.is_active = True
            device.expires_at = expires_at
            device.created_by_user_id = user_id
            self.db.flush()
        else:
            device = CashierDevice(
                company_id=company_id,
                user_id=user_id,
                device_id=device_id or str(uuid.uuid4()),
                name=name,
                token_hash=token_hash,
                is_active=True,
                expires_at=expires_at,
                created_by_user_id=user_id,
            )
            self.repo.add(device)
        return device, token

    def refresh(self, device_id: str, device_token: str) -> Tuple[str, datetime]:
        """Verify the device credential and mint a fresh 24h access_token.

        Raises DeviceAuthError(401) for a bad/inactive/expired token and
        DeviceAuthError(403) if the pinned membership was revoked while offline.
        Returns ``(access_token, new_device_expiry)``.
        """
        device = self.repo.get_by_device_id(device_id)
        provided_hash = _hash_token(device_token)
        # Constant-time compare even when the device is missing (no timing oracle).
        stored_hash = device.token_hash if device is not None else "0" * 64
        token_ok = hmac.compare_digest(provided_hash, stored_hash)
        if device is None or not token_ok or not device.is_active:
            raise DeviceAuthError(401, "Invalid device credentials")

        now = datetime.now(timezone.utc)
        if device.expires_at is not None and _as_aware_utc(device.expires_at) < now:
            raise DeviceAuthError(401, "Device token expired")

        membership = (
            self.db.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == device.user_id,
                CompanyMembership.company_id == device.company_id,
                CompanyMembership.is_active == True,  # noqa: E712
            )
            .first()
        )
        if (
            membership is None
            or membership.company is None
            or not membership.company.is_active
            or membership.user is None
            or not membership.user.is_active
        ):
            raise DeviceAuthError(403, "Device membership revoked")

        access_token = create_access_token(
            data={
                "sub": membership.user.username,
                "user_id": device.user_id,
                "company_id": device.company_id,
                "role": membership.role,
                "global_role": membership.user.global_role,
                # Additive claim that existing decoders ignore.
                "device_id": device.device_id,
            },
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        device.last_seen_at = now
        device.expires_at = now + timedelta(days=settings.DEVICE_TOKEN_EXPIRE_DAYS)
        self.db.flush()
        return access_token, device.expires_at

    def revoke(self, company_id: int, device_id: str) -> CashierDevice:
        device = self.repo.get_by_device_id(device_id)
        if device is None or device.company_id != company_id:
            raise DeviceAuthError(404, "Device not found")
        device.is_active = False
        self.db.flush()
        return device

    def list_devices(self, company_id: int) -> List[CashierDevice]:
        return self.repo.list_by_company(company_id)
