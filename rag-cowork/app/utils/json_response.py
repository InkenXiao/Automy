"""大整数安全 JSON 响应 · 雪花 ID (>2^53) 序列化为字符串, 防前端 JS Number 精度丢失"""
from typing import Any

from fastapi.responses import JSONResponse

_MAX_SAFE_INT = 2**53 - 1


def _stringify(value: Any) -> Any:
    """递归将超出 JS 安全整数范围的 int 转为 str (bool 需先判, bool 是 int 子类)"""
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and abs(value) > _MAX_SAFE_INT:
        return str(value)
    if isinstance(value, dict):
        return {k: _stringify(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_stringify(v) for v in value]
    return value


class BigIntSafeJSONResponse(JSONResponse):
    """默认 JSON 响应的替代品: render 前对大整数做字符串化"""

    def render(self, content: Any) -> bytes:
        return super().render(_stringify(content))
