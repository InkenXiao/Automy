"""共享用户表 (rag-cowork / mcp-cowork / pro-cowork 三系统共用)"""
from sqlalchemy import BigInteger, Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.services.snowflake import generate_id


class SysUser(Base, TimestampMixin, SoftDeleteMixin):
    """系统登录用户: userid 雪花 ID 与姓名一一对应, 业务记录通过 user_id 关联"""

    __tablename__ = "sys_users"
    __table_args__ = {"comment": "系统用户表: rag/mcp/pro-cowork三系统共享登录用户"}

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="用户ID 主键(雪花ID)")
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True, comment="登录名(唯一)")
    password_hash: Mapped[str] = mapped_column(String(256), default="", server_default="", comment="密码哈希")
    display_name: Mapped[str] = mapped_column(String(64), default="", server_default="", comment="显示姓名")
    department: Mapped[str] = mapped_column(String(64), default="", server_default="", index=True, comment="所属部门")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", comment="是否启用")
