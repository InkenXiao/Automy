"""XIN · rag-cowork 知识库平台 · FastAPI 主应用 (端口 8092)"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import auth, files, knowledge_bases, obsidian, rag, stats
from app.utils.json_response import BigIntSafeJSONResponse


class NoCacheStaticFiles(StaticFiles):
    """开发期静态文件禁用缓存, 确保浏览器始终加载最新前端资源"""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时初始化 PG 表结构 + sys_users 种子 (幂等)"""
    await init_db()
    yield


app = FastAPI(
    title="XIN · rag-cowork 知识库平台", lifespan=lifespan,
    default_response_class=BigIntSafeJSONResponse,  # 雪花 ID 响应字符串化, 防前端精度丢失
)

# 跨域设置 (开发阶段允许全部)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API 路由 (统一前缀 /api)
for router in [
    auth.router,
    knowledge_bases.router,
    files.router,
    rag.router,
    stats.router,
    obsidian.router,
]:
    app.include_router(router, prefix="/api")


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "service": "rag-cowork"}


# 挂载前端静态文件 (web 目录)
web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.exists():
    app.mount("/", NoCacheStaticFiles(directory=str(web_dir), html=True), name="web")
