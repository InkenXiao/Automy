"""身份确认路由 · 姓名直登 (无密码); 无效姓名允许进入但无任何项目数据"""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_memberships
from app.models.project import Project
from app.models.usage_log import LoginLog

router = APIRouter(prefix="/auth", tags=["身份确认"])


class LoginIn(BaseModel):
    """登录请求"""

    name: str


async def _user_payload(db: AsyncSession, name: str) -> dict:
    """组装登录响应: 归属项目列表 (含成员角色/状态与项目经理标记)"""
    memberships = await get_memberships(db, name)
    projects = []
    for m in memberships:
        project = await db.get(Project, m.project_id)
        if not project or project.is_delete:
            continue
        projects.append({
            "id": project.id,
            "name": project.name,
            "title": project.title,
            "role": m.role or "",
            "member_status": m.status or "全职",
            "is_manager": (project.manager or "").strip() == name,
            "is_active": project.is_active,
        })
    return {
        "ok": len(projects) > 0,
        "name": name,
        "projects": projects,
    }


@router.post("/login")
async def login(payload: LoginIn, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """姓名直登: 命中项目成员→返回归属项目; 未命中→ok=false 且 projects 为空 (仍允许进入)"""
    name = (payload.name or "").strip()
    result = await _user_payload(db, name) if name else {"ok": False, "name": name, "projects": []}

    # 记录登录日志
    db.add(LoginLog(
        user_name=name,
        is_valid=result["ok"],
        ip=request.client.host if request.client else "",
        user_agent=(request.headers.get("user-agent") or "")[:256],
    ))
    await db.flush()
    return result


@router.get("/me")
async def me(name: str = "", db: AsyncSession = Depends(get_db)) -> dict:
    """按姓名恢复归属项目 (浏览器刷新后恢复会话)"""
    name = (name or "").strip()
    if not name:
        return {"ok": False, "name": "", "projects": []}
    return await _user_payload(db, name)
