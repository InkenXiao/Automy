"""Obsidian 连接配置模型 (个人知识库对接 Obsidian, 每人一条)"""
from sqlalchemy import BigInteger, Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.services.snowflake import generate_id


class RagObsidianConfig(Base, TimestampMixin, SoftDeleteMixin):
    """Obsidian 连接配置: 个人知识库对接 Obsidian Local REST API

    - 每个用户维护自己的连接信息 (user_id 唯一)
    - 通过 Obsidian Local REST API 插件读取 vault 中的 Markdown 笔记
    - 同步到指定的个人知识库, 参与分块/向量化/图谱构建
    """

    __tablename__ = "rag_obsidian_configs"
    __table_args__ = {"comment": "Obsidian连接配置表: 个人知识库对接Obsidian(每人一条)"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="主键ID(雪花ID)")
    user_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, comment="所属用户ID (FK→sys_users.user_id, 每人一条)")
    kb_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", comment="同步目标个人知识库ID (FK→rag_knowledge_bases.kb_id)")
    host: Mapped[str] = mapped_column(String(512), default="", server_default="", comment="Obsidian Local REST API 地址 (如 https://host.docker.internal:27124)")
    api_key: Mapped[str] = mapped_column(String(256), default="", server_default="", comment="Obsidian Local REST API 的 API Key")
    base_path: Mapped[str] = mapped_column(String(512), default="", server_default="", comment="仅同步该子目录(空=整个vault)")
    auto_parse: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", comment="同步后是否自动触发解析入库")
    last_sync_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True, comment="最近同步时间")
    last_sync_info: Mapped[str] = mapped_column(String(512), default="", server_default="", comment="最近同步结果摘要")
