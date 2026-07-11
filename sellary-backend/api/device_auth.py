from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from api.dependencies import (
    AuthContext,
    get_auth_context,
    require_manager_or_admin,
)
from core.database import get_db
from core.rate_limiter import login_rate_limiter
from schemas.device import (
    DeviceListItem,
    DeviceRefreshRequest,
    DeviceRefreshResponse,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
)
from services.device_auth_service import DeviceAuthError, DeviceAuthService

router = APIRouter(prefix="/auth/devices", tags=["devices"])


def _client_ip(request: Request) -> str:
    return (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


@router.post("/register", response_model=DeviceRegisterResponse)
def register_device(
    body: DeviceRegisterRequest,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    # Any authenticated company member may self-register on first run.
    if login_rate_limiter.is_rate_limited(_client_ip(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
        )
    service = DeviceAuthService(db)
    device, token = service.register(
        auth.company_id, auth.user.id, body.name, body.device_id
    )
    db.commit()
    return DeviceRegisterResponse(
        device_id=device.device_id,
        device_token=token,
        name=device.name,
        expires_at=device.expires_at,
    )


@router.post("/refresh", response_model=DeviceRefreshResponse)
def refresh_device(
    body: DeviceRefreshRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # NO bearer: this is the offline-return call. Rate-limit by device_id + IP.
    if login_rate_limiter.is_rate_limited(f"device:{body.device_id}:{_client_ip(request)}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
        )
    service = DeviceAuthService(db)
    try:
        access_token, expires_at = service.refresh(body.device_id, body.device_token)
    except DeviceAuthError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    db.commit()
    return DeviceRefreshResponse(
        access_token=access_token, token_type="bearer", expires_at=expires_at
    )


@router.delete("/{device_id}")
def revoke_device(
    device_id: str,
    auth: AuthContext = Depends(require_manager_or_admin),
    db: Session = Depends(get_db),
):
    service = DeviceAuthService(db)
    try:
        service.revoke(auth.company_id, device_id)
    except DeviceAuthError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    db.commit()
    return {"message": "Device revoked"}


@router.get("", response_model=list[DeviceListItem])
def list_devices(
    auth: AuthContext = Depends(require_manager_or_admin),
    db: Session = Depends(get_db),
):
    service = DeviceAuthService(db)
    return service.list_devices(auth.company_id)
