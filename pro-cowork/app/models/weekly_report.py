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

    __tablename__ = "pro_weekly_reports"
    __table_args__ = {"comment": "项目周报表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属项目ID (FK→pro_projects.id)"
    )
    title: Mapped[str] = mapped_column(String(128), default="", comment="周报标题")
    week_range: Mapped[str] = mapped_column(String(32), default="", comment="周报周期展示文本, 如 '07.01 — 07.07'")
    week_start: Mapped[date] = mapped_column(Date, nullable=True, comment="周报周期开始日期")
    week_end: Mapped[date] = mapped_column(Date, nullable=True, comment="周报周期结束日期")
    overview_summary: Mapped[str] = mapped_column(Text, default="", comment="本周概览总结")
    week_digest: Mapped[str] = mapped_column(Text, default="", comment="周报概括 (AI 生成, 微信汇报版)")
    status: Mapped[str] = mapped_column(String(16), default="draft", comment="状态: draft草稿/submitted已提交")

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

    __tablename__ = "pro_weekly_kpis"
    __table_args__ = (
        UniqueConstraint("report_id", "module_id", name="uq_kpi_report_module"),
        {"comment": "周报KPI表 (本周概览, 每模块一条)"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_weekly_reports.id", ondelete="CASCADE"), comment="所属周报ID (FK→pro_weekly_reports.id)"
    )
    module_id: Mapped[int] = mapped_column(Integer, ForeignKey("pro_modules.id"), comment="所属模块ID (FK→pro_modules.id)")
    progress_pct: Mapped[int] = mapped_column(Integer, default=0, comment="完成进度百分比 (0-100)")
    status: Mapped[str] = mapped_column(String(8), default="正常", comment="健康状态: 正常/关注/风险")

    report: Mapped["WeeklyReport"] = relationship("WeeklyReport", back_populates="kpis")
    module: Mapped["Module"] = relationship("Module", back_populates="kpis")


class WeeklyProgressItem(Base, SoftDeleteMixin):
    """周报-本周进展 (每模块多条)"""

    __tablename__ = "pro_weekly_progress_items"
    __table_args__ = {"comment": "周报本周进展表 (每模块多条)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_weekly_reports.id", ondelete="CASCADE"), comment="所属周报ID (FK→pro_weekly_reports.id)"
    )
    module_id: Mapped[int] = mapped_column(Integer, ForeignKey("pro_modules.id"), comment="所属模块ID (FK→pro_modules.id)")
    content: Mapped[str] = mapped_column(String(512), default="", comment="事项标题")
    detail: Mapped[str] = mapped_column(Text, default="", comment="补充说明")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

    report: Mapped["WeeklyReport"] = relationship(
        "WeeklyReport", back_populates="progress_items"
    )
    module: Mapped["Module"] = relationship("Module", back_populates="progress_items")


class WeeklyPlanTask(Base, TimestampMixin, SoftDeleteMixin):
    """周报-下周任务 ★核心关联表 (可关联 progress_tasks)"""

    __tablename__ = "pro_weekly_plan_tasks"
    __table_args__ = {"comment": "周报下周任务表 (核心关联表, 可关联进度计划任务)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_weekly_reports.id", ondelete="CASCADE"), comment="所属周报ID (FK→pro_weekly_reports.id)"
    )
    module_id: Mapped[int] = mapped_column(Integer, ForeignKey("pro_modules.id"), comment="所属模块ID (FK→pro_modules.id)")
    progress_task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_progress_tasks.id"), nullable=True,
        comment="关联进度计划任务ID (FK→pro_progress_tasks.id, 可空)"
    )
    name: Mapped[str] = mapped_column(String(512), comment="任务/事项名称")
    is_key: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否重点任务")
    owner: Mapped[str] = mapped_column(String(64), default="", comment="责任人")
    plan_period: Mapped[str] = mapped_column(String(32), default="", comment="计划周期")
    status: Mapped[str] = mapped_column(String(16), default="待开始", comment="状态: 待开始/进行中/已完成")
    remark: Mapped[str] = mapped_column(Text, default="", comment="备注")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

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

    __tablename__ = "pro_weekly_risks"
    __table_args__ = {"comment": "周报风险与应对表"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_weekly_reports.id", ondelete="CASCADE"), comment="所属周报ID (FK→pro_weekly_reports.id)"
    )
    seq: Mapped[str] = mapped_column(String(4), default="R1", comment="风险编号, 如 'R1','R2'")
    title: Mapped[str] = mapped_column(String(256), default="", comment="风险标题")
    coordination: Mapped[str] = mapped_column(Text, default="", comment="需要协调的内容")
    urgency: Mapped[str] = mapped_column(String(8), default="中", comment="紧急程度: 高/中/低")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

    report: Mapped["WeeklyReport"] = relationship("WeeklyReport", back_populates="risks")
