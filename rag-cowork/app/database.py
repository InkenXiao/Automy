"""数据库引擎与会话工厂 · SQLAlchemy 2.0 async (与 pro-cowork 同一 XIN 库)"""
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.database_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类"""

    pass


async def get_db():
    """FastAPI 依赖: 提供数据库会话"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """建表 (幂等) + sys_users 种子 (从 pro-cowork sys_user_credentials / pro_project_members 导入)"""
    import app.models  # noqa: F401 - 确保 metadata 发现全部表

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _seed_sys_users(conn)


async def _seed_sys_users(conn):
    """共享用户表种子: 合并 sys_user_credentials(含密码) 与 pro_project_members 姓名, 幂等 upsert

    - sys_user_credentials 为密码权威来源: ON CONFLICT 同步最新密码 (含空串=已清除),
      与 pro-cowork 改密双写保持一致
    - 仅项目成员: ON CONFLICT DO NOTHING 兜底新建无密码账号 (姓名直登),
      已有账号不触碰 (保留 rag/mcp 侧自设密码)
    """
    from app.services.snowflake import generate_id

    tables = await conn.run_sync(
        lambda sc: __import__("sqlalchemy").inspect(sc).get_table_names()
    )

    cred_users: dict[str, str] = {}  # sys_user_credentials: 密码权威来源
    if "sys_user_credentials" in tables:
        rows = (await conn.execute(
            text("SELECT name, password_hash FROM sys_user_credentials WHERE is_delete = false")
        )).all()
        for name, pwd in rows:
            if name and name.strip():
                cred_users[name.strip()] = pwd or ""

    member_names: set[str] = set()  # 仅项目成员: 确保账号存在即可
    if "pro_project_members" in tables:
        rows = (await conn.execute(
            text("SELECT DISTINCT name FROM pro_project_members WHERE is_delete = false")
        )).all()
        for (name,) in rows:
            if name and name.strip():
                member_names.add(name.strip())

    if not cred_users and not member_names:
        return

    # 1) sys_user_credentials 权威: upsert 并同步密码
    for name, pwd in cred_users.items():
        await conn.execute(
            text(
                "INSERT INTO sys_users (user_id, name, password_hash, is_active, is_delete) "
                "VALUES (:uid, :name, :pwd, true, false) "
                "ON CONFLICT (name) DO UPDATE SET password_hash = EXCLUDED.password_hash"
            ),
            {"uid": generate_id(), "name": name, "pwd": pwd},
        )
    # 2) 仅项目成员: 无密码账号兜底新建
    member_only = sorted(member_names - cred_users.keys())
    for name in member_only:
        await conn.execute(
            text(
                "INSERT INTO sys_users (user_id, name, password_hash, is_active, is_delete) "
                "VALUES (:uid, :name, '', true, false) "
                "ON CONFLICT (name) DO NOTHING"
            ),
            {"uid": generate_id(), "name": name},
        )
    logger.info(
        "sys_users 种子同步: 凭据 upsert %d, 成员兜底 %d", len(cred_users), len(member_only)
    )
