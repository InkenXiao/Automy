"""项目阶段字典模型"""
from datetime import date
from typing import List

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class Phase(Base, TimestampMixin, SoftDeleteMixin):
    """项目阶段字典 (第一阶段/第二阶段/第三阶段, 按项目隔离)"""

    __tablename__ = "pro_phases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )  # ★所属项目ID
    name: Mapped[str] = mapped_column(String(32))  # 第一阶段/第二阶段/第三阶段
    subtitle: Mapped[str] = mapped_column(String(32), default="")  # 有得用/用起来/用得好
    description: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="phases")
    progress_tasks: Mapped[List["ProgressTask"]] = relationship(
        "ProgressTask", back_populates="phase"
    )

    def __repr__(self):
        return f"<Phase {self.name}>"
