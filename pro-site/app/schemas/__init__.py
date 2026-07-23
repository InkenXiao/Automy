"""Pydantic schemas 汇总 · 统一导出所有 schema"""
from app.schemas.module import (
    ModuleBase,
    ModuleCreate,
    ModuleUpdate,
    ModuleOut,
)
from app.schemas.phase import PhaseBase, PhaseCreate, PhaseOut
from app.schemas.progress_task import (
    ProgressTaskBase,
    ProgressTaskCreate,
    ProgressTaskUpdate,
    ProgressTaskOut,
)
from app.schemas.weekly_report import (
    WeeklyReportBase,
    WeeklyReportCreate,
    WeeklyReportUpdate,
    WeeklyReportOut,
    WeeklyKpiCreate,
    WeeklyKpiOut,
    WeeklyProgressItemCreate,
    WeeklyProgressItemOut,
    WeeklyPlanTaskCreate,
    WeeklyPlanTaskUpdate,
    WeeklyPlanTaskOut,
    WeeklyRiskCreate,
    WeeklyRiskOut,
    PlanTaskLinkRequest,
)
from app.schemas.work_task import (
    WeeklyWorkTaskBase,
    WeeklyWorkTaskCreate,
    WeeklyWorkTaskUpdate,
    WeeklyWorkTaskOut,
)

__all__ = [
    "ModuleBase",
    "ModuleCreate",
    "ModuleUpdate",
    "ModuleOut",
    "PhaseBase",
    "PhaseCreate",
    "PhaseOut",
    "ProgressTaskBase",
    "ProgressTaskCreate",
    "ProgressTaskUpdate",
    "ProgressTaskOut",
    "WeeklyReportBase",
    "WeeklyReportCreate",
    "WeeklyReportUpdate",
    "WeeklyReportOut",
    "WeeklyKpiCreate",
    "WeeklyKpiOut",
    "WeeklyProgressItemCreate",
    "WeeklyProgressItemOut",
    "WeeklyPlanTaskCreate",
    "WeeklyPlanTaskUpdate",
    "WeeklyPlanTaskOut",
    "WeeklyRiskCreate",
    "WeeklyRiskOut",
    "PlanTaskLinkRequest",
    "WeeklyWorkTaskBase",
    "WeeklyWorkTaskCreate",
    "WeeklyWorkTaskUpdate",
    "WeeklyWorkTaskOut",
]
