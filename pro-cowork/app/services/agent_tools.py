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
    # ---------- 个人周报 (pro_personal_reports: 每人每周一份, 本周工作明细 + 下周计划 + 概括) ----------
    {
        "type": "function",
        "function": {
            "name": "list_personal_reports",
            "description": "列出当前项目某周个人周报填报情况: 已填报成员(工时/行数/有无概括)与未填报成员名单, 用于催报与汇总",
            "parameters": {
                "type": "object",
                "properties": {
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD (周一), 默认本周"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_personal_report",
            "description": "获取指定成员某周个人周报详情 (本周工作内容明细/下周工作计划/周报概括)",
            "parameters": {
                "type": "object",
                "properties": {
                    "member_name": {"type": "string", "description": "成员姓名 (必填)"},
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD (周一), 默认本周"},
                },
                "required": ["member_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_personal_report",
            "description": "创建或更新指定成员的个人周报: 子表按传入列表全量替换 (不传则保持原值), summary 传值即更新概括; 同项目同成员同周仅一份",
            "parameters": {
                "type": "object",
                "properties": {
                    "member_name": {"type": "string", "description": "成员姓名 (必填)"},
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD (周一), 默认本周"},
                    "work_items": {
                        "type": "array",
                        "description": "本周工作内容行 (全量替换): 每行一天",
                        "items": {
                            "type": "object",
                            "properties": {
                                "day_of_week": {"type": "integer", "description": "周几: 1=周一~7=周日"},
                                "content": {"type": "string", "description": "当天工作内容"},
                                "participants": {"type": "string", "description": "参与人员"},
                                "deliverable": {"type": "string", "description": "交付物"},
                                "hours": {"type": "number", "description": "工时(H)"},
                            },
                            "required": ["day_of_week", "content"],
                        },
                    },
                    "plan_items": {
                        "type": "array",
                        "description": "下周工作计划行 (全量替换)",
                        "items": {
                            "type": "object",
                            "properties": {"content": {"type": "string", "description": "计划内容"}},
                            "required": ["content"],
                        },
                    },
                    "summary": {"type": "string", "description": "周报概括 (2-3 段: 本周主要工作内容 + 下周工作计划)"},
                },
                "required": ["member_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_personal_summary",
            "description": "基于已保存的个人周报明细 AI 生成周报概括 (2-3 段) 并写回该周报, 返回概括文本; 明细为空时报错",
            "parameters": {
                "type": "object",
                "properties": {
                    "member_name": {"type": "string", "description": "成员姓名 (必填)"},
                    "week_start": {"type": "string", "description": "周起始日期 YYYY-MM-DD (周一), 默认本周"},
                },
                "required": ["member_name"],
            },
        },
    },
    # ---------- 知识库维护 (经 MCP 协议调 rag-cowork 知识库服务, 按当前用户身份做权限过滤) ----------
    {
        "type": "function",
        "function": {
            "name": "kb_list",
            "description": "列出当前用户可见的知识库 (可按级别过滤)",
            "parameters": {
                "type": "object",
                "properties": {
                    "level": {"type": "string", "description": "级别过滤: company/department/project/personal/external, 不传为全部"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kb_create",
            "description": "创建知识库",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "知识库名称"},
                    "level": {"type": "string", "description": "级别: company/department/project/personal/external"},
                    "description": {"type": "string", "description": "知识库描述"},
                    "project_id": {"type": "integer", "description": "项目ID (level=project 时必填)"},
                    "department": {"type": "string", "description": "部门名 (level=department 时必填)"},
                },
                "required": ["name", "level"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kb_files",
            "description": "列出知识库文件清单 (含解析状态 pending/parsing/done/error 与分块数), 用于巡检入库情况",
            "parameters": {
                "type": "object",
                "properties": {
                    "kb_id": {"type": "integer", "description": "知识库ID"},
                },
                "required": ["kb_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kb_file_add",
            "description": "上传文件到知识库并触发解析入库 (内容 base64 编码; 适合小文本文件, 大文件建议走知识库网页上传)",
            "parameters": {
                "type": "object",
                "properties": {
                    "kb_id": {"type": "integer", "description": "知识库ID"},
                    "file_name": {"type": "string", "description": "文件名 (含扩展名, 如 规范.md)"},
                    "content_base64": {"type": "string", "description": "文件内容 base64 编码"},
                },
                "required": ["kb_id", "file_name", "content_base64"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kb_file_parse",
            "description": "触发知识库文档解析入库流水线 (分块/向量化/实体关系抽取, 异步入库), 用于 pending/error 文档重跑",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_id": {"type": "integer", "description": "文档ID"},
                },
                "required": ["doc_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kb_file_delete",
            "description": "删除知识库文件 (逻辑删除并清理向量库/图谱/对象存储)",
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_id": {"type": "integer", "description": "文档ID"},
                },
                "required": ["doc_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kb_rag_search",
            "description": "知识库纯检索: 返回分块/实体命中, 不生成答案 (验证入库效果)",
            "parameters": {
                "type": "object",
                "properties": {
                    "kb_ids": {"type": "array", "items": {"type": "integer"}, "description": "知识库ID列表"},
                    "query": {"type": "string", "description": "检索问题"},
                    "top_k": {"type": "integer", "description": "返回条数, 默认 10"},
                },
                "required": ["kb_ids", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kb_rag_query",
            "description": "知识库 RAG 问答: 向量+图谱混合检索后生成含引用的答案 (验证问答效果)",
            "parameters": {
                "type": "object",
                "properties": {
                    "kb_ids": {"type": "array", "items": {"type": "integer"}, "description": "知识库ID列表"},
                    "query": {"type": "string", "description": "问题"},
                    "mode": {"type": "string", "description": "检索模式: hybrid/local/global, 默认 hybrid"},
                    "top_k": {"type": "integer", "description": "参考材料条数, 默认 8"},
                },
                "required": ["kb_ids", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_im",
            "description": "向当前用户的个人 IM 通道 (飞书/企微/钉钉/邮箱/OA/Obsidian, 在技链工坊配置) 推送消息通知",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "要推送的消息内容"},
                    "channel_id": {"type": "integer", "description": "指定通道ID, 留空则发到本人全部启用通道"},
                },
                "required": ["message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_tool_inspection",
            "description": "触发技链工坊工具巡检: 健康检查全部 MCP 服务、同步工具快照并diff变更、回放已存测试用例做回归门禁, 返回巡检报告摘要",
            "parameters": {"type": "object", "properties": {}},
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
        user_name: str = "",
    ):
        self.db = db
        self.agent_id = agent_id
        self.session_id = session_id
        # 当前对话用户姓名: 知识库 MCP 工具经 X-User-Name 透传给 rag 侧做权限过滤
        self.user_name = user_name

    async def execute(self, tool_name: str, arguments: dict) -> Any:
        """分发执行工具 (多余入参按 handler 签名过滤, 容忍模型幻觉参数)"""
        handler = getattr(self, f"_tool_{tool_name}", None)
        if not handler:
            return {"error": f"未知工具: {tool_name}"}
        try:
            import inspect

            sig = inspect.signature(handler)
            if not any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
            ):
                arguments = {
                    k: v for k, v in (arguments or {}).items() if k in sig.parameters
                }
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

        engine = SkillEngine(self.db, session_id=self.session_id, user_name=self.user_name or "system")
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

    # ---- 个人周报 ----

    @staticmethod
    def _personal_week(week_start: Optional[str]) -> date:
        """解析周起始; 默认本周一"""
        return _parse_date(week_start) or (date.today() - timedelta(days=date.today().weekday()))

    async def _load_personal_report(self, member_name: str, ws: date):
        """按 项目+成员+周 加载个人周报 (含子表); 未找到返回 None"""
        from app.models.personal_report import PersonalReport

        pid = await get_active_project_id(self.db)
        result = await self.db.execute(
            select(PersonalReport)
            .options(
                selectinload(PersonalReport.work_items),
                selectinload(PersonalReport.plan_items),
            )
            .where(
                PersonalReport.is_delete.is_(False),
                PersonalReport.project_id == pid,
                PersonalReport.member_name == member_name.strip(),
                PersonalReport.week_start == ws,
            )
        )
        return result.scalars().first()

    @staticmethod
    def _personal_report_dict(report) -> dict:
        works = [w for w in report.work_items if not w.is_delete]
        plans = [p for p in report.plan_items if not p.is_delete]
        return {
            "id": report.id,
            "member_name": report.member_name,
            "week_start": str(report.week_start),
            "week_end": str(report.week_end),
            "summary": report.summary or "",
            "total_hours": round(sum(w.hours or 0 for w in works), 2),
            "work_items": [
                {
                    "day_of_week": w.day_of_week, "content": w.content,
                    "participants": w.participants, "deliverable": w.deliverable,
                    "hours": w.hours,
                }
                for w in works
            ],
            "plan_items": [{"content": p.content} for p in plans],
        }

    async def _tool_list_personal_reports(self, week_start: Optional[str] = None) -> dict:
        from app.models.personal_report import PersonalReport
        from app.models.project_member import ProjectMember

        pid = await get_active_project_id(self.db)
        ws = self._personal_week(week_start)
        result = await self.db.execute(
            select(PersonalReport)
            .options(
                selectinload(PersonalReport.work_items),
                selectinload(PersonalReport.plan_items),
            )
            .where(
                PersonalReport.is_delete.is_(False),
                PersonalReport.project_id == pid,
                PersonalReport.week_start == ws,
            )
            .order_by(PersonalReport.member_name)
        )
        reports = result.scalars().all()
        filled = []
        for r in reports:
            works = [w for w in r.work_items if not w.is_delete]
            plans = [p for p in r.plan_items if not p.is_delete]
            filled.append({
                "id": r.id,
                "member_name": r.member_name,
                "total_hours": round(sum(w.hours or 0 for w in works), 2),
                "work_rows": len(works),
                "plan_rows": len(plans),
                "has_summary": bool((r.summary or "").strip()),
            })
        # 在职成员中未填报者 (退出成员不计)
        members = await self.db.execute(
            select(ProjectMember.name).where(
                ProjectMember.is_delete.is_(False),
                ProjectMember.project_id == pid,
                ProjectMember.status != "退出",
            )
        )
        filled_names = {r.member_name for r in reports}
        missing = sorted(n for (n,) in members.all() if n and n not in filled_names)
        return {
            "week_start": str(ws),
            "week_end": str(ws + timedelta(days=6)),
            "filled_count": len(filled),
            "missing_count": len(missing),
            "filled": filled,
            "missing_members": missing,
        }

    async def _tool_get_personal_report(
        self, member_name: str, week_start: Optional[str] = None
    ) -> dict:
        if not (member_name or "").strip():
            return {"error": "member_name 必填"}
        ws = self._personal_week(week_start)
        report = await self._load_personal_report(member_name, ws)
        if not report:
            return {"error": f"{member_name} {ws} 所在周暂无个人周报"}
        return self._personal_report_dict(report)

    async def _tool_save_personal_report(
        self,
        member_name: str,
        week_start: Optional[str] = None,
        work_items: Optional[list] = None,
        plan_items: Optional[list] = None,
        summary: Optional[str] = None,
    ) -> dict:
        from app.models.personal_report import (
            PersonalReport,
            PersonalReportPlanItem,
            PersonalReportWorkItem,
        )

        if not (member_name or "").strip():
            return {"error": "member_name 必填"}
        member_name = member_name.strip()
        pid = await get_active_project_id(self.db)
        ws = self._personal_week(week_start)
        we = ws + timedelta(days=6)

        report = await self._load_personal_report(member_name, ws)
        created = False
        if not report:
            report = PersonalReport(
                project_id=pid, member_name=member_name,
                week_start=ws, week_end=we, summary="",
                work_items=[], plan_items=[],
            )
            self.db.add(report)
            await self.db.flush()
            created = True

        if work_items is not None:
            for w in report.work_items:
                w.is_delete = True
            for i, item in enumerate(work_items):
                report.work_items.append(PersonalReportWorkItem(
                    project_id=pid,
                    day_of_week=int(item.get("day_of_week") or 1),
                    content=(item.get("content") or "").strip(),
                    participants=(item.get("participants") or "").strip(),
                    deliverable=(item.get("deliverable") or "").strip(),
                    hours=float(item.get("hours") or 0),
                    sort_order=i,
                ))
        if plan_items is not None:
            for p in report.plan_items:
                p.is_delete = True
            for i, item in enumerate(plan_items):
                report.plan_items.append(PersonalReportPlanItem(
                    project_id=pid,
                    content=(item.get("content") or "").strip(),
                    sort_order=i,
                ))
        if summary is not None:
            report.summary = summary.strip()
        await self.db.flush()

        return {
            "id": report.id,
            "created": created,
            "member_name": member_name,
            "week_start": str(ws),
            "week_end": str(we),
            "work_rows": len(work_items) if work_items is not None else None,
            "plan_rows": len(plan_items) if plan_items is not None else None,
            "summary_saved": summary is not None,
        }

    async def _tool_generate_personal_summary(
        self, member_name: str, week_start: Optional[str] = None
    ) -> dict:
        if not (member_name or "").strip():
            return {"error": "member_name 必填"}
        member_name = member_name.strip()
        ws = self._personal_week(week_start)
        report = await self._load_personal_report(member_name, ws)
        if not report:
            return {"error": f"{member_name} {ws} 所在周暂无个人周报, 请先保存明细再生成概括"}

        works = [w for w in report.work_items if not w.is_delete]
        plans = [p for p in report.plan_items if not p.is_delete]
        # 明细行项目ID → 项目名 (当前项目上下文, 直接用激活项目名)
        project = await self.db.get(Project, report.project_id)
        project_names = {report.project_id: project.name} if project else {}

        from app.services import personal_summary_service

        try:
            text = await personal_summary_service.generate_personal_summary(
                member_name, f"{report.week_start} ~ {report.week_end}",
                works, plans, project_names,
                user_name=self.user_name or "system",
            )
        except RuntimeError as e:
            return {"error": str(e)}
        report.summary = text
        await self.db.flush()
        return {"id": report.id, "member_name": member_name, "summary": text}

    # ---- 知识库维护 (MCP) ----

    async def _call_kb(self, tool_name: str, arguments: dict) -> Any:
        """统一入口: 经 MCP 调 rag-cowork 知识库工具, 异常转 error 返回"""
        from app.services import mcp_client

        try:
            return await mcp_client.call_kb_tool(
                tool_name, arguments, user_name=self.user_name
            )
        except RuntimeError as e:
            return {"error": str(e)}

    async def _tool_kb_list(self, level: Optional[str] = None) -> Any:
        return await self._call_kb("kb_list", {"level": level or ""})

    async def _tool_kb_create(
        self,
        name: str,
        level: str,
        description: Optional[str] = None,
        project_id: Optional[int] = None,
        department: Optional[str] = None,
    ) -> Any:
        args: dict[str, Any] = {"name": name, "level": level}
        if description:
            args["description"] = description
        if project_id:
            args["project_id"] = project_id
        if department:
            args["department"] = department
        return await self._call_kb("kb_create", args)

    async def _tool_kb_files(self, kb_id: int) -> Any:
        return await self._call_kb("kb_files", {"kb_id": kb_id})

    async def _tool_kb_file_add(self, kb_id: int, file_name: str, content_base64: str) -> Any:
        return await self._call_kb("kb_file_add", {
            "kb_id": kb_id, "file_name": file_name, "content_base64": content_base64,
        })

    async def _tool_kb_file_parse(self, doc_id: int) -> Any:
        return await self._call_kb("kb_file_parse", {"doc_id": doc_id})

    async def _tool_kb_file_delete(self, doc_id: int) -> Any:
        return await self._call_kb("kb_file_delete", {"doc_id": doc_id})

    async def _tool_kb_rag_search(
        self, kb_ids: list, query: str, top_k: Optional[int] = None
    ) -> Any:
        args: dict[str, Any] = {"kb_ids": kb_ids, "query": query}
        if top_k:
            args["top_k"] = top_k
        return await self._call_kb("rag_search", args)

    async def _tool_kb_rag_query(
        self, kb_ids: list, query: str, mode: Optional[str] = None,
        top_k: Optional[int] = None,
    ) -> Any:
        args: dict[str, Any] = {"kb_ids": kb_ids, "query": query}
        if mode:
            args["mode"] = mode
        if top_k:
            args["top_k"] = top_k
        return await self._call_kb("rag_query", args)

    # ---- IM 推送 (技链工坊个人通道) ----

    async def _tool_send_im(self, message: str, channel_id: Optional[int] = None) -> Any:
        """经 mcp-cowork 向当前用户个人 IM 通道推送消息"""
        from urllib.parse import quote

        import httpx

        from app.config import settings

        if not self.user_name:
            return {"error": "无法识别当前用户, 未发送"}
        url = (settings.MCP_IM_URL or "").strip()
        if not url:
            return {"error": "IM 推送接口未配置 (MCP_IM_URL)"}
        payload: dict[str, Any] = {"message": message}
        if channel_id:
            payload["channel_id"] = channel_id
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    url, json=payload,
                    headers={"X-User-Name": quote(self.user_name)},
                )
            data = resp.json() if resp.content else {}
        except Exception as e:  # noqa: BLE001
            return {"error": f"IM 推送请求失败: {type(e).__name__}: {e}"}
        if resp.status_code >= 400:
            return {"error": (data or {}).get("detail") or f"HTTP {resp.status_code}"}
        if not data.get("ok"):
            return {"error": data.get("error") or "发送失败", **data}
        fails = [r for r in data.get("results", []) if not r.get("ok")]
        out: dict[str, Any] = {"sent": data.get("sent", 0), "total": data.get("total", 0)}
        if fails:
            out["failures"] = [
                {"name": f.get("name"), "error": f.get("error")} for f in fails
            ]
        return out

    async def _tool_run_tool_inspection(self) -> Any:
        """经 mcp-cowork 触发工具巡检 (健康+diff+用例回归门禁), 返回报告摘要"""
        from urllib.parse import quote

        import httpx

        from app.config import settings

        if not self.user_name:
            return {"error": "无法识别当前用户, 未执行"}
        base = (settings.MCP_INSPECT_URL or "").strip().rstrip("/")
        if not base:
            return {"error": "巡检接口未配置 (MCP_INSPECT_URL)"}
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(
                    f"{base}/run", headers={"X-User-Name": quote(self.user_name)},
                )
            data = resp.json() if resp.content else {}
        except Exception as e:  # noqa: BLE001
            return {"error": f"巡检请求失败: {type(e).__name__}: {e}"}
        if resp.status_code >= 400:
            return {"error": (data or {}).get("detail") or f"HTTP {resp.status_code}"}
        rep = data.get("report") or {}
        s = rep.get("summary") or {}
        verdict_zh = {"pass": "通过", "warn": "有变更", "fail": "回归异常"}.get(
            rep.get("verdict"), rep.get("verdict"))
        out: dict[str, Any] = {
            "verdict": rep.get("verdict"), "verdict_zh": verdict_zh,
            "report_id": rep.get("report_id"),
            "servers_online": s.get("servers_online"), "servers_total": s.get("servers_total"),
            "tools_added": s.get("tools_added"), "tools_removed": s.get("tools_removed"),
            "tools_changed": s.get("tools_changed"),
            "cases_passed": s.get("cases_passed"), "cases_total": s.get("cases_total"),
            "regressions": s.get("regressions"),
        }
        # 回归失败/服务离线明细带给分身, 便于向用户解释
        detail = rep.get("detail") or {}
        bad_cases = [
            {"case_name": c.get("case_name"), "tool_name": c.get("tool_name"),
             "status": c.get("status"), "regression": c.get("regression"),
             "error": c.get("error_excerpt", "")[:150]}
            for c in detail.get("cases", []) if c.get("status") == "error" or c.get("regression")
        ]
        off_servers = [
            {"name": sv.get("name"), "error": (sv.get("error") or "")[:150]}
            for sv in detail.get("servers", []) if sv.get("status") == "offline"
        ]
        if bad_cases:
            out["failed_cases"] = bad_cases
        if off_servers:
            out["offline_servers"] = off_servers
        return out
