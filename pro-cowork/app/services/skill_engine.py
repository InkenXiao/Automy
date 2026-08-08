"""Skill 执行引擎

步骤类型:
- {"tool": "<工具名>", "arguments": {...}}   调用 ToolExecutor 业务工具
- {"builtin": "<内置能力>", "arguments": {...}} 调用内置 Python 能力 (如会议纪要生成)

参数支持 {{input.xxx}} / {{results.N.result.xxx}} 变量引用;
每步执行记录解析后的 arguments 与 duration_ms, 供调试面板展示入参/出参。

session_id 不为空时, 内置能力可通过 emit_run_event 向任务执行窗口实时推送
过程事件 (如 asr_segment 录音转写分段 / minutes_delta 纪要流式增量)。
"""
import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skill import Skill
from app.services.agent_tools import ToolExecutor
from app.utils import get_active_project_id

logger = logging.getLogger(__name__)

# 任务附件存储目录 (与 routers/task_runs.py 一致): pro-cowork/data/task_files/<project_id>/<filename>
TASK_FILES_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "task_files"


def _find_task_file(project_id: Optional[int], file_name: str) -> Optional[Path]:
    """按 项目目录 → 全部项目目录 顺序查找任务附件 (意图识别切换项目后仍可命中)"""
    direct = TASK_FILES_ROOT / str(project_id or 0) / file_name
    if direct.exists():
        return direct
    if TASK_FILES_ROOT.exists():
        for d in sorted(TASK_FILES_ROOT.iterdir()):
            candidate = d / file_name
            if d.is_dir() and candidate.exists():
                return candidate
    return None


async def _builtin_meeting_minutes(db: AsyncSession, args: dict, session_id: Optional[int] = None, user_name: str = "system") -> dict:
    """内置能力: 会议纪要生成

    入参: file_name (任务附件中的录音文件名), project_id (可选, 默认当前激活项目)
    过程: 每段转写文字实时推送 asr_segment 事件; 转写完成后流式推送 minutes_delta
    返回: {file, duration_s, transcript, minutes}
    """
    from app.services.asr_service import transcribe_audio
    from app.services.minutes_service import generate_minutes_stream
    from app.services.task_runner import emit_run_event

    file_name = args.get("file_name")
    if not file_name:
        return {"error": "缺少参数 file_name (录音文件名)"}
    file_name = Path(str(file_name)).name  # 防目录穿越

    project_id = args.get("project_id")
    if project_id in (None, "", 0):
        project_id = await get_active_project_id(db)
    audio_path = _find_task_file(project_id, file_name)
    if not audio_path:
        return {"error": f"录音文件不存在: {file_name} (项目#{project_id}), 请先在任务中上传"}

    await emit_run_event(session_id, "asr_start", {"file": file_name})

    async def on_segment(seg: dict) -> None:
        await emit_run_event(session_id, "asr_segment", seg)

    try:
        asr_result = await transcribe_audio(audio_path, on_segment=on_segment)
    except RuntimeError as e:
        return {"error": f"转录失败: {e}"}

    transcript = asr_result["text"]
    await emit_run_event(session_id, "asr_done", {
        "file": file_name,
        "duration_s": asr_result["duration_s"],
        "segments": len(asr_result.get("segments") or []),
        "chars": len(transcript),
    })

    minutes_parts: list[str] = []
    try:
        async for delta in generate_minutes_stream(transcript, user_name=user_name):
            minutes_parts.append(delta)
            await emit_run_event(session_id, "minutes_delta", {"content": delta})
    except RuntimeError as e:
        return {"error": f"纪要生成失败: {e}", "file": file_name, "transcript": transcript}
    minutes = "".join(minutes_parts).strip()

    return {
        "file": file_name,
        "duration_s": asr_result["duration_s"],
        "transcript": transcript,
        "minutes": minutes,
    }


async def _builtin_weekly_digest(db: AsyncSession, args: dict, session_id: Optional[int] = None, user_name: str = "system") -> dict:
    """内置能力: 项目周工作小结

    入参: report_id (可选, 默认当前项目最新一份周报), project_id (可选, 默认当前激活项目)
    过程: 汇总周报(KPI/进展/下周计划/风险)与本周会议纪要, 流式推送 digest_delta
    返回: {report_id, title, week_range, digest, meetings_used}
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.meeting import Meeting
    from app.models.weekly_report import (
        WeeklyKpi,
        WeeklyPlanTask,
        WeeklyProgressItem,
        WeeklyReport,
    )
    from app.services.digest_service import build_digest_source, generate_week_digest_stream
    from app.services.task_runner import emit_run_event

    project_id = args.get("project_id")
    if project_id in (None, "", 0):
        project_id = await get_active_project_id(db)

    stmt = (
        select(WeeklyReport)
        .options(
            selectinload(WeeklyReport.kpis).selectinload(WeeklyKpi.module),
            selectinload(WeeklyReport.progress_items).selectinload(WeeklyProgressItem.module),
            selectinload(WeeklyReport.plan_tasks).selectinload(WeeklyPlanTask.module),
            selectinload(WeeklyReport.risks),
        )
        .where(WeeklyReport.is_delete.is_(False), WeeklyReport.project_id == project_id)
        .order_by(WeeklyReport.week_start.desc(), WeeklyReport.id.desc())
    )
    report_id = args.get("report_id")
    if report_id not in (None, "", 0):
        stmt = stmt.where(WeeklyReport.id == int(report_id))
    result = await db.execute(stmt.limit(1))
    report = result.scalars().first()
    if not report:
        return {"error": "未找到周报, 请先创建周报"}

    # 本周范围内会议 (meet_date 为 'YYYY-MM-DD' 字符串, 可直接比较)
    meetings = []
    if report.week_start and report.week_end:
        m_result = await db.execute(
            select(Meeting)
            .where(
                Meeting.is_delete.is_(False),
                Meeting.project_id == project_id,
                Meeting.meet_date >= str(report.week_start),
                Meeting.meet_date <= str(report.week_end),
            )
            .order_by(Meeting.meet_date, Meeting.id)
        )
        meetings = list(m_result.scalars().all())

    source = build_digest_source(report, meetings)
    await emit_run_event(session_id, "digest_start", {
        "report_id": report.id, "title": report.title, "week_range": report.week_range,
    })

    digest_parts: list[str] = []
    try:
        async for delta in generate_week_digest_stream(source, user_name=user_name):
            digest_parts.append(delta)
            await emit_run_event(session_id, "digest_delta", {"content": delta})
    except RuntimeError as e:
        return {"error": f"概括生成失败: {e}", "report_id": report.id}
    digest = "".join(digest_parts).strip()

    return {
        "report_id": report.id,
        "title": report.title,
        "week_range": report.week_range,
        "digest": digest,
        "meetings_used": len(meetings),
    }


async def _builtin_image_recognition(db: AsyncSession, args: dict, session_id: Optional[int] = None, user_name: str = "system") -> dict:
    """内置能力: 图像识别 (视觉多模态模型)

    入参: file_name (任务附件中的图片文件名), project_id (可选), question (可选, 识别侧重点)
    返回: {file, text, model, engine}
    """
    from app.services.task_runner import emit_run_event
    from app.services.vision_service import recognize_image

    file_name = args.get("file_name")
    if not file_name:
        return {"error": "缺少参数 file_name (图片文件名)"}
    file_name = Path(str(file_name)).name  # 防目录穿越

    project_id = args.get("project_id")
    if project_id in (None, "", 0):
        project_id = await get_active_project_id(db)
    image_path = _find_task_file(project_id, file_name)
    if not image_path:
        return {"error": f"图片文件不存在: {file_name} (项目#{project_id}), 请先上传"}

    await emit_run_event(session_id, "vision_start", {"file": file_name})
    try:
        result = await recognize_image(
            image_path, question=str(args.get("question") or ""), user_name=user_name
        )
    except RuntimeError as e:
        return {"error": f"图像识别失败: {e}"}
    await emit_run_event(session_id, "vision_done", {
        "file": file_name, "chars": len(result["text"]),
    })
    return {
        "file": file_name,
        "text": result["text"],
        "model": result["model"],
        "engine": "vision",
    }


async def _builtin_doc_parsing(db: AsyncSession, args: dict, session_id: Optional[int] = None, user_name: str = "system") -> dict:
    """内置能力: PDF 文档解析 (PyMuPDF 文本层 → mineru → paddleocr)

    入参: file_name (任务附件中的 PDF 文件名), project_id (可选)
    返回: {file, text, pages, engine}
    """
    from app.services.doc_parse_service import parse_pdf
    from app.services.task_runner import emit_run_event

    file_name = args.get("file_name")
    if not file_name:
        return {"error": "缺少参数 file_name (PDF 文件名)"}
    file_name = Path(str(file_name)).name  # 防目录穿越

    project_id = args.get("project_id")
    if project_id in (None, "", 0):
        project_id = await get_active_project_id(db)
    pdf_path = _find_task_file(project_id, file_name)
    if not pdf_path:
        return {"error": f"PDF 文件不存在: {file_name} (项目#{project_id}), 请先上传"}

    await emit_run_event(session_id, "doc_parse_start", {"file": file_name})
    try:
        result = await parse_pdf(pdf_path)
    except RuntimeError as e:
        return {"error": f"文档解析失败: {e}"}
    await emit_run_event(session_id, "doc_parse_done", {
        "file": file_name, "pages": result["pages"], "chars": len(result["text"]),
        "engine": result["engine"],
    })
    return {
        "file": file_name,
        "text": result["text"],
        "pages": result["pages"],
        "engine": result["engine"],
    }


# 内置能力注册表: builtin 名 -> async fn(db, args, session_id=None, user_name="system")
BUILTIN_REGISTRY = {
    "meeting_minutes": _builtin_meeting_minutes,
    "weekly_digest": _builtin_weekly_digest,
    "image_recognition": _builtin_image_recognition,
    "doc_parsing": _builtin_doc_parsing,
}


class SkillEngine:
    """Skill 执行引擎: 根据 Skill 配置执行工具链/内置能力链"""

    def __init__(self, db: AsyncSession, session_id: Optional[int] = None, user_name: str = "system"):
        self.db = db
        self.session_id = session_id
        self.user_name = user_name
        self.tool_executor = ToolExecutor(db)

    async def execute(self, skill: Skill, input_data: dict, prior_results: list | None = None) -> dict:
        """
        执行 Skill:
        - skill.code 为 JSON 工作流, 按 steps 顺序执行
        - prior_results: 上一次执行的结果列表 (调试上下文), 置于 results 头部供 {{results.N}} 引用
        """
        if not skill.code:
            return {"message": "Skill 未定义执行逻辑", "input": input_data}

        try:
            workflow = json.loads(skill.code)
        except json.JSONDecodeError:
            return {"error": "Skill 代码不是有效的 JSON", "input": input_data}

        steps = workflow.get("steps", [])
        if not steps:
            return {"message": "Skill 无执行步骤", "input": input_data}

        context = {"input": input_data, "results": list(prior_results or [])}
        base_idx = len(context["results"])  # prior_results 占用前置下标

        for i, step in enumerate(steps):
            tool_name = step.get("tool")
            builtin_name = step.get("builtin")
            if not tool_name and not builtin_name:
                context["results"].append({"step": base_idx + i, "error": "缺少 tool/builtin 字段"})
                continue

            # 解析参数: 支持从 context 中引用变量 {{input.xxx}} 或 {{results.N.xxx}}
            raw_args = step.get("arguments", {})
            args = self._resolve_args(raw_args, context)

            start = time.time()
            if builtin_name:
                handler = BUILTIN_REGISTRY.get(builtin_name)
                if not handler:
                    result = {"error": f"未知内置能力: {builtin_name}"}
                else:
                    try:
                        result = await handler(self.db, args, session_id=self.session_id, user_name=self.user_name)
                    except Exception as e:  # noqa: BLE001
                        logger.exception("builtin %s 执行异常", builtin_name)
                        result = {"error": f"{type(e).__name__}: {e}"}
            else:
                result = await self.tool_executor.execute(tool_name, args)
            duration_ms = int((time.time() - start) * 1000)

            context["results"].append({
                "step": base_idx + i,
                "tool": tool_name or builtin_name,
                "arguments": args,
                "result": result,
                "duration_ms": duration_ms,
            })

        return context

    def _resolve_args(self, args: dict, context: dict) -> dict:
        """递归解析参数中的变量引用"""
        resolved = {}
        for k, v in args.items():
            if isinstance(v, str) and v.startswith("{{") and v.endswith("}}"):
                path = v[2:-2].strip()
                resolved[k] = self._get_nested(context, path)
            elif isinstance(v, dict):
                resolved[k] = self._resolve_args(v, context)
            elif isinstance(v, list):
                resolved[k] = [
                    self._resolve_args(item, context) if isinstance(item, dict) else item
                    for item in v
                ]
            else:
                resolved[k] = v
        return resolved

    def _get_nested(self, data: dict, path: str) -> Any:
        """按路径获取嵌套值, 如 'input.name' 或 'results.0.result'"""
        keys = path.split(".")
        current = data
        for key in keys:
            if isinstance(current, dict):
                current = current.get(key)
            elif isinstance(current, list) and key.isdigit():
                current = current[int(key)]
            else:
                return None
        return current
