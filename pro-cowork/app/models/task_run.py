"""TaskRun 模型 · 工作台任务 (项目 × 文件 × 智能体 × 技能)"""
from typing import Optional

from sqlalchemy import (
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class TaskRun(Base, TimestampMixin):
    """工作台任务: 选择项目/文件/智能体/技能后的一次执行记录"""

    __tablename__ = "task_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(256), default="")
    input_text: Mapped[str] = mapped_column(Text, default="")
    skill_ids: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    file_names: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    status: Mapped[str] = mapped_column(
        String(16), default="draft"
    )  # draft/running/done/failed
    result_text: Mapped[str] = mapped_column(Text, default="")
    session_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True
    )


class TaskRunEvent(Base, TimestampMixin):
    """任务执行过程事件 (后台执行持久化, 供过程回放/断线续看)

    type: user / content / tool_call / tool_result / error / done
    payload: content→{"content"}; tool_call→{"arguments"}; tool_result→{"result","duration_ms"}
    """

    __tablename__ = "task_run_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)  # 事件序号 (run 内单调递增)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(64), default="")  # 工具名 (tool_* 事件)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
