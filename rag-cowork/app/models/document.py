"""文档/分块/多模态资源模型 (对应 demo documents/chunks/multimodal_resources, 增加 kb_id/user_id/is_delete)"""
from sqlalchemy import BigInteger, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.services.snowflake import generate_id


class RagDocument(Base, TimestampMixin, SoftDeleteMixin):
    """知识库文档: 原始文件元信息 + MinIO 归档 + 解析状态"""

    __tablename__ = "rag_documents"
    __table_args__ = {"comment": "知识库文档表: 原始文件元信息+MinIO归档+解析状态"}

    doc_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="文档ID 主键(雪花ID)")
    kb_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属知识库ID (FK→rag_knowledge_bases.kb_id)")
    file_name: Mapped[str] = mapped_column(String(512), comment="文件名称")
    file_ext: Mapped[str] = mapped_column(String(16), default="", server_default="", comment="文件扩展名")
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", comment="文件大小(字节)")
    file_hash: Mapped[str] = mapped_column(String(64), default="", server_default="", index=True, comment="文件哈希值(用于去重)")
    minio_bucket: Mapped[str] = mapped_column(String(64), default="", server_default="", comment="MinIO存储桶")
    minio_path: Mapped[str] = mapped_column(String(1024), default="", server_default="", comment="MinIO对象路径")
    # pending/parsing/done/failed
    parse_status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True, comment="解析状态: pending待解析/parsing解析中/done完成/failed失败")
    parser_type: Mapped[str] = mapped_column(String(50), default="", server_default="", comment="解析器类型")
    total_chunks: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="分块总数")
    total_images: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="图片总数")
    total_tables: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="表格总数")
    error_msg: Mapped[str] = mapped_column(Text, default="", server_default="", comment="解析错误信息")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="上传者用户ID (FK→sys_users.user_id)")


class RagChunk(Base, TimestampMixin, SoftDeleteMixin):
    """文本分块: 向量检索与图谱构建的基本单元"""

    __tablename__ = "rag_chunks"
    __table_args__ = {"comment": "文档分块表: 向量检索与图谱构建的基本单元"}

    chunk_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="分块ID 主键(雪花ID)")
    doc_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属文档ID (FK→rag_documents.doc_id)")
    kb_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属知识库ID (FK→rag_knowledge_bases.kb_id)")
    chunk_index: Mapped[int] = mapped_column(Integer, default=0, comment="分块序号(文档内顺序)")
    content: Mapped[str] = mapped_column(Text, comment="分块文本内容")
    page_number: Mapped[int] = mapped_column(Integer, default=0, comment="所在页码")
    chunk_type: Mapped[str] = mapped_column(String(20), default="text", server_default="text", comment="分块类型: text文本等")
    milvus_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="Milvus向量ID")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="创建者用户ID (FK→sys_users.user_id)")


class RagMultimodalResource(Base, TimestampMixin, SoftDeleteMixin):
    """多模态资源: 文档中的图片/表格/语音, 附 AI 生成描述参与检索"""

    __tablename__ = "rag_multimodal_resources"
    __table_args__ = {"comment": "多模态资源表: 文档中的图片/表格/语音, 附AI生成描述参与检索"}

    resource_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="资源ID 主键(雪花ID)")
    doc_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属文档ID (FK→rag_documents.doc_id)")
    kb_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属知识库ID (FK→rag_knowledge_bases.kb_id)")
    chunk_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="关联分块ID (FK→rag_chunks.chunk_id, 可空)")
    resource_type: Mapped[str] = mapped_column(String(20), comment="资源类型: image图片/table表格/audio语音")  # image/table/audio
    resource_index: Mapped[int] = mapped_column(Integer, default=0, comment="资源序号(文档内顺序)")
    minio_path: Mapped[str] = mapped_column(String(1024), default="", server_default="", comment="MinIO对象路径")
    content_desc: Mapped[str] = mapped_column(Text, default="", server_default="", comment="AI生成的内容描述(参与检索)")
    milvus_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="Milvus向量ID")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="创建者用户ID (FK→sys_users.user_id)")
