"""项目模块字典 schema"""
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ModuleBase(BaseModel):
    """模块基础字段"""

    project_id: Optional[int] = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    idx: str
    tag: str
    title: str
    owner: str = ""
    color: str = "#FF8C00"
    color_bg: str = "#FFF3E0"
    sort_order: int = 0


class ModuleCreate(ModuleBase):
    """新建模块请求"""


class ModuleUpdate(BaseModel):
    """更新模块请求 (全部字段可选, project_id 不可改)"""

    idx: str | None = None
    tag: str | None = None
    title: str | None = None
    owner: str | None = None
    color: str | None = None
    color_bg: str | None = None
    sort_order: int | None = None


class ModuleOut(ModuleBase):
    """模块输出"""

    id: int
    project_id: int  # ★所属项目ID
    model_config = ConfigDict(from_attributes=True)
