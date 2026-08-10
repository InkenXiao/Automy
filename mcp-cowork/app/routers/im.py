"""个人 IM 通道路由 · 配置维护 / 测试发送 / 分身推送入口"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_user
from app.models import McpImChannel, SysUser
from app.services import im_service
from app.services.snowflake import generate_id

router = APIRouter(prefix="/im", tags=["IM 通道"])

_VALID_TYPES = {t["type"] for t in im_service.CHANNEL_TYPES}


class ChannelIn(BaseModel):
    channel_type: str
    name: str
    config: dict = {}
    enabled: bool = True


class SendIn(BaseModel):
    message: str
    channel_id: Optional[int] = None


def _dict(c: McpImChannel) -> dict:
    return {
        "channel_id": c.channel_id,
        "channel_type": c.channel_type,
        "type_name": im_service.type_name(c.channel_type),
        "name": c.name,
        "config": c.config or {},
        "enabled": c.enabled,
        "last_test_at": c.last_test_at.isoformat() if c.last_test_at else "",
        "last_test_status": c.last_test_status or "",
        "last_test_error": c.last_test_error or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
    }


@router.get("/types")
async def types() -> dict:
    """通道类型元数据 (前端表单渲染依据)"""
    return {"items": im_service.CHANNEL_TYPES}


@router.get("")
async def list_channels(user: SysUser = Depends(require_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """本人 IM 通道列表"""
    result = await db.execute(
        select(McpImChannel).where(
            McpImChannel.is_delete.is_(False), McpImChannel.user_id == user.user_id
        ).order_by(McpImChannel.channel_id)
    )
    return {"items": [_dict(c) for c in result.scalars().all()]}


@router.post("")
async def create_channel(payload: ChannelIn, user: SysUser = Depends(require_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    if payload.channel_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"不支持的通道类型: {payload.channel_type}")
    if not (payload.name or "").strip():
        raise HTTPException(status_code=400, detail="通道名称不能为空")
    ch = McpImChannel(
        channel_id=generate_id(), user_id=user.user_id,
        channel_type=payload.channel_type, name=payload.name.strip(),
        config=payload.config or {}, enabled=payload.enabled,
    )
    db.add(ch)
    await db.commit()
    return {"ok": True, "channel": _dict(ch)}


async def _own(db: AsyncSession, channel_id: int, user: SysUser) -> McpImChannel:
    ch = await db.get(McpImChannel, channel_id)
    if not ch or ch.is_delete or ch.user_id != user.user_id:
        raise HTTPException(status_code=404, detail="通道不存在")
    return ch


@router.put("/{channel_id}")
async def update_channel(channel_id: int, payload: ChannelIn,
                         user: SysUser = Depends(require_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    ch = await _own(db, channel_id, user)
    if payload.channel_type in _VALID_TYPES:
        ch.channel_type = payload.channel_type
    if (payload.name or "").strip():
        ch.name = payload.name.strip()
    ch.config = payload.config or {}
    ch.enabled = payload.enabled
    await db.commit()
    return {"ok": True}


@router.delete("/{channel_id}")
async def delete_channel(channel_id: int, user: SysUser = Depends(require_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    ch = await _own(db, channel_id, user)
    ch.is_delete = True
    await db.commit()
    return {"ok": True}


@router.post("/{channel_id}/test")
async def test_channel(channel_id: int, user: SysUser = Depends(require_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """测试发送一条消息, 结果回写 last_test_*"""
    ch = await _own(db, channel_id, user)
    text = f"[测试] {user.display_name or user.name} 的 {im_service.type_name(ch.channel_type)} 通道连通正常 · {datetime.now().strftime('%H:%M:%S')}"
    try:
        resp = await im_service.send(ch.channel_type, ch.config or {}, text)
        ch.last_test_status = "success"
        ch.last_test_error = ""
    except Exception as e:  # noqa: BLE001
        ch.last_test_status = "error"
        ch.last_test_error = str(e)[:500]
        await db.commit()
        return {"ok": False, "error": str(e)[:300]}
    ch.last_test_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "response": resp}


@router.post("/send")
async def send_message(payload: SendIn, user: SysUser = Depends(require_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """数字分身 send_im 推送入口: 向本人启用通道发消息 (可指定单条通道)"""
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="消息内容不能为空")
    stmt = select(McpImChannel).where(
        McpImChannel.is_delete.is_(False),
        McpImChannel.user_id == user.user_id,
        McpImChannel.enabled.is_(True),
    )
    if payload.channel_id is not None:
        stmt = stmt.where(McpImChannel.channel_id == payload.channel_id)
    channels = list((await db.execute(stmt)).scalars().all())
    if not channels:
        return {"ok": False, "sent": 0, "error": "无可用 IM 通道, 请先到技链工坊配置"}
    results = []
    sent = 0
    for ch in channels:
        try:
            resp = await im_service.send(ch.channel_type, ch.config or {}, message)
            results.append({"channel_id": ch.channel_id, "name": ch.name, "ok": True,
                            "response": resp})
            sent += 1
        except Exception as e:  # noqa: BLE001
            results.append({"channel_id": ch.channel_id, "name": ch.name, "ok": False,
                            "error": str(e)[:200]})
    return {"ok": sent > 0, "sent": sent, "total": len(channels), "results": results}
