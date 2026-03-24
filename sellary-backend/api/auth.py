from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.database import get_db
from schemas.user import (
    AuthSession,
    CompanySelectRequest,
    CompanySession,
    LoginResponse,
    User,
    UserCreate,
    UserLogin,
)
from services.auth_service import AuthService
from api.dependencies import (
    AuthContext,
    get_auth_context,
    get_login_token_payload,
    require_admin,
)
from repositories.user_repository import UserRepository

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(user_login: UserLogin, db: Session = Depends(get_db)):
    auth_service = AuthService(db)
    user = auth_service.authenticate(user_login.username, user_login.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    try:
        return auth_service.create_login_response(user)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.post("/select-company", response_model=CompanySession)
def select_company(
    company_select: CompanySelectRequest,
    payload: dict = Depends(get_login_token_payload),
    db: Session = Depends(get_db),
):
    user_id = payload.get("user_id")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    user = UserRepository(db).get_by_id(user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    auth_service = AuthService(db)
    try:
        return auth_service.create_company_session(user, company_select.company_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.post("/switch-company", response_model=CompanySession)
def switch_company(
    company_select: CompanySelectRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
):
    auth_service = AuthService(db)
    try:
        return auth_service.create_company_session(auth.user, company_select.company_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.get("/me", response_model=AuthSession)
def get_me(auth: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    auth_service = AuthService(db)
    return auth_service.get_auth_session(
        auth.user,
        auth.company_id,
        current_role=auth.role,
        allow_super_admin_company=auth.is_super_admin_company_entry,
    )


@router.post("/logout")
def logout():
    return {"message": "Successfully logged out"}


@router.post("/register", response_model=User, status_code=status.HTTP_201_CREATED)
def register(
    user_create: UserCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_admin),
):
    auth_service = AuthService(db)
    try:
        user = auth_service.create_user(user_create, auth.company_id)
        return user
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
