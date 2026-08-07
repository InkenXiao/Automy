"""操作日志中间件 · 自动记录 /api 全部写操作 (需求: 使用日志看板)"""
import logging
import re
from urllib.parse import unquote

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.services.log_service import record_operation

logger = logging.getLogger(__name__)

# path 首段 → 实体类型 (中文, 供看板分组)
ENTITY_MAP = {
    "meetings": "会议",
    "weekly-reports": "项目周报",
    "progress-tasks": "里程碑",
    "work-tasks": "周计划",
    "personal-reports": "个人周报",
    "project-members": "项目成员",
    "projects": "项目",
    "agents": "数字分身",
    "skills": "技能",
    "task-runs": "工作台任务",
    "modules": "模块",
    "phases": "阶段",
}

METHOD_ACTION = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}

# 不记录的路径前缀 (日志查询自身 / 登录)
_EXCLUDE_PREFIXES = ("/api/usage-logs", "/api/auth")


class OperationLogMiddleware(BaseHTTPMiddleware):
    """拦截 /api/ 下写操作, 按路径映射实体与动作落 operation_logs (异常静默)"""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        try:
            path = request.url.path
            method = request.method
            if (
                method in METHOD_ACTION
                and path.startswith("/api/")
                and not path.startswith(_EXCLUDE_PREFIXES)
                and 200 <= response.status_code < 300
            ):
                segments = [s for s in path[len("/api/"):].split("/") if s]
                head = segments[0] if segments else ""
                entity_type = ENTITY_MAP.get(head, head)
                action = METHOD_ACTION[method]
                # 特判: 技能/分身执行类端点记为 execute (调用情况统计)
                tail = segments[-1] if segments else ""
                if tail in ("execute", "test", "debug"):
                    action = "execute"
                # 尽力解析实体 id (首个纯数字段)
                entity_id = None
                for seg in segments[1:]:
                    if re.fullmatch(r"\d+", seg):
                        entity_id = int(seg)
                        break
                # 中文姓名经前端 URL 编码 (header 仅 Latin-1), 此处还原
                user_name = unquote((request.headers.get("x-user-name") or "").strip())
                await record_operation(
                    user_name=user_name,
                    method=method,
                    path=path,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    action=action,
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("操作日志中间件异常(已忽略): %s", e)

        return response
