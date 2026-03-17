from datetime import timedelta
from typing import Optional
from sqlalchemy.orm import Session
from repositories.user_repository import UserRepository
from models.user import User
from schemas.user import UserCreate, Token
from core.security import verify_password, get_password_hash, create_access_token
from core.config import settings


class AuthService:
    def __init__(self, db: Session):
        self.db = db
        self.user_repo = UserRepository(db)

    def authenticate(self, username: str, password: str) -> Optional[User]:
        user = self.user_repo.get_by_username(username)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        if not user.is_active:
            return None
        return user

    def create_user(self, user_create: UserCreate) -> User:
        if self.user_repo.get_by_username(user_create.username):
            raise ValueError(f"Username '{user_create.username}' already exists")
        if self.user_repo.get_by_email(user_create.email):
            raise ValueError(f"Email '{user_create.email}' already exists")

        hashed_password = get_password_hash(user_create.password)
        user = User(
            username=user_create.username,
            email=user_create.email,
            full_name=user_create.full_name,
            hashed_password=hashed_password,
            role=user_create.role,
        )
        return self.user_repo.create(user)

    def create_token(self, user: User) -> Token:
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": user.username, "user_id": user.id, "role": user.role},
            expires_delta=access_token_expires,
        )
        return Token(
            access_token=access_token,
            token_type="bearer",
            user=user,
        )
