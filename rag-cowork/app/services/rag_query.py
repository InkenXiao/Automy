"""RAG 检索问答服务 · Milvus 向量 + Neo4j 图谱混合检索 → LLM 生成 (含引用)

- search: 纯检索, 返回分块/实体命中 (不生成答案)
- query : 检索 + 图谱上下文 + LLM 生成带引用的答案, 写 rag_query_logs
"""
import asyncio
import logging
import time
from typing import Dict, List, Optional

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import RagEntity, RagQueryLog
from app.services import embedding_service, llm_service, milvus_store, neo4j_store
from app.services.snowflake import generate_id

logger = logging.getLogger(__name__)

_ANSWER_SYSTEM = """你是知识库问答助手。基于给定的【检索内容】与【知识图谱关系】回答用户问题。
要求:
1. 仅依据给定材料回答, 材料不足时明确说明"知识库中未找到足够信息";
2. 回答末尾用 [来源: 文档名] 标注引用来源 (按材料中给出的文档名);
3. 回答简洁准确, 使用中文。"""


async def search(kb_ids: List[int], query: str, top_k: int = 10,
                 allowed_doc_ids: Optional[set] = None) -> Dict:
    """纯检索: 向量召回分块 + 实体, 返回命中列表

    allowed_doc_ids 不为 None 时, 按文档级授权过滤命中结果。
    """
    qvec = await embedding_service.embed_query(query)
    # 有文档级限制时放大召回量, 过滤后补足 top_k
    fetch_k = top_k * 3 if allowed_doc_ids is not None else top_k
    chunk_hits, entity_hits = await asyncio.gather(
        asyncio.to_thread(
            milvus_store.search, milvus_store.COLL_CHUNKS, qvec, kb_ids, fetch_k,
            ["content", "doc_id", "kb_id"],
        ),
        asyncio.to_thread(
            milvus_store.search, milvus_store.COLL_ENTITIES, qvec, kb_ids, fetch_k,
            ["name", "description", "doc_id", "kb_id"],
        ),
    )

    # 文档级授权过滤
    if allowed_doc_ids is not None:
        chunk_hits = [h for h in chunk_hits if h.get("doc_id") in allowed_doc_ids]
        entity_hits = [h for h in entity_hits if h.get("doc_id") in allowed_doc_ids]
    chunk_hits = chunk_hits[:top_k]
    entity_hits = entity_hits[:top_k]

    # 补充文档名 (按 doc_id 批量查 PG)
    doc_ids = list({h.get("doc_id") for h in chunk_hits + entity_hits if h.get("doc_id")})
    doc_names: Dict[int, str] = {}
    if doc_ids:
        from app.models import RagDocument
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(RagDocument.doc_id, RagDocument.file_name).where(
                    RagDocument.doc_id.in_(doc_ids), RagDocument.is_delete.is_(False)
                )
            )
            doc_names = {did: fname for did, fname in result.all()}
    for h in chunk_hits + entity_hits:
        h["file_name"] = doc_names.get(h.get("doc_id"), "")

    return {"chunks": chunk_hits, "entities": entity_hits}


async def query(kb_ids: List[int], question: str, mode: str = "hybrid",
                top_k: int = 8, user_id: int = 0,
                allowed_doc_ids: Optional[set] = None,
                agent_id: int = 0, skill_id: int = 0) -> Dict:
    """RAG 问答: hybrid=向量+图谱; local=仅向量; global=仅图谱实体"""
    started = time.time()
    result = await search(kb_ids, question, top_k, allowed_doc_ids=allowed_doc_ids) \
        if mode in ("hybrid", "local") else {"chunks": [], "entities": []}

    # 图谱上下文: 命中实体的邻域关系
    graph_rows: List[Dict] = []
    if mode in ("hybrid", "global"):
        names = [h.get("name", "") for h in result.get("entities", []) if h.get("name")]
        if names:
            try:
                graph_rows = await asyncio.to_thread(neo4j_store.entity_context, names, kb_ids)
            except Exception as e:  # noqa: BLE001
                logger.warning("Neo4j 图谱上下文查询失败: %s", e)

    # 组装 prompt
    chunk_lines = []
    for i, h in enumerate(result.get("chunks", []), start=1):
        src = h.get("file_name") or "未知文档"
        chunk_lines.append(f"[材料{i}] (来源: {src})\n{(h.get('content') or '')[:800]}")
    entity_lines = [
        f"- {h.get('name')}: {(h.get('description') or '')[:200]}"
        for h in result.get("entities", [])
    ]
    graph_lines = [
        f"- {g['src']} --{g['type']}--> {g['tgt']}: {(g.get('desc') or '')[:150]}"
        for g in graph_rows
    ]
    prompt = (
        f"【检索内容】\n" + ("\n\n".join(chunk_lines) or "(无)")
        + f"\n\n【相关实体】\n" + ("\n".join(entity_lines) or "(无)")
        + f"\n\n【知识图谱关系】\n" + ("\n".join(graph_lines) or "(无)")
        + f"\n\n【用户问题】\n{question}"
    )
    answer = await llm_service.chat_main(prompt, system=_ANSWER_SYSTEM)

    latency = int((time.time() - started) * 1000)
    hit_count = len(result.get("chunks", [])) + len(result.get("entities", []))

    # 检索来源摘要 (供问答明细展示: 问题/检索结果/生成内容)
    sources = [
        {
            "doc_id": h.get("doc_id"), "file_name": h.get("file_name") or "",
            "kind": "chunk", "score": h.get("score") if h.get("score") is not None else h.get("distance"),
            "content": (h.get("content") or "")[:200],
        }
        for h in result.get("chunks", [])
    ] + [
        {
            "doc_id": h.get("doc_id"), "file_name": h.get("file_name") or "",
            "kind": "entity", "score": h.get("score") if h.get("score") is not None else h.get("distance"),
            "content": f"{h.get('name', '')}: {(h.get('description') or '')[:150]}",
        }
        for h in result.get("entities", [])
    ]

    # 检索日志
    async with AsyncSessionLocal() as session:
        session.add(RagQueryLog(
            log_id=generate_id(), user_id=user_id, kb_ids=kb_ids, query=question,
            mode=mode, answer_excerpt=answer[:2000], hit_count=hit_count, latency_ms=latency,
            agent_id=agent_id or 0, skill_id=skill_id or 0, sources=sources,
        ))
        await session.commit()

    return {
        "answer": answer,
        "mode": mode,
        "hits": result.get("chunks", []),
        "entities": result.get("entities", []),
        "graph": graph_rows,
        "hit_count": hit_count,
        "latency_ms": latency,
    }
