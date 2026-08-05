"""ORM 模型汇总 · 导出所有模型确保 metadata 可发现全部表"""
from app.models.agent import Agent, AgentMemory, AgentMessage, AgentSession
from app.models.base import Base, SoftDeleteMixin, TimestampMixin
from app.models.meeting import Meeting, MeetingItem
from app.models.module import Module
from app.models.phase import Phase
from app.models.progress_task import ProgressTask
from app.models.skill import Skill, SkillExecution
from app.models.task_run import TaskRun
from app.models.weekly_report import (
    WeeklyReport,
    WeeklyKpi,
    WeeklyProgressItem,
    WeeklyPlanTask,
    WeeklyRisk,
)
from app.models.work_task import WeeklyWorkTask

__all__ = [
    "Base",
    "SoftDeleteMixin",
    "TimestampMixin",
    "Agent",
    "AgentMemory",
    "AgentMessage",
    "AgentSession",
    "Meeting",
    "MeetingItem",
    "Module",
    "Phase",
    "Project",
    "ProgressTask",
    "Skill",
    "SkillExecution",
    "TaskRun",
    "WeeklyReport",
    "WeeklyKpi",
    "WeeklyProgressItem",
    "WeeklyPlanTask",
    "WeeklyRisk",
    "WeeklyWorkTask",
]
