"""会议议程模型 · 含会议主记录与议程项子表"""
from typing import List

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Meeting(Base, TimestampMixin):
    """会议主记录"""

    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(256), default="项目周例会")  # 会议主题
    meet_date: Mapped[str] = mapped_column(String(32), default="")  # 日期, 如 '2026-07-21'
    meet_time: Mapped[str] = mapped_column(String(32), default="")  # 时间, 如 '09:00-10:00'
    place: Mapped[str] = mapped_column(String(128), default="")  # 地点
    host: Mapped[str] = mapped_column(String(64), default="")  # 主持人
    attendees: Mapped[str] = mapped_column(Text, default="")  # 参会人员 (逗号分隔)
    description: Mapped[str] = mapped_column(Text, default="")  # 会议描述/纪要
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 关联议程项
    items: Mapped[List["MeetingItem"]] = relationship(
        "MeetingItem", back_populates="meeting", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Meeting {self.id} {self.title}>"


class MeetingItem(Base, TimestampMixin):
    """会议议程项"""

    __tablename__ = "meeting_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meetings.id", ondelete="CASCADE")
    )
    item_time: Mapped[str] = mapped_column(String(32), default="")  # 时间段, 如 '09:00-09:10'
    theme: Mapped[str] = mapped_column(String(256), default="")  # 议程主题
    speaker: Mapped[str] = mapped_column(String(64), default="")  # 汇报人
    duration: Mapped[str] = mapped_column(String(32), default="")  # 时长, 如 '10分钟'
    note: Mapped[str] = mapped_column(Text, default="")  # 备注
    description: Mapped[str] = mapped_column(Text, default="")  # 议程内容简介
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # 关联会议
    meeting: Mapped["Meeting"] = relationship("Meeting", back_populates="items")

    def __repr__(self):
        return f"<MeetingItem {self.id} {self.theme}>"
