"""mcp-cowork 配置 · pydantic-settings (与 rag-cowork 共用 XIN 库与 sys_users)"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # PostgreSQL
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 11000
    POSTGRES_DB: str = "XIN"
    POSTGRES_USER: str = "dbuser"
    POSTGRES_PASSWORD: str = ""

    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # 雪花 ID 工作节点 (与 rag-cowork 区分)
    SNOWFLAKE_WORKER_ID: int = 2

    # MCP 调用超时 (秒): 连接/读取 (rag 解析类工具耗时长, 给足余量)
    MCP_CONNECT_TIMEOUT_S: float = 10.0
    MCP_READ_TIMEOUT_S: float = 300.0

    # 工具自动巡检间隔 (小时): 0 = 关闭定时巡检
    INSPECT_INTERVAL_H: float = 6.0

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


settings = Settings()
