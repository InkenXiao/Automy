"""身份确认路由 · 姓名登录 (与 rag-cowork 同一 sys_users 共享用户体系)"""
import hashlib
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_user_name
from app.models import SysUser

router = APIRouter(prefix="/auth", tags=["身份确认"])


class LoginIn(BaseModel):
    name: str
    password: Optional[str] = None


class PasswordSetIn(BaseModel):
    old_password: Optional[str] = None
    new_password: str


def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return dk.hex()


async def _get_user(db: AsyncSession, name: str) -> Optional[SysUser]:
    result = await db.execute(
        select(SysUser).where(SysUser.is_delete.is_(False), SysUser.name == name, SysUser.is_active.is_(True))
    )
    return result.scalars().first()


def _payload(user: SysUser) -> dict:
    return {
        "ok": True,
        "name": user.name,
        "user_id": user.user_id,
        "display_name": user.display_name or user.name,
        "department": user.department,
        "has_password": bool(user.password_hash),
    }


@router.post("/login")
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)) -> dict:
    name = (payload.name or "").strip()
    if not name:
        return {"ok": False, "name": "", "msg": "请输入姓名"}
    user = await _get_user(db, name)
    if not user:
        return {"ok": False, "name": name, "msg": "用户未注册, 请联系管理员"}
    if user.password_hash:
        if not payload.password:
            return {"ok": False, "need_password": True, "name": name}
        salt, expected = user.password_hash.split("$", 1)
        if _hash_password(payload.password, salt) != expected:
            raise HTTPException(status_code=401, detail="密码错误")
    return _payload(user)


@router.get("/me")
async def me(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    name = get_user_name(request)
    if not name:
        return {"ok": False}
    user = await _get_user(db, name)
    if not user:
        return {"ok": False, "name": name}
    return _payload(user)


@router.post("/password")
async def set_password(payload: PasswordSetIn, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    name = get_user_name(request)
    if not name:
        raise HTTPException(status_code=403, detail="请先登录")
    user = await _get_user(db, name)
    if not user:
        raise HTTPException(status_code=403, detail="用户未注册")
    if user.password_hash:
        salt, expected = user.password_hash.split("$", 1)
        if not payload.old_password or _hash_password(payload.old_password, salt) != expected:
            raise HTTPException(status_code=403, detail="原密码错误")
    new_password = (payload.new_password or "").strip()
    if new_password:
        salt = secrets.token_hex(16)
        user.password_hash = f"{salt}${_hash_password(new_password, salt)}"
    else:
        user.password_hash = ""
    await db.commit()
    return {"ok": True, "has_password": bool(new_password)}
