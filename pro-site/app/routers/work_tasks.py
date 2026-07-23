"""每周工作任务安排路由"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.progress_task import ProgressTask
from app.models.weekly_report import WeeklyPlanTask
from app.models.work_task import WeeklyWorkTask
from app.schemas.work_task import (
    WeeklyWorkTaskCreate,
    WeeklyWorkTaskOut,
    WeeklyWorkTaskUpdate,
)

router = APIRouter(prefix="/work-tasks", tags=["每周工作任务"])


class FromPlanRequest(BaseModel):
    """从周报下周任务批量生成工作任务的请求体"""

    week_start: date
    week_end: date


async def _load_work_task(db: AsyncSession, task_id: int) -> WeeklyWorkTask:
    """加载单条工作任务 (含 plan_task 及其 progress_task/module 关系, 避免异步懒加载)"""
    stmt = (
        select(WeeklyWorkTask)
        .options(
            selectinload(WeeklyWorkTask.plan_task)
            .selectinload(WeeklyPlanTask.progress_task)
            .selectinload(ProgressTask.phase),
            selectinload(WeeklyWorkTask.plan_task).selectinload(WeeklyPlanTask.module),
            selectinload(WeeklyWorkTask.module),
        )
        .where(WeeklyWorkTask.id == task_id)
        .execution_options(populate_existing=True)
    )
    result = await db.execute(stmt)
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="每周工作任务不存在")
    return item


@router.get("/", response_model=list[WeeklyWorkTaskOut])
async def list_work_tasks(
    week_start: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
) -> list[WeeklyWorkTaskOut]:
    """获取每周工作任务列表 (支持按 week_start 筛选)"""
    stmt = select(WeeklyWorkTask).options(
        selectinload(WeeklyWorkTask.plan_task)
        .selectinload(WeeklyPlanTask.progress_task)
        .selectinload(ProgressTask.phase),
        selectinload(WeeklyWorkTask.plan_task).selectinload(WeeklyPlanTask.module),
        selectinload(WeeklyWorkTask.module),
    )
    if week_start is not None:
        stmt = stmt.where(WeeklyWorkTask.week_start == week_start)
    stmt = stmt.order_by(WeeklyWorkTask.sort_order, WeeklyWorkTask.id)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [WeeklyWorkTaskOut.model_validate(it) for it in items]


@router.get("/{item_id}", response_model=WeeklyWorkTaskOut)
async def get_work_task(
    item_id: int, db: AsyncSession = Depends(get_db)
) -> WeeklyWorkTaskOut:
    """获取每周工作任务详情"""
    item = await _load_work_task(db, item_id)
    return WeeklyWorkTaskOut.model_validate(item)


@router.post("/", response_model=WeeklyWorkTaskOut)
async def create_work_task(
    payload: WeeklyWorkTaskCreate, db: AsyncSession = Depends(get_db)
) -> WeeklyWorkTaskOut:
    """新建每周工作任务"""
    item = WeeklyWorkTask(**payload.model_dump())
    db.add(item)
    await db.flush()
    item = await _load_work_task(db, item.id)
    return WeeklyWorkTaskOut.model_validate(item)


@router.post("/from-plan/{report_id}", response_model=list[WeeklyWorkTaskOut])
async def create_work_tasks_from_plan(
    report_id: int,
    payload: FromPlanRequest,
    db: AsyncSession = Depends(get_db),
) -> list[WeeklyWorkTaskOut]:
    """从周报下周任务批量生成每周工作任务"""
    stmt = (
        select(WeeklyPlanTask)
        .where(WeeklyPlanTask.report_id == report_id)
        .order_by(WeeklyPlanTask.sort_order, WeeklyPlanTask.id)
    )
    result = await db.execute(stmt)
    plan_tasks = result.scalars().all()
    if not plan_tasks:
        raise HTTPException(status_code=404, detail="该周报无下周任务")

    created_ids: list[int] = []
    for idx, pt in enumerate(plan_tasks):
        item = WeeklyWorkTask(
            week_start=payload.week_start,
            week_end=payload.week_end,
            plan_task_id=pt.id,
            name=pt.name,
            module_id=pt.module_id,
            owner=pt.owner,
            is_temporary=False,
            priority="high" if pt.is_key else "medium",
            status="待开始",
            sort_order=idx,
        )
        db.add(item)
        await db.flush()
        created_ids.append(item.id)

    # 重新批量加载 (含 plan_task 及其嵌套关系)
    reload_stmt = (
        select(WeeklyWorkTask)
        .options(
            selectinload(WeeklyWorkTask.plan_task)
            .selectinload(WeeklyPlanTask.progress_task)
            .selectinload(ProgressTask.phase),
            selectinload(WeeklyWorkTask.plan_task).selectinload(WeeklyPlanTask.module),
            selectinload(WeeklyWorkTask.module),
        )
        .where(WeeklyWorkTask.id.in_(created_ids))
        .order_by(WeeklyWorkTask.sort_order, WeeklyWorkTask.id)
        .execution_options(populate_existing=True)
    )
    result = await db.execute(reload_stmt)
    items = result.scalars().all()
    return [WeeklyWorkTaskOut.model_validate(it) for it in items]


@router.put("/{item_id}", response_model=WeeklyWorkTaskOut)
async def update_work_task(
    item_id: int,
    payload: WeeklyWorkTaskUpdate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyWorkTaskOut:
    """更新每周工作任务"""
    item = await db.get(WeeklyWorkTask, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="每周工作任务不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    item = await _load_work_task(db, item_id)
    return WeeklyWorkTaskOut.model_validate(item)


@router.delete("/{item_id}")
async def delete_work_task(
    item_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除每周工作任务"""
    item = await db.get(WeeklyWorkTask, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="每周工作任务不存在")
    await db.delete(item)
    await db.flush()
    return {"ok": True, "id": item_id}
