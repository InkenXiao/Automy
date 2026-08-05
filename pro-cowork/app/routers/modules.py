"""项目模块字典路由"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.module import Module
from app.schemas.module import ModuleCreate, ModuleOut, ModuleUpdate
from app.utils import resolve_project_id

router = APIRouter(prefix="/modules", tags=["模块"])


@router.get("/", response_model=list[ModuleOut])
async def list_modules(
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> list[ModuleOut]:
    """获取模块列表 (支持按 project_id 过滤; 不传则用当前激活项目)"""
    pid = await resolve_project_id(db, project_id)
    result = await db.execute(
        select(Module)
        .where(Module.is_delete.is_(False), Module.project_id == pid)
        .order_by(Module.sort_order, Module.id)
    )
    items = result.scalars().all()
    return [ModuleOut.model_validate(it) for it in items]


@router.get("/{item_id}", response_model=ModuleOut)
async def get_module(item_id: int, db: AsyncSession = Depends(get_db)) -> ModuleOut:
    """获取模块详情"""
    item = await db.get(Module, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="模块不存在")
    return ModuleOut.model_validate(item)


@router.post("/", response_model=ModuleOut)
async def create_module(
    payload: ModuleCreate, db: AsyncSession = Depends(get_db)
) -> ModuleOut:
    """新建模块; project_id 未传时默认用当前激活项目"""
    data = payload.model_dump()
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    item = Module(**data)
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
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="模块不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return ModuleOut.model_validate(item)
