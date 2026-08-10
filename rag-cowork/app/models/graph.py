"""知识图谱实体/关系模型 (对应 demo entities/relations, 增加 kb_id/user_id/is_delete)"""
from sqlalchemy import BigInteger, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.services.snowflake import generate_id


class RagEntity(Base, TimestampMixin, SoftDeleteMixin):
    """命名实体: 知识图谱节点"""

    __tablename__ = "rag_entities"
    __table_args__ = {"comment": "知识图谱实体表: 命名实体(图谱节点)"}

    entity_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="实体ID 主键(雪花ID)")
    kb_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属知识库ID (FK→rag_knowledge_bases.kb_id)")
    doc_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="来源文档ID (FK→rag_documents.doc_id)")
    entity_name: Mapped[str] = mapped_column(String(512), index=True, comment="实体名称")
    entity_type: Mapped[str] = mapped_column(String(100), default="UNKNOWN", server_default="UNKNOWN", comment="实体类型(默认UNKNOWN)")
    description: Mapped[str] = mapped_column(Text, default="", server_default="", comment="实体描述")
    weight: Mapped[float] = mapped_column(Float, default=1.0, server_default="1.0", comment="实体权重")
    neo4j_node_id: Mapped[str] = mapped_column(String(64), default="", server_default="", comment="Neo4j节点ID")
    milvus_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="Milvus向量ID")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="创建者用户ID (FK→sys_users.user_id)")


class RagRelation(Base, TimestampMixin, SoftDeleteMixin):
    """实体关系: 知识图谱边"""

    __tablename__ = "rag_relations"
    __table_args__ = {"comment": "知识图谱关系表: 实体间关系(图谱边)"}

    relation_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="关系ID 主键(雪花ID)")
    kb_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属知识库ID (FK→rag_knowledge_bases.kb_id)")
    doc_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="来源文档ID (FK→rag_documents.doc_id)")
    src_entity_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="源实体ID (FK→rag_entities.entity_id)")
    tgt_entity_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="目标实体ID (FK→rag_entities.entity_id)")
    relation_type: Mapped[str] = mapped_column(String(100), default="RELATED", server_default="RELATED", comment="关系类型(默认RELATED)")
    description: Mapped[str] = mapped_column(Text, default="", server_default="", comment="关系描述")
    keywords: Mapped[str] = mapped_column(String(512), default="", server_default="", comment="关系关键词")
    neo4j_edge_id: Mapped[str] = mapped_column(String(64), default="", server_default="", comment="Neo4j边ID")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="创建者用户ID (FK→sys_users.user_id)")
