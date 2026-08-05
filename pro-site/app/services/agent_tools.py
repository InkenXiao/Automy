"""Agent 工具集 · 调用 pro-site 内部 API 执行具体操作"""
import json
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting import Meeting, MeetingItem
from app.models.module import Module
from app.models.phase import Phase
from app.models.progress_task import ProgressTask
from app.models.project import Project
from app.models.weekly_report import WeeklyReport, WeeklyKpi, WeeklyProgressItem, WeeklyPlanTask, WeeklyRisk
from app.models.work_task import WeeklyWorkTask


# ---------- 工具定义 (OpenAI Function Calling 格式) ----------

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_progress_tasks",
            "description": "获取项目进度任务列表",
            "parameters": {
                "type": "object",
                "properties": {
                    "phase_id": {"type": "integer", "description": "阶段ID过滤"},
                    "status": {"type": "string", "description": "状态过滤: planned/ongoing/done/deleted"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_progress_task",
            "description": "创建新的进度任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_uid": {"type": "string", "description": "任务编号, 如 1-1"},
                    "name": {"type": "string", "description": "任务名称"},
                    "phase_id": {"type": "integer", "description": "所属阶段ID"},
                    "start_date": {"type": "string", "description": "开始日期 YYYY-MM-DD"},
                    "end_date": {"type": "string", "description": "结束日期 YYYY-MM-DD"},
                    "status": {"type": "string", "description": "状态: planned/ongoing/done", "default": "planned"},
                    "full_desc": {"type": "string", "description": "详细描述"},
                },
                "required": ["task_uid", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_progress_task",
            "description": "更新进度任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "description": "任务ID"},
                    "name": {"type": "string"},
                    "status": {"type": "string", "description": "planned/ongoing/done/deleted"},
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                    "phase_id": {"type": "integer"},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_phases",
            "description": "获取项目阶段列表",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_modules",
            "description": "获取项目模块列表",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weekly_reports",
            "description": "获取周报列表",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weekly_report_detail",
            "description": "获取周报详情(含KPI/进展/计划/风险)",
            "parameters": {
                "type": "object",
                "properties": {
                    "report_id": {"type": "integer", "description": "周报ID"},
                },
                "required": ["report_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_meetings",
            "description": "获取会议列表",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_meeting",
            "description": "创建会议",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "会议标题"},
                    "meeting_type": {"type": "string", "description": "会议类型"},
                    "meeting_date": {"type": "string", "description": "会议日期 YYYY-MM-DD"},
                    "start_time": {"type": "string", "description": "开始时间 HH:MM"},
                    "end_time": {"type": "string", "description": "结束时间 HH:MM"},
                    "location": {"type": "string"},
                    "participants": {"type": "string"},
                    "summary": {"type": "string", "description": "会议纪要"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_work_tasks",
            "description": "获取每周工作任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_work_task",
            "description": "创建每周工作任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "任务名称"},
                    "module_id": {"type": "integer"},
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD"},
                    "owner": {"type": "string"},
                    "priority": {"type": "string", "description": "高/中/低"},
                    "status": {"type": "string", "default": "待开始"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_project_info",
            "description": "获取当前项目信息",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# ---------- 工具执行器 ----------

class ToolExecutor:
    """执行 Agent 工具调用, 直接操作数据库"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def execute(self, tool_name: str, arguments: dict) -> Any:
        """分发执行工具"""
        handler = getattr(self, f"_tool_{tool_name}", None)
        if not handler:
            return {"error": f"未知工具: {tool_name}"}
        try:
            return await handler(**arguments)
        except Exception as e:
            return {"error": str(e)}

    # ---- 项目信息 ----

    async def _tool_get_project_info(self) -> dict:
        result = await self.db.execute(select(Project).where(Project.is_active.is_(True)))
        p = result.scalars().first()
        if not p:
            return {"error": "无激活项目"}
        return {"id": p.id, "name": p.name, "title": p.title, "start_date": str(p.start_date), "end_date": str(p.end_date)}

    # ---- 进度任务 ----

    async def _tool_get_progress_tasks(self, phase_id: Optional[int] = None, status: Optional[str] = None) -> list:
        q = select(ProgressTask).where(ProgressTask.is_delete.is_(False))
        if phase_id:
            q = q.where(ProgressTask.phase_id == phase_id)
        if status:
            q = q.where(ProgressTask.status == status)
        q = q.order_by(ProgressTask.phase_id, ProgressTask.sort_order)
        result = await self.db.execute(q)
        tasks = result.scalars().all()
        return [
            {
                "id": t.id, "task_uid": t.task_uid, "name": t.name,
                "phase_id": t.phase_id, "status": t.status,
                "start_date": str(t.start_date), "end_date": str(t.end_date),
                "is_milestone": t.is_milestone,
            }
            for t in tasks
        ]

    async def _tool_create_progress_task(self, task_uid: str, name: str, **kwargs) -> dict:
        task = ProgressTask(task_uid=task_uid, name=name, **kwargs)
        self.db.add(task)
        await self.db.flush()
        await self.db.refresh(task)
        return {"id": task.id, "task_uid": task.task_uid, "name": task.name}

    async def _tool_update_progress_task(self, task_id: int, **kwargs) -> dict:
        task = await self.db.get(ProgressTask, task_id)
        if not task or task.is_delete:
            return {"error": "任务不存在"}
        for k, v in kwargs.items():
            if v is not None:
                setattr(task, k, v)
        await self.db.flush()
        await self.db.refresh(task)
        return {"id": task.id, "name": task.name, "status": task.status}

    # ---- 阶段与模块 ----

    async def _tool_get_phases(self) -> list:
        result = await self.db.execute(
            select(Phase).where(Phase.is_delete.is_(False)).order_by(Phase.sort_order)
        )
        return [
            {"id": p.id, "name": p.name, "subtitle": p.subtitle,
             "start_date": str(p.start_date), "end_date": str(p.end_date)}
            for p in result.scalars().all()
        ]

    async def _tool_get_modules(self) -> list:
        result = await self.db.execute(
            select(Module).where(Module.is_delete.is_(False)).order_by(Module.sort_order)
        )
        return [{"id": m.id, "name": m.name, "owner": m.owner, "sort_order": m.sort_order} for m in result.scalars().all()]

    # ---- 周报 ----

    async def _tool_get_weekly_reports(self) -> list:
        result = await self.db.execute(
            select(WeeklyReport).where(WeeklyReport.is_delete.is_(False)).order_by(WeeklyReport.id.desc()).limit(10)
        )
        return [{"id": r.id, "title": r.title, "week_range": r.week_range, "status": r.status} for r in result.scalars().all()]

    async def _tool_get_weekly_report_detail(self, report_id: int) -> dict:
        report = await self.db.get(WeeklyReport, report_id)
        if not report or report.is_delete:
            return {"error": "周报不存在"}
        return {
            "id": report.id, "title": report.title, "week_range": report.week_range,
            "kpis": [{"module_id": k.module_id, "progress_pct": k.progress_pct, "status": k.status} for k in report.kpis],
            "progress_items": [{"module_id": p.module_id, "content": p.content, "detail": p.detail} for p in report.progress_items],
            "plan_tasks": [{"module_id": t.module_id, "name": t.name, "owner": t.owner, "status": t.status} for t in report.plan_tasks],
            "risks": [{"seq": r.seq, "title": r.title, "urgency": r.urgency} for r in report.risks],
        }

    # ---- 会议 ----

    async def _tool_get_meetings(self) -> list:
        result = await self.db.execute(
            select(Meeting).where(Meeting.is_delete.is_(False)).order_by(Meeting.meeting_date.desc()).limit(10)
        )
        return [{"id": m.id, "title": m.title, "meeting_date": str(m.meeting_date), "summary": m.summary} for m in result.scalars().all()]

    async def _tool_create_meeting(self, title: str, **kwargs) -> dict:
        meeting = Meeting(title=title, **kwargs)
        self.db.add(meeting)
        await self.db.flush()
        await self.db.refresh(meeting)
        return {"id": meeting.id, "title": meeting.title}

    # ---- 工作任务 ----

    async def _tool_get_work_tasks(self, week_start: Optional[str] = None) -> list:
        q = select(WeeklyWorkTask)
        if week_start:
            q = q.where(WeeklyWorkTask.week_start == week_start)
        q = q.order_by(WeeklyWorkTask.sort_order)
        result = await self.db.execute(q)
        return [
            {"id": t.id, "name": t.name, "owner": t.owner, "status": t.status, "priority": t.priority}
            for t in result.scalars().all()
        ]

    async def _tool_create_work_task(self, name: str, **kwargs) -> dict:
        task = WeeklyWorkTask(name=name, **kwargs)
        self.db.add(task)
        await self.db.flush()
        await self.db.refresh(task)
        return {"id": task.id, "name": task.name}
