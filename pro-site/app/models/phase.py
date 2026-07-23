"""项目阶段字典模型"""
from datetime import date
from typing import List

from sqlalchemy import Date, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Phase(Base, TimestampMixin):
    """项目阶段字典 (第一阶段/第二阶段/第三阶段)"""

    __tablename__ = "phases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(32))  # 第一阶段/第二阶段/第三阶段
    subtitle: Mapped[str] = mapped_column(String(32), default="")  # 有得用/用起来/用得好
    description: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)

    # 关联
    progress_tasks: Mapped[List["ProgressTask"]] = relationship(
        "ProgressTask", back_populates="phase"
    )

    def __repr__(self):
        return f"<Phase {self.name}>"
