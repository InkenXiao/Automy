"""知识库 MCP 客户端 · pro-cowork 智能体经 MCP 协议管理 rag-cowork 知识库

- 走 streamable-HTTP 调 rag-cowork FastMCP 服务 (默认 http://localhost:8093/mcp)
- mcp SDK 1.29 注意点: ClientSession.read_timeout_seconds 必须是 timedelta
- 用户身份经 X-User-Name 请求头透传 (URL 编码中文姓名), rag 侧按此做权限过滤
- 每次调用独立建连 (短连接); MCP 服务不可达时抛 RuntimeError 由调用方兜底
"""
import json
import logging
from datetime import timedelta
from typing import Any
from urllib.parse import quote

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from app.config import settings

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 15   # 建连与初始化超时 (秒)
_READ_TIMEOUT = 300     # 工具调用读超时 (秒): 解析入库/问答等长任务


async def call_kb_tool(tool_name: str, arguments: dict, user_name: str = "") -> Any:
    """调用 rag-cowork 知识库 MCP 工具, 返回结构化结果

    结果解包: CallToolResult.content 为 TextContent 列表, 文本为 JSON 字符串;
    解析失败时原样返回文本。isError=True 时抛 RuntimeError。
    """
    url = (settings.KB_MCP_URL or "").strip()
    if not url:
        raise RuntimeError("知识库 MCP 未配置: 请在 .env 中设置 KB_MCP_URL")

    headers = {"X-User-Name": quote(user_name)} if user_name else None
    try:
        async with streamablehttp_client(
            url, headers=headers, timeout=_CONNECT_TIMEOUT
        ) as (read_stream, write_stream, _):
            async with ClientSession(
                read_stream, write_stream,
                read_timeout_seconds=timedelta(seconds=_READ_TIMEOUT),
            ) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments or {})
    except RuntimeError:
        raise
    except Exception as e:  # 连接失败/会话异常统一兜底 (含 anyio TaskGroup 包装)
        raise RuntimeError(f"知识库 MCP 调用失败 ({tool_name}): {e}") from e

    if result.isError:
        detail = "".join(getattr(c, "text", "") for c in result.content)
        raise RuntimeError(detail or f"知识库工具 {tool_name} 执行失败")

    text = "".join(getattr(c, "text", "") for c in result.content)
    try:
        return json.loads(text) if text.strip() else {}
    except json.JSONDecodeError:
        return {"raw": text}
