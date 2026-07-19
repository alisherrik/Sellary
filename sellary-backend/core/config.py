import warnings
from functools import lru_cache

from pydantic_settings import BaseSettings


def _parse_cors_origins(value: str) -> list[str]:
    return [origin.strip() for origin in value.split(",") if origin.strip()]


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/sellary_db"

    # Security
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    LOGIN_TOKEN_EXPIRE_MINUTES: int = 10
    OWNER_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    # Environment detection
    SELLARY_ENV: str = "production"

    # Fallback IANA zone for companies with no timezone set. Reports close the
    # business day on this clock; the server itself runs UTC.
    DEFAULT_TIMEZONE: str = "Asia/Dushanbe"

    # Cloudinary image hosting. Format: cloudinary://<api_key>:<api_secret>@<cloud_name>
    # Empty disables uploads (endpoints return 503). Read from env in production.
    CLOUDINARY_URL: str = ""

    # Bootstrap super admin
    SUPER_ADMIN_USERNAME: str | None = None
    SUPER_ADMIN_EMAIL: str | None = None
    SUPER_ADMIN_PASSWORD: str | None = None
    SUPER_ADMIN_FULL_NAME: str | None = None

    # API
    API_V1_STR: str = "/api"
    PROJECT_NAME: str = "Sellary"
    VERSION: str = "1.0.0"

    # CORS — defaults for local dev; set BACKEND_CORS_ORIGINS_RAW in production
    BACKEND_CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3005",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        "http://127.0.0.1:3003",
        "http://127.0.0.1:3004",
        "http://127.0.0.1:3005",
        "http://192.168.1.108:3000",
        "http://192.168.1.108:3001",
        "http://192.168.1.108:3002",
        "https://sellary-client.netlify.app",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    BACKEND_CORS_ORIGINS_RAW: str = ""

    # Pagination
    DEFAULT_PAGE_SIZE: int = 50
    MAX_PAGE_SIZE: int = 200

    # Sync
    # DEPRECATED: no longer overrides ledger safety. Exact FIFO inventory
    # accounting cannot back negative stock, so a synced sale that exceeds
    # available layer stock is always rejected (recorded as a failed per-sale
    # result), regardless of this flag. Kept only for backwards compatibility;
    # a warning is emitted at startup when it is left enabled.
    SYNC_ALLOW_OVERSELL: bool = True

    # Cashier device auth: opaque device_token lifetime, sliding-renewed on every
    # /api/auth/devices/refresh. Additive default; the minted access_token is the
    # unchanged 24h ACCESS_TOKEN_EXPIRE_MINUTES JWT.
    DEVICE_TOKEN_EXPIRE_DAYS: int = 180

    # Telegram Mini App marketplace. BOT token is used to verify shopper initData
    # HMAC-SHA256 signatures. Empty disables the /api/shop identity path (returns
    # 503). Read from env in production. Max-age rejects replayed/stale initData.
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_AUTH_MAX_AGE_SECONDS: int = 86400  # 24h

    # Telegram bot webhook (F6 new-order notifications). Secret guards
    # POST /api/telegram/webhook via the X-Telegram-Bot-Api-Secret-Token header.
    # Empty → the webhook rejects ALL calls (fail-closed) so an unconfigured
    # deployment cannot be driven by forged updates.
    TELEGRAM_WEBHOOK_SECRET: str = ""
    # Bot API base; overridable in tests / for a local mock. No trailing slash.
    TELEGRAM_API_BASE_URL: str = "https://api.telegram.org"

    def model_post_init(self, __context) -> None:
        if self.BACKEND_CORS_ORIGINS_RAW:
            self.BACKEND_CORS_ORIGINS = _parse_cors_origins(self.BACKEND_CORS_ORIGINS_RAW)

        is_prod = self.SELLARY_ENV == "production"
        unsafe_keys = (
            "your-secret-key-change-in-production",
            "your-secret-key-change-in-production-use-openssl-rand-hex-32",
        )
        if self.SECRET_KEY in unsafe_keys or len(self.SECRET_KEY) < 32:
            if is_prod:
                raise ValueError(
                    "Production requires a strong SECRET_KEY (>=32 chars, not the default). "
                    "Generate with: openssl rand -hex 32"
                )
            warnings.warn(
                "Using default/weak SECRET_KEY. This is unsafe for production. "
                "Set SECRET_KEY in .env before deploying.",
                RuntimeWarning,
                stacklevel=2,
            )

        if self.SYNC_ALLOW_OVERSELL:
            warnings.warn(
                "SYNC_ALLOW_OVERSELL is enabled but no longer overrides ledger "
                "safety: synced sales that exceed available FIFO layer stock are "
                "always rejected. The flag is deprecated and can be removed.",
                RuntimeWarning,
                stacklevel=2,
            )

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
