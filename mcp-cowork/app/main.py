"""XIN · mcp-cowork MCP 接口维护/测试/统计平台 · FastAPI 主应用 (端口 8094)"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text

from app.config import settings
from app.database import AsyncSessionLocal, init_db
from app.routers import auth, im, inspect, servers, stats, testing
from app.utils.json_response import BigIntSafeJSONResponse

logger = logging.getLogger(__name__)

# 预置 MCP 服务: rag-cowork (容器内直达, 幂等)
PRESET_SERVERS = [
    {
        "name": "rag-cowork",
        "base_url": "http://localhost:8093/mcp",
        "description": "rag-cowork 知识库 MCP 服务: 知识库管理/文件归档/解析入库/RAG 检索问答",
    },
]


class NoCacheStaticFiles(StaticFiles):
    """开发期静态文件禁用缓存"""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动: 建表 + sys_users 种子 + 预置 MCP 服务注册 + 定时巡检任务 (全用户幂等)"""
    await init_db()
    await _seed_preset_servers()
    task = _start_inspect_scheduler()
    yield
    if task:
        task.cancel()


def _start_inspect_scheduler() -> "asyncio.Task | None":
    """定时工具巡检: 每 INSPECT_INTERVAL_H 小时对全部用户跑一轮 (0=关闭)"""
    interval_h = settings.INSPECT_INTERVAL_H
    if interval_h <= 0:
        return None

    from app.services import inspect_service

    async def _loop() -> None:
        # 启动后先等 2 分钟再首轮 (避开服务启动期), 之后按间隔循环
        await asyncio.sleep(120)
        while True:
            try:
                await inspect_service.run_all_users(trigger="scheduled")
            except Exception:  # noqa: BLE001
                logger.exception("定时巡检执行异常")
            await asyncio.sleep(max(interval_h, 0.1) * 3600)

    return asyncio.create_task(_loop())


async def _seed_preset_servers() -> None:
    from app.models import McpServer, SysUser
    from app.services.snowflake import generate_id

    async with AsyncSessionLocal() as session:
        users = (await session.execute(
            select(SysUser).where(SysUser.is_delete.is_(False), SysUser.is_active.is_(True))
        )).scalars().all()
        for preset in PRESET_SERVERS:
            for u in users:
                exists = (await session.execute(
                    select(McpServer).where(
                        McpServer.is_delete.is_(False),
                        McpServer.user_id == u.user_id,
                        McpServer.base_url == preset["base_url"],
                    )
                )).scalars().first()
                if not exists:
                    session.add(McpServer(
                        server_id=generate_id(), name=preset["name"],
                        base_url=preset["base_url"], description=preset["description"],
                        user_id=u.user_id,
                    ))
        await session.commit()


app = FastAPI(
    title="XIN · mcp-cowork MCP 接口平台", lifespan=lifespan,
    default_response_class=BigIntSafeJSONResponse,  # 雪花 ID 响应字符串化, 防前端精度丢失
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in [auth.router, servers.router, testing.router, stats.router, im.router, inspect.router]:
    app.include_router(router, prefix="/api")


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "service": "mcp-cowork"}


web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.exists():
    app.mount("/", NoCacheStaticFiles(directory=str(web_dir), html=True), name="web")
