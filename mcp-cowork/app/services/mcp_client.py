"""MCP streamable-HTTP 客户端 · list_tools / call_tool 封装"""
import json
import logging
from datetime import timedelta
from typing import Any, Callable, Dict, List
from urllib.parse import quote

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from app.config import settings

logger = logging.getLogger(__name__)


def flatten_exc(e: BaseException, max_len: int = 300) -> str:
    """递归展开 ExceptionGroup (anyio TaskGroup 抛出), 拼接叶节点 "类型: 信息"

    str(ExceptionGroup) 只显示 "unhandled errors in a TaskGroup (1 sub-exception)",
    真实子异常 (连接拒绝/406/超时等) 被掩盖, 需解包后展示。
    """
    leaves: List[str] = []

    def _walk(err: BaseException) -> None:
        if isinstance(err, BaseExceptionGroup):
            for sub in err.exceptions:
                _walk(sub)
            return
        msg = f"{type(err).__name__}: {err}"
        if msg not in leaves:
            leaves.append(msg)

    _walk(e)
    return ("; ".join(leaves) or str(e))[:max_len]


def _headers(user_name: str = "") -> Dict[str, str]:
    """透传用户身份头 (与 rag-cowork X-User-Name 约定一致)"""
    if user_name:
        return {"X-User-Name": quote(user_name)}
    return {}


async def _with_session(base_url: str, fn: Callable, user_name: str = "") -> Any:
    async with streamablehttp_client(
        base_url,
        headers=_headers(user_name),
        timeout=settings.MCP_CONNECT_TIMEOUT_S,
    ) as (read_stream, write_stream, _):
        async with ClientSession(
            read_stream, write_stream,
            # SDK 1.29 起要求 timedelta (内部直接调用 .total_seconds())
            read_timeout_seconds=timedelta(seconds=settings.MCP_READ_TIMEOUT_S),
        ) as session:
            await session.initialize()
            return await fn(session)


async def list_tools(base_url: str, user_name: str = "") -> List[Dict[str, Any]]:
    """同步服务工具清单"""
    async def _do(session) -> List[Dict[str, Any]]:
        result = await session.list_tools()
        return [
            {
                "tool_name": t.name,
                "description": t.description or "",
                "input_schema": t.inputSchema or {},
            }
            for t in result.tools
        ]
    return await _with_session(base_url, _do, user_name)


def _serialize_content(content: Any) -> str:
    """CallToolResult.content → 可读文本 (拼接 text 项, 其余 JSON 化)"""
    parts: List[str] = []
    for item in content or []:
        text = getattr(item, "text", None)
        if text is not None:
            parts.append(text)
        else:
            try:
                parts.append(json.dumps(item.model_dump(), ensure_ascii=False, default=str))
            except Exception:  # noqa: BLE001
                parts.append(str(item))
    return "\n".join(parts)


async def call_tool(base_url: str, tool_name: str, params: Dict[str, Any],
                    user_name: str = "") -> Dict[str, Any]:
    """调用工具, 返回 {is_error, text, structured}"""
    async def _do(session) -> Dict[str, Any]:
        result = await session.call_tool(tool_name, params)
        text = _serialize_content(result.content)
        structured = getattr(result, "structuredContent", None)
        # text 可能是 JSON 字符串, 尝试解析便于前端展示
        parsed = None
        try:
            parsed = json.loads(text) if text else None
        except Exception:  # noqa: BLE001
            parsed = None
        return {
            "is_error": bool(getattr(result, "isError", False)),
            "text": text,
            "data": structured if structured is not None else parsed,
        }
    return await _with_session(base_url, _do, user_name)
