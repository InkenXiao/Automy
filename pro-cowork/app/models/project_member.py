"""项目成员模型 · 项目驾驶舱-项目成员页"""
from datetime import date
from typing import Optional

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class ProjectMember(Base, TimestampMixin, SoftDeleteMixin):
    """项目成员 (维护所选项目的成员: 角色/岗位、入组时间、当前状态)"""

    __tablename__ = "pro_project_members"
    __table_args__ = {"comment": "项目成员表 (维护所选项目的成员: 角色/岗位、入组时间、当前状态)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属项目ID (FK→pro_projects.id)"
    )
    name: Mapped[str] = mapped_column(String(64), comment="成员姓名")
    role: Mapped[str] = mapped_column(String(64), default="", comment="角色/岗位")
    join_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, comment="入组时间")
    status: Mapped[str] = mapped_column(String(16), default="全职", comment="当前状态: 全职/临时/退出")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, comment="排序序号")

    # 关联项目
    project: Mapped["Project"] = relationship("Project", back_populates="members")

    def __repr__(self):
        return f"<ProjectMember {self.id} {self.name}@{self.project_id}>"
