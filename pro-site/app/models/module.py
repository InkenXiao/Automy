"""项目模块字典模型"""
from typing import List

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Module(Base, TimestampMixin):
    """项目模块字典 (底座/数据/智能体/应用/需求/协调)"""

    __tablename__ = "modules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    idx: Mapped[str] = mapped_column(String(4))  # '01','02'...
    tag: Mapped[str] = mapped_column(String(16))  # 底座/数据/智能体/应用/需求/协调
    title: Mapped[str] = mapped_column(String(128))
    owner: Mapped[str] = mapped_column(String(64), default="")
    color: Mapped[str] = mapped_column(String(16), default="#FF8C00")
    color_bg: Mapped[str] = mapped_column(String(16), default="#FFF3E0")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 关联
    kpis: Mapped[List["WeeklyKpi"]] = relationship("WeeklyKpi", back_populates="module")
    progress_items: Mapped[List["WeeklyProgressItem"]] = relationship(
        "WeeklyProgressItem", back_populates="module"
    )
    plan_tasks: Mapped[List["WeeklyPlanTask"]] = relationship("WeeklyPlanTask", back_populates="module")
    work_tasks: Mapped[List["WeeklyWorkTask"]] = relationship("WeeklyWorkTask", back_populates="module")

    def __repr__(self):
        return f"<Module {self.idx} {self.tag}>"
