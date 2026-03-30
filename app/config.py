from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Google Cloud / Vertex AI — MUST be set via .env
    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"
    google_application_credentials: str = "/app/gemini_creds.json"
    gemini_model: str = "gemini-2.5-flash-lite"

    # Database (defaults for docker-compose dev environment)
    database_url: str = "postgresql+asyncpg://pelgo:pelgo@postgres:5432/pelgo"
    database_url_sync: str = "postgresql://pelgo:pelgo@postgres:5432/pelgo"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # App
    log_level: str = "INFO"
    worker_concurrency: int = 2
    tool_timeout_seconds: int = 30
    max_retries: int = 3

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
