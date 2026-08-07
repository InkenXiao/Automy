"""个人周报模型 · 项目驾驶舱-个人周报填写页 (本周工作内容 + 下周工作计划)"""
from datetime import date
from typing import List, Optional

from sqlalchemy import Date, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class PersonalReport(Base, TimestampMixin, SoftDeleteMixin):
    """个人周报主表 (每人每周一份, 按项目上下文隔离)"""

    __tablename__ = "personal_reports"
    __table_args__ = (
        UniqueConstraint("project_id", "member_name", "week_start", name="uq_preport_proj_member_week"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )  # ★所属项目ID (填报上下文)
    member_name: Mapped[str] = mapped_column(String(64), index=True)  # 填报人 (来自项目成员)
    week_start: Mapped[date] = mapped_column(Date)  # 周报周期起 (周一)
    week_end: Mapped[date] = mapped_column(Date)  # 周报周期止 (周日)

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

    __tablename__ = "personal_report_work_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("personal_reports.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )  # 工作内容所属项目 (选择)
    day_of_week: Mapped[int] = mapped_column(Integer, default=1)  # 周几: 1=周一 ~ 7=周日
    content: Mapped[str] = mapped_column(Text, default="")  # 当天工作内容
    participants: Mapped[str] = mapped_column(String(256), default="")  # 参与人员
    deliverable: Mapped[str] = mapped_column(String(256), default="")   # 交付物
    hours: Mapped[float] = mapped_column(Float, default=0)  # 工时(H)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    report: Mapped["PersonalReport"] = relationship("PersonalReport", back_populates="work_items")

    def __repr__(self):
        return f"<PersonalReportWorkItem {self.id} r{self.report_id} {self.hours}h>"


class PersonalReportPlanItem(Base, SoftDeleteMixin):
    """个人周报-下周工作计划 (动态行: 项目 + 计划内容)"""

    __tablename__ = "personal_report_plan_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("personal_reports.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )  # 计划所属项目 (选择)
    content: Mapped[str] = mapped_column(Text, default="")  # 计划内容
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    report: Mapped["PersonalReport"] = relationship("PersonalReport", back_populates="plan_items")

    def __repr__(self):
        return f"<PersonalReportPlanItem {self.id} r{self.report_id}>"
