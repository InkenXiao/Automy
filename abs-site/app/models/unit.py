"""单词单元模型"""
from datetime import datetime
from typing import List

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import SoftDeleteMixin


class Unit(Base, SoftDeleteMixin):
    """单词单元 (词书分册)"""

    __tablename__ = "vocab_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )

    # 关联
    words: Mapped[List["Word"]] = relationship(
        "Word",
        back_populates="unit",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Unit {self.id} {self.name}>"
