"""sys_users 共享用户表同步 (pro-cowork → rag-cowork/mcp-cowork 登录体系)

双写时机:
- 新增项目成员 / 成员改名: sync_sys_user(db, name) 确保账号存在 (不触碰密码)
- 设置/修改/清除密码: sync_sys_user(db, name, password_hash=...) 覆盖密码哈希

密码哈希算法三系统一致 (pbkdf2-sha256 10 万迭代, salt$hex), 可直接拷贝。
"""
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.snowflake import generate_id


async def sync_sys_user(
    db: AsyncSession, name: str, password_hash: Optional[str] = None
) -> None:
    """按姓名 upsert sys_users (雪花 ID 主键)

    - name 不存在: 新建账号 (display_name/department 走列默认值, is_active=true)
    - name 已存在: password_hash 为 None 则不动; 为字符串则覆盖 (空串=清除密码)
    """
    name = (name or "").strip()
    if not name:
        return
    if password_hash is None:
        await db.execute(
            text(
                "INSERT INTO sys_users (user_id, name, password_hash, is_active, is_delete) "
                "VALUES (:uid, :name, '', true, false) "
                "ON CONFLICT (name) DO NOTHING"
            ),
            {"uid": generate_id(), "name": name},
        )
    else:
        await db.execute(
            text(
                "INSERT INTO sys_users (user_id, name, password_hash, is_active, is_delete) "
                "VALUES (:uid, :name, :pwd, true, false) "
                "ON CONFLICT (name) DO UPDATE SET "
                "password_hash = EXCLUDED.password_hash, is_delete = false"
            ),
            {"uid": generate_id(), "name": name, "pwd": password_hash},
        )
