"""使用日志模型 · 登录日志 + 操作日志 (需求: 使用日志看板)"""
from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class LoginLog(Base, TimestampMixin, SoftDeleteMixin):
    """登录日志 (每次身份确认均记录, 含无效姓名)"""

    __tablename__ = "login_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(64), index=True)  # 登录姓名
    is_valid: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否为有效项目成员
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(256), default="")

    def __repr__(self):
        return f"<LoginLog {self.id} {self.user_name} valid={self.is_valid}>"


class OperationLog(Base, TimestampMixin, SoftDeleteMixin):
    """操作日志 (中间件自动记录全部写操作 + LLM 调用 token)"""

    __tablename__ = "operation_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(64), default="", index=True)  # 操作人
    method: Mapped[str] = mapped_column(String(8), default="")      # HTTP 方法 / LLM
    path: Mapped[str] = mapped_column(String(256), default="")      # 请求路径 / 调用来源
    entity_type: Mapped[str] = mapped_column(String(32), default="", index=True)  # 实体类型 (会议/项目周报/...)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=True)  # 实体 ID (可空)
    action: Mapped[str] = mapped_column(String(16), default="", index=True)  # create/update/delete/llm_call/export
    detail: Mapped[str] = mapped_column(Text, default="")           # 补充说明
    tokens: Mapped[int] = mapped_column(Integer, default=0)         # LLM token 消耗

    def __repr__(self):
        return f"<OperationLog {self.id} {self.user_name} {self.action} {self.entity_type}>"
