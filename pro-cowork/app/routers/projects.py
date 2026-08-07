"""项目元信息路由 · 支持多项目, GET /active 在无项目时幂等创建默认项目

身份相关 (需求: 身份确认):
- GET /        按 X-User-Name 过滤为该用户所属项目 (匿名/无效姓名 → 空列表)
- GET /active  该用户无所属项目 → 403; 全局激活项目不在其归属内时自动切换为其首个项目
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update

from app.database import get_db
from app.deps import get_user_name, get_user_project_ids
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["项目元信息"])


async def _seed_memories_for_new_project(db, project_id: int) -> None:
    """新项目钩子: 为四个预置智能体播种项目关联的默认记忆 (失败不阻塞项目创建)"""
    try:
        from app.services.agent_presets import seed_project_memories

        await seed_project_memories(db, project_id)
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).warning("项目 #%s 默认记忆播种失败", project_id, exc_info=True)

# 默认项目 (信投AI2.0) — 无项目时幂等创建
_DEFAULT_PROJECT = {
    "name": "信投AI2.0",
    "title": "信投 AI 2.0 项目进度计划执行图",
    "based_doc": "20260710信投AI2.0项目进度计划V2.3",
    "start_date": date(2026, 7, 1),
    "end_date": date(2026, 12, 31),
    "is_active": True,
    "sort_order": 0,
}


@router.get("/", response_model=list[ProjectOut])
async def list_projects(request: Request, db=Depends(get_db)) -> list[ProjectOut]:
    """获取该用户所属项目 (按 sort_order, id 排序); 匿名/无效姓名返回空列表"""
    name = get_user_name(request)
    if not name:
        return []
    ids = await get_user_project_ids(db, name)
    if not ids:
        return []
    stmt = (
        select(Project)
        .where(Project.is_delete.is_(False), Project.id.in_(ids))
        .order_by(Project.sort_order, Project.id)
    )
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [ProjectOut.model_validate(it) for it in items]


@router.get("/active", response_model=ProjectOut)
async def get_active_project(request: Request, db=Depends(get_db)) -> ProjectOut:
    """获取当前激活项目; 若无任何项目则幂等创建默认项目

    已登录用户: 无所属项目 → 403; 全局激活项目不在其归属内 → 自动切换为其首个项目
    """
    name = get_user_name(request)
    allowed_ids: list[int] | None = None
    if name:
        allowed_ids = await get_user_project_ids(db, name)
        if not allowed_ids:
            raise HTTPException(status_code=403, detail="当前姓名不属于任何项目")

    stmt = (
        select(Project)
        .where(Project.is_active.is_(True), Project.is_delete.is_(False))
        .limit(1)
    )
    result = await db.execute(stmt)
    proj = result.scalars().first()

    if proj is not None and allowed_ids is not None and proj.id not in allowed_ids:
        # 激活项目不属于该用户: 切换为其首个归属项目
        proj = None

    if proj is None:
        if allowed_ids:
            # 取该用户首个归属项目并激活
            own_stmt = (
                select(Project)
                .where(Project.is_delete.is_(False), Project.id.in_(allowed_ids))
                .order_by(Project.sort_order, Project.id)
                .limit(1)
            )
            own_result = await db.execute(own_stmt)
            proj = own_result.scalars().first()
            if proj is None:
                raise HTTPException(status_code=403, detail="当前姓名不属于任何项目")
            await db.execute(
                update(Project)
                .where(Project.id != proj.id, Project.is_delete.is_(False))
                .values(is_active=False)
            )
            proj.is_active = True
            await db.flush()
            return ProjectOut.model_validate(proj)
        # 无登录身份 (兼容旧调用): 看是否已有任意项目
        any_stmt = (
            select(Project)
            .where(Project.is_delete.is_(False))
            .order_by(Project.sort_order, Project.id)
            .limit(1)
        )
        any_result = await db.execute(any_stmt)
        proj = any_result.scalars().first()
        if proj is None:
            # 完全无项目: 创建默认项目
            proj = Project(**_DEFAULT_PROJECT)
            db.add(proj)
            await db.flush()
            await _seed_memories_for_new_project(db, proj.id)
        else:
            # 有项目但无激活: 激活第一条
            proj.is_active = True
            await db.flush()
    return ProjectOut.model_validate(proj)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: int, db=Depends(get_db)) -> ProjectOut:
    """获取单个项目"""
    proj = await db.get(Project, project_id)
    if not proj or proj.is_delete:
        raise HTTPException(status_code=404, detail="项目不存在")
    return ProjectOut.model_validate(proj)


@router.post("/", response_model=ProjectOut)
async def create_project(payload: ProjectCreate, db=Depends(get_db)) -> ProjectOut:
    """新建项目; 若标记为 active, 则取消其他项目的 active; 并为预置智能体播种项目记忆"""
    if payload.is_active:
        await db.execute(update(Project).values(is_active=False))
    proj = Project(**payload.model_dump())
    db.add(proj)
    await db.flush()
    await _seed_memories_for_new_project(db, proj.id)
    return ProjectOut.model_validate(proj)


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: int, payload: ProjectUpdate, db=Depends(get_db)
) -> ProjectOut:
    """更新项目; 若置为 active, 则取消其他项目的 active"""
    proj = await db.get(Project, project_id)
    if not proj or proj.is_delete:
        raise HTTPException(status_code=404, detail="项目不存在")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_active"):
        await db.execute(
            update(Project)
            .where(Project.id != project_id, Project.is_delete.is_(False))
            .values(is_active=False)
        )
    for key, value in data.items():
        setattr(proj, key, value)
    await db.flush()
    return ProjectOut.model_validate(proj)


@router.patch("/{project_id}/activate", response_model=ProjectOut)
async def activate_project(project_id: int, db=Depends(get_db)) -> ProjectOut:
    """将指定项目置为激活, 其余取消激活"""
    proj = await db.get(Project, project_id)
    if not proj or proj.is_delete:
        raise HTTPException(status_code=404, detail="项目不存在")
    await db.execute(
        update(Project)
        .where(Project.id != project_id, Project.is_delete.is_(False))
        .values(is_active=False)
    )
    proj.is_active = True
    await db.flush()
    return ProjectOut.model_validate(proj)


@router.delete("/{project_id}")
async def delete_project(project_id: int, db=Depends(get_db)) -> dict:
    """删除项目"""
    proj = await db.get(Project, project_id)
    if not proj or proj.is_delete:
        raise HTTPException(status_code=404, detail="项目不存在")
    proj.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True, "id": project_id}
