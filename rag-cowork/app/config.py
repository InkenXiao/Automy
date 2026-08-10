"""应用配置 · 从 rag-cowork/.env 读取; 容器内由 .docker.env 环境变量覆盖"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """rag-cowork 配置 (环境变量优先级高于 .env 文件)"""

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

    # 系统配置
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"

    # 主推理模型 (实体/关系抽取, RAG 答案生成)
    MAIN_API_URL: str = ""
    MAIN_API_KEY: str = ""
    MAIN_MODEL: str = ""

    # 轻量快推模型 (概括等快速任务; 未配置时回退主推理模型)
    SMALL_API_URL: str = ""
    SMALL_API_KEY: str = ""
    SMALL_MODEL: str = ""

    # 向量抽取模型
    EMBEDDING_API_URL: str = ""
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_MODEL: str = ""

    # 结果重排模型 (RAG 重排, 预留)
    RERANKER_API_URL: str = ""
    RERANKER_API_KEY: str = ""
    RERANKER_MODEL: str = ""

    # 视觉多模态模型 (图片/表格内容识别)
    VISION_API_URL: str = ""
    VISION_API_KEY: str = ""
    VISION_MODEL: str = ""

    # ASR 语音识别 (语音知识库文件转文字)
    ASR_API_URL: str = ""
    ASR_API_KEY: str = ""
    ASR_MODEL: str = "paraformer-large"
    ASR_CHUNK_MS: int = 120000

    # mineru 算力网关 (扫描件 PDF 深度解析; 留空则跳过该级)
    MINERU_API_URL: str = ""

    # Milvus 向量库
    MILVUS_HOST: str = "localhost"
    MILVUS_PORT: int = 19530
    MILVUS_DB_NAME: str = "default"

    # Neo4j 图数据库
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = ""

    # MinIO 对象存储 (知识库文件归档: {kb_id}/{yyyymm}/{文件名})
    MINIO_ENDPOINT: str = ""
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MINIO_BUCKET: str = "xuanpu"
    MINIO_SECURE: bool = False
    MINIO_REGION: str = "cn-north-1"
    RAG_MINIO_BUCKET: str = "xuanpu-rag"

    # RAG 参数
    EMBEDDING_DIM: int = 1024
    SNOWFLAKE_WORKER_ID: int = 1
    CHUNK_SIZE: int = 800        # 文本分块目标字符数
    CHUNK_OVERLAP: int = 120     # 分块重叠字符数

    @property
    def database_url(self) -> str:
        """SQLAlchemy async DATABASE_URL (postgresql+asyncpg://)"""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def small_api_url(self) -> str:
        """轻量模型未配置时回退主推理模型"""
        return self.SMALL_API_URL or self.MAIN_API_URL

    @property
    def small_api_key(self) -> str:
        return self.SMALL_API_KEY or self.MAIN_API_KEY

    @property
    def small_model(self) -> str:
        return self.SMALL_MODEL or self.MAIN_MODEL


settings = Settings()
