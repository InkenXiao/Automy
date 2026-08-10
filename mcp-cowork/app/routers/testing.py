"""MCP 在线测试路由 · 工具调用 / 用例保存与回放"""
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_user
from app.models import McpCallLog, McpServer, McpTestCase, SysUser
from app.services import mcp_client
from app.services.snowflake import generate_id

router = APIRouter(prefix="/testing", tags=["在线测试"])


class CallIn(BaseModel):
    server_id: int
    tool_name: str
    params: dict = {}


class CaseIn(BaseModel):
    server_id: int
    tool_name: str
    case_name: str
    params: dict = {}


def _case_dict(c: McpTestCase) -> dict:
    return {
        "case_id": c.case_id, "server_id": c.server_id, "tool_name": c.tool_name,
        "case_name": c.case_name, "params": c.params,
        "last_status": c.last_status,
        "created_at": c.created_at.isoformat() if c.created_at else "",
    }


async def _get_server(db: AsyncSession, server_id: int) -> McpServer:
    server = await db.get(McpServer, server_id)
    if not server or server.is_delete:
        raise HTTPException(status_code=404, detail="MCP 服务不存在")
    return server


async def _do_call(db: AsyncSession, user: SysUser, server: McpServer,
                   tool_name: str, params: dict) -> dict:
    """执行调用 + 写调用日志"""
    started = time.time()
    try:
        result = await mcp_client.call_tool(server.base_url, tool_name, params, user.name)
        status = "error" if result["is_error"] else "success"
        excerpt = (result["text"] or "")[:1000]
    except Exception as e:  # noqa: BLE001
        err_text = mcp_client.flatten_exc(e, 1000)
        result = {"is_error": True, "text": err_text, "data": None}
        status = "error"
        excerpt = err_text
    latency = int((time.time() - started) * 1000)
    db.add(McpCallLog(
        log_id=generate_id(), server_id=server.server_id, tool_name=tool_name,
        params=params, result_excerpt=excerpt, latency_ms=latency,
        status=status, user_id=user.user_id,
    ))
    await db.commit()
    return {**result, "status": status, "latency_ms": latency}


@router.post("/call")
async def call_tool(payload: CallIn, user: SysUser = Depends(require_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """在线调用工具 (写 mcp_call_logs)"""
    server = await _get_server(db, payload.server_id)
    return await _do_call(db, user, server, payload.tool_name, payload.params or {})


@router.get("/cases")
async def list_cases(server_id: int, user: SysUser = Depends(require_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """本人保存的用例列表"""
    result = await db.execute(
        select(McpTestCase).where(
            McpTestCase.is_delete.is_(False),
            McpTestCase.server_id == server_id,
            McpTestCase.user_id == user.user_id,
        ).order_by(McpTestCase.case_id.desc())
    )
    return {"items": [_case_dict(c) for c in result.scalars().all()]}


@router.post("/cases")
async def save_case(payload: CaseIn, user: SysUser = Depends(require_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    await _get_server(db, payload.server_id)
    if not (payload.case_name or "").strip():
        raise HTTPException(status_code=400, detail="用例名称不能为空")
    case = McpTestCase(
        case_id=generate_id(), server_id=payload.server_id,
        tool_name=payload.tool_name, case_name=payload.case_name.strip(),
        params=payload.params or {}, user_id=user.user_id,
    )
    db.add(case)
    await db.commit()
    return {"ok": True, "case": _case_dict(case)}


@router.post("/cases/{case_id}/run")
async def run_case(case_id: int, user: SysUser = Depends(require_user),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """回放用例 (结果回写用例)"""
    case = await db.get(McpTestCase, case_id)
    if not case or case.is_delete or case.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="用例不存在")
    server = await _get_server(db, case.server_id)
    result = await _do_call(db, user, server, case.tool_name, case.params or {})
    case.last_status = result["status"]
    case.last_result = {"text": result["text"][:2000], "latency_ms": result["latency_ms"]}
    await db.commit()
    return result


@router.delete("/cases/{case_id}")
async def delete_case(case_id: int, user: SysUser = Depends(require_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    case = await db.get(McpTestCase, case_id)
    if case and not case.is_delete and case.user_id == user.user_id:
        case.is_delete = True
        await db.commit()
    return {"ok": True}
