"""项目进度计划任务模型"""
from datetime import date
from typing import List

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class ProgressTask(Base, TimestampMixin, SoftDeleteMixin):
    """项目进度计划任务"""

    __tablename__ = "progress_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )  # ★所属项目ID
    task_uid: Mapped[str] = mapped_column(String(16), unique=True)  # '1-1','M1'
    name: Mapped[str] = mapped_column(String(256))
    phase_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("phases.id"), nullable=True
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), default="planned"
    )  # ongoing/planned/milestone/done/deleted
    full_desc: Mapped[str] = mapped_column(Text, default="")  # 完整描述(含责任方)
    owner: Mapped[str] = mapped_column(String(64), default="")
    is_milestone: Mapped[bool] = mapped_column(Boolean, default=False)

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="progress_tasks")
    phase: Mapped["Phase"] = relationship("Phase", back_populates="progress_tasks")
    plan_tasks: Mapped[List["WeeklyPlanTask"]] = relationship(
        "WeeklyPlanTask", back_populates="progress_task"
    )

    def __repr__(self):
        return f"<ProgressTask {self.task_uid} {self.name}>"
