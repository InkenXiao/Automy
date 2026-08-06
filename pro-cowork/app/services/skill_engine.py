"""Skill 执行引擎

步骤类型:
- {"tool": "<工具名>", "arguments": {...}}   调用 ToolExecutor 业务工具
- {"builtin": "<内置能力>", "arguments": {...}} 调用内置 Python 能力 (如会议纪要生成)

参数支持 {{input.xxx}} / {{results.N.result.xxx}} 变量引用;
每步执行记录解析后的 arguments 与 duration_ms, 供调试面板展示入参/出参。
"""
import json
import logging
import time
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skill import Skill
from app.services.agent_tools import ToolExecutor
from app.utils import get_active_project_id

logger = logging.getLogger(__name__)

# 任务附件存储目录 (与 routers/task_runs.py 一致): pro-cowork/data/task_files/<project_id>/<filename>
TASK_FILES_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "task_files"


async def _builtin_meeting_minutes(db: AsyncSession, args: dict) -> dict:
    """内置能力: 会议纪要生成

    入参: file_name (任务附件中的录音文件名), project_id (可选, 默认当前激活项目)
    返回: {file, duration_s, transcript, minutes}
    """
    from app.services.asr_service import transcribe_audio
    from app.services.minutes_service import generate_minutes

    file_name = args.get("file_name")
    if not file_name:
        return {"error": "缺少参数 file_name (录音文件名)"}
    file_name = Path(str(file_name)).name  # 防目录穿越

    project_id = args.get("project_id")
    if project_id in (None, "", 0):
        project_id = await get_active_project_id(db)
    audio_path = TASK_FILES_ROOT / str(project_id or 0) / file_name
    if not audio_path.exists():
        return {"error": f"录音文件不存在: {file_name} (项目#{project_id}), 请先在任务中上传"}

    try:
        asr_result = await transcribe_audio(audio_path)
    except RuntimeError as e:
        return {"error": f"转录失败: {e}"}

    transcript = asr_result["text"]
    try:
        minutes = await generate_minutes(transcript)
    except RuntimeError as e:
        return {"error": f"纪要生成失败: {e}", "file": file_name, "transcript": transcript}

    return {
        "file": file_name,
        "duration_s": asr_result["duration_s"],
        "transcript": transcript,
        "minutes": minutes,
    }


# 内置能力注册表: builtin 名 -> async fn(db, args)
BUILTIN_REGISTRY = {
    "meeting_minutes": _builtin_meeting_minutes,
}


class SkillEngine:
    """Skill 执行引擎: 根据 Skill 配置执行工具链/内置能力链"""

    def __init__(self, db: AsyncSession):
        self.db = db
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
                        result = await handler(self.db, args)
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
