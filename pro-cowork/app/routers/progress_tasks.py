"""项目进度计划任务路由"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.database import get_db
from app.models.phase import Phase
from app.models.progress_task import ProgressTask
from app.schemas.progress_task import (
    ProgressTaskCreate,
    ProgressTaskOut,
    ProgressTaskUpdate,
)
from app.utils import resolve_project_id

router = APIRouter(prefix="/progress-tasks", tags=["进度计划"])


class StatusUpdate(BaseModel):
    """状态更新请求体"""

    status: str


async def _load_progress_task(db: AsyncSession, task_id: int) -> ProgressTask:
    """加载单条进度计划任务 (含 phase 关系, 避免异步懒加载)"""
    stmt = (
        select(ProgressTask)
        .options(
            selectinload(ProgressTask.phase),
            with_loader_criteria(Phase, Phase.is_delete.is_(False)),
        )
        .where(ProgressTask.id == task_id, ProgressTask.is_delete.is_(False))
        .execution_options(populate_existing=True)
    )
    result = await db.execute(stmt)
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="进度计划任务不存在")
    return item


@router.get("/", response_model=list[ProgressTaskOut])
async def list_progress_tasks(
    project_id: Optional[int] = None,
    phase_id: Optional[int] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[ProgressTaskOut]:
    """获取进度计划任务列表 (支持按 project_id / phase_id / status 筛选; project_id 不传则用当前激活项目)"""
    pid = await resolve_project_id(db, project_id)
    stmt = select(ProgressTask).options(
        selectinload(ProgressTask.phase),
        with_loader_criteria(Phase, Phase.is_delete.is_(False)),
    )
    stmt = stmt.where(ProgressTask.project_id == pid)
    if phase_id is not None:
        stmt = stmt.where(ProgressTask.phase_id == phase_id)
    if status:
        stmt = stmt.where(ProgressTask.status == status)
    stmt = stmt.where(ProgressTask.is_delete.is_(False))
    stmt = stmt.order_by(ProgressTask.start_date, ProgressTask.id)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [ProgressTaskOut.model_validate(it) for it in items]


@router.get("/{item_id}", response_model=ProgressTaskOut)
async def get_progress_task(
    item_id: int, db: AsyncSession = Depends(get_db)
) -> ProgressTaskOut:
    """获取进度计划任务详情"""
    item = await _load_progress_task(db, item_id)
    return ProgressTaskOut.model_validate(item)


@router.post("/", response_model=ProgressTaskOut)
async def create_progress_task(
    payload: ProgressTaskCreate, db: AsyncSession = Depends(get_db)
) -> ProgressTaskOut:
    """新建进度计划任务; project_id 未传时默认用当前激活项目"""
    data = payload.model_dump()
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    item = ProgressTask(**data)
    db.add(item)
    await db.flush()
    item = await _load_progress_task(db, item.id)
    return ProgressTaskOut.model_validate(item)


@router.put("/{item_id}", response_model=ProgressTaskOut)
async def update_progress_task(
    item_id: int,
    payload: ProgressTaskUpdate,
    db: AsyncSession = Depends(get_db),
) -> ProgressTaskOut:
    """更新进度计划任务"""
    item = await db.get(ProgressTask, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="进度计划任务不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    item = await _load_progress_task(db, item_id)
    return ProgressTaskOut.model_validate(item)


@router.patch("/{item_id}/status", response_model=ProgressTaskOut)
async def update_progress_task_status(
    item_id: int,
    payload: StatusUpdate,
    db: AsyncSession = Depends(get_db),
) -> ProgressTaskOut:
    """更新进度计划任务状态"""
    item = await db.get(ProgressTask, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="进度计划任务不存在")
    item.status = payload.status
    await db.flush()
    item = await _load_progress_task(db, item_id)
    return ProgressTaskOut.model_validate(item)


@router.delete("/{item_id}")
async def delete_progress_task(
    item_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除进度计划任务"""
    item = await db.get(ProgressTask, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="进度计划任务不存在")
    item.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True, "id": item_id}
