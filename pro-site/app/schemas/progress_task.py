"""项目进度计划任务 schema (含嵌套阶段)"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.phase import PhaseOut


class ProgressTaskBase(BaseModel):
    """进度计划任务基础字段"""

    project_id: Optional[int] = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    task_uid: str
    name: str
    phase_id: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: str = "planned"
    full_desc: str = ""
    owner: str = ""
    is_milestone: bool = False


class ProgressTaskCreate(ProgressTaskBase):
    """新建进度计划任务请求"""


class ProgressTaskUpdate(BaseModel):
    """更新进度计划任务请求 (全部字段可选, project_id 不可改)"""

    task_uid: str | None = None
    name: str | None = None
    phase_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: str | None = None
    full_desc: str | None = None
    owner: str | None = None
    is_milestone: bool | None = None


class ProgressTaskOut(ProgressTaskBase):
    """进度计划任务输出 (含嵌套 phase)"""

    id: int
    project_id: int  # ★所属项目ID
    phase: Optional[PhaseOut] = None
    model_config = ConfigDict(from_attributes=True)
