"""XIN · CoWork 项目管理智能体工作平台 · FastAPI 主应用"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.middleware import OperationLogMiddleware
from app.routers import (
    agents,
    auth,
    meetings,
    modules,
    personal_reports,
    phases,
    progress_tasks,
    project_members,
    projects,
    skills,
    task_runs,
    usage_logs,
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
    """应用生命周期: 启动时初始化数据库 + 预置 Agent/Skill + 项目记忆 + 中断任务巡检"""
    await init_db()
    # 预置四大智能体与示例技能 (幂等)
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models.project import Project
    from app.services.agent_presets import (
        seed_preset_agents,
        seed_preset_memories,
        seed_project_memories,
    )
    from app.services.skill_presets import seed_preset_skills
    from app.services.task_runner import recover_interrupted_runs

    async with AsyncSessionLocal() as session:
        await seed_preset_agents(session)
        await seed_preset_memories(session)
        await seed_preset_skills(session)
        # 存量项目: 为四个预置智能体播种项目关联的默认记忆 (幂等)
        result = await session.execute(
            select(Project.id).where(Project.is_delete.is_(False))
        )
        for (pid,) in result.all():
            await seed_project_memories(session, pid)
        await session.commit()
    # 上次进程退出时仍在 running 的任务标记为失败
    await recover_interrupted_runs()
    yield


app = FastAPI(title="XIN · CoWork 项目管理智能体工作平台", lifespan=lifespan)

# 跨域设置 (开发阶段允许全部)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 操作日志中间件 (自动记录 /api 写操作; 注意 add_middleware 为后添加先执行,
# 此处置于 CORS 之后注册, 实际执行在 CORS 之前, 不影响业务)
app.add_middleware(OperationLogMiddleware)

# 注册 API 路由 (统一前缀 /api)
for router in [
    agents.router,
    auth.router,
    meetings.router,
    modules.router,
    personal_reports.router,
    phases.router,
    progress_tasks.router,
    project_members.router,
    projects.router,
    skills.router,
    task_runs.router,
    usage_logs.router,
    weekly_reports.router,
    work_tasks.router,
]:
    app.include_router(router, prefix="/api")

# 挂载前端静态文件 (web 目录)
web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.exists():
    app.mount("/", NoCacheStaticFiles(directory=str(web_dir), html=True), name="web")
