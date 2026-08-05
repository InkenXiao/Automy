"""Skill 路由 · CRUD + 执行"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.skill import Skill, SkillExecution
from app.schemas.skill import (
    SkillCreate,
    SkillExecuteRequest,
    SkillExecutionOut,
    SkillOut,
    SkillUpdate,
)

router = APIRouter(prefix="/skills", tags=["技能"])


@router.get("/", response_model=list[SkillOut])
async def list_skills(
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[SkillOut]:
    q = select(Skill).where(Skill.is_active.is_(True))
    if category:
        q = q.where(Skill.category == category)
    q = q.order_by(Skill.id)
    result = await db.execute(q)
    return [SkillOut.model_validate(s) for s in result.scalars().all()]


@router.get("/{skill_id}", response_model=SkillOut)
async def get_skill(skill_id: int, db: AsyncSession = Depends(get_db)) -> SkillOut:
    skill = await db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    return SkillOut.model_validate(skill)


@router.post("/", response_model=SkillOut)
async def create_skill(payload: SkillCreate, db: AsyncSession = Depends(get_db)) -> SkillOut:
    skill = Skill(**payload.model_dump())
    db.add(skill)
    await db.flush()
    await db.refresh(skill)
    return SkillOut.model_validate(skill)


@router.put("/{skill_id}", response_model=SkillOut)
async def update_skill(
    skill_id: int, payload: SkillUpdate, db: AsyncSession = Depends(get_db)
) -> SkillOut:
    skill = await db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(skill, key, value)
    await db.flush()
    await db.refresh(skill)
    return SkillOut.model_validate(skill)


@router.delete("/{skill_id}")
async def delete_skill(skill_id: int, db: AsyncSession = Depends(get_db)):
    skill = await db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    skill.is_active = False
    await db.flush()
    return {"ok": True}


@router.post("/{skill_id}/execute", response_model=SkillExecutionOut)
async def execute_skill(
    skill_id: int, payload: SkillExecuteRequest, db: AsyncSession = Depends(get_db)
) -> SkillExecutionOut:
    skill = await db.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")

    import time
    start = time.time()
    execution = SkillExecution(
        skill_id=skill_id,
        input_data=payload.input_data,
        status="running",
    )
    db.add(execution)
    await db.flush()

    try:
        from app.services.skill_engine import SkillEngine
        engine = SkillEngine(db)
        output = await engine.execute(skill, payload.input_data)
        execution.output_data = output
        execution.status = "success"
    except Exception as e:
        execution.error = str(e)
        execution.status = "failed"
    finally:
        execution.duration_ms = int((time.time() - start) * 1000)
        await db.flush()
        await db.refresh(execution)

    return SkillExecutionOut.model_validate(execution)


@router.get("/{skill_id}/executions", response_model=list[SkillExecutionOut])
async def list_executions(skill_id: int, db: AsyncSession = Depends(get_db)) -> list[SkillExecutionOut]:
    result = await db.execute(
        select(SkillExecution)
        .where(SkillExecution.skill_id == skill_id)
        .order_by(SkillExecution.created_at.desc())
        .limit(50)
    )
    return [SkillExecutionOut.model_validate(e) for e in result.scalars().all()]
