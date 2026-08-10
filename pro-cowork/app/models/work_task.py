"""每周工作任务安排模型 ★核心关联表 (可关联 weekly_plan_tasks)"""
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class WeeklyWorkTask(Base, TimestampMixin, SoftDeleteMixin):
    """每周工作任务安排 ★核心关联表"""

    __tablename__ = "pro_weekly_work_tasks"
    __table_args__ = {"comment": "每周工作任务安排表 (核心关联表, 可关联周报下周任务)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属项目ID (FK→pro_projects.id)"
    )
    week_start: Mapped[date] = mapped_column(Date, comment="周开始日期")
    week_end: Mapped[date] = mapped_column(Date, comment="周结束日期")
    plan_task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_weekly_plan_tasks.id"), nullable=True,
        comment="关联周报下周任务ID (FK→pro_weekly_plan_tasks.id, 可空)"
    )
    name: Mapped[str] = mapped_column(String(512), comment="任务名称")
    module_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_modules.id"), nullable=True, comment="所属模块ID (FK→pro_modules.id, 可空)"
    )
    owner: Mapped[str] = mapped_column(String(64), default="", comment="责任人")
    is_temporary: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否临时任务")
    priority: Mapped[str] = mapped_column(
        String(8), default="medium", comment="优先级: high高/medium中/low低"
    )
    status: Mapped[str] = mapped_column(
        String(16), default="待开始", comment="状态: 待开始/进行中/已完成/已取消"
    )
    planned_hours: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, comment="计划工时(H)")
    actual_hours: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0, comment="实际工时(H)")
    remark: Mapped[str] = mapped_column(Text, default="", comment="备注")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="weekly_work_tasks")
    plan_task: Mapped["WeeklyPlanTask"] = relationship(
        "WeeklyPlanTask", back_populates="work_tasks"
    )
    module: Mapped["Module"] = relationship("Module", back_populates="work_tasks")

    def __repr__(self):
        return f"<WeeklyWorkTask {self.id} {self.name}>"
