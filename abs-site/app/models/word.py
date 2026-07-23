"""单词模型"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Word(Base):
    """单词"""

    __tablename__ = "vocab_words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    english: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    phonetic: Mapped[str] = mapped_column(String(128), default="")
    definition: Mapped[str] = mapped_column(Text, nullable=False)  # 核心 1-2 释义
    example: Mapped[str] = mapped_column(Text, default="")
    unit_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("vocab_units.id"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="new")  # new / learning / mastered
    consecutive_passes: Mapped[int] = mapped_column(Integer, default=0)
    learned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # 首次学习时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    # 关联
    unit: Mapped[Optional["Unit"]] = relationship("Unit", back_populates="words")

    def __repr__(self):
        return f"<Word {self.id} {self.english}>"
