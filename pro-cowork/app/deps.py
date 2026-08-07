"""共享依赖: 当前登录人识别与项目权限校验 (需求: 身份确认 + 维护权限)"""
from urllib.parse import unquote

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.project_member import ProjectMember


def get_user_name(request: Request) -> str:
    """从 X-User-Name 请求头取当前登录人姓名; 未登录返回空串 (视为匿名)

    前端对姓名做 encodeURIComponent (HTTP header 仅支持 Latin-1, 中文需编码);
    此处统一 unquote 还原。
    """
    raw = (request.headers.get("x-user-name") or "").strip()
    return unquote(raw) if raw else ""


async def get_memberships(db: AsyncSession, name: str) -> list[ProjectMember]:
    """该用户在全部项目的成员记录 (未删除, 按项目排序)"""
    if not name:
        return []
    result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.is_delete.is_(False), ProjectMember.name == name)
        .order_by(ProjectMember.project_id, ProjectMember.sort_order, ProjectMember.id)
    )
    return list(result.scalars().all())


async def get_user_project_ids(db: AsyncSession, name: str) -> list[int]:
    """该用户所属项目 id 列表"""
    return [m.project_id for m in await get_memberships(db, name)]


def is_project_manager(project: Project | None, name: str) -> bool:
    """是否项目经理 (manager 字段与登录姓名匹配)"""
    return bool(project and name and (project.manager or "").strip() == name)


async def require_project_manager(db: AsyncSession, project_id: int, name: str) -> Project:
    """仅项目经理可维护; 否则 403"""
    project = await db.get(Project, project_id)
    if not project or project.is_delete:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not is_project_manager(project, name):
        raise HTTPException(status_code=403, detail="仅项目经理可执行此操作")
    return project


async def require_fulltime(db: AsyncSession, project_id: int, name: str) -> Project:
    """项目经理或全职成员可维护 (临时/退出只读); 否则 403"""
    project = await db.get(Project, project_id)
    if not project or project.is_delete:
        raise HTTPException(status_code=404, detail="项目不存在")
    if is_project_manager(project, name):
        return project
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.is_delete.is_(False),
            ProjectMember.project_id == project_id,
            ProjectMember.name == name,
        )
    )
    member = result.scalars().first()
    if member and (member.status or "全职") == "全职":
        return project
    raise HTTPException(status_code=403, detail="仅项目经理或全职成员可执行此操作")
