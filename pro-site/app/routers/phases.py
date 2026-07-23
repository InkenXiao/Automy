"""项目阶段字典路由"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.phase import Phase
from app.schemas.phase import PhaseOut

router = APIRouter(prefix="/phases", tags=["阶段"])


@router.get("/", response_model=list[PhaseOut])
async def list_phases(db: AsyncSession = Depends(get_db)) -> list[PhaseOut]:
    """获取所有阶段 (按 start_date 排序)"""
    result = await db.execute(select(Phase).order_by(Phase.start_date))
    items = result.scalars().all()
    return [PhaseOut.model_validate(it) for it in items]
