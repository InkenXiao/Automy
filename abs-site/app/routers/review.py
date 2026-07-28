"""复习路由 (艾宾浩斯 8 点复习引擎)"""
from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.database import get_db
from app.models.review import ReviewSchedule
from app.models.word import Word
from app.schemas.review import (
    MarkReviewRequest,
    ReviewScheduleOut,
    StartLearningRequest,
)
from app.schemas.word import WordOut

router = APIRouter(prefix="/review", tags=["复习"])

# 艾宾浩斯 8 个复习间隔 (从首次学习时间起算)
INTERVAL_OFFSETS: List[timedelta] = [
    timedelta(minutes=5),       # 0
    timedelta(minutes=30),      # 1
    timedelta(hours=12),        # 2
    timedelta(days=1),          # 3
    timedelta(days=2),          # 4
    timedelta(days=4),          # 5
    timedelta(days=7),          # 6
    timedelta(days=15),         # 7
]


def _start_of_today() -> datetime:
    return datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)


@router.post("/start-learning")
async def start_learning(
    payload: StartLearningRequest, db: AsyncSession = Depends(get_db)
):
    """开始学习某单元的全部新词, 为每个新词创建 8 条复习计划"""
    now = datetime.now()

    stmt = select(Word).where(
        Word.unit_id == payload.unit_id,
        Word.status == "new",
        Word.is_delete.is_(False),
    ).order_by(Word.sort_order, Word.id)
    result = await db.execute(stmt)
    new_words = result.scalars().all()

    started = 0
    for word in new_words:
        word.status = "learning"
        word.learned_at = now
        word.consecutive_passes = 0
        for idx, offset in enumerate(INTERVAL_OFFSETS):
            db.add(
                ReviewSchedule(
                    word_id=word.id,
                    unit_id=word.unit_id,
                    interval_index=idx,
                    scheduled_at=now + offset,
                    status="pending",
                )
            )
        started += 1

    await db.flush()
    return {"started": started, "unit_id": payload.unit_id}


@router.get("/today-reviews")
async def today_reviews(db: AsyncSession = Depends(get_db)):
    """获取今日及逾期的待复习计划 (含断更恢复)"""
    now = datetime.now()
    start_of_today = _start_of_today()

    stmt = (
        select(ReviewSchedule)
        .options(
            selectinload(ReviewSchedule.word),
            with_loader_criteria(Word, Word.is_delete.is_(False)),
        )
        .where(
            ReviewSchedule.status == "pending",
            ReviewSchedule.scheduled_at <= now,
            ReviewSchedule.is_delete.is_(False),
        )
        .order_by(ReviewSchedule.scheduled_at.asc())
    )
    result = await db.execute(stmt)
    reviews = result.scalars().all()

    overdue_count = sum(1 for r in reviews if r.scheduled_at < start_of_today)

    return {
        "reviews": [ReviewScheduleOut.model_validate(r) for r in reviews],
        "count": len(reviews),
        "overdue_count": overdue_count,
    }


@router.post("/mark-review", response_model=ReviewScheduleOut)
async def mark_review(
    payload: MarkReviewRequest, db: AsyncSession = Depends(get_db)
):
    """标记一次复习结果 (pass / struggle / fail)"""
    if payload.mark not in ("pass", "struggle", "fail"):
        raise HTTPException(status_code=400, detail="mark must be pass/struggle/fail")

    now = datetime.now()

    stmt = (
        select(ReviewSchedule)
        .options(
            selectinload(ReviewSchedule.word),
            with_loader_criteria(Word, Word.is_delete.is_(False)),
        )
        .where(ReviewSchedule.id == payload.review_id, ReviewSchedule.is_delete.is_(False))
    )
    result = await db.execute(stmt)
    review = result.scalar_one_or_none()
    if review is None or review.is_delete:
        raise HTTPException(status_code=404, detail="Review not found")

    word = review.word
    if word is None:
        raise HTTPException(status_code=404, detail="Word not found for review")

    # 1. 标记本次复习完成
    review.status = "done"
    review.mark = payload.mark
    review.completed_at = now

    interval_index = review.interval_index

    if payload.mark == "pass":
        word.consecutive_passes = (word.consecutive_passes or 0) + 1
        if word.consecutive_passes >= 3:
            word.status = "mastered"
            # 已掌握且非最后间隔: 跳过该单词剩余待复习计划
            if interval_index < 7:
                skip_stmt = (
                    update(ReviewSchedule)
                    .where(
                        ReviewSchedule.word_id == word.id,
                        ReviewSchedule.status == "pending",
                        ReviewSchedule.id != review.id,
                        ReviewSchedule.is_delete.is_(False),
                    )
                    .values(status="skipped")
                    .execution_options(synchronize_session=False)
                )
                await db.execute(skip_stmt)

    elif payload.mark == "struggle":
        # 未真正通过, 重置连续通过数; 下一待复习计划保持不变
        word.consecutive_passes = 0

    else:  # fail
        word.consecutive_passes = 0
        # 先刷新, 让本次 done 状态落入 DB, 再查询剩余 pending
        await db.flush()
        next_pending = await db.scalar(
            select(ReviewSchedule)
            .where(
                ReviewSchedule.word_id == word.id,
                ReviewSchedule.status == "pending",
                ReviewSchedule.is_delete.is_(False),
            )
            .order_by(ReviewSchedule.interval_index.asc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
        retest_at = now + timedelta(minutes=5)
        if next_pending is not None:
            next_pending.scheduled_at = retest_at
        else:
            db.add(
                ReviewSchedule(
                    word_id=word.id,
                    unit_id=review.unit_id,
                    interval_index=0,
                    scheduled_at=retest_at,
                    status="pending",
                )
            )

    await db.flush()

    # 重新加载以返回最新状态 (含 word 关系)
    refresh_stmt = (
        select(ReviewSchedule)
        .options(
            selectinload(ReviewSchedule.word),
            with_loader_criteria(Word, Word.is_delete.is_(False)),
        )
        .where(ReviewSchedule.id == review.id, ReviewSchedule.is_delete.is_(False))
    )
    refresh_result = await db.execute(refresh_stmt)
    fresh = refresh_result.scalar_one()
    return ReviewScheduleOut.model_validate(fresh)


@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    """仪表盘统计数据"""
    now = datetime.now()
    today_date = now.date()
    start_of_today = _start_of_today()

    # today_pending: 待复习且已到期
    today_pending = await db.scalar(
        select(func.count(ReviewSchedule.id)).where(
            ReviewSchedule.status == "pending",
            ReviewSchedule.scheduled_at <= now,
            ReviewSchedule.is_delete.is_(False),
        )
    ) or 0

    # today_learned: 今日首次学习的单词数
    today_learned = await db.scalar(
        select(func.count(Word.id)).where(
            Word.learned_at >= start_of_today,
            Word.is_delete.is_(False),
        )
    ) or 0

    # mastered
    mastered = await db.scalar(
        select(func.count(Word.id)).where(
            Word.status == "mastered",
            Word.is_delete.is_(False),
        )
    ) or 0

    # total_words
    total_words = await db.scalar(
        select(func.count(Word.id)).where(Word.is_delete.is_(False))
    ) or 0

    # learning_words
    learning_words = await db.scalar(
        select(func.count(Word.id)).where(
            Word.status == "learning",
            Word.is_delete.is_(False),
        )
    ) or 0

    # new_words
    new_words = await db.scalar(
        select(func.count(Word.id)).where(
            Word.status == "new",
            Word.is_delete.is_(False),
        )
    ) or 0

    # stubborn: learning 且 consecutive_passes==0 且 存在 mark=fail 的复习记录
    fail_word_ids = (
        select(ReviewSchedule.word_id)
        .where(
            ReviewSchedule.mark == "fail",
            ReviewSchedule.is_delete.is_(False),
        )
        .distinct()
    )
    stubborn = await db.scalar(
        select(func.count(Word.id)).where(
            Word.status == "learning",
            Word.consecutive_passes == 0,
            Word.id.in_(fail_word_ids),
            Word.is_delete.is_(False),
        )
    ) or 0

    # streak_days & weekly_reviews: 查询全部已完成复习的 completed_at
    completed_stmt = select(ReviewSchedule.completed_at).where(
        ReviewSchedule.completed_at.is_not(None),
        ReviewSchedule.is_delete.is_(False),
    )
    completed_result = await db.execute(completed_stmt)
    completed_datetimes = completed_result.scalars().all()
    completed_dates = {dt.date() for dt in completed_datetimes}

    # streak: 连续有完成复习的天数 (今天还没完成则从昨天起算)
    streak = 0
    check_date = today_date
    if check_date not in completed_dates:
        check_date = check_date - timedelta(days=1)
    while check_date in completed_dates:
        streak += 1
        check_date = check_date - timedelta(days=1)

    # weekly_reviews: 过去 7 天 (含今天) 每日完成复习数
    weekly_reviews: List[Dict[str, Any]] = []
    for i in range(6, -1, -1):
        d = today_date - timedelta(days=i)
        cnt = sum(1 for dt in completed_datetimes if dt.date() == d)
        weekly_reviews.append({"date": d.strftime("%Y-%m-%d"), "count": cnt})

    return {
        "today_pending": today_pending,
        "today_learned": today_learned,
        "mastered": mastered,
        "stubborn": stubborn,
        "total_words": total_words,
        "learning_words": learning_words,
        "new_words": new_words,
        "streak_days": streak,
        "weekly_reviews": weekly_reviews,
    }


@router.get("/stubborn-words")
async def stubborn_words(db: AsyncSession = Depends(get_db)):
    """顽固单词: 存在 fail 复习记录且未掌握, 附带 fail 次数"""
    fail_word_ids = (
        select(ReviewSchedule.word_id)
        .where(
            ReviewSchedule.mark == "fail",
            ReviewSchedule.is_delete.is_(False),
        )
        .distinct()
    )

    stmt = (
        select(Word)
        .where(
            Word.status != "mastered",
            Word.id.in_(fail_word_ids),
            Word.is_delete.is_(False),
        )
        .order_by(Word.id)
    )
    result = await db.execute(stmt)
    words = result.scalars().all()

    if not words:
        return {"words": [], "count": 0}

    word_ids = [w.id for w in words]

    # 统计每个单词的 fail 次数
    count_stmt = (
        select(ReviewSchedule.word_id, func.count(ReviewSchedule.id).label("fail_count"))
        .where(
            ReviewSchedule.word_id.in_(word_ids),
            ReviewSchedule.mark == "fail",
            ReviewSchedule.is_delete.is_(False),
        )
        .group_by(ReviewSchedule.word_id)
    )
    count_result = await db.execute(count_stmt)
    fail_count_map = {
        row.word_id: row.fail_count for row in count_result
    }

    items = []
    for w in words:
        item = WordOut.model_validate(w).model_dump()
        item["fail_count"] = fail_count_map.get(w.id, 0)
        items.append(item)

    return {"words": items, "count": len(items)}
