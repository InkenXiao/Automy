"""身份确认路由 · 姓名登录 (可选密码); 无效姓名允许进入但无任何项目数据

密码逻辑 (需求: 密码设置):
- 成员未设置密码: 姓名直登
- 成员已设置密码: 登录需携带 password; 仅姓名登录时返回 need_password=true 由前端弹出密码框
- 密码加盐 pbkdf2 哈希存储于 user_credentials (按姓名唯一)
"""
import hashlib
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_memberships, get_user_name
from app.models.project import Project
from app.models.usage_log import LoginLog
from app.models.user_credential import UserCredential

router = APIRouter(prefix="/auth", tags=["身份确认"])


class LoginIn(BaseModel):
    """登录请求 (password 可选; 已设密码的成员必填)"""

    name: str
    password: Optional[str] = None


class PasswordSetIn(BaseModel):
    """设置/修改密码请求 (已设密码时需提供 old_password 校验)"""

    old_password: Optional[str] = None
    new_password: str


def _hash_password(password: str, salt: str) -> str:
    """pbkdf2-sha256 加盐哈希 (10 万次迭代)"""
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000
    )
    return dk.hex()


async def _get_credential(db: AsyncSession, name: str) -> Optional[UserCredential]:
    """按姓名取登录凭据 (未设置过密码 → None)"""
    result = await db.execute(
        select(UserCredential).where(
            UserCredential.is_delete.is_(False), UserCredential.name == name
        )
    )
    return result.scalars().first()


async def _user_payload(db: AsyncSession, name: str) -> dict:
    """组装登录响应: 归属项目列表 (含成员角色/状态与项目经理标记)"""
    memberships = await get_memberships(db, name)
    projects = []
    for m in memberships:
        project = await db.get(Project, m.project_id)
        if not project or project.is_delete:
            continue
        projects.append({
            "id": project.id,
            "name": project.name,
            "title": project.title,
            "role": m.role or "",
            "member_status": m.status or "全职",
            "is_manager": (project.manager or "").strip() == name,
            "is_active": project.is_active,
        })
    return {
        "ok": len(projects) > 0,
        "name": name,
        "projects": projects,
    }


@router.post("/login")
async def login(payload: LoginIn, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """姓名登录: 命中项目成员→返回归属项目; 未命中→ok=false 且 projects 为空 (仍允许进入)

    已设密码的成员: 未带 password 时返回 need_password=true (不记录登录日志);
    密码错误 → 401 并记录无效登录。
    """
    name = (payload.name or "").strip()

    # 密码校验分支
    cred = await _get_credential(db, name) if name else None
    if cred and cred.password_hash:
        if not payload.password:
            # 需要密码但未提供: 提示前端弹密码框, 不记日志
            return {"ok": False, "need_password": True, "name": name, "projects": []}
        salt, expected = cred.password_hash.split("$", 1)
        if _hash_password(payload.password, salt) != expected:
            db.add(LoginLog(
                user_name=name,
                is_valid=False,
                ip=request.client.host if request.client else "",
                user_agent=(request.headers.get("user-agent") or "")[:256],
            ))
            await db.flush()
            raise HTTPException(status_code=401, detail="密码错误")

    result = await _user_payload(db, name) if name else {"ok": False, "name": name, "projects": []}
    result["has_password"] = bool(cred and cred.password_hash)

    # 记录登录日志
    db.add(LoginLog(
        user_name=name,
        is_valid=result["ok"],
        ip=request.client.host if request.client else "",
        user_agent=(request.headers.get("user-agent") or "")[:256],
    ))
    await db.flush()
    return result


@router.get("/me")
async def me(name: str = "", db: AsyncSession = Depends(get_db)) -> dict:
    """按姓名恢复归属项目 (浏览器刷新后恢复会话); 附带 has_password 供前端密码按钮展示"""
    name = (name or "").strip()
    if not name:
        return {"ok": False, "name": "", "projects": [], "has_password": False}
    result = await _user_payload(db, name)
    cred = await _get_credential(db, name)
    result["has_password"] = bool(cred and cred.password_hash)
    return result


@router.post("/password")
async def set_password(
    payload: PasswordSetIn, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    """设置/修改本人密码 (按 X-User-Name 识别本人)

    - 仅项目成员可设置 (无效姓名 403)
    - 已设过密码: 需 old_password 校验通过
    - 新密码为空串 → 清除密码 (恢复姓名直登)
    """
    name = get_user_name(request)
    if not name:
        raise HTTPException(status_code=403, detail="请先登录")
    memberships = await get_memberships(db, name)
    if not memberships:
        raise HTTPException(status_code=403, detail="仅项目成员可设置密码")

    new_password = (payload.new_password or "").strip()
    cred = await _get_credential(db, name)

    # 已设密码: 校验旧密码
    if cred and cred.password_hash:
        salt, expected = cred.password_hash.split("$", 1)
        if not payload.old_password or _hash_password(payload.old_password, salt) != expected:
            raise HTTPException(status_code=403, detail="原密码错误")

    if cred is None:
        cred = UserCredential(name=name, password_hash="")
        db.add(cred)

    if new_password:
        salt = secrets.token_hex(16)
        cred.password_hash = f"{salt}${_hash_password(new_password, salt)}"
    else:
        cred.password_hash = ""  # 清除密码
    # 显式提交: 保证紧随的登录请求立刻读到最新凭据 (不等依赖收尾)
    await db.commit()
    return {"ok": True, "has_password": bool(new_password)}
