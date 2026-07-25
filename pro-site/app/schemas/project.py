"""项目元信息 schema"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ProjectBase(BaseModel):
    """项目基础字段"""

    name: str
    title: str
    based_doc: str = ""
    start_date: date
    end_date: date
    is_active: bool = False
    sort_order: int = 0


class ProjectCreate(ProjectBase):
    """新建项目请求"""


class ProjectUpdate(BaseModel):
    """更新项目请求 (所有字段可选)"""

    name: Optional[str] = None
    title: Optional[str] = None
    based_doc: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class ProjectOut(ProjectBase):
    """项目输出"""

    id: int
    model_config = ConfigDict(from_attributes=True)
