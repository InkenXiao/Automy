"""项目元信息模型 · 支持多项目 (进度计划执行图的标题/基于文档/周期)"""
from datetime import date

from sqlalchemy import Boolean, Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Project(Base, TimestampMixin):
    """项目元信息 (一个项目对应一张进度计划执行图)"""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64))  # 项目名, 如 "信投AI2.0"
    title: Mapped[str] = mapped_column(String(256))  # 执行图标题
    based_doc: Mapped[str] = mapped_column(String(256), default="")  # 基于文档
    start_date: Mapped[date] = mapped_column(Date)  # 项目开始日期
    end_date: Mapped[date] = mapped_column(Date)  # 项目结束日期
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否当前项目
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    def __repr__(self):
        return f"<Project {self.id} {self.name}>"
