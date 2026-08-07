"""会议议程路由 · 含议程项子资源 + 会议录音播放"""
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

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
from app.services.skill_engine import _find_task_file
from app.utils import resolve_project_id

router = APIRouter(prefix="/meetings", tags=["项目会议"])

_AUDIO_MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".wma": "audio/x-ms-wma",
    ".opus": "audio/opus",
}


async def _load_meeting(db: AsyncSession, meeting_id: int) -> Meeting:
    """加载单条会议 (含议程项按 sort_order 排序, populate_existing 强制刷新)"""
    stmt = (
        select(Meeting)
        .options(
            selectinload(Meeting.items),
            with_loader_criteria(MeetingItem, MeetingItem.is_delete.is_(False)),
        )
        .where(Meeting.id == meeting_id, Meeting.is_delete.is_(False))
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
async def list_meetings(
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> list[MeetingOut]:
    """获取会议列表 (支持按 project_id 过滤; 不传则返回当前激活项目的会议)"""
    pid = await resolve_project_id(db, project_id)
    stmt = (
        select(Meeting)
        .options(
            selectinload(Meeting.items),
            with_loader_criteria(MeetingItem, MeetingItem.is_delete.is_(False)),
        )
        .where(Meeting.is_delete.is_(False), Meeting.project_id == pid)
        .order_by(Meeting.meet_date.desc(), Meeting.meet_time.desc())
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


@router.get("/{meeting_id}/audio")
async def get_meeting_audio(
    meeting_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    """播放会议录音: 支持 HTTP Range (进度条拖拽定位)"""
    meeting = await db.get(Meeting, meeting_id)
    if not meeting or meeting.is_delete:
        raise HTTPException(status_code=404, detail="会议不存在")
    if not meeting.audio_file:
        raise HTTPException(status_code=404, detail="该会议暂无关联录音")
    audio_path = _find_task_file(meeting.project_id, Path(meeting.audio_file).name)
    if not audio_path:
        raise HTTPException(status_code=404, detail="录音文件不存在或已被清理")

    file_size = audio_path.stat().st_size
    media_type = _AUDIO_MEDIA_TYPES.get(audio_path.suffix.lower(), "application/octet-stream")

    range_header = request.headers.get("range")
    if range_header:
        m = re.match(r"bytes=(\d*)-(\d*)", range_header.strip())
        if m:
            start = int(m.group(1)) if m.group(1) else 0
            end = int(m.group(2)) if m.group(2) else file_size - 1
            end = min(end, file_size - 1)
            if start >= file_size or start > end:
                raise HTTPException(status_code=416, detail="Range Not Satisfiable")
            length = end - start + 1

            def iter_file():
                with open(audio_path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(256 * 1024, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            return StreamingResponse(
                iter_file(),
                status_code=206,
                media_type=media_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(length),
                },
            )

    return FileResponse(
        audio_path,
        media_type=media_type,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )


@router.post("/", response_model=MeetingOut)
async def create_meeting(
    payload: MeetingCreate, db: AsyncSession = Depends(get_db)
) -> MeetingOut:
    """创建会议 (含议程项批量创建); project_id 未传时默认用当前激活项目"""
    data = payload.model_dump()
    items_data = data.pop("items", [])
    # 解析 project_id (未传则用当前激活项目)
    data["project_id"] = await resolve_project_id(db, data.get("project_id"))
    meeting = Meeting(**data)
    for item_in in items_data:
        meeting.items.append(MeetingItem(**item_in))
    db.add(meeting)
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到新会议
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
    if not meeting or meeting.is_delete:
        raise HTTPException(status_code=404, detail="会议不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(meeting, key, value)
    await db.commit()  # 显式提交: 保证前端紧随的读取能读到更新 (含纪要/转写/录音关联)
    # 重新加载以避免异步懒加载子表
    meeting = await _load_meeting(db, meeting_id)
    return MeetingOut.model_validate(meeting)


@router.delete("/{meeting_id}")
async def delete_meeting(
    meeting_id: int, db: AsyncSession = Depends(get_db)
) -> dict:
    """删除会议 (级联删除议程项)"""
    meeting = await db.get(Meeting, meeting_id)
    if not meeting or meeting.is_delete:
        raise HTTPException(status_code=404, detail="会议不存在")
    meeting.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
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
    if not meeting or meeting.is_delete:
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
    if not item or item.is_delete or item.meeting_id != meeting_id:
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
    if not item or item.is_delete or item.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="议程项不存在")
    item.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True, "id": item_id}
