"""项目模块字典路由"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.module import Module
from app.schemas.module import ModuleCreate, ModuleOut, ModuleUpdate

router = APIRouter(prefix="/modules", tags=["模块"])


@router.get("/", response_model=list[ModuleOut])
async def list_modules(db: AsyncSession = Depends(get_db)) -> list[ModuleOut]:
    """获取所有模块 (按 sort_order 排序)"""
    result = await db.execute(
        select(Module).order_by(Module.sort_order, Module.id)
    )
    items = result.scalars().all()
    return [ModuleOut.model_validate(it) for it in items]


@router.get("/{item_id}", response_model=ModuleOut)
async def get_module(item_id: int, db: AsyncSession = Depends(get_db)) -> ModuleOut:
    """获取模块详情"""
    item = await db.get(Module, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="模块不存在")
    return ModuleOut.model_validate(item)


@router.post("/", response_model=ModuleOut)
async def create_module(
    payload: ModuleCreate, db: AsyncSession = Depends(get_db)
) -> ModuleOut:
    """新建模块"""
    item = Module(**payload.model_dump())
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return ModuleOut.model_validate(item)


@router.put("/{item_id}", response_model=ModuleOut)
async def update_module(
    item_id: int,
    payload: ModuleUpdate,
    db: AsyncSession = Depends(get_db),
) -> ModuleOut:
    """更新模块"""
    item = await db.get(Module, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="模块不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return ModuleOut.model_validate(item)
