"""Agent 相关 Schema"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AgentCreate(BaseModel):
    name: str
    type: str = "custom"
    description: str = ""
    system_prompt: str = ""
    config: dict = {}
    tools: list = []


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    config: Optional[dict] = None
    tools: Optional[list] = None
    is_active: Optional[bool] = None


class AgentOut(BaseModel):
    id: int
    name: str
    type: str
    description: str
    system_prompt: str
    config: dict
    tools: list
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SessionCreate(BaseModel):
    title: str = ""


class SessionOut(BaseModel):
    id: int
    agent_id: int
    title: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    tool_calls: Optional[dict] = None
    tool_results: Optional[dict] = None
    tokens_used: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[int] = None


class MemoryCreate(BaseModel):
    memory_type: str = "fact"
    key: str = ""
    content: str
    extra_data: dict = {}


class MemoryOut(BaseModel):
    id: int
    agent_id: int
    session_id: Optional[int] = None
    memory_type: str
    key: str
    content: str
    extra_data: dict
    created_at: datetime

    model_config = {"from_attributes": True}
