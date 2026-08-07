"""个人周报路由 · 项目驾驶舱-个人周报填写页 (全量保存: 子表整体替换)

填写限制 (需求: 成员状态): 退出状态成员不能填写该项目周报; 非项目成员同样禁止
可见性限制 (需求: 本人周报): 非项目经理仅能查看/填写本人周报; 项目经理可查看/代填全部
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.database import get_db
from app.deps import (
    get_user_name,
    is_any_project_manager,
    is_project_manager,
    resolve_visible_project_id,
)
from app.models.personal_report import (
    PersonalReport,
    PersonalReportPlanItem,
    PersonalReportWorkItem,
)
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.schemas.personal_report import (
    PersonalReportCreate,
    PersonalReportOut,
    PersonalReportUpdate,
)
from app.utils import resolve_project_id

router = APIRouter(prefix="/personal-reports", tags=["个人周报"])


async def _is_pm(db: AsyncSession, project_id: int, name: str) -> bool:
    """当前用户是否该项目经理"""
    project = await db.get(Project, project_id)
    return is_project_manager(project, name)


async def _check_member_can_report(db: AsyncSession, project_id: int, member_name: str) -> None:
    """校验成员可填写该项目周报: 必须是项目成员且状态不为 退出"""
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.is_delete.is_(False),
            ProjectMember.project_id == project_id,
            ProjectMember.name == member_name,
        )
    )
    member = result.scalars().first()
    if not member:
        raise HTTPException(status_code=403, detail="该人员不是项目成员, 不能填写周报")
    if (member.status or "全职") == "退出":
        raise HTTPException(status_code=403, detail="已退出成员不能填写该项目周报")


async def _check_report_visible(
    db: AsyncSession, report: PersonalReport, name: str
) -> None:
    """校验当前用户可操作该周报: 本人或该项目经理, 否则 403"""
    if (report.member_name or "").strip() == name:
        return
    if await _is_pm(db, report.project_id, name):
        return
    raise HTTPException(status_code=403, detail="仅本人或项目经理可操作该周报")


def _with_items(stmt):
    """加载子表的统一 options (过滤逻辑删除)"""
    return stmt.options(
        selectinload(PersonalReport.work_items),
        selectinload(PersonalReport.plan_items),
        with_loader_criteria(PersonalReportWorkItem, PersonalReportWorkItem.is_delete.is_(False)),
        with_loader_criteria(PersonalReportPlanItem, PersonalReportPlanItem.is_delete.is_(False)),
    )


def _to_out(report: PersonalReport) -> PersonalReportOut:
    """ORM → 输出 schema, 顺带计算本周总工时"""
    out = PersonalReportOut.model_validate(report)
    out.total_hours = round(sum(w.hours or 0 for w in out.work_items), 2)
    return out


async def _load_report(db: AsyncSession, report_id: int) -> PersonalReport:
    stmt = _with_items(
        select(PersonalReport).where(
            PersonalReport.id == report_id, PersonalReport.is_delete.is_(False)
        )
    ).execution_options(populate_existing=True)
    result = await db.execute(stmt)
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="个人周报不存在")
    return report


def _item_kwargs(item, idx: int) -> dict:
    """子表行 → ORM 构造参数; sort_order 缺省时按行序"""
    data = item.model_dump()
    data["sort_order"] = item.sort_order or idx
    return data


def _replace_items(report: PersonalReport, payload: PersonalReportUpdate) -> None:
    """子表全量替换: 旧行逻辑删除, 新行整体插入"""
    if payload.work_items is not None:
        for w in report.work_items:
            w.is_delete = True
        for i, w in enumerate(payload.work_items):
            report.work_items.append(PersonalReportWorkItem(**_item_kwargs(w, i)))
    if payload.plan_items is not None:
        for p in report.plan_items:
            p.is_delete = True
        for i, p in enumerate(payload.plan_items):
            report.plan_items.append(PersonalReportPlanItem(**_item_kwargs(p, i)))


@router.get("/", response_model=list[PersonalReportOut])
async def list_personal_reports(
    request: Request,
    member_name: Optional[str] = None,
    week_start: Optional[date] = None,
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> list[PersonalReportOut]:
    """个人周报列表 (按 week_start 倒序; 支持 member_name / week_start / project_id 过滤)

    可见性 (需求: 本人周报): 无所属项目者返回空; 非项目经理强制仅本人 (member_name 参数被忽略)
    """
    name = get_user_name(request)
    pid = await resolve_visible_project_id(db, name, project_id)
    if pid is None:
        return []
    stmt = _with_items(
        select(PersonalReport)
        .where(PersonalReport.is_delete.is_(False), PersonalReport.project_id == pid)
        .order_by(PersonalReport.week_start.desc(), PersonalReport.id.desc())
    )
    # 非项目经理: 强制仅本人
    if not await is_any_project_manager(db, name):
        member_name = name
    if member_name:
        stmt = stmt.where(PersonalReport.member_name == member_name)
    if week_start:
        stmt = stmt.where(PersonalReport.week_start == week_start)
    result = await db.execute(stmt)
    return [_to_out(r) for r in result.scalars().all()]


@router.get("/{report_id}", response_model=PersonalReportOut)
async def get_personal_report(
    report_id: int, request: Request, db: AsyncSession = Depends(get_db)
) -> PersonalReportOut:
    """个人周报详情 (含子表与总工时); 仅本人或该项目经理可见"""
    report = await _load_report(db, report_id)
    await _check_report_visible(db, report, get_user_name(request))
    return _to_out(report)


@router.post("/", response_model=PersonalReportOut)
async def create_personal_report(
    payload: PersonalReportCreate, request: Request, db: AsyncSession = Depends(get_db)
) -> PersonalReportOut:
    """新建个人周报 (含完整子表); 同项目同人员同周已存在则 409; 退出成员禁止填写

    权限: 非项目经理仅能为本人新建 (member_name 必须等于登录姓名)
    """
    data = payload.model_dump(exclude={"work_items", "plan_items"})
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    name = get_user_name(request)
    if (data["member_name"] or "").strip() != name and not await _is_pm(db, data["project_id"], name):
        raise HTTPException(status_code=403, detail="仅本人或项目经理可创建该周报")
    await _check_member_can_report(db, data["project_id"], data["member_name"])

    dup = await db.execute(
        select(PersonalReport).where(
            PersonalReport.is_delete.is_(False),
            PersonalReport.project_id == data["project_id"],
            PersonalReport.member_name == data["member_name"],
            PersonalReport.week_start == data["week_start"],
        )
    )
    if dup.scalars().first():
        raise HTTPException(status_code=409, detail="该人员本周已有周报, 请直接编辑")

    report = PersonalReport(**data)
    for i, w in enumerate(payload.work_items):
        report.work_items.append(PersonalReportWorkItem(**_item_kwargs(w, i)))
    for i, p in enumerate(payload.plan_items):
        report.plan_items.append(PersonalReportPlanItem(**_item_kwargs(p, i)))
    db.add(report)
    await db.flush()
    return _to_out(await _load_report(db, report.id))


@router.put("/{report_id}", response_model=PersonalReportOut)
async def update_personal_report(
    report_id: int, payload: PersonalReportUpdate, request: Request, db: AsyncSession = Depends(get_db)
) -> PersonalReportOut:
    """更新个人周报 (子表全量替换); 显式提交保证紧随的读取拿到最新值

    权限: 仅本人或该项目经理; 退出成员禁止填写
    """
    report = await _load_report(db, report_id)
    await _check_report_visible(db, report, get_user_name(request))
    await _check_member_can_report(db, report.project_id, report.member_name)
    _replace_items(report, payload)
    await db.flush()
    await db.commit()
    return _to_out(await _load_report(db, report_id))


@router.delete("/{report_id}")
async def delete_personal_report(
    report_id: int, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除个人周报 (逻辑删除); 仅本人或该项目经理"""
    report = await db.get(PersonalReport, report_id)
    if not report or report.is_delete:
        raise HTTPException(status_code=404, detail="个人周报不存在")
    await _check_report_visible(db, report, get_user_name(request))
    report.is_delete = True
    await db.commit()
    return {"ok": True, "id": report_id}
