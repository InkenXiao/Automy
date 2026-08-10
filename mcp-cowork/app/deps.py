"""共享依赖 · 当前用户识别 (X-User-Name 头, 与 rag-cowork 同一 sys_users 体系)"""
from urllib.parse import unquote

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import SysUser


def get_user_name(request: Request) -> str:
    raw = (request.headers.get("x-user-name") or "").strip()
    return unquote(raw) if raw else ""


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> SysUser | None:
    name = get_user_name(request)
    if not name:
        return None
    result = await db.execute(
        select(SysUser).where(SysUser.is_delete.is_(False), SysUser.name == name, SysUser.is_active.is_(True))
    )
    return result.scalars().first()


async def require_user(user: SysUser | None = Depends(get_current_user)) -> SysUser:
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user
