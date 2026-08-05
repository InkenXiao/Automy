"""Agent 执行引擎 · 感知/记忆/决策/交互/执行 五大能力"""
import json
import logging
from typing import AsyncGenerator, List, Optional

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.agent import Agent, AgentMemory, AgentMessage, AgentSession
from app.services.agent_tools import TOOL_DEFINITIONS, ToolExecutor

logger = logging.getLogger(__name__)


class AgentEngine:
    """Agent 运行时引擎"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.tool_executor = ToolExecutor(db)
        self.client = None
        if settings.OPENAI_API_KEY:
            self.client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL,
            )

    async def chat(
        self,
        agent: Agent,
        session: AgentSession,
        history: List[AgentMessage],
        memories: List[AgentMemory],
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """
        流式对话核心:
        1. 构建系统提示词 (含 Agent 定义 + 记忆 + 工具描述)
        2. 调用 LLM 流式生成回复
        3. 检测工具调用并执行
        4. 将工具结果注入对话继续生成
        """
        if not self.client:
            yield "⚠️ LLM 未配置。请在 .env 中设置 OPENAI_API_KEY 和 OPENAI_BASE_URL 后重启服务。"
            return

        # 构建消息列表
        messages = self._build_messages(agent, history, memories, user_message)

        # 获取可用工具
        tools = self._get_tools(agent)

        # 最大工具调用轮次
        max_rounds = 5
        for round_num in range(max_rounds):
            try:
                # 流式调用 LLM
                stream = await self.client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=messages,
                    tools=tools if tools else None,
                    stream=True,
                )

                full_content = ""
                tool_calls_data = {}  # index -> {id, name, arguments}

                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta

                    # 文本内容
                    if delta.content:
                        full_content += delta.content
                        yield delta.content

                    # 工具调用
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

                # 如果没有工具调用, 对话结束
                if not tool_calls_data:
                    break

                # 添加助手消息(含工具调用)到对话历史
                assistant_msg = {"role": "assistant", "content": full_content or None}
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for tc in sorted(tool_calls_data.values(), key=lambda x: x["id"])
                ]
                messages.append(assistant_msg)

                # 执行工具调用
                for tc in sorted(tool_calls_data.values(), key=lambda x: x["id"]):
                    tool_name = tc["name"]
                    try:
                        arguments = json.loads(tc["arguments"]) if tc["arguments"] else {}
                    except json.JSONDecodeError:
                        arguments = {}

                    # 通知前端正在执行工具
                    yield f"\n\n> 🔧 执行工具: **{tool_name}** ...\n\n"

                    result = await self.tool_executor.execute(tool_name, arguments)
                    result_str = json.dumps(result, ensure_ascii=False, default=str)

                    # 添加工具结果到对话
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result_str,
                    })

                    yield f"> ✅ 工具结果: {result_str[:200]}{'...' if len(result_str) > 200 else ''}\n\n"

            except Exception as e:
                logger.error(f"Agent chat error (round {round_num}): {e}")
                yield f"\n\n⚠️ 调用出错: {str(e)}"
                break

    def _build_messages(
        self,
        agent: Agent,
        history: List[AgentMessage],
        memories: List[AgentMemory],
        user_message: str,
    ) -> list:
        """构建 OpenAI 消息列表"""
        messages = []

        # 系统提示词
        system_prompt = agent.system_prompt or f"你是 {agent.name}，一个项目管理智能助手。"

        # 注入记忆
        if memories:
            memory_text = "\n".join([f"- [{m.memory_type}] {m.key}: {m.content}" for m in memories])
            system_prompt += f"\n\n## 相关记忆\n{memory_text}"

        messages.append({"role": "system", "content": system_prompt})

        # 历史消息 (最近 20 条)
        for msg in history[-20:]:
            if msg.role in ("user", "assistant"):
                messages.append({"role": msg.role, "content": msg.content})

        # 当前用户消息
        messages.append({"role": "user", "content": user_message})

        return messages

    def _get_tools(self, agent: Agent) -> list:
        """获取 Agent 可用工具"""
        if not agent.tools:
            return TOOL_DEFINITIONS
        # 根据 agent.tools 中配置的工具名过滤
        tool_names = set(agent.tools)
        return [t for t in TOOL_DEFINITIONS if t["function"]["name"] in tool_names]
