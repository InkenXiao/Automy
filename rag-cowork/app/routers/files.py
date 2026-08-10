"""知识库文件路由 · 上传 (MinIO 归档) / 列表 / 删除 / 原文下载 / 分块四库明细"""
import asyncio
import hashlib

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import accessible_doc_ids, require_kb_access, require_user
from app.models import RagChunk, RagDocPermission, RagDocument, RagParseTask, SysUser
from app.services import milvus_store, minio_service, neo4j_store, parse_pipeline
from app.services.snowflake import generate_id

router = APIRouter(prefix="/files", tags=["知识库文件"])

MAX_UPLOAD_MB = 100


def _doc_dict(d: RagDocument, perm_count: int = 0) -> dict:
    return {
        "doc_id": d.doc_id,
        "kb_id": d.kb_id,
        "file_name": d.file_name,
        "file_ext": d.file_ext,
        "file_size": d.file_size,
        "parse_status": d.parse_status,
        "parser_type": d.parser_type,
        "total_chunks": d.total_chunks,
        "error_msg": d.error_msg,
        "created_at": d.created_at.isoformat() if d.created_at else "",
        "perm_count": perm_count,
    }


@router.post("/upload")
async def upload_file(kb_id: int, file: UploadFile, user: SysUser = Depends(require_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """上传文件到知识库: MinIO 归档 + 建 rag_documents(pending); 返回 doc_id 供触发解析"""
    kb = await require_kb_access(db, kb_id, user, write=True)
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"文件超过 {MAX_UPLOAD_MB}MB 限制")

    file_name = file.filename or "unnamed"
    file_hash = hashlib.sha256(data).hexdigest()

    # 同库哈希去重
    dup = (await db.execute(
        select(RagDocument).where(
            RagDocument.is_delete.is_(False),
            RagDocument.kb_id == kb.kb_id,
            RagDocument.file_hash == file_hash,
        )
    )).scalars().first()
    if dup:
        return {"ok": True, "duplicate": True, "doc": _doc_dict(dup), "msg": "相同文件已存在, 直接复用"}

    object_key = await minio_service.upload_bytes(
        kb.kb_id, file_name, data, file.content_type or "application/octet-stream"
    )
    if object_key is None:
        raise HTTPException(status_code=500, detail="MinIO 归档失败, 请检查对象存储配置")

    doc = RagDocument(
        doc_id=generate_id(), kb_id=kb.kb_id, file_name=file_name,
        file_ext=file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "",
        file_size=len(data), file_hash=file_hash,
        minio_bucket=settings.RAG_MINIO_BUCKET,
        minio_path=object_key, parse_status="pending", user_id=user.user_id,
    )
    db.add(doc)
    await db.commit()
    return {"ok": True, "duplicate": False, "doc": _doc_dict(doc)}


@router.get("")
async def list_files(kb_id: int, user: SysUser = Depends(require_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """知识库文件列表 (附最新解析任务进度 + 单篇文档授权人数)

    受文档级权限限制时, 仅返回用户可见的文档。
    """
    kb = await require_kb_access(db, kb_id, user)
    result = await db.execute(
        select(RagDocument).where(
            RagDocument.is_delete.is_(False), RagDocument.kb_id == kb.kb_id
        ).order_by(RagDocument.doc_id.desc())
    )
    docs = list(result.scalars().all())

    # 文档级权限过滤
    allowed = await accessible_doc_ids(db, kb_id, user)
    if allowed is not None:
        docs = [d for d in docs if d.doc_id in allowed]

    # 每文档最新任务
    tasks = (await db.execute(
        select(RagParseTask).where(
            RagParseTask.is_delete.is_(False), RagParseTask.kb_id == kb.kb_id
        ).order_by(RagParseTask.task_id.desc())
    )).scalars().all()
    latest: dict[int, RagParseTask] = {}
    for t in tasks:
        latest.setdefault(t.doc_id, t)

    # 每文档授权人数
    doc_ids = [d.doc_id for d in docs]
    perm_counts = dict((await db.execute(
        select(RagDocPermission.doc_id, func.count())
        .where(RagDocPermission.is_delete.is_(False), RagDocPermission.doc_id.in_(doc_ids) if doc_ids else text("false"))
        .group_by(RagDocPermission.doc_id)
    )).all()) if doc_ids else {}

    items = []
    for d in docs:
        item = _doc_dict(d, perm_counts.get(d.doc_id, 0))
        t = latest.get(d.doc_id)
        item["task"] = (
            {"task_id": t.task_id, "stage": t.stage, "status": t.status, "progress": t.progress}
            if t else None
        )
        items.append(item)
    return {"items": items}


@router.post("/{doc_id}/parse")
async def trigger_parse(doc_id: int, user: SysUser = Depends(require_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """触发文档解析入库 (异步流水线, 返回 task_id 供轮询)"""
    doc = await db.get(RagDocument, doc_id)
    if not doc or doc.is_delete:
        raise HTTPException(status_code=404, detail="文档不存在")
    await require_kb_access(db, doc.kb_id, user, write=True)
    if doc.parse_status == "parsing":
        raise HTTPException(status_code=400, detail="该文档正在解析中")
    task_id = await parse_pipeline.create_and_launch_parse(doc_id)
    return {"ok": True, "task_id": task_id}


@router.get("/{doc_id}/task")
async def parse_task(doc_id: int, user: SysUser = Depends(require_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """文档最新解析任务进度 (前端轮询)"""
    doc = await db.get(RagDocument, doc_id)
    if not doc or doc.is_delete:
        raise HTTPException(status_code=404, detail="文档不存在")
    await require_kb_access(db, doc.kb_id, user)
    t = (await db.execute(
        select(RagParseTask).where(
            RagParseTask.is_delete.is_(False), RagParseTask.doc_id == doc_id
        ).order_by(RagParseTask.task_id.desc()).limit(1)
    )).scalars().first()
    return {
        "doc_id": doc_id,
        "parse_status": doc.parse_status,
        "task": (
            {"task_id": t.task_id, "stage": t.stage, "status": t.status,
             "progress": t.progress, "error_msg": t.error_msg}
            if t else None
        ),
    }


@router.delete("/{doc_id}")
async def delete_file(doc_id: int, user: SysUser = Depends(require_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """逻辑删除文档 + 清理 Milvus 向量 / Neo4j 节点 / MinIO 对象"""
    doc = await db.get(RagDocument, doc_id)
    if not doc or doc.is_delete:
        raise HTTPException(status_code=404, detail="文档不存在")
    await require_kb_access(db, doc.kb_id, user, write=True)

    doc.is_delete = True
    from sqlalchemy import text
    for tbl in ("rag_chunks", "rag_multimodal_resources", "rag_entities", "rag_relations"):
        await db.execute(text(f"UPDATE {tbl} SET is_delete = true WHERE doc_id = :did"), {"did": doc_id})
    await db.commit()

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
    if doc.minio_path:
        await minio_service.delete_object(doc.minio_path, doc.minio_bucket)
    return {"ok": True}


@router.get("/{doc_id}/raw")
async def raw_file(doc_id: int, user: SysUser = Depends(require_user),
                   db: AsyncSession = Depends(get_db)) -> Response:
    """原文下载 (从 MinIO 回源)"""
    doc = await db.get(RagDocument, doc_id)
    if not doc or doc.is_delete:
        raise HTTPException(status_code=404, detail="文档不存在")
    await require_kb_access(db, doc.kb_id, user)
    data = await minio_service.download_bytes(doc.minio_path, doc.minio_bucket)
    if data is None:
        raise HTTPException(status_code=404, detail="对象存储中未找到文件")
    from urllib.parse import quote
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(doc.file_name)}"},
    )


@router.get("/{doc_id}/chunks")
async def doc_chunks(doc_id: int, user: SysUser = Depends(require_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """文档分块明细 (四库联查): PG 文本 + Milvus 向量核对 + Neo4j 图谱关联 + MinIO 归档位置

    点击文件列表"分块数"时调用, 展示每个分块在各存储中的内容与关联关系。
    """
    doc = await db.get(RagDocument, doc_id)
    if not doc or doc.is_delete:
        raise HTTPException(status_code=404, detail="文档不存在")
    await require_kb_access(db, doc.kb_id, user)

    chunks = list((await db.execute(
        select(RagChunk).where(RagChunk.is_delete.is_(False), RagChunk.doc_id == doc_id)
        .order_by(RagChunk.chunk_index)
    )).scalars().all())
    chunk_ids = [c.chunk_id for c in chunks]

    # Milvus 向量存在性核对 (按 chunk_id 主键查询)
    milvus_ids: set[int] = set()
    milvus_err = ""
    try:
        got = await asyncio.to_thread(
            milvus_store.get_by_ids, milvus_store.COLL_CHUNKS, "chunk_id", chunk_ids, ["chunk_id"])
        milvus_ids = set(got.keys())
    except Exception as e:  # noqa: BLE001
        milvus_err = str(e)[:200]

    # Neo4j 图谱关联 (实体/关系为文档级抽取结果)
    graph = {"entities": [], "relations": []}
    neo4j_err = ""
    try:
        graph = await asyncio.to_thread(neo4j_store.doc_graph, doc_id)
    except Exception as e:  # noqa: BLE001
        neo4j_err = str(e)[:200]

    return {
        "doc": _doc_dict(doc),
        "minio": {"bucket": doc.minio_bucket, "object_key": doc.minio_path},
        "milvus": {"collection": milvus_store.COLL_CHUNKS, "dim": settings.EMBEDDING_DIM, "error": milvus_err},
        "graph": graph,
        "neo4j_error": neo4j_err,
        "chunks": [
            {
                "chunk_id": c.chunk_id,
                "chunk_index": c.chunk_index,
                "page_number": c.page_number,
                "content": c.content,
                "char_len": len(c.content or ""),
                "milvus_id": c.milvus_id,
                "in_milvus": c.chunk_id in milvus_ids,
                "created_at": c.created_at.isoformat() if c.created_at else "",
            }
            for c in chunks
        ],
    }
