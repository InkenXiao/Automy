"""会议议程 schema · 含会议主体与议程项子资源"""
from pydantic import BaseModel, ConfigDict, field_validator


# ---------- 议程项 ----------
class MeetingItemCreate(BaseModel):
    """议程项创建请求"""

    item_time: str = ""
    theme: str = ""
    speaker: str = ""
    duration: str = ""
    note: str = ""
    description: str = ""
    sort_order: int = 0


class MeetingItemUpdate(BaseModel):
    """议程项更新请求 (全部字段可选)"""

    item_time: str | None = None
    theme: str | None = None
    speaker: str | None = None
    duration: str | None = None
    note: str | None = None
    description: str | None = None
    sort_order: int | None = None


class MeetingItemOut(MeetingItemCreate):
    """议程项输出"""

    id: int
    meeting_id: int
    model_config = ConfigDict(from_attributes=True)

    @field_validator("description", mode="before")
    @classmethod
    def _none_to_empty(cls, v):
        return v or ""


# ---------- 会议主体 ----------
class MeetingCreate(BaseModel):
    """会议创建请求 (可携带议程项批量创建)

    project_id 可选, 不传时由后端用当前激活项目填充
    """

    project_id: int | None = None  # ★所属项目ID (可选, 后端默认用当前激活项目)
    title: str = "项目周例会"
    meet_date: str = ""
    meet_time: str = ""
    place: str = ""
    host: str = ""
    attendees: str = ""
    description: str = ""
    sort_order: int = 0
    items: list[MeetingItemCreate] = []


class MeetingUpdate(BaseModel):
    """会议更新请求 (全部字段可选, project_id 不可改)"""

    title: str | None = None
    meet_date: str | None = None
    meet_time: str | None = None
    place: str | None = None
    host: str | None = None
    attendees: str | None = None
    description: str | None = None
    audio_file: str | None = None  # 原始录音文件名
    transcript: str | None = None  # 录音转写完整文字
    sort_order: int | None = None


class MeetingOut(BaseModel):
    """会议输出 (含议程项)"""

    id: int
    project_id: int  # ★所属项目ID
    title: str
    meet_date: str
    meet_time: str
    place: str
    host: str
    attendees: str
    description: str = ""
    audio_file: str = ""
    transcript: str = ""
    sort_order: int
    items: list[MeetingItemOut] = []
    model_config = ConfigDict(from_attributes=True)

    @field_validator("items", mode="before")
    @classmethod
    def _none_to_list(cls, v):
        """SQLAlchemy 异步模式下未加载的关系可能返回 None, 统一转为列表"""
        if v is None:
            return []
        return v
