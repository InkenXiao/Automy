"""项目阶段字典模型"""
from datetime import date
from typing import List

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class Phase(Base, TimestampMixin, SoftDeleteMixin):
    """项目阶段字典 (第一阶段/第二阶段/第三阶段, 按项目隔离)"""

    __tablename__ = "pro_phases"
    __table_args__ = {"comment": "项目阶段字典表 (第一阶段/第二阶段/第三阶段, 按项目隔离)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属项目ID (FK→pro_projects.id)"
    )
    name: Mapped[str] = mapped_column(String(32), comment="阶段名称: 第一阶段/第二阶段/第三阶段")
    subtitle: Mapped[str] = mapped_column(String(32), default="", comment="阶段副标题: 有得用/用起来/用得好")
    description: Mapped[str] = mapped_column(Text, default="", comment="阶段描述")
    start_date: Mapped[date] = mapped_column(Date, comment="阶段开始日期")
    end_date: Mapped[date] = mapped_column(Date, comment="阶段结束日期")

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="phases")
    progress_tasks: Mapped[List["ProgressTask"]] = relationship(
        "ProgressTask", back_populates="phase"
    )

    def __repr__(self):
        return f"<Phase {self.name}>"
