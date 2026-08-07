"""Agent 工具集 · 直接操作数据库执行具体业务操作

所有工具与真实 ORM 模型字段严格对齐:
- 查询类工具自动按当前激活项目 (project_id) 过滤
- 写入类工具自动注入当前激活项目 project_id
- 日期字符串统一 date.fromisoformat() 转换后落库
"""
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.meeting import Meeting
from app.models.module import Module
from app.models.phase import Phase
from app.models.progress_task import ProgressTask
from app.models.project import Project
from app.models.skill import Skill
from app.models.weekly_report import (
    WeeklyKpi,
    WeeklyPlanTask,
    WeeklyProgressItem,
    WeeklyReport,
    WeeklyRisk,
)
from app.models.work_task import WeeklyWorkTask
from app.utils import get_active_project_id


def _parse_date(value: Any) -> Optional[date]:
    """将 'YYYY-MM-DD' 字符串解析为 date; 非法/为空返回 None"""
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return None
    return None


# ---------- 工具定义 (OpenAI Function Calling 格式) ----------

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_today",
            "description": "获取当前日期与本周起止日期 (感知时间环境)",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_project_info",
            "description": "获取当前激活项目信息",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_progress_tasks",
            "description": "获取项目进度任务列表 (当前激活项目)",
            "parameters": {
                "type": "object",
                "properties": {
                    "phase_id": {"type": "integer", "description": "阶段ID过滤"},
                    "status": {"type": "string", "description": "状态过滤: planned/ongoing/milestone/done"},
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
                    "owner": {"type": "string", "description": "负责人"},
                    "full_desc": {"type": "string", "description": "详细描述"},
                    "is_milestone": {"type": "boolean", "description": "是否里程碑"},
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
                    "status": {"type": "string", "description": "planned/ongoing/milestone/done/deleted"},
                    "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "end_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "phase_id": {"type": "integer"},
                    "owner": {"type": "string"},
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
            "description": "获取周报列表 (最近10份)",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weekly_report_detail",
            "description": "获取周报详情(含KPI/进展/下周任务/风险)",
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
            "name": "create_weekly_report",
            "description": "创建本周周报 (自动复制上一份周报的KPI/进展/任务/风险作为草稿, 下周任务状态重置为待开始)",
            "parameters": {
                "type": "object",
                "properties": {
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD, 默认为本周一"},
                    "title": {"type": "string", "description": "周报标题, 默认自动生成"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_meetings",
            "description": "获取会议列表 (最近10个)",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_meeting_detail",
            "description": "获取会议详情 (含全部议程项/纪要条目)",
            "parameters": {
                "type": "object",
                "properties": {
                    "meeting_id": {"type": "integer", "description": "会议ID"},
                },
                "required": ["meeting_id"],
            },
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
                    "title": {"type": "string", "description": "会议主题"},
                    "meet_date": {"type": "string", "description": "会议日期 YYYY-MM-DD"},
                    "meet_time": {"type": "string", "description": "时间段, 如 09:00-10:00"},
                    "place": {"type": "string", "description": "地点"},
                    "host": {"type": "string", "description": "主持人"},
                    "attendees": {"type": "string", "description": "参会人员, 逗号分隔"},
                    "description": {"type": "string", "description": "会议描述/纪要"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_meeting",
            "description": "将对话中确认的会议内容更新到数据库 (主题/日期/时间/地点/主持人/参会人/会议纪要/录音转写原文/录音文件), 用于会议记录落库",
            "parameters": {
                "type": "object",
                "properties": {
                    "meeting_id": {"type": "integer", "description": "会议ID (必填)"},
                    "title": {"type": "string", "description": "会议主题"},
                    "meet_date": {"type": "string", "description": "会议日期 YYYY-MM-DD"},
                    "meet_time": {"type": "string", "description": "时间段, 如 09:00-10:00"},
                    "place": {"type": "string", "description": "地点"},
                    "host": {"type": "string", "description": "主持人"},
                    "attendees": {"type": "string", "description": "参会人员, 逗号分隔"},
                    "description": {"type": "string", "description": "会议描述/纪要正文"},
                    "transcript": {"type": "string", "description": "录音转写完整文字 (带时间戳)"},
                    "audio_file": {"type": "string", "description": "原始录音文件名 (任务附件中的文件)"},
                },
                "required": ["meeting_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_meeting_item",
            "description": "为指定会议添加议程项/纪要条目 (时间/主题/发言人/时长/备注)",
            "parameters": {
                "type": "object",
                "properties": {
                    "meeting_id": {"type": "integer", "description": "会议ID"},
                    "item_time": {"type": "string", "description": "议程时间, 如 09:00-09:10"},
                    "theme": {"type": "string", "description": "议程主题"},
                    "speaker": {"type": "string", "description": "发言人"},
                    "duration": {"type": "string", "description": "时长, 如 10分钟"},
                    "note": {"type": "string", "description": "备注/纪要要点"},
                },
                "required": ["meeting_id", "theme"],
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
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD, 不传则取全部"},
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
                    "module_id": {"type": "integer", "description": "所属模块ID"},
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD, 默认本周一"},
                    "owner": {"type": "string", "description": "负责人"},
                    "priority": {"type": "string", "description": "优先级: high/medium/low", "default": "medium"},
                    "planned_hours": {"type": "number", "description": "计划工时"},
                    "remark": {"type": "string", "description": "备注"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_work_task",
            "description": "更新每周工作任务 (状态/工时/优先级等)",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "description": "任务ID"},
                    "status": {"type": "string", "description": "待开始/进行中/已完成/已取消"},
                    "actual_hours": {"type": "number", "description": "实际工时"},
                    "priority": {"type": "string", "description": "high/medium/low"},
                    "owner": {"type": "string"},
                    "remark": {"type": "string"},
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_skill",
            "description": "执行一个技能 (按名称或ID), 可传入输入参数",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_id": {"type": "integer", "description": "技能ID (与 skill_name 二选一)"},
                    "skill_name": {"type": "string", "description": "技能名称 (模糊匹配)"},
                    "input_data": {"type": "object", "description": "技能输入参数"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_memory",
            "description": "将重要事实/用户偏好/关键决策保存为长期记忆, 供后续对话使用",
            "parameters": {
                "type": "object",
                "properties": {
                    "memory_type": {"type": "string", "description": "类型: fact/preference/context/decision", "default": "fact"},
                    "key": {"type": "string", "description": "记忆键名, 简短概括"},
                    "content": {"type": "string", "description": "记忆内容"},
                },
                "required": ["content"],
            },
        },
    },
]


# ---------- 工具执行器 ----------

class ToolExecutor:
    """执行 Agent 工具调用, 直接操作数据库

    agent_id/session_id 由 AgentEngine 注入, 供 save_memory / run_skill 等
    需要上下文的工具使用; SkillEngine 单独使用时为 None。
    """

    def __init__(
        self,
        db: AsyncSession,
        agent_id: Optional[int] = None,
        session_id: Optional[int] = None,
    ):
        self.db = db
        self.agent_id = agent_id
        self.session_id = session_id

    async def execute(self, tool_name: str, arguments: dict) -> Any:
        """分发执行工具"""
        handler = getattr(self, f"_tool_{tool_name}", None)
        if not handler:
            return {"error": f"未知工具: {tool_name}"}
        try:
            return await handler(**(arguments or {}))
        except Exception as e:
            return {"error": f"{type(e).__name__}: {e}"}

    # ---- 感知: 时间与项目 ----

    async def _tool_get_today(self) -> dict:
        today = date.today()
        week_start = today - timedelta(days=today.weekday())
        return {
            "today": str(today),
            "weekday": today.isoweekday(),
            "week_start": str(week_start),
            "week_end": str(week_start + timedelta(days=6)),
        }

    async def _tool_get_project_info(self) -> dict:
        pid = await get_active_project_id(self.db)
        p = await self.db.get(Project, pid)
        if not p:
            return {"error": "无激活项目"}
        return {
            "id": p.id, "name": p.name, "title": p.title,
            "start_date": str(p.start_date), "end_date": str(p.end_date),
        }

    # ---- 进度任务 ----

    async def _tool_get_progress_tasks(
        self, phase_id: Optional[int] = None, status: Optional[str] = None
    ) -> list:
        pid = await get_active_project_id(self.db)
        q = select(ProgressTask).where(
            ProgressTask.is_delete.is_(False),
            ProgressTask.project_id == pid,
        )
        if phase_id:
            q = q.where(ProgressTask.phase_id == phase_id)
        if status:
            q = q.where(ProgressTask.status == status)
        q = q.order_by(ProgressTask.phase_id, ProgressTask.id)
        result = await self.db.execute(q)
        tasks = result.scalars().all()
        return [
            {
                "id": t.id, "task_uid": t.task_uid, "name": t.name,
                "phase_id": t.phase_id, "status": t.status,
                "start_date": str(t.start_date), "end_date": str(t.end_date),
                "owner": t.owner, "is_milestone": t.is_milestone,
            }
            for t in tasks
        ]

    async def _tool_create_progress_task(self, task_uid: str, name: str, **kwargs) -> dict:
        pid = await get_active_project_id(self.db)
        kwargs["start_date"] = _parse_date(kwargs.get("start_date"))
        kwargs["end_date"] = _parse_date(kwargs.get("end_date"))
        kwargs = {k: v for k, v in kwargs.items() if v is not None}
        task = ProgressTask(task_uid=task_uid, name=name, project_id=pid, **kwargs)
        self.db.add(task)
        await self.db.flush()
        await self.db.refresh(task)
        return {"id": task.id, "task_uid": task.task_uid, "name": task.name}

    async def _tool_update_progress_task(self, task_id: int, **kwargs) -> dict:
        task = await self.db.get(ProgressTask, task_id)
        if not task or task.is_delete:
            return {"error": "任务不存在"}
        for key in ("start_date", "end_date"):
            if key in kwargs:
                kwargs[key] = _parse_date(kwargs[key])
        allowed = {"name", "status", "start_date", "end_date", "phase_id", "owner", "full_desc", "is_milestone"}
        for k, v in kwargs.items():
            if k in allowed and v is not None:
                setattr(task, k, v)
        await self.db.flush()
        await self.db.refresh(task)
        return {"id": task.id, "name": task.name, "status": task.status}

    # ---- 阶段与模块 ----

    async def _tool_get_phases(self) -> list:
        pid = await get_active_project_id(self.db)
        result = await self.db.execute(
            select(Phase)
            .where(Phase.is_delete.is_(False), Phase.project_id == pid)
            .order_by(Phase.start_date)
        )
        return [
            {
                "id": p.id, "name": p.name, "subtitle": p.subtitle,
                "start_date": str(p.start_date), "end_date": str(p.end_date),
            }
            for p in result.scalars().all()
        ]

    async def _tool_get_modules(self) -> list:
        pid = await get_active_project_id(self.db)
        result = await self.db.execute(
            select(Module)
            .where(Module.is_delete.is_(False), Module.project_id == pid)
            .order_by(Module.sort_order)
        )
        return [
            {
                "id": m.id, "idx": m.idx, "tag": m.tag, "title": m.title,
                "owner": m.owner, "sort_order": m.sort_order,
            }
            for m in result.scalars().all()
        ]

    # ---- 周报 ----

    async def _tool_get_weekly_reports(self) -> list:
        pid = await get_active_project_id(self.db)
        result = await self.db.execute(
            select(WeeklyReport)
            .where(WeeklyReport.is_delete.is_(False), WeeklyReport.project_id == pid)
            .order_by(WeeklyReport.week_start.desc(), WeeklyReport.id.desc())
            .limit(10)
        )
        return [
            {
                "id": r.id, "title": r.title, "week_range": r.week_range,
                "week_start": str(r.week_start), "status": r.status,
            }
            for r in result.scalars().all()
        ]

    async def _tool_get_weekly_report_detail(self, report_id: int) -> dict:
        result = await self.db.execute(
            select(WeeklyReport)
            .options(
                selectinload(WeeklyReport.kpis),
                selectinload(WeeklyReport.progress_items),
                selectinload(WeeklyReport.plan_tasks),
                selectinload(WeeklyReport.risks),
            )
            .where(WeeklyReport.id == report_id, WeeklyReport.is_delete.is_(False))
        )
        report = result.scalars().first()
        if not report:
            return {"error": "周报不存在"}
        return {
            "id": report.id,
            "title": report.title,
            "week_range": report.week_range,
            "status": report.status,
            "overview_summary": report.overview_summary,
            "kpis": [
                {"module_id": k.module_id, "progress_pct": k.progress_pct, "status": k.status}
                for k in report.kpis if not k.is_delete
            ],
            "progress_items": [
                {"module_id": p.module_id, "content": p.content, "detail": p.detail}
                for p in report.progress_items if not p.is_delete
            ],
            "plan_tasks": [
                {
                    "id": t.id, "module_id": t.module_id, "name": t.name,
                    "owner": t.owner, "status": t.status, "is_key": t.is_key,
                }
                for t in report.plan_tasks if not t.is_delete
            ],
            "risks": [
                {"seq": r.seq, "title": r.title, "urgency": r.urgency}
                for r in report.risks if not r.is_delete
            ],
        }

    async def _tool_create_weekly_report(
        self, week_start: Optional[str] = None, title: Optional[str] = None
    ) -> dict:
        pid = await get_active_project_id(self.db)
        ws = _parse_date(week_start) or (date.today() - timedelta(days=date.today().weekday()))
        we = ws + timedelta(days=6)

        # 本周已有周报则直接返回
        exist = await self.db.execute(
            select(WeeklyReport).where(
                WeeklyReport.is_delete.is_(False),
                WeeklyReport.project_id == pid,
                WeeklyReport.week_start == ws,
            )
        )
        if exist.scalars().first():
            return {"error": f"{ws} 所在周已存在周报, 请勿重复创建"}

        # 查找最近一份历史周报作为复制源 (预加载子表)
        src_result = await self.db.execute(
            select(WeeklyReport)
            .options(
                selectinload(WeeklyReport.kpis),
                selectinload(WeeklyReport.progress_items),
                selectinload(WeeklyReport.plan_tasks),
                selectinload(WeeklyReport.risks),
            )
            .where(
                WeeklyReport.is_delete.is_(False),
                WeeklyReport.project_id == pid,
                WeeklyReport.week_start < ws,
            )
            .order_by(WeeklyReport.week_start.desc(), WeeklyReport.id.desc())
            .limit(1)
        )
        src = src_result.scalars().first()

        new_report = WeeklyReport(
            project_id=pid,
            title=title or f"{ws} 周报",
            week_range=f"{ws.strftime('%m.%d')} — {we.strftime('%m.%d')}",
            week_start=ws,
            week_end=we,
            overview_summary="",
            status="draft",
        )
        self.db.add(new_report)
        await self.db.flush()

        copied = {"kpis": 0, "progress_items": 0, "plan_tasks": 0, "risks": 0}
        if src:
            for k in src.kpis:
                if k.is_delete:
                    continue
                self.db.add(WeeklyKpi(report_id=new_report.id, module_id=k.module_id,
                                      progress_pct=k.progress_pct, status=k.status))
                copied["kpis"] += 1
            for p in src.progress_items:
                if p.is_delete:
                    continue
                self.db.add(WeeklyProgressItem(report_id=new_report.id, module_id=p.module_id,
                                               content=p.content, detail=p.detail,
                                               sort_order=p.sort_order))
                copied["progress_items"] += 1
            for t in src.plan_tasks:
                if t.is_delete:
                    continue
                self.db.add(WeeklyPlanTask(report_id=new_report.id, module_id=t.module_id,
                                           progress_task_id=t.progress_task_id, name=t.name,
                                           is_key=t.is_key, owner=t.owner,
                                           plan_period=t.plan_period, status="待开始",
                                           remark=t.remark, sort_order=t.sort_order))
                copied["plan_tasks"] += 1
            for r in src.risks:
                if r.is_delete:
                    continue
                self.db.add(WeeklyRisk(report_id=new_report.id, seq=r.seq, title=r.title,
                                       coordination=r.coordination, urgency=r.urgency,
                                       sort_order=r.sort_order))
                copied["risks"] += 1
            await self.db.flush()

        return {
            "id": new_report.id,
            "title": new_report.title,
            "week_range": new_report.week_range,
            "copied_from": src.id if src else None,
            "copied": copied,
        }

    # ---- 会议 ----

    async def _tool_get_meetings(self) -> list:
        pid = await get_active_project_id(self.db)
        result = await self.db.execute(
            select(Meeting)
            .where(Meeting.is_delete.is_(False), Meeting.project_id == pid)
            .order_by(Meeting.meet_date.desc(), Meeting.id.desc())
            .limit(10)
        )
        return [
            {
                "id": m.id, "title": m.title, "meet_date": m.meet_date,
                "meet_time": m.meet_time, "place": m.place, "host": m.host,
                "attendees": m.attendees, "description": m.description,
            }
            for m in result.scalars().all()
        ]

    async def _tool_create_meeting(self, title: str, **kwargs) -> dict:
        pid = await get_active_project_id(self.db)
        allowed = {"meet_date", "meet_time", "place", "host", "attendees", "description"}
        fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        meeting = Meeting(title=title, project_id=pid, **fields)
        self.db.add(meeting)
        await self.db.flush()
        await self.db.refresh(meeting)
        return {"id": meeting.id, "title": meeting.title, "meet_date": meeting.meet_date}

    async def _tool_get_meeting_detail(self, meeting_id: int) -> dict:
        """会议详情: 主记录 + 全部议程项 (按 sort_order 排序)"""
        result = await self.db.execute(
            select(Meeting)
            .options(selectinload(Meeting.items))
            .where(Meeting.id == meeting_id, Meeting.is_delete.is_(False))
        )
        meeting = result.scalars().first()
        if not meeting:
            return {"error": "会议不存在"}
        return {
            "id": meeting.id,
            "title": meeting.title,
            "meet_date": meeting.meet_date,
            "meet_time": meeting.meet_time,
            "place": meeting.place,
            "host": meeting.host,
            "attendees": meeting.attendees,
            "description": meeting.description,
            "audio_file": meeting.audio_file or "",
            "has_transcript": bool(meeting.transcript),
            "items": [
                {
                    "id": it.id, "item_time": it.item_time, "theme": it.theme,
                    "speaker": it.speaker, "duration": it.duration, "note": it.note,
                }
                for it in sorted(meeting.items, key=lambda x: x.sort_order)
                if not it.is_delete
            ],
        }

    async def _tool_update_meeting(self, meeting_id: int, **kwargs) -> dict:
        """更新会议主记录 (对话内容落库); 仅更新传入的非空字段"""
        meeting = await self.db.get(Meeting, meeting_id)
        if not meeting or meeting.is_delete:
            return {"error": "会议不存在"}
        allowed = {"title", "meet_date", "meet_time", "place", "host", "attendees",
                   "description", "transcript", "audio_file"}
        updated = []
        for k, v in kwargs.items():
            if k in allowed and v is not None:
                setattr(meeting, k, v)
                updated.append(k)
        if not updated:
            return {"error": "未提供任何待更新字段"}
        await self.db.flush()
        await self.db.refresh(meeting)
        return {"id": meeting.id, "title": meeting.title, "updated_fields": updated}

    async def _tool_add_meeting_item(self, meeting_id: int, theme: str, **kwargs) -> dict:
        """添加会议议程项/纪要条目"""
        from app.models.meeting import MeetingItem

        meeting = await self.db.get(Meeting, meeting_id)
        if not meeting or meeting.is_delete:
            return {"error": "会议不存在"}
        allowed = {"item_time", "speaker", "duration", "note", "description"}
        fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        item = MeetingItem(meeting_id=meeting_id, theme=theme, **fields)
        self.db.add(item)
        await self.db.flush()
        await self.db.refresh(item)
        return {"id": item.id, "meeting_id": meeting_id, "theme": item.theme}

    # ---- 工作任务 ----

    async def _tool_get_work_tasks(self, week_start: Optional[str] = None) -> list:
        pid = await get_active_project_id(self.db)
        q = select(WeeklyWorkTask).where(
            WeeklyWorkTask.is_delete.is_(False),
            WeeklyWorkTask.project_id == pid,
        )
        ws = _parse_date(week_start)
        if ws:
            q = q.where(WeeklyWorkTask.week_start == ws)
        q = q.order_by(WeeklyWorkTask.week_start.desc(), WeeklyWorkTask.sort_order, WeeklyWorkTask.id)
        result = await self.db.execute(q)
        return [
            {
                "id": t.id, "name": t.name, "owner": t.owner, "status": t.status,
                "priority": t.priority, "week_start": str(t.week_start),
                "planned_hours": float(t.planned_hours or 0),
                "actual_hours": float(t.actual_hours or 0),
            }
            for t in result.scalars().all()
        ]

    async def _tool_create_work_task(self, name: str, **kwargs) -> dict:
        pid = await get_active_project_id(self.db)
        ws = _parse_date(kwargs.pop("week_start", None))
        if not ws:
            ws = date.today() - timedelta(days=date.today().weekday())
        we = ws + timedelta(days=6)
        allowed = {"module_id", "owner", "priority", "planned_hours", "remark", "is_temporary"}
        fields = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
        task = WeeklyWorkTask(name=name, project_id=pid, week_start=ws, week_end=we, **fields)
        self.db.add(task)
        await self.db.flush()
        await self.db.refresh(task)
        return {"id": task.id, "name": task.name, "week_start": str(task.week_start)}

    async def _tool_update_work_task(self, task_id: int, **kwargs) -> dict:
        task = await self.db.get(WeeklyWorkTask, task_id)
        if not task or task.is_delete:
            return {"error": "任务不存在"}
        allowed = {"status", "actual_hours", "planned_hours", "priority", "owner", "remark", "name"}
        for k, v in kwargs.items():
            if k in allowed and v is not None:
                setattr(task, k, v)
        await self.db.flush()
        await self.db.refresh(task)
        return {"id": task.id, "name": task.name, "status": task.status}

    # ---- 技能 ----

    async def _tool_run_skill(
        self,
        skill_id: Optional[int] = None,
        skill_name: Optional[str] = None,
        input_data: Optional[dict] = None,
    ) -> dict:
        # 延迟导入避免循环依赖 (skill_engine 依赖 ToolExecutor)
        from app.services.skill_engine import SkillEngine
        from app.models.skill import SkillExecution

        skill: Optional[Skill] = None
        if skill_id:
            skill = await self.db.get(Skill, skill_id)
            if skill and skill.is_delete:
                skill = None
        elif skill_name:
            result = await self.db.execute(
                select(Skill)
                .where(
                    Skill.is_active.is_(True),
                    Skill.is_delete.is_(False),
                    Skill.name.contains(skill_name),
                )
                .order_by(Skill.id)
                .limit(1)
            )
            skill = result.scalars().first()
        if not skill or not skill.is_active:
            return {"error": "技能不存在或已停用"}

        import time
        start = time.time()
        execution = SkillExecution(
            skill_id=skill.id,
            session_id=self.session_id,
            input_data=input_data or {},
            status="running",
        )
        self.db.add(execution)
        await self.db.flush()

        engine = SkillEngine(self.db, session_id=self.session_id)
        try:
            output = await engine.execute(skill, input_data or {})
            execution.output_data = output
            execution.status = "success"
        except Exception as e:
            execution.error = str(e)
            execution.status = "failed"
            output = {"error": str(e)}
        finally:
            execution.duration_ms = int((time.time() - start) * 1000)
            await self.db.flush()

        return {"skill": skill.name, "execution_id": execution.id,
                "status": execution.status, "output": output}

    # ---- 记忆 ----

    async def _tool_save_memory(
        self, content: str, memory_type: str = "fact", key: str = ""
    ) -> dict:
        if not self.agent_id:
            return {"error": "当前上下文无 Agent, 无法保存记忆"}
        from app.models.agent import AgentMemory
        from app.utils import get_active_project_id

        if memory_type not in ("fact", "preference", "context", "decision"):
            memory_type = "fact"
        memory = AgentMemory(
            agent_id=self.agent_id,
            project_id=await get_active_project_id(self.db),
            session_id=self.session_id,
            memory_type=memory_type,
            key=key or content[:30],
            content=content,
        )
        self.db.add(memory)
        await self.db.flush()
        await self.db.refresh(memory)
        return {"id": memory.id, "key": memory.key, "saved": True}
