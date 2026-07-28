"""数据库引擎与会话工厂 · SQLAlchemy 2.0 async"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=settings.DEBUG, pool_pre_ping=True, pool_size=5, max_overflow=10)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
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
    import app.models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 补充逻辑删除字段: 仅对使用了 SoftDeleteMixin 的表生效
        await _ensure_is_delete_column(conn)


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
        try:
            await conn.execute(
                text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS is_delete BOOLEAN DEFAULT FALSE NOT NULL")
            )
        except Exception:
            cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns(tbl))
            if not any(c["name"] == "is_delete" for c in cols):
                await conn.execute(
                    text(f"ALTER TABLE {tbl} ADD COLUMN is_delete BOOLEAN DEFAULT 0 NOT NULL")
                )
