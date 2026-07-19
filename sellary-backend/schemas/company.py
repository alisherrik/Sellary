from typing import Optional

from pydantic import BaseModel, Field


class MarketplaceSettingsUpdate(BaseModel):
    is_marketplace_enabled: Optional[bool] = None
    logo_url: Optional[str] = Field(None, max_length=500)
    marketplace_description: Optional[str] = Field(None, max_length=500)
    supports_delivery: Optional[bool] = None
    supports_pickup: Optional[bool] = None


class MarketplaceSettingsResponse(BaseModel):
    is_marketplace_enabled: bool
    logo_url: Optional[str] = None
    marketplace_description: Optional[str] = None
    supports_delivery: bool
    supports_pickup: bool

    class Config:
        from_attributes = True
