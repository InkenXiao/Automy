"""每周工作任务安排 schema (含可选嵌套 plan_task 与 module)"""
from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.module import ModuleOut
from app.schemas.weekly_report import WeeklyPlanTaskOut


class WeeklyWorkTaskBase(BaseModel):
    """每周工作任务基础字段"""

    project_id: Optional[int] = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    week_start: date
    week_end: date
    plan_task_id: Optional[int] = None
    name: str
    module_id: Optional[int] = None
    owner: str = ""
    is_temporary: bool = False
    priority: str = "medium"
    status: str = "待开始"
    planned_hours: Decimal = Decimal("0")
    actual_hours: Decimal = Decimal("0")
    remark: str = ""
    sort_order: int = 0


class WeeklyWorkTaskCreate(WeeklyWorkTaskBase):
    """新建每周工作任务请求"""


class WeeklyWorkTaskUpdate(BaseModel):
    """更新每周工作任务请求 (全部字段可选, project_id 不可改)"""

    week_start: date | None = None
    week_end: date | None = None
    plan_task_id: int | None = None
    name: str | None = None
    module_id: int | None = None
    owner: str | None = None
    is_temporary: bool | None = None
    priority: str | None = None
    status: str | None = None
    planned_hours: Decimal | None = None
    actual_hours: Decimal | None = None
    remark: str | None = None
    sort_order: int | None = None


class WeeklyWorkTaskOut(WeeklyWorkTaskBase):
    """每周工作任务输出 (含可选嵌套 plan_task 与 module)"""

    id: int
    project_id: int  # ★所属项目ID
    plan_task: Optional[WeeklyPlanTaskOut] = None
    module: Optional[ModuleOut] = None
    model_config = ConfigDict(from_attributes=True)
