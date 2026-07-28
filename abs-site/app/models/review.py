"""复习计划模型"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import SoftDeleteMixin


class ReviewSchedule(Base, SoftDeleteMixin):
    """复习计划 (艾宾浩斯 8 个间隔点)"""

    __tablename__ = "vocab_review_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    word_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("vocab_words.id"), nullable=False, index=True
    )
    unit_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("vocab_units.id"), nullable=True, index=True
    )
    interval_index: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-7 共 8 个间隔
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)  # 到期时间
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    mark: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # pass / struggle / fail
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending / done / skipped
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    # 关联
    word: Mapped[Optional["Word"]] = relationship("Word")

    def __repr__(self):
        return f"<ReviewSchedule {self.id} word={self.word_id} idx={self.interval_index}>"
