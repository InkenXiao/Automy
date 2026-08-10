"""知识库与权限模型"""
from sqlalchemy import BigInteger, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.services.snowflake import generate_id

# 五级知识库级别
KB_LEVELS = ("company", "department", "project", "personal", "external")


class RagKnowledgeBase(Base, TimestampMixin, SoftDeleteMixin):
    """知识库: 公司/部门/项目/个人/外接 五级

    - project 级: project_id 关联 pro-cowork projects.id, 继承项目成员权限
    - department 级: 按 sys_users.department 字符串匹配
    - personal/external 级: 靠 rag_kb_permissions 显式授权
    """

    __tablename__ = "rag_knowledge_bases"
    __table_args__ = {"comment": "知识库表: 公司/部门/项目/个人/外接五级知识库"}

    kb_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="知识库ID 主键(雪花ID)")
    name: Mapped[str] = mapped_column(String(256), index=True, comment="知识库名称")
    level: Mapped[str] = mapped_column(String(20), index=True, comment="知识库级别: company公司/department部门/project项目/personal个人/external外接")
    description: Mapped[str] = mapped_column(Text, default="", server_default="", comment="知识库描述")
    owner_user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所有者用户ID (FK→sys_users.user_id)")
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True, comment="关联项目ID (FK→pro-cowork projects.id, 仅project级)")
    department: Mapped[str] = mapped_column(String(64), default="", server_default="", comment="所属部门(department级按sys_users.department匹配)")
    # 创建者 (记录关联; 与 owner_user_id 一致, 保留字段遵循统一规则)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="创建者用户ID (FK→sys_users.user_id)")


class RagKbPermission(Base, TimestampMixin, SoftDeleteMixin):
    """知识库显式授权: read/write/admin"""

    __tablename__ = "rag_kb_permissions"
    __table_args__ = {"comment": "知识库权限表: 用户显式授权(read/write/admin)"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="主键ID(雪花ID)")
    kb_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="知识库ID (FK→rag_knowledge_bases.kb_id)")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="被授权用户ID (FK→sys_users.user_id)")
    perm: Mapped[str] = mapped_column(String(16), default="read", server_default="read", comment="权限级别: read只读/write可写/admin管理")


class RagDocPermission(Base, TimestampMixin, SoftDeleteMixin):
    """文档级显式授权: read/write/admin (单篇文档单独授权给用户)"""

    __tablename__ = "rag_doc_permissions"
    __table_args__ = {"comment": "文档级权限表: 对单篇文档的显式授权(read/write/admin)"}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="主键ID(雪花ID)")
    doc_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="文档ID (FK→rag_documents.doc_id)")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="被授权用户ID (FK→sys_users.user_id)")
    perm: Mapped[str] = mapped_column(String(16), default="read", server_default="read", comment="权限级别: read只读/write可写/admin管理")
