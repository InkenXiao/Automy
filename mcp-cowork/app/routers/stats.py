"""MCP 调用统计路由 · 基于 mcp_call_logs 聚合"""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_user
from app.models import McpCallLog, McpServer, McpTool, SysUser

router = APIRouter(prefix="/stats", tags=["统计"])


@router.get("/overview")
async def overview(server_id: Optional[int] = None, tool_name: Optional[str] = None,
                   user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """总览: 服务数/工具数/调用量/成功率/平均延迟 (可按服务/工具过滤)"""
    server_count = (await db.execute(
        select(func.count()).select_from(McpServer).where(
            McpServer.is_delete.is_(False), McpServer.user_id == user.user_id
        )
    )).scalar() or 0

    tool_q = select(func.count()).select_from(McpTool).where(McpTool.is_delete.is_(False))
    if server_id is not None:
        tool_q = tool_q.where(McpTool.server_id == server_id)
    tool_count = (await db.execute(tool_q)).scalar() or 0

    base = select(
        func.count().label("total"),
        func.sum(case((McpCallLog.status == "success", 1), else_=0)).label("success"),
        func.avg(McpCallLog.latency_ms).label("avg_latency"),
        func.max(McpCallLog.created_at).label("last_at"),
    ).where(McpCallLog.is_delete.is_(False), McpCallLog.user_id == user.user_id)
    if server_id is not None:
        base = base.where(McpCallLog.server_id == server_id)
    if tool_name:
        base = base.where(McpCallLog.tool_name == tool_name)
    row = (await db.execute(base)).first()
    total = int(row.total or 0)
    success = int(row.success or 0)
    return {
        "server_count": server_count,
        "tool_count": tool_count,
        "call_count": total,
        "success_rate": round(success / total * 100, 1) if total else 0.0,
        "avg_latency_ms": int(row.avg_latency or 0),
        "last_call_at": row.last_at.isoformat() if row.last_at else "",
    }


@router.get("/by-tool")
async def by_tool(server_id: Optional[int] = None, user: SysUser = Depends(require_user),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """按工具分布: 调用次数/成功率/平均延迟 (可按服务过滤)"""
    stmt = select(
        McpCallLog.tool_name,
        func.count().label("total"),
        func.sum(case((McpCallLog.status == "success", 1), else_=0)).label("success"),
        func.avg(McpCallLog.latency_ms).label("avg_latency"),
    ).where(McpCallLog.is_delete.is_(False), McpCallLog.user_id == user.user_id)
    if server_id is not None:
        stmt = stmt.where(McpCallLog.server_id == server_id)
    rows = (await db.execute(
        stmt.group_by(McpCallLog.tool_name)
        .order_by(func.count().desc())
        .limit(20)
    )).all()
    return {
        "items": [
            {
                "tool_name": r.tool_name or "(health)",
                "total": int(r.total or 0),
                "success_rate": round(int(r.success or 0) / int(r.total) * 100, 1) if r.total else 0.0,
                "avg_latency_ms": int(r.avg_latency or 0),
            }
            for r in rows
        ]
    }


@router.get("/logs")
async def logs(server_id: Optional[int] = None, tool_name: Optional[str] = None,
               user: SysUser = Depends(require_user),
               db: AsyncSession = Depends(get_db)) -> dict:
    """最近 100 条调用日志 (可按 server_id / tool_name 过滤; 含入参详情)"""
    stmt = (
        select(McpCallLog, McpServer.name)
        .join(McpServer, McpServer.server_id == McpCallLog.server_id)
        .where(McpCallLog.is_delete.is_(False), McpCallLog.user_id == user.user_id)
    )
    if server_id is not None:
        stmt = stmt.where(McpCallLog.server_id == server_id)
    if tool_name:
        stmt = stmt.where(McpCallLog.tool_name == tool_name)
    result = await db.execute(stmt.order_by(McpCallLog.log_id.desc()).limit(100))
    return {
        "items": [
            {
                "log_id": l.log_id, "server_id": l.server_id, "server_name": sname,
                "tool_name": l.tool_name, "params": l.params or {},
                "status": l.status, "latency_ms": l.latency_ms,
                "result_excerpt": (l.result_excerpt or "")[:200],
                "created_at": l.created_at.isoformat() if l.created_at else "",
            }
            for l, sname in result.all()
        ]
    }
