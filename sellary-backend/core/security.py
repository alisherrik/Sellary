from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
import bcrypt
from .config import settings

ACCESS_TOKEN_TYPE = "access"
LOGIN_TOKEN_TYPE = "login"
OWNER_ACCESS_TOKEN_TYPE = "owner_access"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
    token_type: str = ACCESS_TOKEN_TYPE,
) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "token_type": token_type})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_login_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.LOGIN_TOKEN_EXPIRE_MINUTES)
    return create_access_token(data, expires_delta=expires_delta, token_type=LOGIN_TOKEN_TYPE)


def create_owner_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.OWNER_ACCESS_TOKEN_EXPIRE_MINUTES)
    return create_access_token(
        data,
        expires_delta=expires_delta,
        token_type=OWNER_ACCESS_TOKEN_TYPE,
    )


def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None
