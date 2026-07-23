"""会议议程路由 · 含议程项子资源"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.meeting import Meeting, MeetingItem
from app.schemas.meeting import (
    MeetingCreate,
    MeetingItemCreate,
    MeetingItemOut,
    MeetingItemUpdate,
    MeetingOut,
    MeetingUpdate,
)

router = APIRouter(prefix="/meetings", tags=["项目例会"])


async def _load_meeting(db: AsyncSession, meeting_id: int) -> Meeting:
    """加载单条会议 (含议程项按 sort_order 排序, populate_existing 强制刷新)"""
    stmt = (
        select(Meeting)
        .options(selectinload(Meeting.items))
        .where(Meeting.id == meeting_id)
        .execution_options(populate_existing=True)
    )
    result = await db.execute(stmt)
    meeting = result.scalars().first()
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    # 议程项按 sort_order, id 排序 (避免数据库返回顺序不稳定)
    meeting.items.sort(key=lambda x: (x.sort_order, x.id))
    return meeting


# ---------- 会议主体 ----------
@router.get("/", response_model=list[MeetingOut])
async def list_meetings(db: AsyncSession = Depends(get_db)) -> list[MeetingOut]:
    """获取所有会议 (按 sort_order 排序, 含议程项)"""
    stmt = (
        select(Meeting)
        .options(selectinload(Meeting.items))
        .order_by(Meeting.sort_order, Meeting.id)
    )
    result = await db.execute(stmt)
    items = result.scalars().all()
    # 议程项按 sort_order, id 排序
    for m in items:
        m.items.sort(key=lambda x: (x.sort_order, x.id))
    return [MeetingOut.model_validate(it) for it in items]


@router.get("/{meeting_id}", response_model=MeetingOut)
async def get_meeting(
    meeting_id: int, db: AsyncSession = Depends(get_db)
) -> MeetingOut:
    """获取会议详情 (含议程项)"""
    meeting = await _load_meeting(db, meeting_id)
    return MeetingOut.model_validate(meeting)


@router.post("/", response_model=MeetingOut)
async def create_meeting(
    payload: MeetingCreate, db: AsyncSession = Depends(get_db)
) -> MeetingOut:
    """创建会议 (含议程项批量创建)"""
    data = payload.model_dump()
    items_data = data.pop("items", [])
    meeting = Meeting(**data)
    for item_in in items_data:
        meeting.items.append(MeetingItem(**item_in))
    db.add(meeting)
    await db.flush()
    # 重新加载以避免异步懒加载子表
    meeting = await _load_meeting(db, meeting.id)
    return MeetingOut.model_validate(meeting)


@router.put("/{meeting_id}", response_model=MeetingOut)
async def update_meeting(
    meeting_id: int,
    payload: MeetingUpdate,
    db: AsyncSession = Depends(get_db),
) -> MeetingOut:
    """更新会议主记录"""
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(meeting, key, value)
    await db.flush()
    # 重新加载以避免异步懒加载子表
    meeting = await _load_meeting(db, meeting_id)
    return MeetingOut.model_validate(meeting)


@router.delete("/{meeting_id}")
async def delete_meeting(
    meeting_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除会议 (级联删除议程项)"""
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    await db.delete(meeting)
    await db.flush()
    return {"ok": True, "id": meeting_id}


# ---------- 议程项 ----------
@router.post("/{meeting_id}/items", response_model=MeetingItemOut)
async def create_meeting_item(
    meeting_id: int,
    payload: MeetingItemCreate,
    db: AsyncSession = Depends(get_db),
) -> MeetingItemOut:
    """新增议程项"""
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    item = MeetingItem(meeting_id=meeting_id, **payload.model_dump())
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return MeetingItemOut.model_validate(item)


@router.put("/{meeting_id}/items/{item_id}", response_model=MeetingItemOut)
async def update_meeting_item(
    meeting_id: int,
    item_id: int,
    payload: MeetingItemUpdate,
    db: AsyncSession = Depends(get_db),
) -> MeetingItemOut:
    """更新议程项"""
    item = await db.get(MeetingItem, item_id)
    if not item or item.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="议程项不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return MeetingItemOut.model_validate(item)


@router.delete("/{meeting_id}/items/{item_id}")
async def delete_meeting_item(
    meeting_id: int, item_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除议程项"""
    item = await db.get(MeetingItem, item_id)
    if not item or item.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="议程项不存在")
    await db.delete(item)
    await db.flush()
    return {"ok": True, "id": item_id}
