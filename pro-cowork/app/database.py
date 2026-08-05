"""数据库引擎与会话工厂 · SQLAlchemy 2.0 async"""
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# 异步引擎
engine = create_async_engine(
    settings.database_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

# 异步会话工厂
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
    """开发阶段: 创建所有表 + 为已有表补充 is_delete 字段(逻辑删除)"""
    # 导入所有模型确保 metadata 能发现全部表
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 补充逻辑删除字段: 仅对使用了 SoftDeleteMixin 的表生效
        await _ensure_is_delete_column(conn)
        # 记忆按项目隔离: 补充 agent_memories.project_id + 存量回填
        await _ensure_memory_project_column(conn)


async def _ensure_memory_project_column(conn):
    """agent_memories 补充 project_id 字段 (幂等); 存量记忆回填到首个项目"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "agent_memories" not in existing_tables or "projects" not in existing_tables:
        return

    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("agent_memories"))
    if not any(c["name"] == "project_id" for c in cols):
        await conn.execute(
            text("ALTER TABLE agent_memories ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL")
        )
        # 存量记忆回填到首个项目, 保证"每个项目有自己的记忆"
        await conn.execute(
            text(
                "UPDATE agent_memories SET project_id = "
                "(SELECT id FROM projects ORDER BY sort_order, id LIMIT 1) "
                "WHERE project_id IS NULL"
            )
        )


async def _ensure_is_delete_column(conn):
    """对使用了 SoftDeleteMixin 的表执行 ALTER TABLE ADD COLUMN IF NOT EXISTS is_delete"""
    from sqlalchemy import inspect, text

    def _collect_tables(base_cls):
        targets = []
        for mapper in base_cls.registry.mappers:
            cls = mapper.class_
            if "is_delete" in mapper.columns.keys():
                targets.append(cls.__tablename__)
        return targets

    table_names = _collect_tables(Base)
    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())

    for tbl in table_names:
        if tbl not in existing_tables:
            continue
        # PostgreSQL 13+ 支持 ADD COLUMN IF NOT EXISTS; SQLite 需先查 PRAGMA
        try:
            await conn.execute(
                text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS is_delete BOOLEAN DEFAULT FALSE NOT NULL")
            )
        except Exception:
            # SQLite 不支持 IF NOT EXISTS 时退回 try-except
            cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns(tbl))
            if not any(c["name"] == "is_delete" for c in cols):
                await conn.execute(
                    text(f"ALTER TABLE {tbl} ADD COLUMN is_delete BOOLEAN DEFAULT 0 NOT NULL")
                )
