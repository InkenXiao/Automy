"""项目成员 schema"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ProjectMemberBase(BaseModel):
    """项目成员基础字段"""

    project_id: Optional[int] = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    name: str
    role: str = ""  # 角色/岗位
    join_date: Optional[date] = None  # 入组时间
    status: str = "在职"  # 当前状态: 在职/已退出
    sort_order: int = 0


class ProjectMemberCreate(ProjectMemberBase):
    """新建项目成员请求"""


class ProjectMemberUpdate(BaseModel):
    """更新项目成员请求 (全部字段可选, project_id 不可改)"""

    name: Optional[str] = None
    role: Optional[str] = None
    join_date: Optional[date] = None
    status: Optional[str] = None
    sort_order: Optional[int] = None


class ProjectMemberOut(ProjectMemberBase):
    """项目成员输出"""

    id: int
    project_id: int
    model_config = ConfigDict(from_attributes=True)
