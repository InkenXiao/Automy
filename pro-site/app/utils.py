"""应用层共享辅助函数"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project


async def get_active_project_id(db: AsyncSession) -> int:
    """获取当前激活项目的 ID

    优先返回 is_active=True 的项目; 若无则返回 sort_order 最靠前的项目;
    若完全无项目则返回 1 (兜底, 避免业务接口报错).
    """
    stmt = (
        select(Project.id)
        .where(Project.is_active.is_(True), Project.is_delete.is_(False))
        .limit(1)
    )
    result = await db.execute(stmt)
    pid = result.scalars().first()
    if pid is not None:
        return pid

    # 无激活项目: 取任意一个
    any_stmt = (
        select(Project.id)
        .where(Project.is_delete.is_(False))
        .order_by(Project.sort_order, Project.id)
        .limit(1)
    )
    result = await db.execute(any_stmt)
    pid = result.scalars().first()
    return pid if pid is not None else 1


async def resolve_project_id(db: AsyncSession, payload_project_id: int | None) -> int:
    """解析有效的 project_id

    - 若调用方显式传入 project_id, 直接使用
    - 否则取当前激活项目 ID
    """
    if payload_project_id is not None:
        return payload_project_id
    return await get_active_project_id(db)
