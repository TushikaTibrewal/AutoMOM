"""Application configuration loaded from environment variables."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AutoMOM"
    environment: str = "development"
    debug: bool = True

    # Database
    database_url: str = f"sqlite:///{BASE_DIR / 'automom.db'}"

    # Auth
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    # AI providers
    ai_provider: str = "auto"  # auto | openai | gemini | mock
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-pro"
    ai_max_retries: int = 3
    ai_timeout_seconds: int = 60

    # PDF backend: auto | weasyprint | chromium
    pdf_engine: str = "auto"

    # Paths
    templates_dir: Path = BASE_DIR / "templates"
    exports_dir: Path = BASE_DIR / "exports"
    uploads_dir: Path = BASE_DIR / "uploads"

    # Limits
    max_transcript_chars: int = 60_000
    max_upload_bytes: int = 5 * 1024 * 1024
    rate_limit_generate: str = "10/minute"
    rate_limit_auth: str = "20/minute"
    rate_limit_default: str = "120/minute"

    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in ("production", "prod")

    def validate_for_production(self) -> None:
        """Refuse to run in production with insecure defaults."""
        problems = []
        if self.jwt_secret_key in ("", "change-me-in-production"):
            problems.append("JWT_SECRET_KEY must be set to a strong random value")
        if len(self.jwt_secret_key) < 32:
            problems.append("JWT_SECRET_KEY must be at least 32 characters")
        if self.debug:
            problems.append("DEBUG must be false in production")
        if any("localhost" in o for o in self.cors_origin_list):
            problems.append("CORS_ORIGINS must not include localhost in production")
        if problems:
            raise RuntimeError(
                "Refusing to start in production with insecure configuration:\n  - "
                + "\n  - ".join(problems)
            )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.exports_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    if settings.is_production:
        settings.validate_for_production()
    return settings
