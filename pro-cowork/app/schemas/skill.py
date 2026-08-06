"""Skill 相关 Schema"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SkillCreate(BaseModel):
    name: str
    description: str = ""
    category: str = ""
    trigger_type: str = "manual"
    config: dict = {}
    code: str = ""


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    trigger_type: Optional[str] = None
    config: Optional[dict] = None
    code: Optional[str] = None
    is_active: Optional[bool] = None


class SkillOut(BaseModel):
    id: int
    name: str
    description: str
    category: str
    trigger_type: str
    config: dict
    code: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SkillExecuteRequest(BaseModel):
    input_data: dict = {}


class SkillTestRequest(BaseModel):
    """技能调试请求: prior_results 为前几轮测试的 steps 结果, 供 {{results.N}} 上下文引用"""

    input_data: dict = {}
    prior_results: list = []


class SkillExecutionOut(BaseModel):
    id: int
    skill_id: int
    session_id: Optional[int] = None
    input_data: dict
    output_data: dict
    status: str
    error: str
    duration_ms: int
    created_at: datetime

    model_config = {"from_attributes": True}
