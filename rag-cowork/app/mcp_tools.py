"""MCP 工具实现 · rag-cowork 知识库对外接口 (供 mcp_server.py 注册)

9 个工具: kb_create / kb_list / kb_file_upload / kb_file_parse / kb_file_add /
         kb_files / kb_file_delete / rag_search / rag_query

实现内部直接复用 rag-cowork service/ORM 层 (同代码库, 不经 HTTP 自调)。
用户身份: 优先 HTTP 请求头 X-User-Name (streamable-HTTP 模式), 其次显式 user_name 参数。
"""
import asyncio
import base64
import hashlib
import logging
from typing import List, Optional
from urllib.parse import unquote

from sqlalchemy import select, text

from app.config import settings
from app.database import AsyncSessionLocal
from app.deps import accessible_doc_ids, require_kb_access, visible_kb_ids
from app.models import KB_LEVELS, RagDocument, RagKnowledgeBase, SysUser
from app.services import milvus_store, minio_service, neo4j_store, parse_pipeline, rag_query
from app.services.snowflake import generate_id

logger = logging.getLogger(__name__)

MAX_UPLOAD_MB = 100


def _header_user_name() -> str:
    """从 streamable-HTTP 请求头取 X-User-Name (SDK request_ctx 上下文变量, 失败返回空)

    SDK 1.29 移除了 mcp.server.fastmcp.get_http_request; 当前请求经
    mcp.server.lowlevel.server.request_ctx 暴露, HTTP 模式下 .request 为 Starlette Request。
    """
    try:
        from mcp.server.lowlevel.server import request_ctx
        req = request_ctx.get().request
        if req is None:
            return ""
        raw = (req.headers.get("x-user-name") or "").strip()
        return unquote(raw) if raw else ""
    except Exception:  # noqa: BLE001
        return ""


async def _resolve_user(user_name: str = "") -> SysUser:
    """按姓名加载 sys_users 用户; 失败抛错"""
    name = (user_name or "").strip() or _header_user_name()
    if not name:
        raise RuntimeError("缺少用户身份: 请传 user_name 参数或携带 X-User-Name 请求头")
    async with AsyncSessionLocal() as session:
        user = (await session.execute(
            select(SysUser).where(
                SysUser.is_delete.is_(False), SysUser.name == name, SysUser.is_active.is_(True)
            )
        )).scalars().first()
        if not user:
            raise RuntimeError(f"用户未注册: {name}")
        return user


def _kb_dict(kb: RagKnowledgeBase) -> dict:
    return {
        "kb_id": kb.kb_id, "name": kb.name, "level": kb.level,
        "description": kb.description, "owner_user_id": kb.owner_user_id,
        "project_id": kb.project_id, "department": kb.department,
    }


def _doc_dict(d: RagDocument) -> dict:
    return {
        "doc_id": d.doc_id, "kb_id": d.kb_id, "file_name": d.file_name,
        "file_ext": d.file_ext, "file_size": d.file_size,
        "parse_status": d.parse_status, "total_chunks": d.total_chunks,
        "error_msg": d.error_msg,
    }


async def _upload(kb: RagKnowledgeBase, user: SysUser, file_name: str, data: bytes) -> RagDocument:
    """MinIO 归档 + 建文档记录 (含哈希去重); 返回文档"""
    async with AsyncSessionLocal() as session:
        file_hash = hashlib.sha256(data).hexdigest()
        dup = (await session.execute(
            select(RagDocument).where(
                RagDocument.is_delete.is_(False),
                RagDocument.kb_id == kb.kb_id,
                RagDocument.file_hash == file_hash,
            )
        )).scalars().first()
        if dup:
            return dup
        object_key = await minio_service.upload_bytes(kb.kb_id, file_name, data)
        if object_key is None:
            raise RuntimeError("MinIO 归档失败, 请检查对象存储配置")
        doc = RagDocument(
            doc_id=generate_id(), kb_id=kb.kb_id, file_name=file_name,
            file_ext=file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "",
            file_size=len(data), file_hash=file_hash,
            minio_bucket=settings.RAG_MINIO_BUCKET, minio_path=object_key,
            parse_status="pending", user_id=user.user_id,
        )
        session.add(doc)
        await session.commit()
        return doc


# ================= 工具实现 =================

async def tool_kb_create(name: str, level: str, description: str = "",
                         project_id: Optional[int] = None, department: str = "",
                         user_name: str = "") -> dict:
    user = await _resolve_user(user_name)
    name = (name or "").strip()
    if not name:
        raise RuntimeError("知识库名称不能为空")
    if level not in KB_LEVELS:
        raise RuntimeError(f"level 必须是: {'/'.join(KB_LEVELS)}")
    async with AsyncSessionLocal() as session:
        if level == "project":
            if not project_id:
                raise RuntimeError("项目级知识库需传 project_id")
            exists = (await session.execute(
                text("SELECT 1 FROM pro_projects WHERE is_delete = false AND id = :pid LIMIT 1"),
                {"pid": project_id},
            )).first()
            if not exists:
                raise RuntimeError(f"关联项目不存在: {project_id}")
        if level == "department" and not (department or "").strip():
            raise RuntimeError("部门级知识库需传 department")
        kb = RagKnowledgeBase(
            kb_id=generate_id(), name=name, level=level,
            description=(description or "").strip(),
            owner_user_id=user.user_id, user_id=user.user_id,
            project_id=project_id if level == "project" else None,
            department=(department or "").strip() if level == "department" else "",
        )
        session.add(kb)
        await session.commit()
    try:
        await asyncio.to_thread(neo4j_store.upsert_kb, kb.kb_id, kb.name, kb.level)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "kb": _kb_dict(kb)}


async def tool_kb_list(level: str = "", user_name: str = "") -> dict:
    user = await _resolve_user(user_name)
    async with AsyncSessionLocal() as session:
        ids = await visible_kb_ids(session, user)
        if not ids:
            return {"items": []}
        q = select(RagKnowledgeBase).where(
            RagKnowledgeBase.is_delete.is_(False), RagKnowledgeBase.kb_id.in_(ids)
        ).order_by(RagKnowledgeBase.level, RagKnowledgeBase.kb_id)
        result = await session.execute(q)
        items = [_kb_dict(kb) for kb in result.scalars().all()
                 if not level or kb.level == level]
    return {"items": items}


async def tool_kb_file_upload(kb_id: int, file_name: str, content_base64: str,
                              user_name: str = "") -> dict:
    user = await _resolve_user(user_name)
    data = base64.b64decode(content_base64)
    if not data:
        raise RuntimeError("文件内容为空")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise RuntimeError(f"文件超过 {MAX_UPLOAD_MB}MB 限制")
    async with AsyncSessionLocal() as session:
        kb = await require_kb_access(session, kb_id, user, write=True)
    doc = await _upload(kb, user, file_name, data)
    return {"ok": True, "doc": _doc_dict(doc)}


async def tool_kb_file_parse(doc_id: int, user_name: str = "") -> dict:
    user = await _resolve_user(user_name)
    async with AsyncSessionLocal() as session:
        doc = await session.get(RagDocument, doc_id)
        if not doc or doc.is_delete:
            raise RuntimeError("文档不存在")
        await require_kb_access(session, doc.kb_id, user, write=True)
        if doc.parse_status == "parsing":
            raise RuntimeError("该文档正在解析中")
    task_id = await parse_pipeline.create_and_launch_parse(doc_id)
    return {"ok": True, "task_id": task_id, "doc_id": doc_id}


async def tool_kb_file_add(kb_id: int, file_name: str, content_base64: str,
                           user_name: str = "") -> dict:
    """上传 + 解析一步到位"""
    up = await tool_kb_file_upload(kb_id, file_name, content_base64, user_name)
    doc = up["doc"]
    if doc["parse_status"] == "done":
        return {"ok": True, "doc": doc, "duplicate": True, "msg": "相同文件已存在且已解析"}
    task_id = await parse_pipeline.create_and_launch_parse(doc["doc_id"])
    return {"ok": True, "doc": doc, "task_id": task_id}


async def tool_kb_files(kb_id: int, user_name: str = "") -> dict:
    user = await _resolve_user(user_name)
    async with AsyncSessionLocal() as session:
        kb = await require_kb_access(session, kb_id, user)
        result = await session.execute(
            select(RagDocument).where(
                RagDocument.is_delete.is_(False), RagDocument.kb_id == kb.kb_id
            ).order_by(RagDocument.doc_id.desc())
        )
        return {"items": [_doc_dict(d) for d in result.scalars().all()]}


async def tool_kb_file_delete(doc_id: int, user_name: str = "") -> dict:
    user = await _resolve_user(user_name)
    async with AsyncSessionLocal() as session:
        doc = await session.get(RagDocument, doc_id)
        if not doc or doc.is_delete:
            raise RuntimeError("文档不存在")
        await require_kb_access(session, doc.kb_id, user, write=True)
        doc.is_delete = True
        for tbl in ("rag_chunks", "rag_multimodal_resources", "rag_entities", "rag_relations"):
            await session.execute(text(f"UPDATE {tbl} SET is_delete = true WHERE doc_id = :did"), {"did": doc_id})
        await session.commit()
        minio_path, minio_bucket = doc.minio_path, doc.minio_bucket
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
    if minio_path:
        await minio_service.delete_object(minio_path, minio_bucket)
    return {"ok": True, "doc_id": doc_id}


async def tool_rag_search(kb_ids: List[int], query: str, top_k: int = 10,
                          user_name: str = "") -> dict:
    user = await _resolve_user(user_name)
    if not (query or "").strip():
        raise RuntimeError("查询内容不能为空")
    async with AsyncSessionLocal() as session:
        visible = set(await visible_kb_ids(session, user))
        kb_ids = [k for k in kb_ids if k in visible]
        if not kb_ids:
            raise RuntimeError("无可见知识库或知识库越权")
        allowed = await _merged_allowed_doc_ids(session, user, kb_ids)
    return await rag_query.search(kb_ids, query.strip(), top_k, allowed_doc_ids=allowed)


async def tool_rag_query(kb_ids: List[int], query: str, mode: str = "hybrid",
                         top_k: int = 8, user_name: str = "",
                         agent_id: int = 0, skill_id: int = 0) -> dict:
    user = await _resolve_user(user_name)
    if not (query or "").strip():
        raise RuntimeError("问题不能为空")
    if mode not in ("hybrid", "local", "global"):
        mode = "hybrid"
    async with AsyncSessionLocal() as session:
        visible = set(await visible_kb_ids(session, user))
        kb_ids = [k for k in kb_ids if k in visible]
        if not kb_ids:
            raise RuntimeError("无可见知识库或知识库越权")
        allowed = await _merged_allowed_doc_ids(session, user, kb_ids)
    return await rag_query.query(
        kb_ids, query.strip(), mode=mode, top_k=top_k, user_id=user.user_id,
        allowed_doc_ids=allowed, agent_id=agent_id or 0, skill_id=skill_id or 0,
    )


async def _merged_allowed_doc_ids(session, user: SysUser, kb_ids: List[int]):
    """合并各 KB 的文档级可见集; None 表示不受限"""
    allowed: set = set()
    for kid in kb_ids:
        doc_ids = await accessible_doc_ids(session, kid, user)
        if doc_ids is None:
            return None
        allowed.update(doc_ids)
    return allowed


# ================= 注册 =================

def register(mcp) -> None:
    """将全部工具注册到 FastMCP 实例"""
    mcp.tool(name="kb_create", description="创建知识库 (level: company/department/project/personal/external; project 级需 project_id, department 级需 department)")(tool_kb_create)
    mcp.tool(name="kb_list", description="列出当前用户可见知识库 (可按 level 过滤)")(tool_kb_list)
    mcp.tool(name="kb_file_upload", description="上传文件到知识库: 保存到 MinIO 并建档 (pending), 内容 base64 编码")(tool_kb_file_upload)
    mcp.tool(name="kb_file_parse", description="触发文档解析入库流水线 (分块/向量化/实体关系抽取, 异步入库 PG+Milvus+Neo4j)")(tool_kb_file_parse)
    mcp.tool(name="kb_file_add", description="上传并解析一步到位 (= kb_file_upload + kb_file_parse)")(tool_kb_file_add)
    mcp.tool(name="kb_files", description="知识库文件列表 (含解析状态)")(tool_kb_files)
    mcp.tool(name="kb_file_delete", description="删除知识库文件 (逻辑删除 + 清理 Milvus/Neo4j/MinIO)")(tool_kb_file_delete)
    mcp.tool(name="rag_search", description="纯检索: 返回分块/实体命中, 不生成答案 (按用户权限过滤 kb_ids)")(tool_rag_search)
    mcp.tool(name="rag_query", description="RAG 问答: 向量+图谱混合检索 → LLM 生成含引用的答案 (mode: hybrid/local/global; 可传 agent_id/skill_id 记录调用来源)")(tool_rag_query)
