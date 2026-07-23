"""单词库路由"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.word import Word
from app.schemas.word import WordBatchImport, WordCreate, WordOut, WordUpdate

router = APIRouter(prefix="/words", tags=["单词库"])


@router.get("/", response_model=List[WordOut])
async def list_words(
    q: Optional[str] = Query(None, description="搜索 english/definition"),
    unit_id: Optional[int] = Query(None, description="按单元过滤"),
    status: Optional[str] = Query(None, description="按状态过滤"),
    db: AsyncSession = Depends(get_db),
):
    """列出全部单词, 支持搜索 / 单元 / 状态过滤, 按 sort_order, id 排序"""
    stmt = select(Word).options(selectinload(Word.unit))
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(Word.english.ilike(pattern), Word.definition.ilike(pattern))
        )
    if unit_id is not None:
        stmt = stmt.where(Word.unit_id == unit_id)
    if status is not None:
        stmt = stmt.where(Word.status == status)
    stmt = stmt.order_by(Word.sort_order, Word.id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/", response_model=WordOut)
async def create_word(word_in: WordCreate, db: AsyncSession = Depends(get_db)):
    """创建单词, 若指定 unit_id 则自动计算 sort_order = max+1"""
    sort_order = word_in.sort_order
    if word_in.unit_id is not None:
        max_order = await db.scalar(
            select(func.coalesce(func.max(Word.sort_order), 0)).where(
                Word.unit_id == word_in.unit_id
            )
        )
        sort_order = (max_order or 0) + 1
    word = Word(
        english=word_in.english,
        phonetic=word_in.phonetic,
        definition=word_in.definition,
        example=word_in.example,
        unit_id=word_in.unit_id,
        sort_order=sort_order,
    )
    db.add(word)
    await db.flush()
    await db.refresh(word)
    return word


@router.post("/batch-import")
async def batch_import(
    payload: WordBatchImport,
    unit_id: Optional[int] = Query(None, description="统一指定所属单元"),
    db: AsyncSession = Depends(get_db),
):
    """批量导入, 每行格式: word|phonetic|definition|example (example 可选)"""
    success = 0
    failed = 0
    errors = []
    for idx, raw in enumerate(payload.text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 3:
            failed += 1
            errors.append(
                f"Line {idx}: 字段不足, 需至少 word|phonetic|definition"
            )
            continue
        english = parts[0].strip()
        phonetic = parts[1].strip()
        definition = parts[2].strip()
        example = parts[3].strip() if len(parts) > 3 else ""
        if not english or not definition:
            failed += 1
            errors.append(f"Line {idx}: word 或 definition 为空")
            continue
        word = Word(
            english=english,
            phonetic=phonetic,
            definition=definition,
            example=example,
            unit_id=unit_id,
        )
        db.add(word)
        success += 1
    await db.flush()
    return {"success": success, "failed": failed, "errors": errors}


@router.get("/{word_id}", response_model=WordOut)
async def get_word(word_id: int, db: AsyncSession = Depends(get_db)):
    """查询单个单词"""
    stmt = (
        select(Word)
        .options(selectinload(Word.unit))
        .where(Word.id == word_id)
    )
    result = await db.execute(stmt)
    word = result.scalar_one_or_none()
    if word is None:
        raise HTTPException(status_code=404, detail="Word not found")
    return word


@router.put("/{word_id}", response_model=WordOut)
async def update_word(
    word_id: int, word_in: WordUpdate, db: AsyncSession = Depends(get_db)
):
    """更新单词"""
    stmt = (
        select(Word)
        .options(selectinload(Word.unit))
        .where(Word.id == word_id)
    )
    result = await db.execute(stmt)
    word = result.scalar_one_or_none()
    if word is None:
        raise HTTPException(status_code=404, detail="Word not found")
    update_data = word_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(word, field, value)
    await db.flush()
    await db.refresh(word)
    return word


@router.delete("/{word_id}")
async def delete_word(word_id: int, db: AsyncSession = Depends(get_db)):
    """删除单词"""
    stmt = select(Word).where(Word.id == word_id)
    result = await db.execute(stmt)
    word = result.scalar_one_or_none()
    if word is None:
        raise HTTPException(status_code=404, detail="Word not found")
    await db.delete(word)
    await db.flush()
    return {"ok": True, "id": word_id}
