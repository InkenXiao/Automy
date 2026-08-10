"""mcp-cowork ORM 模型 · mcp_ 前缀 4 表 + sys_users 共享映射"""
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.services.snowflake import generate_id


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )


class SoftDeleteMixin:
    is_delete: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False,
        comment="是否软删除: False正常/True已删除",
    )


class SysUser(Base, TimestampMixin, SoftDeleteMixin):
    """共享用户表映射 (建表由 rag-cowork/mcp-cowork 任一方先行, create_all 幂等)"""
    __tablename__ = "sys_users"
    __table_args__ = {"comment": "系统用户表: rag/mcp/pro-cowork三系统共享登录用户"}

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="用户ID 主键(雪花ID)")
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True, comment="登录名(唯一)")
    password_hash: Mapped[str] = mapped_column(String(256), default="", server_default="", comment="密码哈希")
    display_name: Mapped[str] = mapped_column(String(64), default="", server_default="", comment="显示姓名")
    department: Mapped[str] = mapped_column(String(64), default="", server_default="", index=True, comment="所属部门")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", comment="是否启用")


class McpServer(Base, TimestampMixin, SoftDeleteMixin):
    """MCP 服务注册表"""
    __tablename__ = "mcp_servers"
    __table_args__ = {"comment": "MCP服务注册表"}

    server_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="服务ID 主键(雪花ID)")
    name: Mapped[str] = mapped_column(String(128), index=True, comment="服务名称")
    base_url: Mapped[str] = mapped_column(String(512), comment="服务地址URL")
    transport: Mapped[str] = mapped_column(String(32), default="streamable_http", server_default="streamable_http", comment="传输协议: streamable_http等")
    description: Mapped[str] = mapped_column(Text, default="", server_default="", comment="服务描述")
    status: Mapped[str] = mapped_column(String(16), default="unknown", server_default="unknown", comment="服务状态: unknown未知/online在线/offline离线")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="创建者用户ID (FK→sys_users.user_id)")


class McpTool(Base, TimestampMixin, SoftDeleteMixin):
    """tools/list 同步快照"""
    __tablename__ = "mcp_tools"
    __table_args__ = {"comment": "MCP工具表: tools/list同步快照"}

    tool_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="工具ID 主键(雪花ID)")
    server_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属服务ID (FK→mcp_servers.server_id)")
    tool_name: Mapped[str] = mapped_column(String(128), index=True, comment="工具名称")
    name_zh: Mapped[str] = mapped_column(String(128), default="", server_default="", comment="工具中文名(同步时从描述首行提取,可手工改)")
    description: Mapped[str] = mapped_column(Text, default="", server_default="", comment="工具描述")
    input_schema: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), comment="输入参数JSON Schema")
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        comment="最近同步时间",
    )
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, default=0, server_default="0", comment="创建者用户ID (FK→sys_users.user_id)")


class McpTestCase(Base, TimestampMixin, SoftDeleteMixin):
    """在线测试台保存的用例"""
    __tablename__ = "mcp_test_cases"
    __table_args__ = {"comment": "MCP测试用例表: 在线测试台保存的用例"}

    case_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="用例ID 主键(雪花ID)")
    server_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属服务ID (FK→mcp_servers.server_id)")
    tool_name: Mapped[str] = mapped_column(String(128), index=True, comment="工具名称")
    case_name: Mapped[str] = mapped_column(String(256), default="", server_default="", comment="用例名称")
    params: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), comment="调用参数JSON")
    last_result: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), comment="最近一次调用结果JSON")
    last_status: Mapped[str] = mapped_column(String(16), default="", server_default="", comment="最近一次调用状态: success成功/error失败")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="创建者用户ID (FK→sys_users.user_id)")


class McpCallLog(Base, TimestampMixin, SoftDeleteMixin):
    """全量调用日志 (统计页聚合依据)"""
    __tablename__ = "mcp_call_logs"
    __table_args__ = {"comment": "MCP调用日志表: 全量调用记录(统计页聚合依据)"}

    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="日志ID 主键(雪花ID)")
    server_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属服务ID (FK→mcp_servers.server_id)")
    tool_name: Mapped[str] = mapped_column(String(128), default="", server_default="", index=True, comment="工具名称")
    params: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), comment="调用参数JSON")
    result_excerpt: Mapped[str] = mapped_column(Text, default="", server_default="", comment="结果摘要")
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0", comment="耗时(毫秒)")
    status: Mapped[str] = mapped_column(String(16), default="success", server_default="success", comment="调用状态: success成功/error失败")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="调用用户ID (FK→sys_users.user_id)")


class McpImChannel(Base, TimestampMixin, SoftDeleteMixin):
    """个人 IM 通道配置: 飞书/企微/钉钉/邮箱/OA/Obsidian, 供数字分身 send_im 推送"""
    __tablename__ = "mcp_im_channels"
    __table_args__ = {"comment": "个人IM通道配置表: 飞书/企微/钉钉/邮箱/OA/Obsidian,每人可配多条"}

    channel_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="通道ID 主键(雪花ID)")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属用户ID (FK→sys_users.user_id)")
    channel_type: Mapped[str] = mapped_column(String(16), index=True, comment="通道类型: feishu飞书/wecom企微/dingtalk钉钉/email邮箱/oa办公/obsidian笔记")
    name: Mapped[str] = mapped_column(String(128), comment="通道名称(如: 我的飞书群机器人)")
    config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), comment="通道配置JSON(webhook/smtp/api_key等)")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", comment="是否启用")
    last_test_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True, comment="最近测试时间")
    last_test_status: Mapped[str] = mapped_column(String(16), default="", server_default="", comment="最近测试状态: success成功/error失败")
    last_test_error: Mapped[str] = mapped_column(String(512), default="", server_default="", comment="最近测试错误信息")


class McpInspectReport(Base, TimestampMixin, SoftDeleteMixin):
    """工具巡检报告: 定时/手动巡检的健康检查+工具变更+用例回归结果"""
    __tablename__ = "mcp_inspect_reports"
    __table_args__ = {"comment": "工具巡检报告表: 服务健康+工具变更diff+测试用例回归结果"}

    report_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, default=generate_id, comment="报告ID 主键(雪花ID)")
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, comment="所属用户ID (FK→sys_users.user_id)")
    trigger_type: Mapped[str] = mapped_column(String(16), default="manual", server_default="manual", comment="触发方式: manual手动/scheduled定时")
    verdict: Mapped[str] = mapped_column(String(16), default="pass", server_default="pass", comment="巡检结论: pass通过/warn有变更/fail回归失败或服务离线")
    summary: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), comment="统计摘要JSON(服务/工具变更/用例计数)")
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"), comment="巡检明细JSON(每服务diff+每用例结果)")
