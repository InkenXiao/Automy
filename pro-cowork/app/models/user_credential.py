"""用户凭据模型 · 成员登录密码 (需求: 密码设置)

- 未设置密码的成员: 姓名直登
- 已设置密码的成员: 姓名 + 密码登录
- 密码按姓名唯一定位 (与项目无关, 同人跨项目共用同一密码)
"""
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class UserCredential(Base, TimestampMixin, SoftDeleteMixin):
    """成员登录凭据 (姓名唯一; password_hash 格式: salt$hexdigest)"""

    __tablename__ = "sys_user_credentials"
    __table_args__ = {"comment": "成员登录凭据表 (姓名唯一, 同人跨项目共用同一密码)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True, comment="成员姓名 (唯一)")
    password_hash: Mapped[str] = mapped_column(String(256), default="", comment="密码哈希 (格式: salt$pbkdf2 hex, 空表示未设置密码)")

    def __repr__(self):
        return f"<UserCredential {self.name}>"
