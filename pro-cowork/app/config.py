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

    # 雪花 ID 工作节点 (sys_users 双写主键用; rag-cowork=1, mcp-cowork=2, 本工程=3)
    SNOWFLAKE_WORKER_ID: int = 3

    # 主推理模型 (智能体对话/会议纪要等主力生成)
    MAIN_API_URL: str = ""
    MAIN_API_KEY: str = ""
    MAIN_MODEL: str = ""

    # 轻量快推模型 (意图识别/内容润色/概括等快速任务)
    SMALL_API_URL: str = ""
    SMALL_API_KEY: str = ""
    SMALL_MODEL: str = ""

    # 代码生成模型 (预留: AI coding)
    CODER_API_URL: str = ""
    CODER_API_KEY: str = ""
    CODER_MODEL: str = ""

    # 向量抽取模型 (知识库构建)
    EMBEDDING_API_URL: str = ""
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_MODEL: str = ""

    # 结果重排模型 (RAG 重排)
    RERANKER_API_URL: str = ""
    RERANKER_API_KEY: str = ""
    RERANKER_MODEL: str = ""

    # 视觉多模态模型 (图片内容识别)
    VISION_API_URL: str = ""
    VISION_API_KEY: str = ""
    VISION_MODEL: str = ""

    # ASR 语音识别配置 (录音转文字)
    ASR_API_URL: str = ""
    ASR_API_KEY: str = ""
    ASR_MODEL: str = "paraformer-large"
    ASR_CHUNK_MS: int = 120000

    # TTS 语音合成配置 (文字合成语音)
    TTS_API_URL: str = ""
    TTS_API_KEY: str = ""
    TTS_MODEL: str = ""
    TTS_CHUNK_MS: int = 10000

    # mineru 算力网关 (扫描件 PDF 深度布局分析; 宿主机 mineru 容器, 留空则跳过该级)
    MINERU_API_URL: str = ""

    # 知识库 MCP 服务 (rag-cowork FastMCP streamable-HTTP; 知识库维护分身经此管理知识库)
    KB_MCP_URL: str = "http://localhost:8093/mcp"

    # 技链工坊 IM 推送接口 (mcp-cowork; send_im 工具经此向用户个人 IM 通道发消息)
    MCP_IM_URL: str = "http://localhost:8094/api/im/send"

    # 技链工坊工具巡检接口 (mcp-cowork; run_tool_inspection 工具经此触发巡检)
    MCP_INSPECT_URL: str = "http://localhost:8094/api/inspect"

    # MinIO 对象存储 (上传文件同步归档; 路径: {分身}/{成员}/{yyyymm}/{文件名})
    MINIO_ENDPOINT: str = ""
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MINIO_BUCKET: str = "xuanpu"
    MINIO_SECURE: bool = False
    MINIO_REGION: str = "cn-north-1"  # 服务端 MINIO_REGION 配置, 签名区域不匹配会报 AuthorizationHeaderMalformed

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
