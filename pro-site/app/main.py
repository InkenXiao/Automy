"""XIN 项目管理工作台 · FastAPI 主应用"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import (
    agents,
    meetings,
    modules,
    phases,
    progress_tasks,
    projects,
    skills,
    weekly_reports,
    work_tasks,
)


class NoCacheStaticFiles(StaticFiles):
    """开发期静态文件禁用缓存, 确保浏览器始终加载最新前端资源"""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期: 启动时初始化数据库 + 预置 Agent"""
    await init_db()
    # 预置四大智能体
    from app.database import AsyncSessionLocal
    from app.services.agent_presets import seed_preset_agents
    async with AsyncSessionLocal() as session:
        await seed_preset_agents(session)
        await session.commit()
    yield


app = FastAPI(title="XIN 项目管理工作台", lifespan=lifespan)

# 跨域设置 (开发阶段允许全部)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API 路由 (统一前缀 /api)
for router in [
    agents.router,
    meetings.router,
    modules.router,
    phases.router,
    progress_tasks.router,
    projects.router,
    skills.router,
    weekly_reports.router,
    work_tasks.router,
]:
    app.include_router(router, prefix="/api")

# 挂载前端静态文件 (web 目录)
web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.exists():
    app.mount("/", NoCacheStaticFiles(directory=str(web_dir), html=True), name="web")
