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
        # 会议录音/转写原文字段 (需求: 纪要关联原始音频与转写文字)
        await _ensure_meeting_media_columns(conn)
        # 任务分身允许为空 (需求: 创建任务后由意图识别确定分身)
        await _ensure_task_run_agent_nullable(conn)
        # 周报概括字段 (需求: AI 生成微信汇报版概括, 与周报表关联)
        await _ensure_weekly_report_digest_column(conn)
        # 项目经理/状态字段 (需求: 项目成员页维护项目经理、起止时间与项目状态)
        await _ensure_project_staff_columns(conn)
        # 个人周报工作项: 7 列(mon~sun) → 按天行(day_of_week+content) 拆行迁移
        await _migrate_pr_work_items_to_daily(conn)
        # 成员状态: 在职→全职, 已退出→退出
        await _migrate_member_status(conn)
        # sys_files 知识库构建状态字段 (需求: rag 解析入库后回写 kb_indexed)
        await _ensure_sys_file_kb_indexed_column(conn)
        # 个人周报概括字段 (需求: AI 生成 2-3 段概括, 右栏可编辑保存)
        await _ensure_personal_report_summary_column(conn)
        # 任务创建人字段 (需求: 首页看板按登录人过滤长任务结果)
        await _ensure_task_run_user_column(conn)


async def _ensure_task_run_user_column(conn):
    """task_runs 补充 user_name 字段 (幂等); 存量为 '' 仅项目经理可见"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "task_runs" not in existing_tables:
        return
    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("task_runs"))
    if not any(c["name"] == "user_name" for c in cols):
        await conn.execute(
            text("ALTER TABLE task_runs ADD COLUMN user_name VARCHAR(64) DEFAULT '' NOT NULL")
        )


async def _ensure_personal_report_summary_column(conn):
    """pro_personal_reports 补充 summary 字段 (幂等)"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "pro_personal_reports" not in existing_tables:
        return
    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("pro_personal_reports"))
    if not any(c["name"] == "summary" for c in cols):
        await conn.execute(
            text("ALTER TABLE pro_personal_reports ADD COLUMN summary TEXT DEFAULT '' NOT NULL")
        )


async def _ensure_sys_file_kb_indexed_column(conn):
    """sys_files 补充 kb_indexed 字段 (幂等)"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "sys_files" not in existing_tables:
        return
    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("sys_files"))
    if not any(c["name"] == "kb_indexed" for c in cols):
        await conn.execute(
            text("ALTER TABLE sys_files ADD COLUMN kb_indexed BOOLEAN DEFAULT FALSE NOT NULL")
        )


async def _migrate_member_status(conn):
    """pro_project_members.status 值迁移: 在职→全职, 已退出→退出 (幂等)"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "pro_project_members" not in existing_tables:
        return
    await conn.execute(
        text("UPDATE pro_project_members SET status='全职' WHERE status='在职'")
    )
    await conn.execute(
        text("UPDATE pro_project_members SET status='退出' WHERE status='已退出'")
    )


async def _migrate_pr_work_items_to_daily(conn):
    """pro_personal_report_work_items 结构迁移: mon~sun 7 列 → day_of_week+content 按天行 (幂等)

    旧行中每天非空内容拆成独立新行; hours/participants/deliverable 仅挂到
    当天序号最小的新行, 其余新行 hours=0; 迁移完成后旧行置 is_delete=true。
    新列不存在时先 ALTER 补齐; 无待迁移旧行即跳过。
    """
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "pro_personal_report_work_items" not in existing_tables:
        return
    cols = await conn.run_sync(
        lambda sync_conn: inspect(sync_conn).get_columns("pro_personal_report_work_items")
    )
    names = {c["name"] for c in cols}

    # 新列补齐 (旧表无 day_of_week/content)
    if "day_of_week" not in names:
        await conn.execute(
            text("ALTER TABLE pro_personal_report_work_items ADD COLUMN day_of_week INTEGER DEFAULT 1 NOT NULL")
        )
    if "content" not in names:
        await conn.execute(
            text("ALTER TABLE pro_personal_report_work_items ADD COLUMN content TEXT DEFAULT '' NOT NULL")
        )
    if "mon" not in names:
        return  # 已是新结构 (无旧列), 无需迁移

    # 待迁移旧行: 未删除且 mon~sun 任一非空
    rows = (await conn.execute(
        text(
            "SELECT id, report_id, project_id, mon, tue, wed, thu, fri, sat, sun, "
            "participants, deliverable, hours, sort_order "
            "FROM pro_personal_report_work_items "
            "WHERE is_delete = false AND ("
            "COALESCE(mon,'') <> '' OR COALESCE(tue,'') <> '' OR COALESCE(wed,'') <> '' "
            "OR COALESCE(thu,'') <> '' OR COALESCE(fri,'') <> '' OR COALESCE(sat,'') <> '' "
            "OR COALESCE(sun,'') <> '')"
        )
    )).mappings().all()

    day_cols = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    # 先删除旧 7 列 (其 NOT NULL 约束会阻断新结构插入; 旧数据已读入内存)
    for col in day_cols:
        await conn.execute(
            text(f"ALTER TABLE pro_personal_report_work_items DROP COLUMN {col}")
        )

    for r in rows:
        non_empty = [(i + 1, (r[c] or "").strip()) for i, c in enumerate(day_cols) if (r[c] or "").strip()]
        if not non_empty:
            continue
        first = True
        for day, content in non_empty:
            await conn.execute(
                text(
                    "INSERT INTO pro_personal_report_work_items "
                    "(report_id, project_id, day_of_week, content, participants, deliverable, "
                    "hours, sort_order, is_delete) "
                    "VALUES (:rid, :pid, :dow, :content, :participants, :deliverable, "
                    ":hours, :sort, false)"
                ),
                {
                    "rid": r["report_id"],
                    "pid": r["project_id"],
                    "dow": day,
                    "content": content,
                    "participants": r["participants"] or "",
                    "deliverable": r["deliverable"] or "",
                    "hours": float(r["hours"] or 0) if first else 0,
                    "sort": (r["sort_order"] or 0) * 10 + day,
                },
            )
            first = False
        await conn.execute(
            text("UPDATE pro_personal_report_work_items SET is_delete = true WHERE id = :oid"),
            {"oid": r["id"]},
        )


async def _ensure_project_staff_columns(conn):
    """pro_projects 补充 manager / status 字段 (幂等)"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "pro_projects" not in existing_tables:
        return
    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("pro_projects"))
    names = {c["name"] for c in cols}
    if "manager" not in names:
        await conn.execute(
            text("ALTER TABLE pro_projects ADD COLUMN manager VARCHAR(64) DEFAULT '' NOT NULL")
        )
    if "status" not in names:
        await conn.execute(
            text("ALTER TABLE pro_projects ADD COLUMN status VARCHAR(16) DEFAULT '进行中' NOT NULL")
        )


async def _ensure_weekly_report_digest_column(conn):
    """pro_weekly_reports 补充 week_digest 字段 (幂等)"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "pro_weekly_reports" not in existing_tables:
        return
    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("pro_weekly_reports"))
    if not any(c["name"] == "week_digest" for c in cols):
        await conn.execute(
            text("ALTER TABLE pro_weekly_reports ADD COLUMN week_digest TEXT DEFAULT '' NOT NULL")
        )


async def _ensure_meeting_media_columns(conn):
    """pro_meetings 补充 audio_file / transcript 字段 (幂等)"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "pro_meetings" not in existing_tables:
        return
    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("pro_meetings"))
    names = {c["name"] for c in cols}
    if "audio_file" not in names:
        await conn.execute(
            text("ALTER TABLE pro_meetings ADD COLUMN audio_file VARCHAR(256) DEFAULT '' NOT NULL")
        )
    if "transcript" not in names:
        await conn.execute(
            text("ALTER TABLE pro_meetings ADD COLUMN transcript TEXT DEFAULT '' NOT NULL")
        )


async def _ensure_task_run_agent_nullable(conn):
    """task_runs.agent_id 允许 NULL (幂等); 仅 PostgreSQL 需要, SQLite 重建表略过"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "task_runs" not in existing_tables:
        return
    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("task_runs"))
    agent_col = next((c for c in cols if c["name"] == "agent_id"), None)
    if agent_col and not agent_col.get("nullable", True):
        try:
            await conn.execute(
                text("ALTER TABLE task_runs ALTER COLUMN agent_id DROP NOT NULL")
            )
        except Exception:
            pass  # 非 PostgreSQL 方言忽略


async def _ensure_memory_project_column(conn):
    """agent_memories 补充 project_id 字段 (幂等); 存量记忆回填到首个项目"""
    from sqlalchemy import inspect, text

    existing_tables = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
    if "agent_memories" not in existing_tables or "pro_projects" not in existing_tables:
        return

    cols = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_columns("agent_memories"))
    if not any(c["name"] == "project_id" for c in cols):
        await conn.execute(
            text("ALTER TABLE agent_memories ADD COLUMN project_id INTEGER REFERENCES pro_projects(id) ON DELETE SET NULL")
        )
        # 存量记忆回填到首个项目, 保证"每个项目有自己的记忆"
        await conn.execute(
            text(
                "UPDATE agent_memories SET project_id = "
                "(SELECT id FROM pro_projects ORDER BY sort_order, id LIMIT 1) "
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
