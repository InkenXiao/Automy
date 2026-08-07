"""周报相关 schema · 含核心关联表 plan_tasks"""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.module import ModuleOut
from app.schemas.progress_task import ProgressTaskOut


def _none_to_list(v):
    """SQLAlchemy 异步模式下未加载的关系可能返回 None 或单个对象, 统一转为列表"""
    if v is None:
        return []
    if isinstance(v, list):
        return v
    return [v]


# ---------- KPI ----------
class WeeklyKpiCreate(BaseModel):
    """周报 KPI 创建请求"""

    module_id: int
    progress_pct: int = 0
    status: str = "正常"


class WeeklyKpiOut(WeeklyKpiCreate):
    """周报 KPI 输出"""

    id: int
    report_id: int
    module: Optional[ModuleOut] = None
    model_config = ConfigDict(from_attributes=True)


# ---------- 进展事项 ----------
class WeeklyProgressItemCreate(BaseModel):
    """周报进展事项创建请求"""

    module_id: int
    content: str = ""
    detail: str = ""
    sort_order: int = 0


class WeeklyProgressItemUpdate(BaseModel):
    """周报进展事项更新请求 (全部字段可选)"""

    module_id: int | None = None
    content: str | None = None
    detail: str | None = None
    sort_order: int | None = None


class WeeklyProgressItemOut(WeeklyProgressItemCreate):
    """周报进展事项输出"""

    id: int
    report_id: int
    module: Optional[ModuleOut] = None
    model_config = ConfigDict(from_attributes=True)


# ---------- 下周任务 ----------
class WeeklyPlanTaskCreate(BaseModel):
    """周报下周任务创建请求"""

    module_id: int
    progress_task_id: Optional[int] = None
    name: str
    is_key: bool = False
    owner: str = ""
    plan_period: str = ""
    status: str = "待开始"
    remark: str = ""
    sort_order: int = 0


class WeeklyPlanTaskUpdate(BaseModel):
    """周报下周任务更新请求 (全部字段可选)"""

    module_id: int | None = None
    progress_task_id: int | None = None
    name: str | None = None
    is_key: bool | None = None
    owner: str | None = None
    plan_period: str | None = None
    status: str | None = None
    remark: str | None = None
    sort_order: int | None = None


class WeeklyPlanTaskOut(WeeklyPlanTaskCreate):
    """周报下周任务输出 (含可选嵌套 progress_task 与 module)"""

    id: int
    report_id: int
    progress_task: Optional[ProgressTaskOut] = None
    module: Optional[ModuleOut] = None
    model_config = ConfigDict(from_attributes=True)


# ---------- 风险 ----------
class WeeklyRiskCreate(BaseModel):
    """周报风险创建请求"""

    seq: str = "R1"
    title: str = ""
    coordination: str = ""
    urgency: str = "中"
    sort_order: int = 0


class WeeklyRiskUpdate(BaseModel):
    """周报风险更新请求 (全部字段可选)"""

    seq: str | None = None
    title: str | None = None
    coordination: str | None = None
    urgency: str | None = None
    sort_order: int | None = None


class WeeklyRiskOut(WeeklyRiskCreate):
    """周报风险输出"""

    id: int
    report_id: int
    model_config = ConfigDict(from_attributes=True)


# ---------- 关联进度计划任务请求 ----------
class PlanTaskLinkRequest(BaseModel):
    """从进度计划关联下周任务请求"""

    progress_task_id: int
    module_id: int


# ---------- 复制上周周报请求 ----------
class CopyLastWeekRequest(BaseModel):
    """复制上周周报到新周次的请求"""

    week_start: date
    week_end: date
    project_id: Optional[int] = None  # ★所属项目ID (可选, 不传则用当前激活项目)
    title: str | None = None
    overview_summary: str | None = None


# ---------- 周报主体 ----------
class WeeklyReportBase(BaseModel):
    """周报基础字段"""

    project_id: Optional[int] = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    title: str = ""
    week_range: str = ""
    week_start: Optional[date] = None
    week_end: Optional[date] = None
    overview_summary: str = ""
    week_digest: str = ""  # 周报概括 (AI 生成, 微信汇报版)
    status: str = "draft"


class WeeklyReportCreate(WeeklyReportBase):
    """新建周报请求"""


class WeeklyReportUpdate(BaseModel):
    """更新周报请求 (全部字段可选, project_id 不可改)"""

    title: str | None = None
    week_range: str | None = None
    week_start: date | None = None
    week_end: date | None = None
    overview_summary: str | None = None
    week_digest: str | None = None
    status: str | None = None


class WeeklyReportOut(WeeklyReportBase):
    """周报输出 (含全部子表)"""

    id: int
    project_id: int  # ★所属项目ID
    kpis: list[WeeklyKpiOut] = []
    progress_items: list[WeeklyProgressItemOut] = []
    plan_tasks: list[WeeklyPlanTaskOut] = []
    risks: list[WeeklyRiskOut] = []
    model_config = ConfigDict(from_attributes=True)

    @field_validator("kpis", "progress_items", "plan_tasks", "risks", mode="before")
    @classmethod
    def _none_to_list(cls, v):
        return _none_to_list(v)
