"""应用配置 · 从 .env 读取数据库等配置"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """从 pro-site/.env 读取配置"""

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # PostgreSQL
    POSTGRES_HOST: str = "pg_db"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "ragKB"
    POSTGRES_USER: str = "dbuser"
    POSTGRES_PASSWORD: str = ""

    # 系统配置
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"

    # LLM 配置
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"

    # ASR 语音识别配置 (录音转文字)
    ASR_API_URL: str = ""
    ASR_API_KEY: str = ""
    ASR_MODEL: str = "paraformer-large"
    ASR_CHUNK_MS: int = 120000

    @property
    def database_url(self) -> str:
        """构建 SQLAlchemy async DATABASE_URL (postgresql+asyncpg://)"""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def database_url_sync(self) -> str:
        """同步 URL (用于种子脚本等场景)"""
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


settings = Settings()
