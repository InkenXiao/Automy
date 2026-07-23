"""艾宾浩斯背单词应用 · FastAPI 主应用"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import review, units, words


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期: 启动时初始化数据库"""
    await init_db()
    yield


app = FastAPI(title="艾宾浩斯背单词", lifespan=lifespan)

# 跨域设置 (开发阶段允许全部)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API 路由 (统一前缀 /api)
for router in [words.router, units.router, review.router]:
    app.include_router(router, prefix="/api")

# 挂载前端静态文件 (web 目录)
web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.exists():
    app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")
