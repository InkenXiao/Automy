"""Skill / SkillExecution 模型"""
from datetime import datetime
from typing import Optional

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


class Skill(Base, TimestampMixin, SoftDeleteMixin):
    """技能定义"""

    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32), default="")  # data/api/workflow/notification
    trigger_type: Mapped[str] = mapped_column(String(32), default="manual")  # manual/scheduled/event
    config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    code: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    executions: Mapped[list["SkillExecution"]] = relationship(
        "SkillExecution", back_populates="skill", cascade="all, delete-orphan"
    )


class SkillExecution(Base, SoftDeleteMixin):
    """技能执行记录"""

    __tablename__ = "skill_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    skill_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    session_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True
    )
    input_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    output_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(
        String(16), default="pending"
    )  # pending/running/success/failed
    error: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    skill: Mapped["Skill"] = relationship("Skill", back_populates="executions")
