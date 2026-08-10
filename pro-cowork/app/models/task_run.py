"""TaskRun 模型 · 工作台任务 (项目 × 文件 × 智能体 × 技能)"""
from typing import Optional

from sqlalchemy import (
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class TaskRun(Base, TimestampMixin, SoftDeleteMixin):
    """工作台任务: 选择项目/文件/智能体/技能后的一次执行记录"""

    __tablename__ = "task_runs"
    __table_args__ = {"comment": "工作台任务表 (选择项目/文件/智能体/技能后的一次执行记录)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    project_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("pro_projects.id", ondelete="SET NULL"), nullable=True,
        comment="所属项目ID (FK→pro_projects.id, 可空)"
    )
    agent_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=True,
        comment="执行智能体ID (FK→agents.id, 可空: 创建时不指定, 由意图识别/用户选择确定)"
    )
    title: Mapped[str] = mapped_column(String(256), default="", comment="任务标题")
    input_text: Mapped[str] = mapped_column(Text, default="", comment="用户输入文本")
    skill_ids: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", comment="选用的技能ID列表 (JSON)")
    file_names: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", comment="附件文件名列表 (JSON)")
    status: Mapped[str] = mapped_column(
        String(16), default="draft", comment="状态: draft草稿/running执行中/done已完成/failed失败"
    )
    user_name: Mapped[str] = mapped_column(
        String(64), default="", index=True, comment="创建人姓名 (首页看板按人过滤)"
    )
    result_text: Mapped[str] = mapped_column(Text, default="", comment="执行结果文本")
    session_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_sessions.id", ondelete="SET NULL"), nullable=True,
        comment="关联会话ID (FK→agent_sessions.id, 可空)"
    )


class TaskRunEvent(Base, TimestampMixin, SoftDeleteMixin):
    """任务执行过程事件 (后台执行持久化, 供过程回放/断线续看)

    type: user / content / tool_call / tool_result / error / done
          intent(意图识别) / choice_request(等待用户选择) / choice_done(选择完成)
          model(模型调用) / asr_segment(转写分段) / asr_done(转写完成) / minutes_delta(纪要流式增量)
    payload: content→{"content"}; tool_call→{"arguments"}; tool_result→{"result","duration_ms"}
    """

    __tablename__ = "task_run_events"
    __table_args__ = {"comment": "任务执行事件表 (过程回放/断线续看)"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_runs.id", ondelete="CASCADE"), nullable=False, index=True,
        comment="所属任务ID (FK→task_runs.id)"
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False, comment="事件序号 (任务内单调递增)")
    type: Mapped[str] = mapped_column(String(16), nullable=False, comment="事件类型: user/content/tool_call/tool_result/error/done/intent/choice_request/choice_done/model/asr_segment/asr_done/minutes_delta")
    name: Mapped[str] = mapped_column(String(64), default="", comment="工具名 (tool_* 事件)")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", comment="事件载荷 (JSON)")
