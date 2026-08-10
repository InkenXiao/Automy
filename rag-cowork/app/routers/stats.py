"""统计与管理路由 · 总览统计 / 知识库明细 / 检索日志 / schema 初始化"""
import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_kb_access, require_user, visible_kb_ids
from app.models import (
    RagChunk,
    RagDocPermission,
    RagDocument,
    RagEntity,
    RagKbPermission,
    RagKnowledgeBase,
    RagQueryLog,
    RagRelation,
    SysUser,
)
from app.services import milvus_store, neo4j_store

router = APIRouter(prefix="/stats", tags=["统计"])


@router.get("/overview")
async def overview(kb_id: Optional[int] = None, user: SysUser = Depends(require_user),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """知识库总览: 可见 KB 数 / 文档数 / 分块数 / 实体数 / 关系数 / 问答次数

    kb_id 传入时按该知识库统计 (前端选中知识库后联动), 并附加:
    - perm_count: 知识库级授权用户数 (rag_kb_permissions)
    - doc_perm_user_count: 文档级单独授权涉及的用户数 (rag_doc_permissions distinct user)
    不传则统计全部可见知识库 (首页全局口径)。
    """
    if kb_id is not None:
        await require_kb_access(db, kb_id, user)
        ids = [kb_id]
        kb_count = 1
    else:
        ids = await visible_kb_ids(db, user)
        kb_count = len(ids)

    async def _count(model, *conds) -> int:
        q = select(func.count()).select_from(model).where(model.is_delete.is_(False), *conds)
        return (await db.execute(q)).scalar() or 0

    doc_count = chunk_count = entity_count = relation_count = 0
    if ids:
        doc_count = await _count(RagDocument, RagDocument.kb_id.in_(ids))
        chunk_count = await _count(RagChunk, RagChunk.kb_id.in_(ids))
        entity_count = await _count(RagEntity, RagEntity.kb_id.in_(ids))
        relation_count = await _count(RagRelation, RagRelation.kb_id.in_(ids))
    if kb_id is not None:
        # 该库的问答次数: rag_query_logs.kb_ids (JSONB 数组) 包含此 kb_id
        query_count = await _count(
            RagQueryLog, RagQueryLog.kb_ids.contains([int(kb_id)])
        )
        perm_count = await _count(
            RagKbPermission, RagKbPermission.kb_id == kb_id
        )
        # 文档级单独授权: 该库下被单独授权的文档所涉及的去重用户数
        doc_perm_user_count = (await db.execute(
            select(func.count(func.distinct(RagDocPermission.user_id)))
            .select_from(RagDocPermission)
            .join(RagDocument, RagDocument.doc_id == RagDocPermission.doc_id)
            .where(
                RagDocPermission.is_delete.is_(False),
                RagDocument.is_delete.is_(False),
                RagDocument.kb_id == kb_id,
            )
        )).scalar() or 0
    else:
        query_count = await _count(RagQueryLog, RagQueryLog.user_id == user.user_id)
        perm_count = 0
        doc_perm_user_count = 0

    graph = {"entities": 0, "relations": 0}
    if ids:
        try:
            graph = await asyncio.to_thread(neo4j_store.kb_graph_stats, ids)
        except Exception:  # noqa: BLE001
            pass

    return {
        "kb_count": kb_count,
        "doc_count": doc_count,
        "chunk_count": chunk_count,
        "entity_count": entity_count,
        "relation_count": relation_count,
        "query_count": query_count,
        "perm_count": perm_count,
        "doc_perm_user_count": int(doc_perm_user_count),
        "neo4j": graph,
    }


@router.get("/detail")
async def stat_detail(kind: str = Query(...), kb_id: Optional[int] = None,
                      doc_id: Optional[int] = None,
                      q_user_id: Optional[int] = None,
                      q_agent_id: Optional[int] = None,
                      q_skill_id: Optional[int] = None,
                      limit: int = Query(50, le=200), offset: int = 0,
                      user: SysUser = Depends(require_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """统计卡片明细: kind=docs/perms/docperms/chunks/entities/relations/queries

    kb_id 传入时限定该知识库 (需有访问权); 不传则为全部可见知识库范围。
    chunks/entities/relations 支持 doc_id 按文档筛选;
    queries 支持 q_user_id/q_agent_id/q_skill_id/doc_id 筛选。
    """
    if kb_id is not None:
        await require_kb_access(db, kb_id, user)
        ids = [kb_id]
    else:
        ids = await visible_kb_ids(db, user)
    if not ids and kind != "queries":
        return {"items": [], "total": 0}

    async def _paged_scalars(stmt, count_stmt) -> dict:
        """单实体查询分页 (scalars 解包, 避免 Row 元组属性访问错误)"""
        total = (await db.execute(count_stmt)).scalar() or 0
        rows = (await db.execute(stmt.limit(limit).offset(offset))).scalars().all()
        return {"items": rows, "total": int(total)}

    async def _paged_rows(stmt, count_stmt) -> dict:
        """多列联查分页 (返回 Row 元组)"""
        total = (await db.execute(count_stmt)).scalar() or 0
        rows = (await db.execute(stmt.limit(limit).offset(offset))).all()
        return {"items": rows, "total": int(total)}

    if kind == "docs":
        stmt = (
            select(RagDocument)
            .where(RagDocument.is_delete.is_(False), RagDocument.kb_id.in_(ids))
            .order_by(RagDocument.doc_id.desc())
        )
        cnt = select(func.count()).select_from(RagDocument).where(
            RagDocument.is_delete.is_(False), RagDocument.kb_id.in_(ids))
        res = await _paged_scalars(stmt, cnt)
        res["items"] = [
            {
                "doc_id": d.doc_id, "file_name": d.file_name, "file_size": d.file_size,
                "parse_status": d.parse_status, "total_chunks": d.total_chunks,
                "created_at": d.created_at.isoformat() if d.created_at else "",
            }
            for d in res["items"]
        ]
        return res

    if kind == "perms":
        if kb_id is None:
            raise HTTPException(status_code=400, detail="授权明细需指定知识库")
        stmt = (
            select(RagKbPermission, SysUser.name, SysUser.department)
            .join(SysUser, SysUser.user_id == RagKbPermission.user_id)
            .where(RagKbPermission.is_delete.is_(False), RagKbPermission.kb_id == kb_id)
            .order_by(RagKbPermission.id)
        )
        rows = (await db.execute(stmt.limit(limit).offset(offset))).all()
        total = (await db.execute(
            select(func.count()).select_from(RagKbPermission).where(
                RagKbPermission.is_delete.is_(False), RagKbPermission.kb_id == kb_id)
        )).scalar() or 0
        return {
            "items": [
                {"id": p.id, "user_name": n, "department": dept or "", "perm": p.perm,
                 "created_at": p.created_at.isoformat() if p.created_at else ""}
                for p, n, dept in rows
            ],
            "total": int(total),
        }

    if kind == "docperms":
        # 文档级单独授权明细: 哪篇文章授权给了哪个人
        if kb_id is None:
            raise HTTPException(status_code=400, detail="文档授权明细需指定知识库")
        stmt = (
            select(RagDocPermission, RagDocument.file_name, SysUser.name, SysUser.department)
            .join(RagDocument, RagDocument.doc_id == RagDocPermission.doc_id)
            .join(SysUser, SysUser.user_id == RagDocPermission.user_id)
            .where(
                RagDocPermission.is_delete.is_(False),
                RagDocument.is_delete.is_(False),
                RagDocument.kb_id == kb_id,
            )
            .order_by(RagDocPermission.id)
        )
        rows = (await db.execute(stmt.limit(limit).offset(offset))).all()
        total = (await db.execute(
            select(func.count()).select_from(RagDocPermission)
            .join(RagDocument, RagDocument.doc_id == RagDocPermission.doc_id)
            .where(
                RagDocPermission.is_delete.is_(False),
                RagDocument.is_delete.is_(False),
                RagDocument.kb_id == kb_id,
            )
        )).scalar() or 0
        return {
            "items": [
                {"id": p.id, "doc_id": p.doc_id, "file_name": fn,
                 "user_name": uname, "department": dept or "", "perm": p.perm,
                 "created_at": p.created_at.isoformat() if p.created_at else ""}
                for p, fn, uname, dept in rows
            ],
            "total": int(total),
        }

    if kind == "chunks":
        conds = [RagChunk.is_delete.is_(False), RagChunk.kb_id.in_(ids)]
        if doc_id is not None:
            conds.append(RagChunk.doc_id == doc_id)
        stmt = (
            select(RagChunk, RagDocument.file_name)
            .join(RagDocument, RagDocument.doc_id == RagChunk.doc_id)
            .where(*conds)
            .order_by(RagChunk.chunk_id.desc())
        )
        cnt = select(func.count()).select_from(RagChunk).where(*conds)
        res = await _paged_rows(stmt, cnt)
        res["items"] = [
            {
                "chunk_id": c.chunk_id, "doc_id": c.doc_id, "file_name": fn,
                "chunk_index": c.chunk_index, "page_number": c.page_number,
                "content": (c.content or "")[:200],
            }
            for c, fn in res["items"]
        ]
        return res

    if kind == "entities":
        conds = [RagEntity.is_delete.is_(False), RagEntity.kb_id.in_(ids)]
        if doc_id is not None:
            conds.append(RagEntity.doc_id == doc_id)
        stmt = (
            select(RagEntity, RagDocument.file_name)
            .join(RagDocument, RagDocument.doc_id == RagEntity.doc_id)
            .where(*conds)
            .order_by(RagEntity.entity_id.desc())
        )
        cnt = select(func.count()).select_from(RagEntity).where(*conds)
        res = await _paged_rows(stmt, cnt)
        res["items"] = [
            {
                "entity_id": e.entity_id, "entity_name": e.entity_name,
                "entity_type": e.entity_type, "description": (e.description or "")[:160],
                "file_name": fn,
            }
            for e, fn in res["items"]
        ]
        return res

    if kind == "relations":
        conds = [RagRelation.is_delete.is_(False), RagRelation.kb_id.in_(ids)]
        if doc_id is not None:
            conds.append(RagRelation.doc_id == doc_id)
        stmt = (
            select(RagRelation, RagDocument.file_name)
            .join(RagDocument, RagDocument.doc_id == RagRelation.doc_id)
            .where(*conds)
            .order_by(RagRelation.relation_id.desc())
        )
        cnt = select(func.count()).select_from(RagRelation).where(*conds)
        res = await _paged_rows(stmt, cnt)
        # 实体名映射
        ent_ids = {r.src_entity_id for r, _ in res["items"]} | {r.tgt_entity_id for r, _ in res["items"]}
        names: dict[int, str] = {}
        if ent_ids:
            names = dict((await db.execute(
                select(RagEntity.entity_id, RagEntity.entity_name)
                .where(RagEntity.entity_id.in_(ent_ids))
            )).all())
        res["items"] = [
            {
                "relation_id": r.relation_id,
                "src": names.get(r.src_entity_id, str(r.src_entity_id)),
                "tgt": names.get(r.tgt_entity_id, str(r.tgt_entity_id)),
                "relation_type": r.relation_type, "keywords": r.keywords or "",
                "file_name": fn,
            }
            for r, fn in res["items"]
        ]
        return res

    if kind == "queries":
        stmt = select(RagQueryLog).where(RagQueryLog.is_delete.is_(False))
        cnt = select(func.count()).select_from(RagQueryLog).where(RagQueryLog.is_delete.is_(False))
        if kb_id is not None:
            stmt = stmt.where(RagQueryLog.kb_ids.contains([int(kb_id)]))
            cnt = cnt.where(RagQueryLog.kb_ids.contains([int(kb_id)]))
        else:
            stmt = stmt.where(RagQueryLog.user_id == user.user_id)
            cnt = cnt.where(RagQueryLog.user_id == user.user_id)
        # 筛选条件
        if q_user_id is not None:
            stmt = stmt.where(RagQueryLog.user_id == q_user_id)
            cnt = cnt.where(RagQueryLog.user_id == q_user_id)
        if q_agent_id is not None:
            stmt = stmt.where(RagQueryLog.agent_id == q_agent_id)
            cnt = cnt.where(RagQueryLog.agent_id == q_agent_id)
        if q_skill_id is not None:
            stmt = stmt.where(RagQueryLog.skill_id == q_skill_id)
            cnt = cnt.where(RagQueryLog.skill_id == q_skill_id)
        stmt = stmt.order_by(RagQueryLog.log_id.desc())
        res = await _paged_scalars(stmt, cnt)

        # 补充用户名
        q_user_ids = {l.user_id for l in res["items"] if l.user_id}
        user_names: dict[int, str] = {}
        if q_user_ids:
            user_names = dict((await db.execute(
                select(SysUser.user_id, SysUser.name).where(SysUser.user_id.in_(q_user_ids))
            )).all())

        # 文档筛选: 按 sources JSON 中的 doc_id 过滤 (内存过滤后修正总数)
        items = []
        for l in res["items"]:
            sources = l.sources if isinstance(l.sources, list) else []
            if doc_id is not None:
                if not any(str(s.get("doc_id")) == str(doc_id) for s in sources if isinstance(s, dict)):
                    continue
            items.append({
                "log_id": l.log_id, "query": l.query or "", "mode": l.mode,
                "hit_count": l.hit_count, "latency_ms": l.latency_ms,
                "answer_excerpt": l.answer_excerpt or "",
                "sources": sources,
                "user_id": l.user_id, "user_name": user_names.get(l.user_id, ""),
                "agent_id": l.agent_id or 0, "skill_id": l.skill_id or 0,
                "created_at": l.created_at.isoformat() if l.created_at else "",
            })
        res["items"] = items
        if doc_id is not None:
            res["total"] = len(items)  # 内存过滤后的真实条数
        return res

    raise HTTPException(status_code=400, detail=f"不支持的明细类型: {kind}")


@router.get("/query-filters")
async def query_filters(kb_id: Optional[int] = None,
                        user: SysUser = Depends(require_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """问答明细筛选项: 该知识库下出现过的 用户/智能体/技能/文档 列表"""
    if kb_id is not None:
        await require_kb_access(db, kb_id, user)
        base = select(RagQueryLog).where(
            RagQueryLog.is_delete.is_(False),
            RagQueryLog.kb_ids.contains([int(kb_id)]),
        )
    else:
        ids = await visible_kb_ids(db, user)
        if not ids:
            return {"users": [], "agents": [], "skills": [], "docs": []}
        base = select(RagQueryLog).where(RagQueryLog.is_delete.is_(False), RagQueryLog.kb_ids.overlap(ids))

    logs = list((await db.execute(base)).scalars().all())

    user_ids = {l.user_id for l in logs if l.user_id}
    agent_ids = {l.agent_id for l in logs if l.agent_id}
    skill_ids = {l.skill_id for l in logs if l.skill_id}
    # 从 sources 提取文档
    doc_map: dict[str, str] = {}
    for l in logs:
        for s in (l.sources if isinstance(l.sources, list) else []):
            if isinstance(s, dict) and s.get("doc_id"):
                doc_map[str(s["doc_id"])] = s.get("file_name") or f"doc#{s['doc_id']}"

    names: dict[int, str] = {}
    all_ids = user_ids | agent_ids
    if all_ids:
        names = dict((await db.execute(
            select(SysUser.user_id, SysUser.name).where(SysUser.user_id.in_(all_ids))
        )).all())

    return {
        "users": [{"id": uid, "name": names.get(uid, str(uid))} for uid in sorted(user_ids)],
        "agents": [{"id": aid, "name": names.get(aid, f"智能体#{aid}")} for aid in sorted(agent_ids)],
        "skills": [{"id": sid, "name": f"技能#{sid}"} for sid in sorted(skill_ids)],
        "docs": [{"id": did, "name": dname} for did, dname in sorted(doc_map.items())],
    }


@router.get("/query-logs")
async def query_logs(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """本人最近 50 条检索日志"""
    result = await db.execute(
        select(RagQueryLog).where(
            RagQueryLog.is_delete.is_(False), RagQueryLog.user_id == user.user_id
        ).order_by(RagQueryLog.log_id.desc()).limit(50)
    )
    return {
        "items": [
            {
                "log_id": l.log_id, "query": l.query, "mode": l.mode,
                "hit_count": l.hit_count, "latency_ms": l.latency_ms,
                "answer_excerpt": l.answer_excerpt,
                "sources": l.sources if isinstance(l.sources, list) else [],
                "created_at": l.created_at.isoformat() if l.created_at else "",
            }
            for l in result.scalars().all()
        ]
    }


@router.post("/schema/init")
async def schema_init(user: SysUser = Depends(require_user)) -> dict:
    """初始化 Milvus 集合 + Neo4j 约束 (幂等; 首次部署或 EMBEDDING_DIM 变更时调用)"""
    milvus_ok = neo4j_ok = False
    milvus_err = neo4j_err = ""
    try:
        await asyncio.to_thread(milvus_store.init_collections)
        milvus_ok = True
    except Exception as e:  # noqa: BLE001
        milvus_err = str(e)[:300]
    try:
        await asyncio.to_thread(neo4j_store.init_schema)
        neo4j_ok = True
    except Exception as e:  # noqa: BLE001
        neo4j_err = str(e)[:300]
    return {
        "milvus": {"ok": milvus_ok, "error": milvus_err},
        "neo4j": {"ok": neo4j_ok, "error": neo4j_err},
    }
