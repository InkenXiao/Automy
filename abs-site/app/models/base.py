"""ORM 模型基类与混入"""
from sqlalchemy import Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SoftDeleteMixin:
    """逻辑删除混入: is_delete=True 表示已软删除, 查询时需过滤"""

    is_delete: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
