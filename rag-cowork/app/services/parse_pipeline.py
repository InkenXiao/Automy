"""文档解析入库流水线 · 编排 MinIO 下载 → 解析 → 分块 → 向量化 → 抽取 → 三库写入

进程内 asyncio 后台执行 (替代 demo Redis Streams worker);
各阶段进度写 rag_parse_tasks, 三库写入结果写 rag_sync_events 台账 (失败可重试)。
"""
import asyncio
import logging
import tempfile
from pathlib import Path
from typing import List

from sqlalchemy import delete, select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import (
    RagChunk,
    RagDocument,
    RagEntity,
    RagMultimodalResource,
    RagParseTask,
    RagRelation,
    RagSyncEvent,
)
from app.services import (
    embedding_service,
    graph_service,
    milvus_store,
    minio_service,
    neo4j_store,
    parsers,
)
from app.services.snowflake import generate_id

logger = logging.getLogger(__name__)

# 实体抽取的分块采样上限 (控制 LLM 消耗: 首尾均匀采样)
MAX_EXTRACT_CHUNKS = 12


async def _update_task(task_id: int, stage: str, progress: int, status: str = "running", error: str = "") -> None:
    async with AsyncSessionLocal() as session:
        task = await session.get(RagParseTask, task_id)
        if task:
            task.stage = stage
            task.progress = progress
            task.status = status
            if error:
                task.error_msg = error
            await session.commit()


async def _set_doc_status(doc_id: int, status: str, error: str = "", **stats) -> None:
    async with AsyncSessionLocal() as session:
        doc = await session.get(RagDocument, doc_id)
        if doc:
            doc.parse_status = status
            doc.error_msg = error  # 空串表示清空旧错误 (如重解析成功)
            for k, v in stats.items():
                setattr(doc, k, v)
            await session.commit()


async def _log_event(action: str, target_type: str, target_id: int, doc_id: int, kb_id: int,
                     status: str, user_id: int, error: str = "") -> None:
    async with AsyncSessionLocal() as session:
        session.add(RagSyncEvent(
            event_id=generate_id(), action=action, target_type=target_type,
            target_id=target_id, doc_id=doc_id, kb_id=kb_id, status=status,
            error_msg=error, user_id=user_id,
        ))
        await session.commit()


def _chunk_text(text: str) -> List[str]:
    """按段落优先的定长分块 (目标 CHUNK_SIZE, 重叠 CHUNK_OVERLAP)"""
    size, overlap = settings.CHUNK_SIZE, settings.CHUNK_OVERLAP
    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    chunks: List[str] = []
    buf = ""
    for para in paragraphs:
        if len(buf) + len(para) + 1 <= size:
            buf = f"{buf}\n{para}" if buf else para
            continue
        if buf:
            chunks.append(buf)
            buf = buf[-overlap:] + "\n" + para if overlap and len(buf) > overlap else para
        else:
            # 单段超长: 硬切
            for i in range(0, len(para), size - overlap):
                chunks.append(para[i:i + size])
            buf = chunks.pop()[-overlap:] if chunks and overlap else ""
    if buf.strip():
        chunks.append(buf.strip())
    return [c for c in chunks if len(c.strip()) >= 10]


async def _set_kb_indexed(doc_id: int, indexed: bool) -> None:
    """回写 sys_files.kb_indexed (按 bucket+object_key 匹配; 异常仅告警不阻断)"""
    try:
        from sqlalchemy import text
        async with AsyncSessionLocal() as session:
            doc = await session.get(RagDocument, doc_id)
            if not doc or not doc.minio_path:
                return
            await session.execute(
                text(
                    "UPDATE sys_files SET kb_indexed = :v, updated_at = now() "
                    "WHERE bucket = :bk AND object_key = :key"
                ),
                {
                    "v": indexed,
                    "bk": doc.minio_bucket or settings.RAG_MINIO_BUCKET,
                    "key": doc.minio_path,
                },
            )
            await session.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning("sys_files kb_indexed 回写失败 doc_id=%s: %s", doc_id, e)


async def run_parse_pipeline(task_id: int, doc_id: int) -> None:
    """流水线主入口 (后台任务); 任何异常都落终态, 不抛出"""
    try:
        await _pipeline(task_id, doc_id)
    except Exception as e:  # noqa: BLE001
        logger.exception("解析流水线异常 doc_id=%s", doc_id)
        await _update_task(task_id, "failed", 100, status="failed", error=str(e)[:500])
        await _set_doc_status(doc_id, "failed", error=str(e)[:500])
        await _set_kb_indexed(doc_id, False)


async def _pipeline(task_id: int, doc_id: int) -> None:
    # ---- 0. 读取文档记录 ----
    async with AsyncSessionLocal() as session:
        doc = await session.get(RagDocument, doc_id)
        if not doc or doc.is_delete:
            return
        kb_id, user_id = doc.kb_id, doc.user_id
        file_name, minio_path, minio_bucket = doc.file_name, doc.minio_path, doc.minio_bucket
    await _set_doc_status(doc_id, "parsing")
    await _update_task(task_id, "parse", 5)

    # ---- 0.5 幂等清理: 重解析时先清除该文档旧的分块/实体/关系 (PG + Milvus + Neo4j) ----
    async with AsyncSessionLocal() as session:
        for model in (RagRelation, RagEntity, RagMultimodalResource, RagChunk):
            await session.execute(delete(model).where(model.doc_id == doc_id))
        await session.commit()
    for coll in (milvus_store.COLL_CHUNKS, milvus_store.COLL_RESOURCES,
                 milvus_store.COLL_ENTITIES, milvus_store.COLL_RELATIONS):
        try:
            await asyncio.to_thread(milvus_store.delete_by_doc, coll, doc_id)
        except Exception:  # noqa: BLE001
            pass
    try:
        await asyncio.to_thread(neo4j_store.delete_by_doc, doc_id)
    except Exception:  # noqa: BLE001
        pass

    # ---- 1. MinIO 下载到临时文件 ----
    data = await minio_service.download_bytes(minio_path, minio_bucket)
    if data is None:
        raise RuntimeError(f"MinIO 文件下载失败: {minio_path}")
    suffix = Path(file_name).suffix
    tmp = tempfile.NamedTemporaryFile(prefix=f"rag_doc_{doc_id}_", suffix=suffix, delete=False)
    tmp_path = Path(tmp.name)
    tmp.write(data)
    tmp.close()
    await _update_task(task_id, "parse", 10)

    try:
        # ---- 2. 解析为文本 (+多模态资源) ----
        parsed = await parsers.parse_file(tmp_path)
        text, engine = parsed["text"], parsed["engine"]
        resources = parsed.get("resources") or []
        await _update_task(task_id, "chunk", 30)

        # ---- 3. 分块 ----
        chunk_texts = await asyncio.to_thread(_chunk_text, text)
        if not chunk_texts:
            raise RuntimeError("分块结果为空, 文档无可入库内容")
        await _update_task(task_id, "embed", 40)

        # ---- 4. 向量化 (分批) ----
        vectors: List[List[float]] = []
        batch = 16
        for i in range(0, len(chunk_texts), batch):
            vectors.extend(await embedding_service.embed_texts(chunk_texts[i:i + batch]))
        await _update_task(task_id, "embed", 55)

        # ---- 5. PG chunks + Milvus 写入 ----
        chunk_rows: List[dict] = []
        async with AsyncSessionLocal() as session:
            for idx, (content, vec) in enumerate(zip(chunk_texts, vectors)):
                cid = generate_id()
                session.add(RagChunk(
                    chunk_id=cid, doc_id=doc_id, kb_id=kb_id, chunk_index=idx,
                    content=content, page_number=0, chunk_type="text",
                    milvus_id=cid, user_id=user_id,
                ))
                chunk_rows.append({
                    "chunk_id": cid, "kb_id": kb_id, "doc_id": doc_id,
                    "content": content[:8000], "embedding": vec,
                })
            await session.commit()
        try:
            await asyncio.to_thread(milvus_store.insert, milvus_store.COLL_CHUNKS, chunk_rows)
            await _log_event("insert", "chunk", 0, doc_id, kb_id, "completed", user_id)
        except Exception as e:  # noqa: BLE001
            await _log_event("insert", "chunk", 0, doc_id, kb_id, "failed", user_id, str(e)[:500])
            raise RuntimeError(f"Milvus 分块写入失败: {e}") from e
        await _update_task(task_id, "extract", 65)

        # ---- 6. 多模态资源入库 (图片/语音描述) ----
        for ridx, res in enumerate(resources):
            rid = generate_id()
            desc = res.get("content_desc") or ""
            async with AsyncSessionLocal() as session:
                session.add(RagMultimodalResource(
                    resource_id=rid, doc_id=doc_id, kb_id=kb_id,
                    resource_type=res.get("resource_type", "image"),
                    resource_index=ridx, minio_path=minio_path,
                    content_desc=desc, milvus_id=rid, user_id=user_id,
                ))
                await session.commit()
            if desc:
                try:
                    rvec = await embedding_service.embed_query(desc)
                    await asyncio.to_thread(milvus_store.insert, milvus_store.COLL_RESOURCES, [{
                        "resource_id": rid, "kb_id": kb_id, "doc_id": doc_id,
                        "description": desc[:4000], "embedding": rvec,
                    }])
                except Exception as e:  # noqa: BLE001
                    await _log_event("insert", "resource", rid, doc_id, kb_id, "failed", user_id, str(e)[:500])

        # ---- 7. 实体/关系抽取 (采样分块, 控制 LLM 消耗) ----
        sample = chunk_texts
        if len(chunk_texts) > MAX_EXTRACT_CHUNKS:
            step = len(chunk_texts) / MAX_EXTRACT_CHUNKS
            sample = [chunk_texts[int(i * step)] for i in range(MAX_EXTRACT_CHUNKS)]
        parts = [await graph_service.extract_from_chunk(c) for c in sample]
        merged = graph_service.merge_extraction(parts)
        entities, relations = merged["entities"], merged["relations"]
        await _update_task(task_id, "graph", 80)

        # ---- 8. PG entities/relations + Neo4j 写入 ----
        name_to_id: dict[str, int] = {}
        if entities:
            evecs = await embedding_service.embed_texts(
                [f"{e['name']}: {e['description']}" for e in entities]
            ) if entities else []
            async with AsyncSessionLocal() as session:
                for e, evec in zip(entities, evecs):
                    eid = generate_id()
                    name_to_id[e["name"]] = eid
                    session.add(RagEntity(
                        entity_id=eid, kb_id=kb_id, doc_id=doc_id,
                        entity_name=e["name"][:500], entity_type=e["type"][:90],
                        description=e["description"], weight=1.0, milvus_id=eid,
                        user_id=user_id,
                    ))
                await session.commit()
            try:
                await asyncio.to_thread(milvus_store.insert, milvus_store.COLL_ENTITIES, [
                    {"entity_id": name_to_id[e["name"]], "kb_id": kb_id, "doc_id": doc_id,
                     "name": e["name"][:500], "description": e["description"][:4000],
                     "embedding": evec}
                    for e, evec in zip(entities, evecs)
                ])
            except Exception as ex:  # noqa: BLE001
                await _log_event("insert", "entity", 0, doc_id, kb_id, "failed", user_id, str(ex)[:500])

        try:
            await asyncio.to_thread(neo4j_store.upsert_document, doc_id, kb_id, file_name)
            for e in entities:
                await asyncio.to_thread(
                    neo4j_store.upsert_entity, name_to_id[e["name"]], kb_id, doc_id,
                    e["name"], e["type"], e["description"],
                )
        except Exception as ex:  # noqa: BLE001
            await _log_event("insert", "entity", 0, doc_id, kb_id, "failed", user_id, f"neo4j: {str(ex)[:400]}")

        async with AsyncSessionLocal() as session:
            for r in relations:
                sid, tid = name_to_id.get(r["src"]), name_to_id.get(r["tgt"])
                if not sid or not tid:
                    continue
                session.add(RagRelation(
                    relation_id=generate_id(), kb_id=kb_id, doc_id=doc_id,
                    src_entity_id=sid, tgt_entity_id=tid,
                    relation_type=r["type"][:90], description=r["description"],
                    keywords=r["keywords"], user_id=user_id,
                ))
            await session.commit()
        for r in relations:
            sid, tid = name_to_id.get(r["src"]), name_to_id.get(r["tgt"])
            if not sid or not tid:
                continue
            try:
                await asyncio.to_thread(
                    neo4j_store.upsert_relation, sid, tid, kb_id, doc_id,
                    r["type"], r["description"], r["keywords"],
                )
            except Exception as ex:  # noqa: BLE001
                await _log_event("insert", "relation", 0, doc_id, kb_id, "failed", user_id, f"neo4j: {str(ex)[:400]}")

        # ---- 9. 终态 ----
        await _set_doc_status(
            doc_id, "done", parser_type=engine,
            total_chunks=len(chunk_texts),
            total_images=sum(1 for r in resources if r.get("resource_type") == "image"),
            total_tables=sum(1 for r in resources if r.get("resource_type") == "table"),
        )
        await _update_task(task_id, "done", 100, status="completed")
        await _set_kb_indexed(doc_id, True)
        logger.info("文档解析完成 doc_id=%s: %d 块, %d 实体, %d 关系", doc_id, len(chunk_texts), len(entities), len(relations))
    finally:
        tmp_path.unlink(missing_ok=True)


def launch_parse(task_id: int, doc_id: int) -> None:
    """以 asyncio 后台任务启动流水线 (不阻塞请求)"""
    asyncio.get_running_loop().create_task(run_parse_pipeline(task_id, doc_id))


async def create_and_launch_parse(doc_id: int) -> int:
    """建解析任务并后台启动, 返回 task_id"""
    async with AsyncSessionLocal() as session:
        doc = await session.get(RagDocument, doc_id)
        if not doc or doc.is_delete:
            raise RuntimeError("文档不存在")
        task = RagParseTask(
            task_id=generate_id(), doc_id=doc_id, kb_id=doc.kb_id,
            stage="parse", status="running", progress=0, user_id=doc.user_id,
        )
        session.add(task)
        await session.commit()
        task_id = task.task_id
    launch_parse(task_id, doc_id)
    return task_id
