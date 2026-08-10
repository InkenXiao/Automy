"""雪花 ID 生成器 (与 rag-cowork/mcp-cowork 同算法, worker_id 由配置区分: rag=1/mcp=2/pro=3)

惰性初始化: 首次 generate_id() 时按 SNOWFLAKE_WORKER_ID 初始化, 免显式 init。
"""
import threading
import time

from app.config import settings

_EPOCH = 1735689600000  # 2025-01-01 00:00:00 UTC
_WORKER_BITS = 10
_SEQ_BITS = 12
_MAX_SEQ = (1 << _SEQ_BITS) - 1

_lock = threading.Lock()
_last_ms = 0
_seq = 0
_worker_id = 0
_inited = False


def _ensure_init() -> None:
    global _worker_id, _inited
    if not _inited:
        _worker_id = settings.SNOWFLAKE_WORKER_ID & ((1 << _WORKER_BITS) - 1)
        _inited = True


def generate_id() -> int:
    global _last_ms, _seq
    _ensure_init()
    with _lock:
        now = int(time.time() * 1000)
        if now == _last_ms:
            _seq = (_seq + 1) & _MAX_SEQ
            if _seq == 0:
                while now <= _last_ms:
                    now = int(time.time() * 1000)
        else:
            _seq = 0
        _last_ms = now
        return ((now - _EPOCH) << (_WORKER_BITS + _SEQ_BITS)) | (_worker_id << _SEQ_BITS) | _seq
