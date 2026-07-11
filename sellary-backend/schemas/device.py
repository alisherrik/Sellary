from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DeviceRegisterRequest(BaseModel):
    # Optional stable per-install UUID from the cashier; server generates one if
    # absent. Passing an existing device_id rotates that row (self-healing).
    name: Optional[str] = None
    device_id: Optional[str] = None


class DeviceRegisterResponse(BaseModel):
    device_id: str
    device_token: str  # plaintext — returned exactly once
    name: Optional[str] = None
    expires_at: Optional[datetime] = None


class DeviceRefreshRequest(BaseModel):
    device_id: str
    device_token: str


class DeviceRefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: Optional[datetime] = None  # new (sliding-renewed) device-token expiry


class DeviceListItem(BaseModel):
    id: int
    device_id: str
    name: Optional[str] = None
    is_active: bool
    expires_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
