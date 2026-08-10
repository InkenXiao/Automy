"""模型汇总: 导入即注册全部表到 Base.metadata"""
from app.models.base import SoftDeleteMixin, TimestampMixin
from app.models.document import RagChunk, RagDocument, RagMultimodalResource
from app.models.graph import RagEntity, RagRelation
from app.models.knowledge import KB_LEVELS, RagDocPermission, RagKbPermission, RagKnowledgeBase
from app.models.obsidian import RagObsidianConfig
from app.models.sync import RagParseTask, RagQueryLog, RagSyncEvent
from app.models.user import SysUser

__all__ = [
    "SoftDeleteMixin",
    "TimestampMixin",
    "SysUser",
    "KB_LEVELS",
    "RagKnowledgeBase",
    "RagKbPermission",
    "RagDocPermission",
    "RagDocument",
    "RagChunk",
    "RagMultimodalResource",
    "RagEntity",
    "RagRelation",
    "RagSyncEvent",
    "RagParseTask",
    "RagQueryLog",
    "RagObsidianConfig",
]
