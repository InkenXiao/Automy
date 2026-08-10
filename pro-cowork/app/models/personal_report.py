"""个人周报模型 · 项目驾驶舱-个人周报填写页 (本周工作内容 + 下周工作计划)"""
from datetime import date
from typing import List, Optional

from sqlalchemy import Date, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class PersonalReport(Base, TimestampMixin, SoftDeleteMixin):
    """个人周报主表 (每人每周一份, 按项目上下文隔离)"""

    __tablename__ = "pro_personal_reports"
    __table_args__ = (
        # 部分唯一索引: 仅约束未删除行, 逻辑删除后同周可重新填报
        Index(
            "uq_preport_proj_member_week",
            "project_id", "member_name", "week_start",
            unique=True,
            postgresql_where=text("is_delete = false"),
        ),
        {"comment": "个人周报主表 (每人每周一份, 按项目上下文隔离)"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属项目ID (FK→pro_projects.id, 填报上下文)"
    )
    member_name: Mapped[str] = mapped_column(String(64), index=True, comment="填报人姓名 (来自项目成员)")
    week_start: Mapped[date] = mapped_column(Date, comment="周报周期起 (周一)")
    week_end: Mapped[date] = mapped_column(Date, comment="周报周期止 (周日)")
    summary: Mapped[str] = mapped_column(
        Text, default="", server_default="",
        comment="周报概括 (AI 生成 2-3 段: 本周主要工作内容 + 下周工作计划, 支持人工修改)"
    )

    # 子表
    work_items: Mapped[List["PersonalReportWorkItem"]] = relationship(
        "PersonalReportWorkItem", back_populates="report", cascade="all, delete-orphan",
        order_by="PersonalReportWorkItem.sort_order",
    )
    plan_items: Mapped[List["PersonalReportPlanItem"]] = relationship(
        "PersonalReportPlanItem", back_populates="report", cascade="all, delete-orphan",
        order_by="PersonalReportPlanItem.sort_order",
    )

    def __repr__(self):
        return f"<PersonalReport {self.id} {self.member_name} {self.week_start}>"


class PersonalReportWorkItem(Base, SoftDeleteMixin):
    """个人周报-本周工作内容 (动态行: 每行一天 = 项目 + 周几 + 当天内容 + 参与人员/交付物/工时)"""

    __tablename__ = "pro_personal_report_work_items"
    __table_args__ = {"comment": "个人周报本周工作内容表 (动态行: 每行一天)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_personal_reports.id", ondelete="CASCADE"), index=True,
        comment="所属个人周报ID (FK→pro_personal_reports.id)"
    )
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="SET NULL"), nullable=True,
        comment="工作内容所属项目ID (FK→pro_projects.id, 可空)"
    )
    day_of_week: Mapped[int] = mapped_column(Integer, default=1, comment="周几: 1=周一 ~ 7=周日")
    content: Mapped[str] = mapped_column(Text, default="", comment="当天工作内容")
    participants: Mapped[str] = mapped_column(String(256), default="", comment="参与人员")
    deliverable: Mapped[str] = mapped_column(String(256), default="", comment="交付物")
    hours: Mapped[float] = mapped_column(Float, default=0, comment="工时(H)")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

    report: Mapped["PersonalReport"] = relationship("PersonalReport", back_populates="work_items")

    def __repr__(self):
        return f"<PersonalReportWorkItem {self.id} r{self.report_id} {self.hours}h>"


class PersonalReportPlanItem(Base, SoftDeleteMixin):
    """个人周报-下周工作计划 (动态行: 项目 + 计划内容)"""

    __tablename__ = "pro_personal_report_plan_items"
    __table_args__ = {"comment": "个人周报下周工作计划表 (动态行: 项目 + 计划内容)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_personal_reports.id", ondelete="CASCADE"), index=True,
        comment="所属个人周报ID (FK→pro_personal_reports.id)"
    )
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="SET NULL"), nullable=True,
        comment="计划所属项目ID (FK→pro_projects.id, 可空)"
    )
    content: Mapped[str] = mapped_column(Text, default="", comment="计划内容")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

    report: Mapped["PersonalReport"] = relationship("PersonalReport", back_populates="plan_items")

    def __repr__(self):
        return f"<PersonalReportPlanItem {self.id} r{self.report_id}>"
