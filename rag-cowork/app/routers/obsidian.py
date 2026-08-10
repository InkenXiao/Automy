"""Obsidian 对接路由 · 个人知识库连接配置 (每人一条) / 连通性测试 / 笔记同步"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_kb_access, require_user
from app.models import RagKnowledgeBase, RagObsidianConfig, SysUser
from app.services import obsidian_service
from app.services.snowflake import generate_id

router = APIRouter(prefix="/obsidian", tags=["Obsidian对接"])


class ObsidianConfigIn(BaseModel):
    kb_id: int
    host: str = ""
    api_key: str = ""
    base_path: str = ""
    auto_parse: bool = True


def _config_dict(c: RagObsidianConfig) -> dict:
    return {
        "id": c.id,
        "user_id": c.user_id,
        "kb_id": c.kb_id,
        "host": c.host,
        "api_key": c.api_key,
        "base_path": c.base_path,
        "auto_parse": c.auto_parse,
        "last_sync_at": c.last_sync_at.isoformat() if c.last_sync_at else "",
        "last_sync_info": c.last_sync_info,
    }


async def _get_config(db: AsyncSession, user: SysUser) -> RagObsidianConfig | None:
    return (await db.execute(
        select(RagObsidianConfig).where(
            RagObsidianConfig.is_delete.is_(False), RagObsidianConfig.user_id == user.user_id
        )
    )).scalars().first()


@router.get("/config")
async def get_config(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """读取当前用户的 Obsidian 连接配置 (未配置返回 null)"""
    c = await _get_config(db, user)
    return {"config": _config_dict(c) if c else None}


@router.put("/config")
async def save_config(payload: ObsidianConfigIn, user: SysUser = Depends(require_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """保存/更新当前用户的 Obsidian 连接配置 (每人一条, 按 user_id upsert)"""
    kb = await db.get(RagKnowledgeBase, payload.kb_id)
    if not kb or kb.is_delete:
        raise HTTPException(status_code=404, detail="目标知识库不存在")
    if kb.level != "personal":
        raise HTTPException(status_code=400, detail="Obsidian 仅支持对接个人级知识库")
    await require_kb_access(db, payload.kb_id, user, write=True)

    c = await _get_config(db, user)
    if c is None:
        c = RagObsidianConfig(id=generate_id(), user_id=user.user_id)
        db.add(c)
    c.kb_id = payload.kb_id
    c.host = (payload.host or "").strip()
    c.api_key = (payload.api_key or "").strip()
    c.base_path = (payload.base_path or "").strip().strip("/")
    c.auto_parse = payload.auto_parse
    await db.commit()
    return {"ok": True, "config": _config_dict(c)}


@router.post("/test")
async def test(payload: ObsidianConfigIn | None = None, user: SysUser = Depends(require_user),
               db: AsyncSession = Depends(get_db)) -> dict:
    """测试连接: 优先用请求体中的 host/api_key, 否则用已保存配置"""
    host, api_key = "", ""
    if payload and (payload.host or payload.api_key):
        host, api_key = payload.host.strip(), payload.api_key.strip()
    else:
        c = await _get_config(db, user)
        if c:
            host, api_key = c.host, c.api_key
    if not host:
        raise HTTPException(status_code=400, detail="请先填写 Obsidian 地址")
    return await obsidian_service.test_connection(host, api_key)


@router.post("/sync")
async def sync(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """按当前用户的连接配置, 同步 Obsidian vault 的 Markdown 笔记到个人知识库"""
    c = await _get_config(db, user)
    if not c:
        raise HTTPException(status_code=400, detail="请先配置 Obsidian 连接")
    if not c.host or not c.api_key:
        raise HTTPException(status_code=400, detail="请完善 Obsidian 地址与 API Key")
    kb = await require_kb_access(db, c.kb_id, user, write=True)

    try:
        summary = await obsidian_service.sync_vault(c, user, kb)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"同步失败: {str(e)[:200]}") from e

    c.last_sync_at = datetime.now(timezone.utc)
    c.last_sync_info = (
        f"共{summary['total']}篇 · 新增{summary['created']} · "
        f"跳过{summary['skipped']} · 失败{summary['failed']}"
    )
    await db.commit()
    return {"ok": True, "summary": summary, "last_sync_info": c.last_sync_info}
