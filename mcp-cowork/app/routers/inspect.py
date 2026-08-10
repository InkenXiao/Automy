"""工具巡检路由 · 手动触发 / 历史报告查询"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_user
from app.models import McpInspectReport, SysUser
from app.services import inspect_service

router = APIRouter(prefix="/inspect", tags=["工具巡检"])


def _brief(r: McpInspectReport) -> dict:
    return {
        "report_id": r.report_id,
        "trigger_type": r.trigger_type,
        "verdict": r.verdict,
        "summary": r.summary or {},
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }


@router.post("/run")
async def run(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """手动执行一次巡检 (健康检查 + 工具快照 diff + 用例回归)"""
    report = await inspect_service.run_for_user(db, user, trigger="manual")
    return {"ok": True, "report": {**_brief(report), "detail": report.detail or {}}}


@router.get("/latest")
async def latest(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """最近一份巡检报告 (含明细)"""
    r = (await db.execute(
        select(McpInspectReport).where(
            McpInspectReport.is_delete.is_(False), McpInspectReport.user_id == user.user_id
        ).order_by(McpInspectReport.report_id.desc()).limit(1)
    )).scalars().first()
    if not r:
        return {"report": None}
    return {"report": {**_brief(r), "detail": r.detail or {}}}


@router.get("/reports")
async def reports(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """巡检历史 (最近 20 份, 摘要)"""
    result = await db.execute(
        select(McpInspectReport).where(
            McpInspectReport.is_delete.is_(False), McpInspectReport.user_id == user.user_id
        ).order_by(McpInspectReport.report_id.desc()).limit(20)
    )
    return {"items": [_brief(r) for r in result.scalars().all()]}
