"""项目阶段字典 schema"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict


class PhaseBase(BaseModel):
    """阶段基础字段"""

    project_id: Optional[int] = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    name: str
    subtitle: str = ""
    description: str = ""
    start_date: date
    end_date: date


class PhaseCreate(PhaseBase):
    """新建阶段请求"""


class PhaseUpdate(BaseModel):
    """更新阶段请求 (全部字段可选, project_id 不可改)"""

    name: str | None = None
    subtitle: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class PhaseOut(PhaseBase):
    """阶段输出"""

    id: int
    project_id: int  # ★所属项目ID
    model_config = ConfigDict(from_attributes=True)
