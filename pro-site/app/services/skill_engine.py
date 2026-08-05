"""Skill 执行引擎"""
import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skill import Skill
from app.services.agent_tools import ToolExecutor

logger = logging.getLogger(__name__)


class SkillEngine:
    """Skill 执行引擎: 根据 Skill 配置执行工具链"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.tool_executor = ToolExecutor(db)

    async def execute(self, skill: Skill, input_data: dict) -> dict:
        """
        执行 Skill:
        - 如果 skill.code 是 JSON 格式的工具链定义, 按顺序执行工具
        - 否则返回输入数据作为输出
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

        context = {"input": input_data, "results": []}

        for i, step in enumerate(steps):
            tool_name = step.get("tool")
            if not tool_name:
                context["results"].append({"step": i, "error": "缺少 tool 字段"})
                continue

            # 解析参数: 支持从 context 中引用变量 {{input.xxx}} 或 {{results[N].xxx}}
            raw_args = step.get("arguments", {})
            args = self._resolve_args(raw_args, context)

            result = await self.tool_executor.execute(tool_name, args)
            context["results"].append({"step": i, "tool": tool_name, "result": result})

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
