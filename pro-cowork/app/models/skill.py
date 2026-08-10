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
    __table_args__ = {"comment": "技能定义表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="技能名称")
    description: Mapped[str] = mapped_column(Text, default="", comment="技能描述")
    category: Mapped[str] = mapped_column(String(32), default="", comment="分类: data数据/api接口/workflow工作流/notification通知")
    trigger_type: Mapped[str] = mapped_column(String(32), default="manual", comment="触发方式: manual手动/scheduled定时/event事件")
    config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", comment="配置参数 (JSON)")
    code: Mapped[str] = mapped_column(Text, default="", comment="技能执行代码")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, comment="是否启用")

    executions: Mapped[list["SkillExecution"]] = relationship(
        "SkillExecution", back_populates="skill", cascade="all, delete-orphan"
    )


class SkillExecution(Base, SoftDeleteMixin):
    """技能执行记录"""

    __tablename__ = "skill_executions"
    __table_args__ = {"comment": "技能执行记录表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    skill_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, comment="所属技能ID (FK→skills.id)"
    )
    session_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True,
        comment="来源会话ID (FK→agent_sessions.id, 可空)"
    )
    input_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", comment="输入数据 (JSON)")
    output_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", comment="输出数据 (JSON)")
    status: Mapped[str] = mapped_column(
        String(16), default="pending", comment="状态: pending待执行/running执行中/success成功/failed失败"
    )
    error: Mapped[str] = mapped_column(Text, default="", comment="错误信息")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, comment="执行耗时(毫秒)")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), comment="创建时间"
    )

    skill: Mapped["Skill"] = relationship("Skill", back_populates="executions")
