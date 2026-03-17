from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.database import get_db
from schemas.user import UserLogin, Token, UserCreate, User
from services.auth_service import AuthService
from api.dependencies import get_current_user, require_admin
from models.user import User as UserModel

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(user_login: UserLogin, db: Session = Depends(get_db)):
    auth_service = AuthService(db)
    user = auth_service.authenticate(user_login.username, user_login.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    return auth_service.create_token(user)


@router.get("/me", response_model=User)
def get_me(current_user: UserModel = Depends(get_current_user)):
    return current_user


@router.post("/logout")
def logout():
    return {"message": "Successfully logged out"}


@router.post("/register", response_model=User, status_code=status.HTTP_201_CREATED)
def register(user_create: UserCreate, db: Session = Depends(get_db)):
    auth_service = AuthService(db)
    try:
        user = auth_service.create_user(user_create)
        return user
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
