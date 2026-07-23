"""项目阶段字典 schema"""
from datetime import date

from pydantic import BaseModel, ConfigDict


class PhaseBase(BaseModel):
    """阶段基础字段"""

    name: str
    subtitle: str = ""
    description: str = ""
    start_date: date
    end_date: date


class PhaseCreate(PhaseBase):
    """新建阶段请求"""


class PhaseOut(PhaseBase):
    """阶段输出"""

    id: int
    model_config = ConfigDict(from_attributes=True)
