"""mcp-cowork 数据库 · 引擎/会话/建表初始化 (同一 XIN 库, mcp_ 前缀表)"""
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

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
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    """建表 (幂等) + sys_users 种子 (与 rag-cowork 同一共享用户表)"""
    import app.models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _seed_sys_users(conn)


async def _seed_sys_users(conn):
    """sys_users 种子: sys_user_credentials(密码权威) upsert + pro_project_members 兜底新建 (幂等)

    - sys_user_credentials 为密码权威来源: ON CONFLICT 同步最新密码 (含空串=已清除)
    - 仅项目成员: ON CONFLICT DO NOTHING 兜底新建无密码账号, 已有账号不触碰
      (保留 rag/mcp 侧自设密码)
    """
    tables = set(await conn.run_sync(
        lambda sync_conn: inspect(sync_conn).get_table_names()
    ))
    if "sys_users" not in tables:
        return
    cred_users: dict[str, str] = {}
    if "sys_user_credentials" in tables:
        rows = (await conn.execute(
            text("SELECT name, password_hash FROM sys_user_credentials WHERE is_delete = false")
        )).all()
        for name, pwd in rows:
            if name and name.strip():
                cred_users[name.strip()] = pwd or ""
    member_names: set[str] = set()
    if "pro_project_members" in tables:
        rows = (await conn.execute(
            text("SELECT DISTINCT name FROM pro_project_members WHERE is_delete = false")
        )).all()
        for (name,) in rows:
            if name and name.strip():
                member_names.add(name.strip())
    for name, pwd in cred_users.items():
        await conn.execute(
            text(
                "INSERT INTO sys_users (user_id, name, password_hash, display_name, department, "
                "is_active, is_delete, created_at, updated_at) "
                "VALUES (:uid, :name, :pwd, :dname, '', true, false, now(), now()) "
                "ON CONFLICT (name) DO UPDATE SET password_hash = EXCLUDED.password_hash"
            ),
            {"uid": _gen_id(), "name": name, "pwd": pwd, "dname": name},
        )
    for name in sorted(member_names - cred_users.keys()):
        await conn.execute(
            text(
                "INSERT INTO sys_users (user_id, name, password_hash, display_name, department, "
                "is_active, is_delete, created_at, updated_at) "
                "VALUES (:uid, :name, '', :dname, '', true, false, now(), now()) "
                "ON CONFLICT (name) DO NOTHING"
            ),
            {"uid": _gen_id(), "name": name, "dname": name},
        )


def _gen_id() -> int:
    from app.services.snowflake import generate_id
    return generate_id()
