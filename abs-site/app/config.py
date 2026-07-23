"""应用配置 · 从 .env 读取"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 11000
    POSTGRES_DB: str = "XIN"
    POSTGRES_USER: str = "dbuser"
    POSTGRES_PASSWORD: str = ""
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


settings = Settings()
