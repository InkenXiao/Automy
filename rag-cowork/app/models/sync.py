"""同步台账 / 解析任务 / 检索日志模型"""
from sqlalchemy import BigInteger, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.services.snowflake import generate_id


class RagSyncEvent(Base, TimestampMixin, SoftDeleteMixin):
    """三库写入台账: 记录向 Milvus/Neo4j 同步的事件, 失败可据此重试 (替代 demo Redis Streams)"""

    __tablename__ = "rag_sync_events"
    __table_args__ = {"comment": "同步事件台账表: 记录向Milvus/Neo4j同步的事件, 失败可据此重试"}

    event_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="事件ID 主键(雪花ID)")
    action: Mapped[str] = mapped_column(String(20), default="insert", server_default="insert", comment="操作类型: insert新增")
    target_type: Mapped[str] = mapped_column(String(20), comment="目标类型: chunk分块/entity实体/relation关系/resource多模态资源")  # chunk/entity/relation/resource
    target_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", comment="目标对象ID")
    doc_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", index=True, comment="关联文档ID (FK→rag_documents.doc_id)")
    kb_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", index=True, comment="所属知识库ID (FK→rag_knowledge_bases.kb_id)")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", comment="同步数据载荷JSON")
    # pending/completed/failed
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True, comment="同步状态: pending待同步/completed已完成/failed失败")
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="重试次数")
    error_msg: Mapped[str] = mapped_column(Text, default="", server_default="", comment="错误信息")
    user_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", comment="操作用户ID (FK→sys_users.user_id)")


class RagParseTask(Base, TimestampMixin, SoftDeleteMixin):
    """文档解析任务: 前端轮询进度 (stage: parse/chunk/embed/extract/graph/done/failed)"""

    __tablename__ = "rag_parse_tasks"
    __table_args__ = {"comment": "文档解析任务表: 前端轮询进度"}

    task_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="任务ID 主键(雪花ID)")
    doc_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="文档ID (FK→rag_documents.doc_id)")
    kb_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属知识库ID (FK→rag_knowledge_bases.kb_id)")
    stage: Mapped[str] = mapped_column(String(20), default="parse", server_default="parse", comment="解析阶段: parse解析/chunk分块/embed向量化/extract实体抽取/graph图谱构建/done完成/failed失败")
    status: Mapped[str] = mapped_column(String(20), default="running", server_default="running", index=True, comment="任务状态: running运行中/completed已完成/failed失败")
    progress: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="进度百分比(0-100)")  # 0-100
    error_msg: Mapped[str] = mapped_column(Text, default="", server_default="", comment="错误信息")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="操作用户ID (FK→sys_users.user_id)")


class RagQueryLog(Base, TimestampMixin, SoftDeleteMixin):
    """RAG 检索日志: 统计用"""

    __tablename__ = "rag_query_logs"
    __table_args__ = {"comment": "RAG检索日志表: 查询统计用"}

    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="日志ID 主键(雪花ID)")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="查询用户ID (FK→sys_users.user_id)")
    kb_ids: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", comment="检索的知识库ID列表JSON")
    query: Mapped[str] = mapped_column(Text, comment="查询文本")
    mode: Mapped[str] = mapped_column(String(20), default="hybrid", server_default="hybrid", comment="检索模式: hybrid混合/local局部/global全局")
    answer_excerpt: Mapped[str] = mapped_column(Text, default="", server_default="", comment="答案摘要")
    hit_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="命中数量")
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="耗时(毫秒)")
    agent_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", comment="使用智能体ID (FK→sys_users.user_id)")
    skill_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", comment="使用技能ID")
    sources: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", comment="检索结果来源JSON数组")
