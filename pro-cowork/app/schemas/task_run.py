"""TaskRun 相关 Schema"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class TaskRunCreate(BaseModel):
    title: str = ""
    project_id: Optional[int] = None
    agent_id: Optional[int] = None  # 可不传: 执行时意图识别自动选择, 识别不了由用户选择
    skill_ids: list[int] = []
    file_names: list[str] = []
    input_text: str = ""


class TaskRunContinue(BaseModel):
    """任务继续对话: 补充内容 + 追加文件/技能"""

    input_text: str = ""
    file_names: list[str] = []
    skill_ids: list[int] = []


class TaskRunChoice(BaseModel):
    """意图识别失败时的用户选择 (在执行输出窗口中完成)"""

    agent_id: int
    skill_ids: list[int] = []


class TaskRunOut(BaseModel):
    id: int
    project_id: Optional[int] = None
    agent_id: Optional[int] = None
    title: str
    input_text: str
    skill_ids: list
    file_names: list
    status: str
    result_text: str
    session_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
