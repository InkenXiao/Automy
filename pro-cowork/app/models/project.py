"""项目元信息模型 · 支持多项目 (进度计划执行图的标题/基于文档/周期)"""
from datetime import date
from typing import List

from sqlalchemy import Boolean, Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class Project(Base, TimestampMixin, SoftDeleteMixin):
    """项目元信息 (一个项目对应一张进度计划执行图)"""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64))  # 项目名, 如 "信投AI2.0"
    title: Mapped[str] = mapped_column(String(256))  # 执行图标题
    based_doc: Mapped[str] = mapped_column(String(256), default="")  # 基于文档
    manager: Mapped[str] = mapped_column(String(64), default="")  # 项目经理
    status: Mapped[str] = mapped_column(String(16), default="进行中")  # 项目状态: 进行中/已停止/已完成
    start_date: Mapped[date] = mapped_column(Date)  # 项目开始日期
    end_date: Mapped[date] = mapped_column(Date)  # 项目结束日期
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否当前项目
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 反向关联 (lazy="raise" 避免异步懒加载, 需要时用 selectinload)
    meetings: Mapped[List["Meeting"]] = relationship(
        "Meeting", back_populates="project", lazy="raise"
    )
    progress_tasks: Mapped[List["ProgressTask"]] = relationship(
        "ProgressTask", back_populates="project", lazy="raise"
    )
    weekly_reports: Mapped[List["WeeklyReport"]] = relationship(
        "WeeklyReport", back_populates="project", lazy="raise"
    )
    weekly_work_tasks: Mapped[List["WeeklyWorkTask"]] = relationship(
        "WeeklyWorkTask", back_populates="project", lazy="raise"
    )
    modules: Mapped[List["Module"]] = relationship(
        "Module", back_populates="project", lazy="raise"
    )
    phases: Mapped[List["Phase"]] = relationship(
        "Phase", back_populates="project", lazy="raise"
    )
    members: Mapped[List["ProjectMember"]] = relationship(
        "ProjectMember", back_populates="project", lazy="raise"
    )

    def __repr__(self):
        return f"<Project {self.id} {self.name}>"
