"""MCP 服务注册/健康检查/工具同步路由"""
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_user
from app.models import McpCallLog, McpServer, McpTool, SysUser
from app.services import mcp_client
from app.services.snowflake import generate_id

router = APIRouter(prefix="/servers", tags=["MCP 服务"])


def _extract_name_zh(description: str) -> str:
    """从工具描述提取中文名: 首行括号/冒号前的前缀 (含中文则用), 否则找首个中文短句"""
    first = (description or "").strip().split("\n")[0].strip()
    head = re.split(r"[（(:：]", first, maxsplit=1)[0].strip()
    if re.search(r"[一-鿿]", head):
        return head[:32]
    m = re.search(r"[一-鿿][一-鿿A-Za-z0-9_·/ -]{0,24}", first)
    return m.group(0).strip()[:32] if m else ""


class ServerIn(BaseModel):
    name: str
    base_url: str
    description: Optional[str] = ""


def _server_dict(s: McpServer, tool_count: int = 0) -> dict:
    return {
        "server_id": s.server_id,
        "name": s.name,
        "base_url": s.base_url,
        "transport": s.transport,
        "description": s.description,
        "status": s.status,
        "tool_count": tool_count,
        "created_at": s.created_at.isoformat() if s.created_at else "",
    }


@router.get("")
async def list_servers(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """服务列表 (本人注册的)"""
    result = await db.execute(
        select(McpServer).where(
            McpServer.is_delete.is_(False), McpServer.user_id == user.user_id
        ).order_by(McpServer.server_id)
    )
    servers = list(result.scalars().all())
    # 工具计数
    from sqlalchemy import func
    counts = dict((await db.execute(
        select(McpTool.server_id, func.count()).where(McpTool.is_delete.is_(False)).group_by(McpTool.server_id)
    )).all())
    return {"items": [_server_dict(s, counts.get(s.server_id, 0)) for s in servers]}


@router.post("")
async def create_server(payload: ServerIn, user: SysUser = Depends(require_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    name = (payload.name or "").strip()
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not name or not base_url:
        raise HTTPException(status_code=400, detail="名称与地址不能为空")
    server = McpServer(
        server_id=generate_id(), name=name, base_url=base_url,
        description=(payload.description or "").strip(), user_id=user.user_id,
    )
    db.add(server)
    await db.commit()
    return {"ok": True, "server": _server_dict(server)}


@router.put("/{server_id}")
async def update_server(server_id: int, payload: ServerIn, user: SysUser = Depends(require_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    server = await _own_server(db, server_id, user)
    if payload.name and payload.name.strip():
        server.name = payload.name.strip()
    if payload.base_url and payload.base_url.strip():
        server.base_url = payload.base_url.strip().rstrip("/")
    if payload.description is not None:
        server.description = payload.description.strip()
    await db.commit()
    return {"ok": True}


@router.delete("/{server_id}")
async def delete_server(server_id: int, user: SysUser = Depends(require_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    server = await _own_server(db, server_id, user)
    server.is_delete = True
    await db.commit()
    return {"ok": True}


@router.post("/{server_id}/health")
async def health_check(server_id: int, user: SysUser = Depends(require_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """健康检查: 尝试 list_tools, 成功置 online"""
    server = await _own_server(db, server_id, user)
    try:
        tools = await mcp_client.list_tools(server.base_url, user.name)
        server.status = "online"
        await db.commit()
        return {"ok": True, "status": "online", "tool_count": len(tools)}
    except Exception as e:  # noqa: BLE001
        server.status = "offline"
        await db.commit()
        return {"ok": False, "status": "offline", "error": mcp_client.flatten_exc(e)}


@router.post("/{server_id}/sync")
async def sync_tools(server_id: int, user: SysUser = Depends(require_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """同步 tools/list 快照到 mcp_tools (全量重建该服务快照)"""
    server = await _own_server(db, server_id, user)
    try:
        tools = await mcp_client.list_tools(server.base_url, user.name)
    except Exception as e:  # noqa: BLE001
        server.status = "offline"
        await db.commit()
        raise HTTPException(status_code=502, detail=f"工具同步失败: {mcp_client.flatten_exc(e, 200)}")
    server.status = "online"
    # 逻辑删旧快照 → 写入新快照
    old = (await db.execute(
        select(McpTool).where(McpTool.is_delete.is_(False), McpTool.server_id == server_id)
    )).scalars().all()
    for t in old:
        t.is_delete = True
    now = datetime.now(timezone.utc)
    for t in tools:
        db.add(McpTool(
            tool_id=generate_id(), server_id=server_id,
            tool_name=t["tool_name"], name_zh=_extract_name_zh(t["description"]),
            description=t["description"],
            input_schema=t["input_schema"], synced_at=now, user_id=user.user_id,
        ))
    await db.commit()
    return {"ok": True, "tool_count": len(tools)}


@router.get("/{server_id}/tools")
async def list_tools(server_id: int, user: SysUser = Depends(require_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """已同步的工具清单 (含中文名 + 每工具调用状态统计)"""
    await _own_server(db, server_id, user)
    tools = list((await db.execute(
        select(McpTool).where(
            McpTool.is_delete.is_(False), McpTool.server_id == server_id
        ).order_by(McpTool.tool_name)
    )).scalars().all())

    # 每工具调用统计 (本人全量日志, 按 tool_name 聚合)
    stat_rows = (await db.execute(
        select(
            McpCallLog.tool_name,
            func.count().label("total"),
            func.sum(case((McpCallLog.status == "success", 1), else_=0)).label("success"),
            func.avg(McpCallLog.latency_ms).label("avg_latency"),
            func.max(McpCallLog.created_at).label("last_at"),
        ).where(
            McpCallLog.is_delete.is_(False),
            McpCallLog.user_id == user.user_id,
            McpCallLog.server_id == server_id,
        ).group_by(McpCallLog.tool_name)
    )).all()
    stats = {r.tool_name: r for r in stat_rows}

    items = []
    for t in tools:
        st = stats.get(t.tool_name)
        total = int(st.total or 0) if st else 0
        success = int(st.success or 0) if st else 0
        # 状态: 未调用=unknown; 成功率>=90%=ok; >=50%=warn; 否则=bad
        if total == 0:
            call_status = "unknown"
        else:
            rate = success / total
            call_status = "ok" if rate >= 0.9 else ("warn" if rate >= 0.5 else "bad")
        items.append({
            "tool_id": t.tool_id, "tool_name": t.tool_name,
            "name_zh": t.name_zh or "",
            "description": t.description, "input_schema": t.input_schema,
            "synced_at": t.synced_at.isoformat() if t.synced_at else "",
            "call_total": total,
            "call_success_rate": round(success / total * 100, 1) if total else 0.0,
            "call_avg_latency_ms": int(st.avg_latency or 0) if st else 0,
            "call_status": call_status,
        })
    return {"items": items}


class ToolZhIn(BaseModel):
    name_zh: str


@router.put("/{server_id}/tools/{tool_id}")
async def update_tool_zh(server_id: int, tool_id: int, payload: ToolZhIn,
                         user: SysUser = Depends(require_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """手工修改工具中文名"""
    await _own_server(db, server_id, user)
    tool = await db.get(McpTool, tool_id)
    if not tool or tool.is_delete or tool.server_id != server_id:
        raise HTTPException(status_code=404, detail="工具不存在")
    tool.name_zh = (payload.name_zh or "").strip()[:32]
    await db.commit()
    return {"ok": True, "name_zh": tool.name_zh}


async def _own_server(db: AsyncSession, server_id: int, user: SysUser) -> McpServer:
    server = await db.get(McpServer, server_id)
    if not server or server.is_delete:
        raise HTTPException(status_code=404, detail="MCP 服务不存在")
    if server.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="仅注册人可操作该服务")
    return server
