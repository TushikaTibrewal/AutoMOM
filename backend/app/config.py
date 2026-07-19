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
    ai_provider: str = "auto"  # auto | openai | gemini | groq | mock
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    # Groq: OpenAI-compatible, fast, generous free tier
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    groq_whisper_model: str = "whisper-large-v3-turbo"  # live audio transcription
    groq_vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"  # read Meet roster
    ai_max_retries: int = 3
    ai_timeout_seconds: int = 60

    # PDF backend: auto | weasyprint | chromium
    pdf_engine: str = "auto"

    # Paths
    templates_dir: Path = BASE_DIR / "templates"
    exports_dir: Path = BASE_DIR / "exports"
    uploads_dir: Path = BASE_DIR / "uploads"

    # Limits
    max_transcript_chars: int = 200_000
    max_upload_bytes: int = 5 * 1024 * 1024
    rate_limit_generate: str = "10/minute"
    rate_limit_extract: str = "60/minute"  # live mode polls this frequently
    rate_limit_auth: str = "20/minute"
    rate_limit_default: str = "120/minute"

    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Email (Resend). If no key is set, verification links are logged instead of sent.
    resend_api_key: str = ""
    resend_from: str = "AutoMOM <onboarding@resend.dev>"
    frontend_url: str = "http://localhost:5173"
    require_email_verification: bool = False  # if True, unverified users cannot log in
    verification_token_ttl_hours: int = 48

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in ("production", "prod")

    def validate_for_production(self) -> list[str]:
        """Refuse to boot on secret-critical misconfig; warn on the rest.

        Returns non-fatal warnings so the caller can log them. Only a weak JWT
        secret or DEBUG on are hard blockers — a CORS origin can be corrected
        after first boot (you often need the deployed URL first), so it warns.
        """
        import logging

        fatal = []
        if self.jwt_secret_key in ("", "change-me-in-production"):
            fatal.append("JWT_SECRET_KEY must be set to a strong random value")
        if len(self.jwt_secret_key) < 32:
            fatal.append("JWT_SECRET_KEY must be at least 32 characters")
        if self.debug:
            fatal.append("DEBUG must be false in production")
        if fatal:
            raise RuntimeError(
                "Refusing to start in production with insecure configuration:\n  - "
                + "\n  - ".join(fatal)
            )

        warnings = []
        if any("localhost" in o for o in self.cors_origin_list):
            warnings.append("CORS_ORIGINS still includes localhost - set it to your frontend URL")
        if not self.cors_origin_list:
            warnings.append("CORS_ORIGINS is empty - the browser frontend will be blocked by CORS")
        for w in warnings:
            logging.getLogger("automom.config").warning(w)
        return warnings


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.exports_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    if settings.is_production:
        settings.validate_for_production()
    return settings
