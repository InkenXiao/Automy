"""项目阶段字典路由"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.phase import Phase
from app.schemas.phase import PhaseCreate, PhaseOut, PhaseUpdate
from app.utils import resolve_project_id

router = APIRouter(prefix="/phases", tags=["阶段"])


@router.get("/", response_model=list[PhaseOut])
async def list_phases(
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> list[PhaseOut]:
    """获取阶段列表 (支持按 project_id 过滤; 不传则用当前激活项目)"""
    pid = await resolve_project_id(db, project_id)
    result = await db.execute(
        select(Phase)
        .where(Phase.is_delete.is_(False), Phase.project_id == pid)
        .order_by(Phase.start_date)
    )
    items = result.scalars().all()
    return [PhaseOut.model_validate(it) for it in items]


@router.get("/{item_id}", response_model=PhaseOut)
async def get_phase(item_id: int, db: AsyncSession = Depends(get_db)) -> PhaseOut:
    """获取阶段详情"""
    item = await db.get(Phase, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="阶段不存在")
    return PhaseOut.model_validate(item)


@router.post("/", response_model=PhaseOut)
async def create_phase(
    payload: PhaseCreate, db: AsyncSession = Depends(get_db)
) -> PhaseOut:
    """新建阶段; project_id 未传时默认用当前激活项目"""
    data = payload.model_dump()
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    item = Phase(**data)
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return PhaseOut.model_validate(item)


@router.put("/{item_id}", response_model=PhaseOut)
async def update_phase(
    item_id: int,
    payload: PhaseUpdate,
    db: AsyncSession = Depends(get_db),
) -> PhaseOut:
    """更新阶段"""
    item = await db.get(Phase, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="阶段不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return PhaseOut.model_validate(item)


@router.delete("/{item_id}")
async def delete_phase(item_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    """删除阶段 (软删除)"""
    item = await db.get(Phase, item_id)
    if not item or item.is_delete:
        raise HTTPException(status_code=404, detail="阶段不存在")
    item.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True}
