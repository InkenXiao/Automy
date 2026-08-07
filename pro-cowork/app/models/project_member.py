"""项目成员模型 · 项目驾驶舱-项目成员页"""
from datetime import date
from typing import Optional

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class ProjectMember(Base, TimestampMixin, SoftDeleteMixin):
    """项目成员 (维护所选项目的成员: 角色/岗位、入组时间、当前状态)"""

    __tablename__ = "project_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )  # ★所属项目ID
    name: Mapped[str] = mapped_column(String(64))  # 成员姓名
    role: Mapped[str] = mapped_column(String(64), default="")  # 角色/岗位
    join_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # 入组时间
    status: Mapped[str] = mapped_column(String(16), default="在职")  # 当前状态: 在职/已退出
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 关联项目
    project: Mapped["Project"] = relationship("Project", back_populates="members")

    def __repr__(self):
        return f"<ProjectMember {self.id} {self.name}@{self.project_id}>"
