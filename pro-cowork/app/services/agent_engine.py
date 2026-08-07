"""Agent 执行引擎 · 感知/记忆/决策/交互/执行 五大能力

- 感知: 对话前注入项目环境快照 (agent_context.build_project_snapshot)
- 记忆: 系统提示词注入长期记忆; Agent 可通过 save_memory 工具主动沉淀
- 决策: OpenAI 兼容 function calling 循环 (max 5 轮)
- 交互: chat() 以结构化事件流输出 (content/tool_call/tool_result)
- 执行: ToolExecutor 业务工具 + run_skill 技能工作流
"""
import json
import logging
import time
from typing import Any, AsyncGenerator, List, Optional

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.agent import Agent, AgentMemory, AgentMessage, AgentSession
from app.services.agent_context import build_project_snapshot
from app.services.agent_tools import TOOL_DEFINITIONS, ToolExecutor

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 5


class AgentEngine:
    """Agent 运行时引擎"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = None
        if settings.OPENAI_API_KEY:
            self.client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL,
            )

    # ---------- 交互: 结构化事件流 ----------

    async def chat(
        self,
        agent: Agent,
        session: AgentSession,
        history: List[AgentMessage],
        memories: List[AgentMemory],
        user_message: str,
        user_name: str = "system",
    ) -> AsyncGenerator[dict, None]:
        """
        流式对话核心, 产出结构化事件:
        - {"type": "content", "content": 文本增量}
        - {"type": "tool_call", "name": 工具名, "arguments": 入参}
        - {"type": "tool_result", "name": 工具名, "result": 执行结果}
        """
        if not self.client:
            yield {
                "type": "content",
                "content": "⚠️ LLM 未配置。请在 .env 中设置 OPENAI_API_KEY 和 OPENAI_BASE_URL 后重启服务。",
            }
            return

        tool_executor = ToolExecutor(self.db, agent_id=agent.id, session_id=session.id)
        messages = await self._build_messages(agent, history, memories, user_message)
        tools = self._get_tools(agent)
        total_tokens_all = 0

        for round_num in range(MAX_TOOL_ROUNDS):
            try:
                yield {"type": "model_call", "stage": "start", "round": round_num + 1}
                round_start = time.time()
                stream = await self.client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=messages,
                    tools=tools if tools else None,
                    stream=True,
                    stream_options={"include_usage": True},
                )

                full_content = ""
                tool_calls_data: dict[int, dict] = {}

                async for chunk in stream:
                    if not chunk.choices:
                        if chunk.usage:
                            total_tokens_all += chunk.usage.total_tokens or 0
                        continue
                    delta = chunk.choices[0].delta

                    if delta.content:
                        full_content += delta.content
                        yield {"type": "content", "content": delta.content}

                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in tool_calls_data:
                                tool_calls_data[idx] = {"id": "", "name": "", "arguments": ""}
                            if tc.id:
                                tool_calls_data[idx]["id"] = tc.id
                            if tc.function:
                                if tc.function.name:
                                    tool_calls_data[idx]["name"] = tc.function.name
                                if tc.function.arguments:
                                    tool_calls_data[idx]["arguments"] += tc.function.arguments

                # 无工具调用: 决策完成, 结束对话
                yield {
                    "type": "model_call",
                    "stage": "end",
                    "round": round_num + 1,
                    "chars": len(full_content),
                    "tool_calls": len(tool_calls_data),
                    "duration_ms": int((time.time() - round_start) * 1000),
                }
                if not tool_calls_data:
                    break

                # 助手消息(含工具调用)写入对话历史
                ordered_calls = sorted(tool_calls_data.items(), key=lambda x: x[0])
                messages.append({
                    "role": "assistant",
                    "content": full_content or None,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {"name": tc["name"], "arguments": tc["arguments"]},
                        }
                        for _, tc in ordered_calls
                    ],
                })

                # 执行工具调用 (执行能力)
                for _, tc in ordered_calls:
                    tool_name = tc["name"]
                    try:
                        arguments = json.loads(tc["arguments"]) if tc["arguments"] else {}
                    except json.JSONDecodeError:
                        arguments = {}

                    yield {"type": "tool_call", "name": tool_name, "arguments": arguments}

                    start = time.time()
                    result = await tool_executor.execute(tool_name, arguments)
                    duration_ms = int((time.time() - start) * 1000)

                    yield {
                        "type": "tool_result",
                        "name": tool_name,
                        "result": result,
                        "duration_ms": duration_ms,
                    }

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    })

            except Exception as e:
                logger.error(f"Agent chat error (round {round_num}): {e}")
                yield {"type": "content", "content": f"\n\n⚠️ 调用出错: {e}"}
                break

        # 对话结束: 汇总落库 token 消耗 (异常静默)
        if total_tokens_all > 0:
            from app.services.log_service import record_llm_usage

            await record_llm_usage(
                user_name, "数字分身", total_tokens_all,
                f"{agent.name} · {settings.OPENAI_MODEL}",
            )

    # ---------- 调试: 非流式 + 结构化 Trace ----------

    async def chat_with_trace(
        self,
        agent: Agent,
        history: List[AgentMessage],
        memories: List[AgentMemory],
        user_message: str,
        user_name: str = "system",
    ) -> dict:
        """调试模式: 非流式执行一轮对话, 返回回复与完整执行轨迹"""
        if not self.client:
            return {
                "reply": "",
                "trace": [],
                "error": "LLM 未配置, 请设置 OPENAI_API_KEY / OPENAI_BASE_URL",
                "model": settings.OPENAI_MODEL,
            }

        tool_executor = ToolExecutor(self.db, agent_id=agent.id, session_id=None)
        messages = await self._build_messages(agent, history, memories, user_message)
        tools = self._get_tools(agent)
        trace: list[dict] = []
        reply = ""
        total_tokens_all = 0

        for round_num in range(MAX_TOOL_ROUNDS):
            round_trace: dict[str, Any] = {"round": round_num + 1, "content": "", "tool_calls": []}
            try:
                resp = await self.client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=messages,
                    tools=tools if tools else None,
                    stream=False,
                )
            except Exception as e:
                logger.error(f"Agent debug error (round {round_num}): {e}")
                return {"reply": reply, "trace": trace, "error": str(e), "model": settings.OPENAI_MODEL}

            if resp.usage:
                total_tokens_all += resp.usage.total_tokens or 0

            choice = resp.choices[0]
            msg = choice.message
            round_trace["content"] = msg.content or ""
            round_trace["finish_reason"] = choice.finish_reason
            if msg.content:
                reply += msg.content

            if not msg.tool_calls:
                trace.append(round_trace)
                break

            messages.append({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ],
            })

            for tc in msg.tool_calls:
                try:
                    arguments = json.loads(tc.function.arguments) if tc.function.arguments else {}
                except json.JSONDecodeError:
                    arguments = {}
                start = time.time()
                result = await tool_executor.execute(tc.function.name, arguments)
                duration_ms = int((time.time() - start) * 1000)
                round_trace["tool_calls"].append({
                    "name": tc.function.name,
                    "arguments": arguments,
                    "result": result,
                    "duration_ms": duration_ms,
                })
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                })

            trace.append(round_trace)

        # 调试结束: 汇总落库 token 消耗 (异常静默)
        if total_tokens_all > 0:
            from app.services.log_service import record_llm_usage

            await record_llm_usage(
                user_name, "数字分身", total_tokens_all,
                f"{agent.name} · debug · {settings.OPENAI_MODEL}",
            )

        return {"reply": reply, "trace": trace, "model": settings.OPENAI_MODEL}

    # ---------- 内部: 消息构建 ----------

    async def _build_messages(
        self,
        agent: Agent,
        history: List[AgentMessage],
        memories: List[AgentMemory],
        user_message: str,
    ) -> list:
        """构建 OpenAI 消息列表 (系统提示词 = Agent 定义 + 感知快照 + 记忆)"""
        system_prompt = agent.system_prompt or f"你是 {agent.name}，一个项目管理智能助手。"

        # 感知: 注入项目环境快照
        try:
            snapshot = await build_project_snapshot(self.db)
            system_prompt += f"\n\n{snapshot}"
        except Exception as e:
            logger.warning(f"构建项目快照失败: {e}")

        # 记忆: 注入长期记忆
        if memories:
            memory_text = "\n".join([f"- [{m.memory_type}] {m.key}: {m.content}" for m in memories])
            system_prompt += f"\n\n## 相关记忆\n{memory_text}"

        messages = [{"role": "system", "content": system_prompt}]

        # 历史消息 (最近 20 条)
        for msg in history[-20:]:
            if msg.role in ("user", "assistant"):
                messages.append({"role": msg.role, "content": msg.content})

        messages.append({"role": "user", "content": user_message})
        return messages

    def _get_tools(self, agent: Agent) -> list:
        """获取 Agent 可用工具"""
        if not agent.tools:
            return TOOL_DEFINITIONS
        tool_names = set(agent.tools)
        return [t for t in TOOL_DEFINITIONS if t["function"]["name"] in tool_names]
