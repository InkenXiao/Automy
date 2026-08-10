"""项目模块字典模型"""
from typing import List

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class Module(Base, TimestampMixin, SoftDeleteMixin):
    """项目模块字典 (底座/数据/智能体/应用/需求/协调, 按项目隔离)"""

    __tablename__ = "pro_modules"
    __table_args__ = {"comment": "项目模块字典表 (底座/数据/智能体/应用/需求/协调, 按项目隔离)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属项目ID (FK→pro_projects.id)"
    )
    idx: Mapped[str] = mapped_column(String(4), comment="模块编号, 如 '01','02'...")
    tag: Mapped[str] = mapped_column(String(16), comment="模块标签: 底座/数据/智能体/应用/需求/协调")
    title: Mapped[str] = mapped_column(String(128), comment="模块标题")
    owner: Mapped[str] = mapped_column(String(64), default="", comment="负责人")
    color: Mapped[str] = mapped_column(String(16), default="#FF8C00", comment="主题色")
    color_bg: Mapped[str] = mapped_column(String(16), default="#FFF3E0", comment="背景色")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="modules")
    kpis: Mapped[List["WeeklyKpi"]] = relationship("WeeklyKpi", back_populates="module")
    progress_items: Mapped[List["WeeklyProgressItem"]] = relationship(
        "WeeklyProgressItem", back_populates="module"
    )
    plan_tasks: Mapped[List["WeeklyPlanTask"]] = relationship("WeeklyPlanTask", back_populates="module")
    work_tasks: Mapped[List["WeeklyWorkTask"]] = relationship("WeeklyWorkTask", back_populates="module")

    def __repr__(self):
        return f"<Module {self.idx} {self.tag}>"
