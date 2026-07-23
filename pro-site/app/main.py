"""XIN 项目管理工作台 · FastAPI 主应用"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import (
    meetings,
    modules,
    phases,
    progress_tasks,
    weekly_reports,
    work_tasks,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期: 启动时初始化数据库"""
    await init_db()
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
    meetings.router,
    modules.router,
    phases.router,
    progress_tasks.router,
    weekly_reports.router,
    work_tasks.router,
]:
    app.include_router(router, prefix="/api")

# 挂载前端静态文件 (web 目录)
web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.exists():
    app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")
