"""单元路由"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.unit import Unit
from app.schemas.unit import UnitCreate, UnitOut, UnitUpdate

router = APIRouter(prefix="/units", tags=["单元"])


@router.get("/", response_model=List[UnitOut])
async def list_units(db: AsyncSession = Depends(get_db)):
    """列出全部单元 (含单词), 按 sort_order, id 排序"""
    stmt = (
        select(Unit)
        .options(selectinload(Unit.words))
        .order_by(Unit.sort_order, Unit.id)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{unit_id}", response_model=UnitOut)
async def get_unit(unit_id: int, db: AsyncSession = Depends(get_db)):
    """查询单个单元 (含单词)"""
    stmt = (
        select(Unit)
        .options(selectinload(Unit.words))
        .where(Unit.id == unit_id)
    )
    result = await db.execute(stmt)
    unit = result.scalar_one_or_none()
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


@router.post("/", response_model=UnitOut)
async def create_unit(unit_in: UnitCreate, db: AsyncSession = Depends(get_db)):
    """创建单元"""
    unit = Unit(
        name=unit_in.name,
        description=unit_in.description,
        sort_order=unit_in.sort_order,
    )
    db.add(unit)
    await db.flush()
    # 重新加载以预加载 words 关系 (避免 async 懒加载报错)
    stmt = select(Unit).options(selectinload(Unit.words)).where(Unit.id == unit.id)
    result = await db.execute(stmt)
    return result.scalar_one()


@router.put("/{unit_id}", response_model=UnitOut)
async def update_unit(
    unit_id: int, unit_in: UnitUpdate, db: AsyncSession = Depends(get_db)
):
    """更新单元"""
    stmt = (
        select(Unit)
        .options(selectinload(Unit.words))
        .where(Unit.id == unit_id)
    )
    result = await db.execute(stmt)
    unit = result.scalar_one_or_none()
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    update_data = unit_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(unit, field, value)
    await db.flush()
    # 重新加载以预加载 words 关系
    stmt = select(Unit).options(selectinload(Unit.words)).where(Unit.id == unit_id)
    result = await db.execute(stmt)
    return result.scalar_one()


@router.delete("/{unit_id}")
async def delete_unit(unit_id: int, db: AsyncSession = Depends(get_db)):
    """删除单元 (级联删除其下单词)"""
    stmt = (
        select(Unit)
        .options(selectinload(Unit.words))
        .where(Unit.id == unit_id)
    )
    result = await db.execute(stmt)
    unit = result.scalar_one_or_none()
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    await db.delete(unit)
    await db.flush()
    return {"ok": True, "id": unit_id}
