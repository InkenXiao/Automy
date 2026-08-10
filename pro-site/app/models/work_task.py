"""每周工作任务安排模型 ★核心关联表 (可关联 weekly_plan_tasks)"""
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class WeeklyWorkTask(Base, TimestampMixin, SoftDeleteMixin):
    """每周工作任务安排 ★核心关联表"""

    __tablename__ = "pro_weekly_work_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )  # ★所属项目ID
    week_start: Mapped[date] = mapped_column(Date)
    week_end: Mapped[date] = mapped_column(Date)
    plan_task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_weekly_plan_tasks.id"), nullable=True
    )  # ★关联周报下周任务(可空)
    name: Mapped[str] = mapped_column(String(512))  # 任务名称
    module_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_modules.id"), nullable=True
    )
    owner: Mapped[str] = mapped_column(String(64), default="")
    is_temporary: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否临时任务
    priority: Mapped[str] = mapped_column(
        String(8), default="medium"
    )  # high/medium/low
    status: Mapped[str] = mapped_column(
        String(16), default="待开始"
    )  # 待开始/进行中/已完成/已取消
    planned_hours: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    actual_hours: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    remark: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="weekly_work_tasks")
    plan_task: Mapped["WeeklyPlanTask"] = relationship(
        "WeeklyPlanTask", back_populates="work_tasks"
    )
    module: Mapped["Module"] = relationship("Module", back_populates="work_tasks")

    def __repr__(self):
        return f"<WeeklyWorkTask {self.id} {self.name}>"
