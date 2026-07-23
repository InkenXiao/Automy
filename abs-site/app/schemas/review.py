"""复习计划 Pydantic 模型"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.word import WordOut


class ReviewScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    word_id: int
    unit_id: Optional[int] = None
    interval_index: int
    scheduled_at: datetime
    completed_at: Optional[datetime] = None
    mark: Optional[str] = None
    status: str
    word: Optional[WordOut] = None


class StartLearningRequest(BaseModel):
    """开始学习某单元的新词"""
    unit_id: int


class MarkReviewRequest(BaseModel):
    """标记一次复习结果"""
    review_id: int
    mark: str  # pass / struggle / fail
