"""项目成员路由 · 项目驾驶舱-项目成员页"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.project_member import ProjectMember
from app.schemas.project_member import (
    ProjectMemberCreate,
    ProjectMemberOut,
    ProjectMemberUpdate,
)
from app.services.user_sync import sync_sys_user
from app.utils import resolve_project_id

router = APIRouter(prefix="/project-members", tags=["项目成员"])


@router.get("/", response_model=list[ProjectMemberOut])
async def list_project_members(
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> list[ProjectMemberOut]:
    """获取项目成员列表 (按 sort_order, id 排序; 支持按 project_id 过滤, 不传则用当前激活项目)"""
    pid = await resolve_project_id(db, project_id)
    stmt = (
        select(ProjectMember)
        .where(ProjectMember.is_delete.is_(False), ProjectMember.project_id == pid)
        .order_by(ProjectMember.sort_order, ProjectMember.id)
    )
    result = await db.execute(stmt)
    return [ProjectMemberOut.model_validate(m) for m in result.scalars().all()]


@router.post("/", response_model=ProjectMemberOut)
async def create_project_member(
    payload: ProjectMemberCreate, db: AsyncSession = Depends(get_db)
) -> ProjectMemberOut:
    """新增项目成员; project_id 未传时默认用当前激活项目 (双写 sys_users 共享账号)"""
    data = payload.model_dump()
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    member = ProjectMember(**data)
    db.add(member)
    await db.flush()
    await sync_sys_user(db, member.name)  # rag/mcp-cowork 立即可登录 (不触碰密码)
    await db.refresh(member)
    return ProjectMemberOut.model_validate(member)


@router.put("/{member_id}", response_model=ProjectMemberOut)
async def update_project_member(
    member_id: int, payload: ProjectMemberUpdate, db: AsyncSession = Depends(get_db)
) -> ProjectMemberOut:
    """更新项目成员 (角色/岗位、入组时间、当前状态等); 改名时双写 sys_users 新建新姓名账号"""
    member = await db.get(ProjectMember, member_id)
    if not member or member.is_delete:
        raise HTTPException(status_code=404, detail="成员不存在")
    old_name = member.name
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(member, key, value)
    await db.flush()
    if member.name != old_name:
        # 旧账号保留不动 (避免误删 rag/mcp 侧数据), 仅确保新姓名有账号
        await sync_sys_user(db, member.name)
    await db.refresh(member)
    return ProjectMemberOut.model_validate(member)


@router.delete("/{member_id}")
async def delete_project_member(member_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    """删除项目成员 (逻辑删除)"""
    member = await db.get(ProjectMember, member_id)
    if not member or member.is_delete:
        raise HTTPException(status_code=404, detail="成员不存在")
    member.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True, "id": member_id}
