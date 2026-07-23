"""单词 Pydantic 模型"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class WordCreate(BaseModel):
    english: str
    phonetic: str = ""
    definition: str
    example: str = ""
    unit_id: Optional[int] = None
    sort_order: int = 0


class WordUpdate(BaseModel):
    english: Optional[str] = None
    phonetic: Optional[str] = None
    definition: Optional[str] = None
    example: Optional[str] = None
    unit_id: Optional[int] = None
    sort_order: Optional[int] = None
    status: Optional[str] = None


class WordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    english: str
    phonetic: str
    definition: str
    example: str
    unit_id: Optional[int] = None
    sort_order: int
    status: str
    consecutive_passes: int
    learned_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class WordBatchImport(BaseModel):
    """批量导入 · 原始文本由后端解析"""
    text: str
