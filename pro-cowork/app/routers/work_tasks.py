"""每周工作任务安排路由 (维护权限: 项目经理或全职成员)"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.database import get_db
from app.deps import get_user_name, is_manager_of_project, require_fulltime, resolve_visible_project_id
from app.models.module import Module
from app.models.phase import Phase
from app.models.progress_task import ProgressTask
from app.models.weekly_report import WeeklyPlanTask, WeeklyReport
from app.models.work_task import WeeklyWorkTask
from app.schemas.work_task import (
    WeeklyWorkTaskCreate,
    WeeklyWorkTaskOut,
    WeeklyWorkTaskUpdate,
)
from app.utils import resolve_project_id

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
            with_loader_criteria(WeeklyPlanTask, WeeklyPlanTask.is_delete.is_(False)),
            with_loader_criteria(ProgressTask, ProgressTask.is_delete.is_(False)),
            with_loader_criteria(Phase, Phase.is_delete.is_(False)),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
        )
        .where(WeeklyWorkTask.id == task_id, WeeklyWorkTask.is_delete.is_(False))
        .execution_options(populate_existing=True)
    )
    result = await db.execute(stmt)
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="每周工作任务不存在")
    return item


@router.get("/", response_model=list[WeeklyWorkTaskOut])
async def list_work_tasks(
    request: Request,
    project_id: Optional[int] = None,
    week_start: Optional[date] = None,
    home_scope: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
) -> list[WeeklyWorkTaskOut]:
    """获取每周工作任务列表 (支持按 project_id / week_start 筛选; project_id 不传则用当前激活项目)

    可见性: 无所属项目者返回空列表;
    home_scope=true (首页看板) 时非项目经理仅看指派给自己的任务
    """
    name = get_user_name(request)
    pid = await resolve_visible_project_id(db, name, project_id)
    if pid is None:
        return []
    stmt = select(WeeklyWorkTask).options(
        selectinload(WeeklyWorkTask.plan_task)
        .selectinload(WeeklyPlanTask.progress_task)
        .selectinload(ProgressTask.phase),
        selectinload(WeeklyWorkTask.plan_task).selectinload(WeeklyPlanTask.module),
        selectinload(WeeklyWorkTask.module),
        with_loader_criteria(WeeklyPlanTask, WeeklyPlanTask.is_delete.is_(False)),
        with_loader_criteria(ProgressTask, ProgressTask.is_delete.is_(False)),
        with_loader_criteria(Phase, Phase.is_delete.is_(False)),
        with_loader_criteria(Module, Module.is_delete.is_(False)),
    )
    stmt = stmt.where(WeeklyWorkTask.project_id == pid)
    if week_start is not None:
        stmt = stmt.where(WeeklyWorkTask.week_start == week_start)
    if home_scope and not await is_manager_of_project(db, pid, name):
        stmt = stmt.where(WeeklyWorkTask.owner == name)
    stmt = stmt.where(WeeklyWorkTask.is_delete.is_(False))
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
    payload: WeeklyWorkTaskCreate, request: Request, db: AsyncSession = Depends(get_db)
) -> WeeklyWorkTaskOut:
    """新建每周工作任务; project_id 未传时默认用当前激活项目 (项目经理或全职成员)"""
    data = payload.model_dump()
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    await require_fulltime(db, data["project_id"], get_user_name(request))
    item = WeeklyWorkTask(**data)
    db.add(item)
    await db.flush()
    item = await _load_work_task(db, item.id)
    return WeeklyWorkTaskOut.model_validate(item)


@router.post("/from-plan/{report_id}", response_model=list[WeeklyWorkTaskOut])
async def create_work_tasks_from_plan(
    report_id: int,
    payload: FromPlanRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> list[WeeklyWorkTaskOut]:
    """从周报下周任务批量生成每周工作任务 (project_id 从周报继承) (项目经理或全职成员)"""
    # 取周报的 project_id 作为新工作任务的 project_id
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")
    pid = report.project_id
    await require_fulltime(db, pid, get_user_name(request))

    stmt = (
        select(WeeklyPlanTask)
        .where(
            WeeklyPlanTask.report_id == report_id,
            WeeklyPlanTask.is_delete.is_(False),
        )
        .order_by(WeeklyPlanTask.sort_order, WeeklyPlanTask.id)
    )
    result = await db.execute(stmt)
    plan_tasks = result.scalars().all()
    if not plan_tasks:
        raise HTTPException(status_code=404, detail="该周报无下周任务")

    created_ids: list[int] = []
    for idx, pt in enumerate(plan_tasks):
        item = WeeklyWorkTask(
            project_id=pid,
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
            with_loader_criteria(WeeklyPlanTask, WeeklyPlanTask.is_delete.is_(False)),
            with_loader_criteria(ProgressTask, ProgressTask.is_delete.is_(False)),
            with_loader_criteria(Phase, Phase.is_delete.is_(False)),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
        )
        .where(
            WeeklyWorkTask.id.in_(created_ids),
            WeeklyWorkTask.is_delete.is_(False),
        )
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
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> WeeklyWorkTaskOut:
    """更新每周工作任务 (项目经理或全职成员)"""
    item = await db.get(WeeklyWorkTask, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="每周工作任务不存在")
    await require_fulltime(db, item.project_id, get_user_name(request))
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    item = await _load_work_task(db, item_id)
    return WeeklyWorkTaskOut.model_validate(item)


@router.delete("/{item_id}")
async def delete_work_task(
    item_id: int, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除每周工作任务 (项目经理或全职成员)"""
    item = await db.get(WeeklyWorkTask, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="每周工作任务不存在")
    await require_fulltime(db, item.project_id, get_user_name(request))
    item.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True, "id": item_id}
