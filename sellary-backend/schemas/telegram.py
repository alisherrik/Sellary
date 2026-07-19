from pydantic import BaseModel, ConfigDict


class _Loose(BaseModel):
    model_config = ConfigDict(extra="ignore")


class TelegramChat(_Loose):
    id: int


class TelegramMessage(_Loose):
    chat: TelegramChat | None = None
    text: str | None = None


class TelegramUpdate(_Loose):
    update_id: int | None = None
    message: TelegramMessage | None = None
