"""周报相关模型 · 含核心关联表 weekly_plan_tasks"""
from datetime import date
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class WeeklyReport(Base, TimestampMixin, SoftDeleteMixin):
    """项目周报"""

    __tablename__ = "weekly_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )  # ★所属项目ID
    title: Mapped[str] = mapped_column(String(128), default="")
    week_range: Mapped[str] = mapped_column(String(32), default="")  # '07.01 — 07.07'
    week_start: Mapped[date] = mapped_column(Date, nullable=True)
    week_end: Mapped[date] = mapped_column(Date, nullable=True)
    overview_summary: Mapped[str] = mapped_column(Text, default="")
    week_digest: Mapped[str] = mapped_column(Text, default="")  # 周报概括 (AI 生成, 微信汇报版)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft/submitted

    # 关联项目
    project: Mapped["Project"] = relationship("Project", back_populates="weekly_reports")
    # 关联子表
    kpis: Mapped[List["WeeklyKpi"]] = relationship(
        "WeeklyKpi", back_populates="report", cascade="all, delete-orphan"
    )
    progress_items: Mapped[List["WeeklyProgressItem"]] = relationship(
        "WeeklyProgressItem", back_populates="report", cascade="all, delete-orphan"
    )
    plan_tasks: Mapped[List["WeeklyPlanTask"]] = relationship(
        "WeeklyPlanTask", back_populates="report", cascade="all, delete-orphan"
    )
    risks: Mapped[List["WeeklyRisk"]] = relationship(
        "WeeklyRisk", back_populates="report", cascade="all, delete-orphan",
        order_by="WeeklyRisk.sort_order"
    )

    def __repr__(self):
        return f"<WeeklyReport {self.id} {self.week_range}>"


class WeeklyKpi(Base, SoftDeleteMixin):
    """周报-本周概览 KPI (每模块一条)"""

    __tablename__ = "weekly_kpis"
    __table_args__ = (UniqueConstraint("report_id", "module_id", name="uq_kpi_report_module"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("weekly_reports.id", ondelete="CASCADE")
    )
    module_id: Mapped[int] = mapped_column(Integer, ForeignKey("modules.id"))
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)  # 0-100
    status: Mapped[str] = mapped_column(String(8), default="正常")  # 正常/关注/风险

    report: Mapped["WeeklyReport"] = relationship("WeeklyReport", back_populates="kpis")
    module: Mapped["Module"] = relationship("Module", back_populates="kpis")


class WeeklyProgressItem(Base, SoftDeleteMixin):
    """周报-本周进展 (每模块多条)"""

    __tablename__ = "weekly_progress_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("weekly_reports.id", ondelete="CASCADE")
    )
    module_id: Mapped[int] = mapped_column(Integer, ForeignKey("modules.id"))
    content: Mapped[str] = mapped_column(String(512), default="")  # 事项标题
    detail: Mapped[str] = mapped_column(Text, default="")  # 补充说明
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    report: Mapped["WeeklyReport"] = relationship(
        "WeeklyReport", back_populates="progress_items"
    )
    module: Mapped["Module"] = relationship("Module", back_populates="progress_items")


class WeeklyPlanTask(Base, TimestampMixin, SoftDeleteMixin):
    """周报-下周任务 ★核心关联表 (可关联 progress_tasks)"""

    __tablename__ = "weekly_plan_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("weekly_reports.id", ondelete="CASCADE")
    )
    module_id: Mapped[int] = mapped_column(Integer, ForeignKey("modules.id"))
    progress_task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("progress_tasks.id"), nullable=True
    )  # ★关联进度计划任务(可空)
    name: Mapped[str] = mapped_column(String(512))  # 任务/事项名称
    is_key: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否重点
    owner: Mapped[str] = mapped_column(String(64), default="")
    plan_period: Mapped[str] = mapped_column(String(32), default="")  # 计划周期
    status: Mapped[str] = mapped_column(String(16), default="待开始")  # 待开始/进行中/已完成
    remark: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 关联
    report: Mapped["WeeklyReport"] = relationship(
        "WeeklyReport", back_populates="plan_tasks"
    )
    module: Mapped["Module"] = relationship("Module", back_populates="plan_tasks")
    progress_task: Mapped["ProgressTask"] = relationship(
        "ProgressTask", back_populates="plan_tasks"
    )
    work_tasks: Mapped[List["WeeklyWorkTask"]] = relationship(
        "WeeklyWorkTask", back_populates="plan_task"
    )

    def __repr__(self):
        return f"<WeeklyPlanTask {self.id} {self.name}>"


class WeeklyRisk(Base, SoftDeleteMixin):
    """周报-风险与应对"""

    __tablename__ = "weekly_risks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("weekly_reports.id", ondelete="CASCADE")
    )
    seq: Mapped[str] = mapped_column(String(4), default="R1")  # 'R1','R2'
    title: Mapped[str] = mapped_column(String(256), default="")
    coordination: Mapped[str] = mapped_column(Text, default="")  # 需要协调的内容
    urgency: Mapped[str] = mapped_column(String(8), default="中")  # 紧急程度
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    report: Mapped["WeeklyReport"] = relationship("WeeklyReport", back_populates="risks")
