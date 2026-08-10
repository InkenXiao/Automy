"""向量化服务 · OpenAI 兼容 embeddings 接口 + 向量清洗 (移植 demo 容错逻辑)"""
import logging
import math
from typing import List

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def clean_vector(vec: list, expected_dim: int = 0) -> List[float]:
    """清洗 NaN/Inf 并对齐维度 (零填充/截断), 避免 Milvus 插入报错"""
    cleaned = []
    for v in vec:
        try:
            f = float(v)
        except (TypeError, ValueError):
            f = 0.0
        if math.isnan(f) or math.isinf(f):
            f = 0.0
        cleaned.append(f)
    dim = expected_dim or settings.EMBEDDING_DIM
    if dim and len(cleaned) != dim:
        if len(cleaned) < dim:
            logger.warning("向量维度不足: 实际=%d, 期望=%d, 零填充", len(cleaned), dim)
            cleaned.extend([0.0] * (dim - len(cleaned)))
        else:
            logger.warning("向量维度超出: 实际=%d, 期望=%d, 截断", len(cleaned), dim)
            cleaned = cleaned[:dim]
    return cleaned


async def embed_texts(texts: List[str]) -> List[List[float]]:
    """批量向量化文本; 返回与输入等长的向量列表 (失败抛出 RuntimeError)"""
    if not settings.EMBEDDING_API_URL:
        raise RuntimeError("EMBEDDING 通道未配置 (EMBEDDING_API_URL)")
    if not texts:
        return []
    url = settings.EMBEDDING_API_URL.rstrip("/") + "/embeddings"
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0)
    ) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {settings.EMBEDDING_API_KEY}"},
            json={"model": settings.EMBEDDING_MODEL, "input": texts},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Embedding 接口 HTTP {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    items = sorted(data.get("data") or [], key=lambda x: x.get("index", 0))
    if len(items) != len(texts):
        raise RuntimeError(f"Embedding 返回数量不匹配: 期望 {len(texts)}, 实际 {len(items)}")
    return [clean_vector(it.get("embedding") or []) for it in items]


async def embed_query(text: str) -> List[float]:
    """单条查询向量化"""
    vectors = await embed_texts([text])
    return vectors[0] if vectors else []
