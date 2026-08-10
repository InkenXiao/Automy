"""雪花 ID 生成器 (移植自 demo/RAG-Anything ragsync/core/snowflake.py)

64 位: 1 符号位 + 41 毫秒时间戳(自定义纪元) + 10 工作节点 + 12 序列号
惰性初始化: 首次 generate_id() 时按 SNOWFLAKE_WORKER_ID 初始化, 免显式 init。
"""
import os
import threading
import time

_EPOCH = 1609459200000  # 2021-01-01 UTC
_WORKER_BITS = 10
_SEQ_BITS = 12
_MAX_WORKER = (1 << _WORKER_BITS) - 1
_MAX_SEQ = (1 << _SEQ_BITS) - 1

_lock = threading.Lock()
_worker_id = -1
_last_ms = -1
_seq = 0


def _ensure_init():
    global _worker_id
    if _worker_id < 0:
        wid = int(os.getenv("SNOWFLAKE_WORKER_ID", "1"))
        _worker_id = wid & _MAX_WORKER


def generate_id() -> int:
    """生成全局唯一雪花 ID (线程安全)"""
    global _last_ms, _seq
    _ensure_init()
    with _lock:
        now = int(time.time() * 1000)
        if now == _last_ms:
            _seq = (_seq + 1) & _MAX_SEQ
            if _seq == 0:  # 同毫秒序列耗尽, 自旋到下一毫秒
                while now <= _last_ms:
                    now = int(time.time() * 1000)
        else:
            _seq = 0
        _last_ms = now
        return ((now - _EPOCH) << (_WORKER_BITS + _SEQ_BITS)) | (_worker_id << _SEQ_BITS) | _seq
