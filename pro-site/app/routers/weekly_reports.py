"""周报路由 · 含 KPI / 进展事项 / 下周任务 / 风险 等子资源"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.database import get_db
from app.models.module import Module
from app.models.phase import Phase
from app.models.progress_task import ProgressTask
from app.models.weekly_report import (
    WeeklyKpi,
    WeeklyPlanTask,
    WeeklyProgressItem,
    WeeklyReport,
    WeeklyRisk,
)
from app.schemas.weekly_report import (
    CopyLastWeekRequest,
    PlanTaskLinkRequest,
    WeeklyKpiCreate,
    WeeklyKpiOut,
    WeeklyPlanTaskCreate,
    WeeklyPlanTaskOut,
    WeeklyPlanTaskUpdate,
    WeeklyProgressItemCreate,
    WeeklyProgressItemOut,
    WeeklyProgressItemUpdate,
    WeeklyReportCreate,
    WeeklyReportOut,
    WeeklyReportUpdate,
    WeeklyRiskCreate,
    WeeklyRiskOut,
    WeeklyRiskUpdate,
)
from app.utils import resolve_project_id

router = APIRouter(prefix="/weekly-reports", tags=["周报"])


async def _load_report(db: AsyncSession, report_id: int) -> WeeklyReport:
    """加载周报 (含全部子表, populate_existing 强制刷新 identity map 中可能存在的对象)"""
    stmt = (
        select(WeeklyReport)
        .options(
            selectinload(WeeklyReport.kpis).selectinload(WeeklyKpi.module),
            selectinload(WeeklyReport.progress_items).selectinload(
                WeeklyProgressItem.module
            ),
            selectinload(WeeklyReport.plan_tasks)
            .selectinload(WeeklyPlanTask.progress_task)
            .selectinload(ProgressTask.phase),
            selectinload(WeeklyReport.plan_tasks).selectinload(
                WeeklyPlanTask.module
            ),
            selectinload(WeeklyReport.risks),
            with_loader_criteria(WeeklyKpi, WeeklyKpi.is_delete.is_(False)),
            with_loader_criteria(WeeklyProgressItem, WeeklyProgressItem.is_delete.is_(False)),
            with_loader_criteria(WeeklyPlanTask, WeeklyPlanTask.is_delete.is_(False)),
            with_loader_criteria(WeeklyRisk, WeeklyRisk.is_delete.is_(False)),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
            with_loader_criteria(ProgressTask, ProgressTask.is_delete.is_(False)),
            with_loader_criteria(Phase, Phase.is_delete.is_(False)),
        )
        .where(WeeklyReport.id == report_id, WeeklyReport.is_delete.is_(False))
        .execution_options(populate_existing=True)
    )
    result = await db.execute(stmt)
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="周报不存在")
    return report


async def _load_plan_task(db: AsyncSession, task_id: int) -> WeeklyPlanTask:
    """加载单条下周任务 (含 module 与 progress_task 关系, 避免异步懒加载)"""
    stmt = (
        select(WeeklyPlanTask)
        .options(
            selectinload(WeeklyPlanTask.module),
            selectinload(WeeklyPlanTask.progress_task).selectinload(ProgressTask.phase),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
            with_loader_criteria(ProgressTask, ProgressTask.is_delete.is_(False)),
            with_loader_criteria(Phase, Phase.is_delete.is_(False)),
        )
        .where(WeeklyPlanTask.id == task_id, WeeklyPlanTask.is_delete.is_(False))
        .execution_options(populate_existing=True)
    )
    result = await db.execute(stmt)
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="下周任务不存在")
    return item


# ---------- 周报主体 ----------
@router.get("/", response_model=list[WeeklyReportOut])
async def list_weekly_reports(
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> list[WeeklyReportOut]:
    """获取周报列表 (按 week_start 倒序; 支持按 project_id 过滤, 不传则用当前激活项目)"""
    pid = await resolve_project_id(db, project_id)
    stmt = (
        select(WeeklyReport)
        .options(
            selectinload(WeeklyReport.kpis).selectinload(WeeklyKpi.module),
            selectinload(WeeklyReport.progress_items).selectinload(
                WeeklyProgressItem.module
            ),
            selectinload(WeeklyReport.plan_tasks)
            .selectinload(WeeklyPlanTask.progress_task)
            .selectinload(ProgressTask.phase),
            selectinload(WeeklyReport.plan_tasks).selectinload(
                WeeklyPlanTask.module
            ),
            selectinload(WeeklyReport.risks),
            with_loader_criteria(WeeklyKpi, WeeklyKpi.is_delete.is_(False)),
            with_loader_criteria(WeeklyProgressItem, WeeklyProgressItem.is_delete.is_(False)),
            with_loader_criteria(WeeklyPlanTask, WeeklyPlanTask.is_delete.is_(False)),
            with_loader_criteria(WeeklyRisk, WeeklyRisk.is_delete.is_(False)),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
            with_loader_criteria(ProgressTask, ProgressTask.is_delete.is_(False)),
            with_loader_criteria(Phase, Phase.is_delete.is_(False)),
        )
        .where(WeeklyReport.is_delete.is_(False), WeeklyReport.project_id == pid)
        .order_by(WeeklyReport.week_start.desc(), WeeklyReport.id.desc())
    )
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [WeeklyReportOut.model_validate(it) for it in items]


@router.get("/{report_id}", response_model=WeeklyReportOut)
async def get_weekly_report(
    report_id: int, db: AsyncSession = Depends(get_db)
) -> WeeklyReportOut:
    """获取周报详情 (含全部子表)"""
    report = await _load_report(db, report_id)
    return WeeklyReportOut.model_validate(report)


@router.post("/", response_model=WeeklyReportOut)
async def create_weekly_report(
    payload: WeeklyReportCreate, db: AsyncSession = Depends(get_db)
) -> WeeklyReportOut:
    """新建周报; project_id 未传时默认用当前激活项目"""
    data = payload.model_dump()
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    report = WeeklyReport(**data)
    db.add(report)
    await db.flush()
    # 重新加载以避免异步懒加载子表
    report = await _load_report(db, report.id)
    return WeeklyReportOut.model_validate(report)


@router.post("/copy-last", response_model=WeeklyReportOut)
async def copy_last_week_report(
    payload: CopyLastWeekRequest, db: AsyncSession = Depends(get_db)
) -> WeeklyReportOut:
    """复制最近一份周报到新周次 (复制 KPI / 进展 / 下周任务 / 风险 全部子表)

    - 在 week_start 之前查找最近一份未删除周报作为源 (同项目内)
    - 新周报保留源的所有内容, 仅更新周次范围与标题, project_id 继承自源
    - 下周任务 (plan_tasks) 的 status 重置为 "待开始"
    """
    # 解析 project_id (未传则用当前激活项目)
    pid = await resolve_project_id(db, payload.project_id)

    # 1. 查找源周报 (同项目内, week_start 严格早于目标 week_start, 按 week_start 倒序取首条)
    src_stmt = (
        select(WeeklyReport)
        .options(
            selectinload(WeeklyReport.kpis),
            selectinload(WeeklyReport.progress_items),
            selectinload(WeeklyReport.plan_tasks),
            selectinload(WeeklyReport.risks),
            with_loader_criteria(WeeklyKpi, WeeklyKpi.is_delete.is_(False)),
            with_loader_criteria(WeeklyProgressItem, WeeklyProgressItem.is_delete.is_(False)),
            with_loader_criteria(WeeklyPlanTask, WeeklyPlanTask.is_delete.is_(False)),
            with_loader_criteria(WeeklyRisk, WeeklyRisk.is_delete.is_(False)),
        )
        .where(
            WeeklyReport.is_delete.is_(False),
            WeeklyReport.project_id == pid,
            WeeklyReport.week_start < payload.week_start,
        )
        .order_by(WeeklyReport.week_start.desc(), WeeklyReport.id.desc())
        .limit(1)
    )
    src_result = await db.execute(src_stmt)
    src = src_result.scalars().first()
    if src is None:
        raise HTTPException(status_code=404, detail="未找到可复制的上周周报")

    # 2. 创建新周报主体 (主表内容新生成, 不沿用源; 仅复制子表内容)
    # title: 用新周次生成 (留空则用 "YYYY-MM-DD 周报")
    new_title = payload.title or f"{payload.week_start} 周报"
    # week_range: 用新周次生成 (格式 MM.DD — MM.DD)
    new_week_range = (
        f"{payload.week_start.strftime('%m.%d')} — {payload.week_end.strftime('%m.%d')}"
    )
    # overview_summary: 留空 (新周报的本周总结需重新填写)
    new_summary = payload.overview_summary if payload.overview_summary is not None else ""
    new_report = WeeklyReport(
        project_id=pid,
        title=new_title,
        week_range=new_week_range,
        week_start=payload.week_start,
        week_end=payload.week_end,
        overview_summary=new_summary,
        status="draft",
    )
    db.add(new_report)
    await db.flush()

    # 3. 复制 KPI
    for k in (src.kpis or []):
        db.add(WeeklyKpi(
            report_id=new_report.id,
            module_id=k.module_id,
            progress_pct=k.progress_pct,
            status=k.status,
        ))

    # 4. 复制进展事项
    for p in (src.progress_items or []):
        db.add(WeeklyProgressItem(
            report_id=new_report.id,
            module_id=p.module_id,
            content=p.content,
            detail=p.detail,
            sort_order=p.sort_order,
        ))

    # 5. 复制下周任务 (status 重置为 "待开始")
    for t in (src.plan_tasks or []):
        db.add(WeeklyPlanTask(
            report_id=new_report.id,
            module_id=t.module_id,
            progress_task_id=t.progress_task_id,
            name=t.name,
            is_key=t.is_key,
            owner=t.owner,
            plan_period=t.plan_period,
            status="待开始",
            remark=t.remark,
            sort_order=t.sort_order,
        ))

    # 6. 复制风险
    for r in (src.risks or []):
        db.add(WeeklyRisk(
            report_id=new_report.id,
            seq=r.seq,
            title=r.title,
            coordination=r.coordination,
            urgency=r.urgency,
            sort_order=r.sort_order,
        ))

    await db.flush()
    # 重新加载以返回完整结构
    new_report = await _load_report(db, new_report.id)
    return WeeklyReportOut.model_validate(new_report)


@router.put("/{report_id}", response_model=WeeklyReportOut)
async def update_weekly_report(
    report_id: int,
    payload: WeeklyReportUpdate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyReportOut:
    """更新周报"""
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(report, key, value)
    await db.flush()
    # 重新加载以避免异步懒加载子表
    report = await _load_report(db, report_id)
    return WeeklyReportOut.model_validate(report)


@router.delete("/{report_id}")
async def delete_weekly_report(
    report_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除周报 (级联删除子表)"""
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")
    report.is_delete = True
    await db.flush()
    return {"ok": True, "id": report_id}


# ---------- 下周任务 (plan-tasks) ----------
@router.post("/{report_id}/plan-tasks", response_model=WeeklyPlanTaskOut)
async def create_plan_task(
    report_id: int,
    payload: WeeklyPlanTaskCreate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyPlanTaskOut:
    """新增下周任务"""
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")
    item = WeeklyPlanTask(report_id=report_id, **payload.model_dump())
    db.add(item)
    await db.flush()
    item = await _load_plan_task(db, item.id)
    return WeeklyPlanTaskOut.model_validate(item)


@router.put("/{report_id}/plan-tasks/{task_id}", response_model=WeeklyPlanTaskOut)
async def update_plan_task(
    report_id: int,
    task_id: int,
    payload: WeeklyPlanTaskUpdate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyPlanTaskOut:
    """更新下周任务"""
    item = await db.get(WeeklyPlanTask, task_id)
    if not item or item.is_delete or item.report_id != report_id:
        raise HTTPException(status_code=404, detail="下周任务不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    item = await _load_plan_task(db, task_id)
    return WeeklyPlanTaskOut.model_validate(item)


@router.delete("/{report_id}/plan-tasks/{task_id}")
async def delete_plan_task(
    report_id: int, task_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除下周任务"""
    item = await db.get(WeeklyPlanTask, task_id)
    if not item or item.is_delete or item.report_id != report_id:
        raise HTTPException(status_code=404, detail="下周任务不存在")
    item.is_delete = True
    await db.flush()
    return {"ok": True, "id": task_id}


@router.post("/{report_id}/plan-tasks/link", response_model=WeeklyPlanTaskOut)
async def link_plan_task_from_progress(
    report_id: int,
    payload: PlanTaskLinkRequest,
    db: AsyncSession = Depends(get_db),
) -> WeeklyPlanTaskOut:
    """从进度计划关联任务 (创建一个关联 progress_task 的 plan_task)"""
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")
    progress_task = await db.get(ProgressTask, payload.progress_task_id)
    if not progress_task or progress_task.is_delete:
        raise HTTPException(status_code=404, detail="进度计划任务不存在")
    item = WeeklyPlanTask(
        report_id=report_id,
        module_id=payload.module_id,
        progress_task_id=payload.progress_task_id,
        name=progress_task.name,
        owner=progress_task.owner or "",
        plan_period="",
        status="待开始",
        remark=progress_task.full_desc or "",
    )
    db.add(item)
    await db.flush()
    item = await _load_plan_task(db, item.id)
    return WeeklyPlanTaskOut.model_validate(item)


# ---------- KPI (批量保存) ----------
@router.post("/{report_id}/kpis", response_model=list[WeeklyKpiOut])
async def save_kpis(
    report_id: int,
    payload: list[WeeklyKpiCreate],
    db: AsyncSession = Depends(get_db),
) -> list[WeeklyKpiOut]:
    """批量保存周报 KPI (按 module_id upsert)"""
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")

    # 查询现有 KPI
    stmt = select(WeeklyKpi).where(
        WeeklyKpi.report_id == report_id,
        WeeklyKpi.is_delete.is_(False),
    )
    result = await db.execute(stmt)
    existing = {k.module_id: k for k in result.scalars().all()}

    saved_ids: list[int] = []
    for kpi_in in payload:
        if kpi_in.module_id in existing:
            item = existing[kpi_in.module_id]
            item.progress_pct = kpi_in.progress_pct
            item.status = kpi_in.status
        else:
            item = WeeklyKpi(
                report_id=report_id,
                module_id=kpi_in.module_id,
                progress_pct=kpi_in.progress_pct,
                status=kpi_in.status,
            )
            db.add(item)
        await db.flush()
        saved_ids.append(item.id)

    # 重新批量加载 (含 module 关系)
    reload_stmt = (
        select(WeeklyKpi)
        .options(
            selectinload(WeeklyKpi.module),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
        )
        .where(
            WeeklyKpi.id.in_(saved_ids),
            WeeklyKpi.is_delete.is_(False),
        )
        .order_by(WeeklyKpi.id)
    )
    result = await db.execute(reload_stmt)
    items = result.scalars().all()
    return [WeeklyKpiOut.model_validate(it) for it in items]


@router.delete("/{report_id}/kpis/{kpi_id}")
async def delete_kpi(
    report_id: int, kpi_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除单个周报 KPI"""
    item = await db.get(WeeklyKpi, kpi_id)
    if not item or item.is_delete or item.report_id != report_id:
        raise HTTPException(status_code=404, detail="KPI 不存在")
    item.is_delete = True
    await db.flush()
    return {"ok": True, "id": kpi_id}


# ---------- 进展事项 ----------
@router.post("/{report_id}/progress-items", response_model=WeeklyProgressItemOut)
async def create_progress_item(
    report_id: int,
    payload: WeeklyProgressItemCreate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyProgressItemOut:
    """新增周报进展事项"""
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")
    item = WeeklyProgressItem(report_id=report_id, **payload.model_dump())
    db.add(item)
    await db.flush()
    # 重新加载以避免异步懒加载 module
    reload_stmt = (
        select(WeeklyProgressItem)
        .options(
            selectinload(WeeklyProgressItem.module),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
        )
        .where(
            WeeklyProgressItem.id == item.id,
            WeeklyProgressItem.is_delete.is_(False),
        )
    )
    result = await db.execute(reload_stmt)
    item = result.scalars().first()
    return WeeklyProgressItemOut.model_validate(item)


@router.put("/{report_id}/progress-items/{item_id}", response_model=WeeklyProgressItemOut)
async def update_progress_item(
    report_id: int,
    item_id: int,
    payload: WeeklyProgressItemUpdate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyProgressItemOut:
    """更新周报进展事项"""
    item = await db.get(WeeklyProgressItem, item_id)
    if not item or item.is_delete or item.report_id != report_id:
        raise HTTPException(status_code=404, detail="进展事项不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    # 重新加载以避免异步懒加载 module
    reload_stmt = (
        select(WeeklyProgressItem)
        .options(
            selectinload(WeeklyProgressItem.module),
            with_loader_criteria(Module, Module.is_delete.is_(False)),
        )
        .where(
            WeeklyProgressItem.id == item_id,
            WeeklyProgressItem.is_delete.is_(False),
        )
    )
    result = await db.execute(reload_stmt)
    item = result.scalars().first()
    return WeeklyProgressItemOut.model_validate(item)


@router.delete("/{report_id}/progress-items/{item_id}")
async def delete_progress_item(
    report_id: int, item_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除周报进展事项"""
    item = await db.get(WeeklyProgressItem, item_id)
    if not item or item.is_delete or item.report_id != report_id:
        raise HTTPException(status_code=404, detail="进展事项不存在")
    item.is_delete = True
    await db.flush()
    return {"ok": True, "id": item_id}


# ---------- 风险 ----------
@router.post("/{report_id}/risks", response_model=WeeklyRiskOut)
async def create_risk(
    report_id: int,
    payload: WeeklyRiskCreate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyRiskOut:
    """新增周报风险"""
    report = await db.get(WeeklyReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="周报不存在")
    item = WeeklyRisk(report_id=report_id, **payload.model_dump())
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return WeeklyRiskOut.model_validate(item)


@router.put("/{report_id}/risks/{risk_id}", response_model=WeeklyRiskOut)
async def update_risk(
    report_id: int,
    risk_id: int,
    payload: WeeklyRiskUpdate,
    db: AsyncSession = Depends(get_db),
) -> WeeklyRiskOut:
    """更新周报风险"""
    item = await db.get(WeeklyRisk, risk_id)
    if not item or item.is_delete or item.report_id != report_id:
        raise HTTPException(status_code=404, detail="风险不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return WeeklyRiskOut.model_validate(item)


@router.delete("/{report_id}/risks/{risk_id}")
async def delete_risk(
    report_id: int, risk_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除周报风险"""
    item = await db.get(WeeklyRisk, risk_id)
    if not item or item.is_delete or item.report_id != report_id:
        raise HTTPException(status_code=404, detail="风险不存在")
    item.is_delete = True
    await db.flush()
    return {"ok": True, "id": risk_id}
