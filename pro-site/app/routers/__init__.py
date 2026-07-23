"""API 路由汇总 · 导出所有路由模块"""
from app.routers import (
    modules,
    phases,
    progress_tasks,
    weekly_reports,
    work_tasks,
)

__all__ = [
    "modules",
    "phases",
    "progress_tasks",
    "weekly_reports",
    "work_tasks",
]
