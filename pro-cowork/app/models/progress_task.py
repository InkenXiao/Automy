"""项目进度计划任务模型"""
from datetime import date
from typing import List

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class ProgressTask(Base, TimestampMixin, SoftDeleteMixin):
    """项目进度计划任务"""

    __tablename__ = "pro_progress_tasks"
    __table_args__ = {"comment": "项目进度计划任务表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属项目ID (FK→pro_projects.id)"
    )
    task_uid: Mapped[str] = mapped_column(String(16), unique=True, comment="任务唯一编号, 如 '1-1','M1'")
    name: Mapped[str] = mapped_column(String(256), comment="任务名称")
    phase_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_phases.id"), nullable=True, comment="所属阶段ID (FK→pro_phases.id, 可空)"
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=True, comment="开始日期")
    end_date: Mapped[date] = mapped_column(Date, nullable=True, comment="结束日期")
    status: Mapped[str] = mapped_column(
        String(16), default="planned", comment="状态: ongoing进行中/planned待启动/milestone里程碑/done已完成/deleted已删除"
    )
    full_desc: Mapped[str] = mapped_column(Text, default="", comment="完整描述(含责任方)")
    owner: Mapped[str] = mapped_column(String(64), default="", comment="责任人")
    is_milestone: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否里程碑")

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="progress_tasks")
    phase: Mapped["Phase"] = relationship("Phase", back_populates="progress_tasks")
    plan_tasks: Mapped[List["WeeklyPlanTask"]] = relationship(
        "WeeklyPlanTask", back_populates="progress_task"
    )

    def __repr__(self):
        return f"<ProgressTask {self.task_uid} {self.name}>"
