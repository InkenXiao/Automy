"""操作日志中间件 · 自动记录 /api 全部写操作 (需求: 使用日志看板)"""
import json
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

# 请求体捕获上限 (字节), 超过则不记录详情
_MAX_BODY = 64 * 1024

# 脱敏字段 (键名小写匹配)
_SENSITIVE_KEYS = {
    "password", "old_password", "new_password", "pwd",
    "token", "secret", "api_key", "apikey", "authorization",
}


def _mask_sensitive(obj, depth: int = 0):
    """递归脱敏请求体中的敏感字段"""
    if depth > 8:
        return obj
    if isinstance(obj, dict):
        return {
            k: ("***" if str(k).lower() in _SENSITIVE_KEYS else _mask_sensitive(v, depth + 1))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_mask_sensitive(v, depth + 1) for v in obj[:100]]
    return obj


async def _extract_detail(request: Request) -> str:
    """提取请求体作为操作详情 (仅 JSON; 敏感字段脱敏; 异常返回空串)

    BaseHTTPMiddleware 的 _CachedRequest 会缓存 body, 此处读取不影响下游。
    """
    try:
        ctype = (request.headers.get("content-type") or "").lower()
        if "application/json" not in ctype:
            return ""
        length = int(request.headers.get("content-length") or 0)
        if length <= 0 or length > _MAX_BODY:
            return ""
        raw = await request.body()
        if not raw:
            return ""
        data = json.loads(raw.decode("utf-8", "ignore"))
        return json.dumps(_mask_sensitive(data), ensure_ascii=False, separators=(",", ":"))
    except Exception:  # noqa: BLE001
        return ""


class OperationLogMiddleware(BaseHTTPMiddleware):
    """拦截 /api/ 下写操作, 按路径映射实体与动作落 operation_logs (异常静默)"""

    async def dispatch(self, request: Request, call_next):
        # 预读写操作请求体作为操作详情 (_CachedRequest 缓存, 不影响下游解析)
        path = request.url.path
        detail = ""
        if (
            request.method in METHOD_ACTION
            and path.startswith("/api/")
            and not path.startswith(_EXCLUDE_PREFIXES)
        ):
            detail = await _extract_detail(request)
            if not detail and request.url.query:
                detail = f"query: {request.url.query}"

        response = await call_next(request)

        try:
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
                    detail=detail,
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("操作日志中间件异常(已忽略): %s", e)

        return response
