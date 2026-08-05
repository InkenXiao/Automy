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

from app.models.base import Base, TimestampMixin


class Agent(Base, TimestampMixin):
    """智能体定义"""

    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # progress/meeting/weekly_report/work_plan/custom
    description: Mapped[str] = mapped_column(Text, default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    tools: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    sessions: Mapped[List["AgentSession"]] = relationship(
        "AgentSession", back_populates="agent", cascade="all, delete-orphan"
    )
    memories: Mapped[List["AgentMemory"]] = relationship(
        "AgentMemory", back_populates="agent", cascade="all, delete-orphan"
    )


class AgentSession(Base, TimestampMixin):
    """Agent 会话"""

    __tablename__ = "agent_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(256), default="")
    status: Mapped[str] = mapped_column(String(16), default="active")  # active/archived

    agent: Mapped["Agent"] = relationship("Agent", back_populates="sessions")
    messages: Mapped[List["AgentMessage"]] = relationship(
        "AgentMessage", back_populates="session", cascade="all, delete-orphan",
        order_by="AgentMessage.id"
    )


class AgentMessage(Base):
    """Agent 消息"""

    __tablename__ = "agent_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user/assistant/system/tool
    content: Mapped[str] = mapped_column(Text, default="")
    tool_calls: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    tool_results: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session: Mapped["AgentSession"] = relationship("AgentSession", back_populates="messages")


class AgentMemory(Base):
    """Agent 记忆"""

    __tablename__ = "agent_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    session_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True
    )
    memory_type: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # fact/preference/context/decision
    key: Mapped[str] = mapped_column(String(128), default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    agent: Mapped["Agent"] = relationship("Agent", back_populates="memories")
