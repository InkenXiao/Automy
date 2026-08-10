"""Agent / Session / Message / Memory 模型"""
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class Agent(Base, TimestampMixin, SoftDeleteMixin):
    """智能体定义"""

    __tablename__ = "agents"
    __table_args__ = {"comment": "智能体定义表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="智能体名称")
    type: Mapped[str] = mapped_column(
        String(32), nullable=False, comment="类型: progress进度/meeting会议/weekly_report周报/work_plan工作计划/custom自定义"
    )
    description: Mapped[str] = mapped_column(Text, default="", comment="智能体描述")
    system_prompt: Mapped[str] = mapped_column(Text, default="", comment="系统提示词")
    config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", comment="配置参数 (JSON)")
    tools: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", comment="可用工具列表 (JSON)")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, comment="是否启用")

    sessions: Mapped[List["AgentSession"]] = relationship(
        "AgentSession", back_populates="agent", cascade="all, delete-orphan"
    )
    memories: Mapped[List["AgentMemory"]] = relationship(
        "AgentMemory", back_populates="agent", cascade="all, delete-orphan"
    )


class AgentSession(Base, TimestampMixin, SoftDeleteMixin):
    """Agent 会话"""

    __tablename__ = "agent_sessions"
    __table_args__ = {"comment": "智能体会话表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, comment="所属智能体ID (FK→agents.id)"
    )
    title: Mapped[str] = mapped_column(String(256), default="", comment="会话标题")
    status: Mapped[str] = mapped_column(String(16), default="active", comment="状态: active活跃/archived已归档")

    agent: Mapped["Agent"] = relationship("Agent", back_populates="sessions")
    messages: Mapped[List["AgentMessage"]] = relationship(
        "AgentMessage", back_populates="session", cascade="all, delete-orphan",
        order_by="AgentMessage.id"
    )


class AgentMessage(Base, SoftDeleteMixin):
    """Agent 消息"""

    __tablename__ = "agent_messages"
    __table_args__ = {"comment": "智能体会话消息表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False,
        comment="所属会话ID (FK→agent_sessions.id)"
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, comment="角色: user用户/assistant助手/system系统/tool工具")
    content: Mapped[str] = mapped_column(Text, default="", comment="消息内容")
    tool_calls: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True, comment="工具调用请求 (JSON, 可空)")
    tool_results: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True, comment="工具调用结果 (JSON, 可空)")
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, comment="消耗的 token 数")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )

    session: Mapped["AgentSession"] = relationship("AgentSession", back_populates="messages")


class AgentMemory(Base, SoftDeleteMixin):
    """Agent 记忆"""

    __tablename__ = "agent_memories"
    __table_args__ = {"comment": "智能体记忆表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, comment="所属智能体ID (FK→agents.id)"
    )
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="SET NULL"), nullable=True,
        comment="关联项目ID (FK→pro_projects.id, 可空)"
    )
    session_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True,
        comment="来源会话ID (FK→agent_sessions.id, 可空)"
    )
    memory_type: Mapped[str] = mapped_column(
        String(32), nullable=False, comment="记忆类型: fact事实/preference偏好/context上下文/decision决策"
    )
    key: Mapped[str] = mapped_column(String(128), default="", comment="记忆键名")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="记忆内容")
    extra_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", comment="扩展数据 (JSON)")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )

    agent: Mapped["Agent"] = relationship("Agent", back_populates="memories")
