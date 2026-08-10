"""ORM 模型基类与混入 (同 pro-cowork 约定)"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TimestampMixin:
    """自动维护 created_at / updated_at 时间戳"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )


class SoftDeleteMixin:
    """逻辑删除混入: is_delete=True 表示已软删除, 查询时需过滤"""

    is_delete: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False,
        comment="是否软删除: False正常/True已删除",
    )
