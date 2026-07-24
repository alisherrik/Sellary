from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, require_admin
from core.database import get_db
from schemas.admin import (
    CompanyAdminMembershipCreate,
    CompanyAdminUserCreate,
    ManagedMembershipResponse,
    ManagedMembershipUpdate,
    ManagedUserResponse,
    MembershipModulesPayload,
    MembershipModulesResponse,
)
from services.admin_management import AdminManagementService

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[ManagedUserResponse])
def get_company_users(
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    return AdminManagementService(db).list_users(search=search, company_id=auth.company_id)


@router.post("/users", response_model=ManagedUserResponse, status_code=201)
def create_company_user(
    payload: CompanyAdminUserCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    try:
        return AdminManagementService(db).create_company_admin_user(auth.company_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/memberships", response_model=ManagedMembershipResponse, status_code=201)
def create_company_membership(
    payload: CompanyAdminMembershipCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    try:
        return AdminManagementService(db).create_company_membership(auth.company_id, payload)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.patch("/memberships/{membership_id}", response_model=ManagedMembershipResponse)
def update_company_membership(
    membership_id: int,
    payload: ManagedMembershipUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    try:
        return AdminManagementService(db).update_membership(
            membership_id,
            payload,
            allowed_company_id=auth.company_id,
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.get("/memberships/{membership_id}/modules", response_model=MembershipModulesResponse)
def get_membership_modules(
    membership_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    try:
        return AdminManagementService(db).get_membership_modules(
            membership_id, allowed_company_id=auth.company_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("/memberships/{membership_id}/modules", response_model=MembershipModulesResponse)
def set_membership_modules(
    membership_id: int,
    payload: MembershipModulesPayload,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    try:
        return AdminManagementService(db).set_membership_modules(
            membership_id, allowed_company_id=auth.company_id, modules=payload.modules
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc))
