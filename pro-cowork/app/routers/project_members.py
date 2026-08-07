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
    """新增项目成员; project_id 未传时默认用当前激活项目"""
    data = payload.model_dump()
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    member = ProjectMember(**data)
    db.add(member)
    await db.flush()
    await db.refresh(member)
    return ProjectMemberOut.model_validate(member)


@router.put("/{member_id}", response_model=ProjectMemberOut)
async def update_project_member(
    member_id: int, payload: ProjectMemberUpdate, db: AsyncSession = Depends(get_db)
) -> ProjectMemberOut:
    """更新项目成员 (角色/岗位、入组时间、当前状态等)"""
    member = await db.get(ProjectMember, member_id)
    if not member or member.is_delete:
        raise HTTPException(status_code=404, detail="成员不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(member, key, value)
    await db.flush()
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
