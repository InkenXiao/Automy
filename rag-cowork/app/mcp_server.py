"""rag-cowork MCP 服务 · FastMCP streamable-HTTP 独立进程 (端口 8093)

独立进程原因: 避免 FastAPI 子挂载 lifespan 冲突; 重负载解析与 MCP 调用同进程
隔离于 Web 服务 (8092), 互不影响。

端点: http://localhost:8093/mcp (streamable-HTTP)
用户身份: 请求头 X-User-Name (URL 编码中文姓名), 或工具参数 user_name。
"""
import logging

from mcp.server.fastmcp import FastMCP

from app import mcp_tools

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

MCP_PORT = 8093

mcp = FastMCP(
    "rag-cowork",
    instructions="rag-cowork 知识库 MCP 服务: 知识库管理/文件归档/解析入库/RAG 检索问答",
    host="0.0.0.0",
    port=MCP_PORT,
    streamable_http_path="/mcp",
)

mcp_tools.register(mcp)


def main() -> None:
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
