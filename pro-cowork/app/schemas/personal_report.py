"""个人周报 schema · 全量保存 (创建/更新均携带完整子表)"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


def _none_to_list(v):
    if v is None:
        return []
    if isinstance(v, list):
        return v
    return [v]


# ---------- 本周工作内容 ----------
class PersonalReportWorkItemIn(BaseModel):
    """本周工作内容行 (创建/更新共用; 全量替换; 每行一天)"""

    project_id: Optional[int] = None  # 所属项目 (选择)
    day_of_week: int = 1       # 周几: 1=周一 ~ 7=周日
    content: str = ""          # 当天工作内容
    participants: str = ""   # 参与人员
    deliverable: str = ""    # 交付物
    hours: float = 0         # 工时(H)
    sort_order: int = 0


class PersonalReportWorkItemOut(PersonalReportWorkItemIn):
    """本周工作内容输出行"""

    id: int
    report_id: int
    model_config = ConfigDict(from_attributes=True)


# ---------- 下周工作计划 ----------
class PersonalReportPlanItemIn(BaseModel):
    """下周工作计划行 (全量替换)"""

    project_id: Optional[int] = None
    content: str = ""
    sort_order: int = 0


class PersonalReportPlanItemOut(PersonalReportPlanItemIn):
    """下周工作计划输出行"""

    id: int
    report_id: int
    model_config = ConfigDict(from_attributes=True)


# ---------- 个人周报主体 ----------
class PersonalReportBase(BaseModel):
    """个人周报基础字段"""

    project_id: Optional[int] = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    member_name: str
    week_start: date
    week_end: date


class PersonalReportCreate(PersonalReportBase):
    """新建个人周报 (含完整子表)"""

    work_items: list[PersonalReportWorkItemIn] = []
    plan_items: list[PersonalReportPlanItemIn] = []


class PersonalReportUpdate(BaseModel):
    """更新个人周报 (子表全量替换; 周期/人员不可改)"""

    work_items: Optional[list[PersonalReportWorkItemIn]] = None
    plan_items: Optional[list[PersonalReportPlanItemIn]] = None


class PersonalReportOut(PersonalReportBase):
    """个人周报输出 (含子表与总工时)"""

    id: int
    project_id: int
    work_items: list[PersonalReportWorkItemOut] = []
    plan_items: list[PersonalReportPlanItemOut] = []
    total_hours: float = 0
    model_config = ConfigDict(from_attributes=True)

    @field_validator("work_items", "plan_items", mode="before")
    @classmethod
    def _listify(cls, v):
        return _none_to_list(v)
