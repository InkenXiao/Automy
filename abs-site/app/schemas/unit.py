"""单元 Pydantic 模型"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.word import WordOut


class UnitCreate(BaseModel):
    name: str
    description: str = ""
    sort_order: int = 0


class UnitUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None


class UnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    sort_order: int
    created_at: Optional[datetime] = None
    words: List[WordOut] = []
