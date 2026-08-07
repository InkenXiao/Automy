"""使用日志看板路由 · 登录/操作统计 + 两级下钻 (需求: 使用日志看板)

- GET /stats      按周期统计: 登录人次/人数、各实体写操作计数、LLM 调用与 token (所有人可见)
- GET /details    一级下钻: 某实体类型按 实体ID+动作 聚合的明细 (非项目经理仅本人数据)
- GET /operations 二级下钻: 操作记录列表 (created_at 倒序, 限 200 条; 非项目经理仅本人数据)

周期: day=当天 week=当周(周一起) month=当月; 阈值按北京时间 (UTC+8) 计算
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import Integer, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_user_name, is_any_project_manager
from app.models.usage_log import LoginLog, OperationLog

router = APIRouter(prefix="/usage-logs", tags=["使用日志"])

CN_TZ = timezone(timedelta(hours=8))
LOGIN_ENTITY = "登录"


def _period_start(period: str) -> datetime:
    """周期起点 (北京时间): day=今天0点 / week=周一0点 / month=本月1号0点"""
    now = datetime.now(CN_TZ)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "day":
        return day_start
    if period == "week":
        return day_start - timedelta(days=now.weekday())
    if period == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    raise HTTPException(status_code=400, detail="period 仅支持 day/week/month")


@router.get("/stats")
async def get_stats(period: str = "day", db: AsyncSession = Depends(get_db)) -> dict:
    """顶部统计卡片 + 分类汇总 (写操作按 实体×动作 计数; LLM 按来源统计调用与 token)"""
    start = _period_start(period)

    # 登录: 人次 + 人数
    login_count = (
        await db.execute(
            select(func.count(LoginLog.id)).where(
                LoginLog.is_delete.is_(False), LoginLog.created_at >= start
            )
        )
    ).scalar_one()
    login_users = (
        await db.execute(
            select(func.count(func.distinct(LoginLog.user_name))).where(
                LoginLog.is_delete.is_(False), LoginLog.created_at >= start
            )
        )
    ).scalar_one()

    # 写操作分组 (不含 llm_call)
    write_rows = (
        await db.execute(
            select(
                OperationLog.entity_type,
                OperationLog.action,
                func.count(OperationLog.id).label("cnt"),
            )
            .where(
                OperationLog.is_delete.is_(False),
                OperationLog.created_at >= start,
                OperationLog.action != "llm_call",
            )
            .group_by(OperationLog.entity_type, OperationLog.action)
            .order_by(OperationLog.entity_type, OperationLog.action)
        )
    ).all()
    writes = [
        {"entity_type": r.entity_type, "action": r.action, "count": r.cnt}
        for r in write_rows
    ]

    # LLM 调用分组 (按来源 entity_type: 数字分身/技能/周报概括/会议纪要)
    llm_rows = (
        await db.execute(
            select(
                OperationLog.entity_type,
                func.count(OperationLog.id).label("calls"),
                func.coalesce(func.sum(OperationLog.tokens), 0).label("tokens"),
            )
            .where(
                OperationLog.is_delete.is_(False),
                OperationLog.created_at >= start,
                OperationLog.action == "llm_call",
            )
            .group_by(OperationLog.entity_type)
            .order_by(OperationLog.entity_type)
        )
    ).all()
    llm = [
        {"entity_type": r.entity_type, "calls": r.calls, "tokens": int(r.tokens)}
        for r in llm_rows
    ]

    return {
        "period": period,
        "start": start.isoformat(),
        "login_count": int(login_count),
        "login_users": int(login_users),
        "write_count": sum(w["count"] for w in writes),
        "llm_calls": sum(item["calls"] for item in llm),
        "llm_tokens": sum(item["tokens"] for item in llm),
        "writes": writes,
        "llm": llm,
    }


@router.get("/details")
async def get_details(
    request: Request,
    period: str = "day",
    entity_type: str = "",
    db: AsyncSession = Depends(get_db),
) -> dict:
    """一级下钻: 指定实体类型按 实体ID+动作 聚合 (count + 最近时间 + 操作人数)

    权限: 项目经理看全部; 其它成员仅本人数据 (强制按登录人过滤)
    """
    if not entity_type:
        raise HTTPException(status_code=400, detail="缺少 entity_type")
    start = _period_start(period)

    # 非项目经理: 强制仅本人
    name = get_user_name(request)
    only_self = not await is_any_project_manager(db, name)

    # 登录日志单独下钻: 按登录人聚合
    if entity_type == LOGIN_ENTITY:
        stmt = (
            select(
                LoginLog.user_name,
                func.count(LoginLog.id).label("cnt"),
                func.max(LoginLog.created_at).label("last_at"),
                func.coalesce(func.sum(LoginLog.is_valid.cast(Integer)), 0).label("valid_cnt"),
            )
            .where(LoginLog.is_delete.is_(False), LoginLog.created_at >= start)
            .group_by(LoginLog.user_name)
            .order_by(func.max(LoginLog.created_at).desc())
        )
        if only_self:
            stmt = stmt.where(LoginLog.user_name == name)
        rows = (await db.execute(stmt)).all()
        return {
            "period": period,
            "entity_type": entity_type,
            "only_self": only_self,
            "items": [
                {
                    "entity_id": None,
                    "action": "login",
                    "user_name": r.user_name,
                    "count": r.cnt,
                    "valid_count": int(r.valid_cnt),
                    "last_at": r.last_at.isoformat() if r.last_at else "",
                }
                for r in rows
            ],
        }

    stmt = (
        select(
            OperationLog.entity_id,
            OperationLog.action,
            func.count(OperationLog.id).label("cnt"),
            func.max(OperationLog.created_at).label("last_at"),
            func.count(func.distinct(OperationLog.user_name)).label("users"),
            func.coalesce(func.sum(OperationLog.tokens), 0).label("tokens"),
        )
        .where(
            OperationLog.is_delete.is_(False),
            OperationLog.created_at >= start,
            OperationLog.entity_type == entity_type,
        )
        .group_by(OperationLog.entity_id, OperationLog.action)
        .order_by(func.max(OperationLog.created_at).desc())
    )
    if only_self:
        stmt = stmt.where(OperationLog.user_name == name)
    rows = (await db.execute(stmt)).all()
    return {
        "period": period,
        "entity_type": entity_type,
        "only_self": only_self,
        "items": [
            {
                "entity_id": r.entity_id,
                "action": r.action,
                "count": r.cnt,
                "users": r.users,
                "tokens": int(r.tokens),
                "last_at": r.last_at.isoformat() if r.last_at else "",
            }
            for r in rows
        ],
    }


@router.get("/operations")
async def get_operations(
    request: Request,
    period: str = "day",
    entity_type: str = "",
    entity_id: Optional[int] = None,
    action: str = "",
    user_name: str = "",
    db: AsyncSession = Depends(get_db),
) -> dict:
    """二级下钻: 操作记录列表 (created_at 倒序, 限 200 条)

    权限: 项目经理看全部 (可按 user_name 过滤); 其它成员仅本人数据 (user_name 参数被忽略)
    """
    start = _period_start(period)

    # 非项目经理: 强制仅本人
    name = get_user_name(request)
    only_self = not await is_any_project_manager(db, name)
    if only_self:
        user_name = name

    # 登录日志单独查询
    if entity_type == LOGIN_ENTITY:
        stmt = (
            select(LoginLog)
            .where(LoginLog.is_delete.is_(False), LoginLog.created_at >= start)
            .order_by(LoginLog.created_at.desc(), LoginLog.id.desc())
            .limit(200)
        )
        if user_name:
            stmt = stmt.where(LoginLog.user_name == user_name)
        rows = (await db.execute(stmt)).scalars().all()
        return {
            "period": period,
            "entity_type": entity_type,
            "only_self": only_self,
            "items": [
                {
                    "id": r.id,
                    "user_name": r.user_name,
                    "method": "",
                    "path": "",
                    "entity_type": LOGIN_ENTITY,
                    "entity_id": None,
                    "action": "login" if r.is_valid else "login_invalid",
                    "detail": f"ip={r.ip}" if r.ip else "",
                    "tokens": 0,
                    "created_at": r.created_at.isoformat() if r.created_at else "",
                }
                for r in rows
            ],
        }

    stmt = (
        select(OperationLog)
        .where(OperationLog.is_delete.is_(False), OperationLog.created_at >= start)
        .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        .limit(200)
    )
    if entity_type:
        stmt = stmt.where(OperationLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(OperationLog.entity_id == entity_id)
    if action:
        stmt = stmt.where(OperationLog.action == action)
    if user_name:
        stmt = stmt.where(OperationLog.user_name == user_name)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "period": period,
        "entity_type": entity_type,
        "items": [
            {
                "id": r.id,
                "user_name": r.user_name,
                "method": r.method,
                "path": r.path,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "action": r.action,
                "detail": r.detail,
                "tokens": r.tokens,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in rows
        ],
    }
