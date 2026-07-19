from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from api.dependencies import OwnerContext, require_super_admin
from core.database import get_db
from core.rate_limiter import owner_login_rate_limiter
from schemas.admin import (
    ManagedCompanyCreate,
    ManagedCompanyResponse,
    ManagedCompanyUpdate,
    ManagedMembershipCreate,
    ManagedMembershipResponse,
    ManagedMembershipUpdate,
    ManagedUserCreate,
    ManagedUserResponse,
    ManagedUserUpdate,
    OwnerLoginRequest,
    OwnerLoginResponse,
    OwnerSession,
)
from schemas.platform_settings import (
    PlatformSettingsResponse,
    PlatformSettingsUpdate,
)
from schemas.user import CompanySession
from services.admin_management import AdminManagementService
from services.auth_service import AuthService
from services.platform_settings_service import PlatformSettingsService

router = APIRouter(prefix="/owner", tags=["owner"])


@router.post("/auth/login", response_model=OwnerLoginResponse)
def owner_login(request: Request, payload: OwnerLoginRequest, db: Session = Depends(get_db)):
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    if owner_login_rate_limiter.is_rate_limited(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
        )

    auth_service = AuthService(db)
    user = auth_service.authenticate_owner(payload.username, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    owner_login_rate_limiter.reset_key(client_ip)
    return auth_service.create_owner_login_response(user)


@router.get("/session", response_model=OwnerSession)
def get_owner_session(owner: OwnerContext = Depends(require_super_admin), db: Session = Depends(get_db)):
    return AuthService(db).get_owner_session(owner.user)


@router.get("/users", response_model=list[ManagedUserResponse])
def get_users(
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    return AdminManagementService(db).list_users(search=search)


@router.post("/users", response_model=ManagedUserResponse, status_code=201)
def create_user(
    payload: ManagedUserCreate,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).create_user(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/users/{user_id}", response_model=ManagedUserResponse)
def update_user(
    user_id: int,
    payload: ManagedUserUpdate,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).update_user(user_id, payload)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.get("/companies", response_model=list[ManagedCompanyResponse])
def get_companies(
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    return AdminManagementService(db).list_companies(search=search)


@router.post("/companies", response_model=ManagedCompanyResponse, status_code=201)
def create_company(
    payload: ManagedCompanyCreate,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).create_company(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/companies/{company_id}", response_model=ManagedCompanyResponse)
def update_company(
    company_id: int,
    payload: ManagedCompanyUpdate,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).update_company(company_id, payload)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.get("/memberships", response_model=list[ManagedMembershipResponse])
def get_memberships(
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    return AdminManagementService(db).list_memberships(search=search)


@router.post("/memberships", response_model=ManagedMembershipResponse, status_code=201)
def create_membership(
    payload: ManagedMembershipCreate,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).create_membership(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/memberships/{membership_id}", response_model=ManagedMembershipResponse)
def update_membership(
    membership_id: int,
    payload: ManagedMembershipUpdate,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    del owner
    try:
        return AdminManagementService(db).update_membership(membership_id, payload)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.post("/companies/{company_id}/enter", response_model=CompanySession)
def enter_company(
    company_id: int,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    try:
        return AdminManagementService(db).enter_company_as_super_admin(owner.user, company_id)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.get("/platform-settings", response_model=PlatformSettingsResponse)
def get_platform_settings(
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    """Masked platform secrets (bot token / webhook secret / cloudinary URL).

    Never returns plaintext — only is_set/masked/source per key.
    """
    del owner
    return PlatformSettingsService(db).get_masked()


@router.put("/platform-settings", response_model=PlatformSettingsResponse)
def update_platform_settings(
    payload: PlatformSettingsUpdate,
    db: Session = Depends(get_db),
    owner: OwnerContext = Depends(require_super_admin),
):
    """Set platform secrets. Blank/omitted fields preserve the stored value."""
    del owner
    service = PlatformSettingsService(db)
    service.update_from_payload(payload.model_dump())
    db.commit()
    return service.get_masked()
