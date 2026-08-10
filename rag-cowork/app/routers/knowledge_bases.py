"""知识库路由 · 五级知识库 CRUD + 显式授权管理 + 文档级授权"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_kb_access, require_user, visible_kb_ids
from app.models import KB_LEVELS, RagDocPermission, RagDocument, RagKbPermission, RagKnowledgeBase, SysUser
from app.services import milvus_store, neo4j_store
from app.services.snowflake import generate_id

router = APIRouter(prefix="/knowledge-bases", tags=["知识库"])

LEVEL_NAMES = {
    "company": "公司", "department": "部门", "project": "项目",
    "personal": "个人", "external": "外接",
}


class KbCreateIn(BaseModel):
    name: str
    level: str
    description: Optional[str] = ""
    project_id: Optional[int] = None
    department: Optional[str] = ""


class KbUpdateIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[int] = None
    department: Optional[str] = None


class GrantIn(BaseModel):
    user_id: int
    perm: str = "read"  # read/write/admin


class BatchGrantIn(BaseModel):
    items: List[GrantIn]


class DocGrantIn(BaseModel):
    doc_id: int
    user_id: int
    perm: str = "read"


class BatchDocGrantIn(BaseModel):
    items: List[DocGrantIn]


def _kb_dict(kb: RagKnowledgeBase, doc_count: int = 0, my_perm: str = "") -> dict:
    return {
        "kb_id": kb.kb_id,
        "name": kb.name,
        "level": kb.level,
        "level_name": LEVEL_NAMES.get(kb.level, kb.level),
        "description": kb.description,
        "owner_user_id": kb.owner_user_id,
        "project_id": kb.project_id,
        "department": kb.department,
        "doc_count": doc_count,
        "my_perm": my_perm,
        "created_at": kb.created_at.isoformat() if kb.created_at else "",
    }


@router.get("")
async def list_kbs(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """当前用户可见知识库列表 (含文档数)"""
    ids = await visible_kb_ids(db, user)
    if not ids:
        return {"items": []}
    result = await db.execute(
        select(RagKnowledgeBase).where(
            RagKnowledgeBase.is_delete.is_(False), RagKnowledgeBase.kb_id.in_(ids)
        ).order_by(RagKnowledgeBase.level, RagKnowledgeBase.kb_id)
    )
    kbs = list(result.scalars().all())

    counts = dict((await db.execute(
        select(RagDocument.kb_id, func.count())
        .where(RagDocument.is_delete.is_(False), RagDocument.kb_id.in_(ids))
        .group_by(RagDocument.kb_id)
    )).all())

    perms = {p.kb_id: p.perm for p in (await db.execute(
        select(RagKbPermission).where(
            RagKbPermission.is_delete.is_(False), RagKbPermission.user_id == user.user_id
        )
    )).scalars().all()}

    items = []
    for kb in kbs:
        my_perm = "admin" if kb.owner_user_id == user.user_id else perms.get(kb.kb_id, "")
        items.append(_kb_dict(kb, counts.get(kb.kb_id, 0), my_perm))
    return {"items": items}


@router.post("")
async def create_kb(payload: KbCreateIn, user: SysUser = Depends(require_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """创建知识库 (project 级必须传 project_id; department 级必须传 department)"""
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="知识库名称不能为空")
    if payload.level not in KB_LEVELS:
        raise HTTPException(status_code=400, detail=f"级别必须是: {'/'.join(KB_LEVELS)}")
    if payload.level == "project":
        if not payload.project_id:
            raise HTTPException(status_code=400, detail="项目级知识库需关联项目")
        exists = (await db.execute(
            text("SELECT 1 FROM pro_projects WHERE is_delete = false AND id = :pid LIMIT 1"),
            {"pid": payload.project_id},
        )).first()
        if not exists:
            raise HTTPException(status_code=400, detail="关联项目不存在")
    if payload.level == "department" and not (payload.department or "").strip():
        raise HTTPException(status_code=400, detail="部门级知识库需指定部门")

    kb = RagKnowledgeBase(
        kb_id=generate_id(), name=name, level=payload.level,
        description=(payload.description or "").strip(),
        owner_user_id=user.user_id, user_id=user.user_id,
        project_id=payload.project_id if payload.level == "project" else None,
        department=(payload.department or "").strip() if payload.level == "department" else "",
    )
    db.add(kb)
    await db.commit()
    # 创建者写入 admin 授权 (rag_kb_permissions 台账; 外接级可见性依赖授权行)
    db.add(RagKbPermission(
        id=generate_id(), kb_id=kb.kb_id, user_id=user.user_id, perm="admin"
    ))
    await db.commit()
    # Neo4j KB 节点 (失败不影响主流程)
    try:
        import asyncio
        await asyncio.to_thread(neo4j_store.upsert_kb, kb.kb_id, kb.name, kb.level)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "kb": _kb_dict(kb)}


@router.put("/{kb_id}")
async def update_kb(kb_id: int, payload: KbUpdateIn, user: SysUser = Depends(require_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """编辑知识库 (仅 owner/admin)"""
    kb = await require_kb_access(db, kb_id, user, write=True)
    if payload.name is not None and payload.name.strip():
        kb.name = payload.name.strip()
    if payload.description is not None:
        kb.description = payload.description.strip()
    if payload.project_id is not None and kb.level == "project":
        kb.project_id = payload.project_id
    if payload.department is not None and kb.level == "department":
        kb.department = payload.department.strip()
    await db.commit()
    return {"ok": True}


@router.delete("/{kb_id}")
async def delete_kb(kb_id: int, user: SysUser = Depends(require_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """逻辑删除知识库 + 清理 Milvus/Neo4j (仅 owner)"""
    kb = await db.get(RagKnowledgeBase, kb_id)
    if not kb or kb.is_delete:
        raise HTTPException(status_code=404, detail="知识库不存在")
    if kb.owner_user_id != user.user_id:
        raise HTTPException(status_code=403, detail="仅创建者可删除知识库")
    kb.is_delete = True
    await db.execute(
        text("UPDATE rag_documents SET is_delete = true WHERE kb_id = :kid"), {"kid": kb_id}
    )
    await db.commit()
    import asyncio
    try:
        await asyncio.to_thread(milvus_store.delete_by_kb, kb_id)
    except Exception:  # noqa: BLE001
        pass
    try:
        await asyncio.to_thread(neo4j_store.delete_by_kb, kb_id)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True}


# ---------- KB 级授权 ----------

@router.get("/{kb_id}/permissions")
async def list_permissions(kb_id: int, user: SysUser = Depends(require_user),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """知识库授权列表"""
    kb = await require_kb_access(db, kb_id, user)
    result = await db.execute(
        select(RagKbPermission, SysUser.name, SysUser.department)
        .join(SysUser, SysUser.user_id == RagKbPermission.user_id)
        .where(RagKbPermission.is_delete.is_(False), RagKbPermission.kb_id == kb_id)
    )
    return {
        "items": [
            {"id": p.id, "user_id": p.user_id, "user_name": name, "department": dept or "", "perm": p.perm}
            for p, name, dept in result.all()
        ]
    }


@router.post("/{kb_id}/permissions")
async def grant_permission(kb_id: int, payload: GrantIn, user: SysUser = Depends(require_user),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """授权 (仅 owner/admin 授权者)"""
    kb = await require_kb_access(db, kb_id, user, write=True)
    if payload.perm not in ("read", "write", "admin"):
        raise HTTPException(status_code=400, detail="perm 必须是 read/write/admin")
    target = await db.get(SysUser, payload.user_id)
    if not target or target.is_delete:
        raise HTTPException(status_code=404, detail="目标用户不存在")

    existing = (await db.execute(
        select(RagKbPermission).where(
            RagKbPermission.is_delete.is_(False),
            RagKbPermission.kb_id == kb_id,
            RagKbPermission.user_id == payload.user_id,
        )
    )).scalars().first()
    if existing:
        existing.perm = payload.perm
    else:
        db.add(RagKbPermission(
            id=generate_id(), kb_id=kb_id, user_id=payload.user_id, perm=payload.perm
        ))
    await db.commit()
    return {"ok": True}


@router.post("/{kb_id}/permissions/batch")
async def batch_grant_permission(kb_id: int, payload: BatchGrantIn,
                                 user: SysUser = Depends(require_user),
                                 db: AsyncSession = Depends(get_db)) -> dict:
    """批量授权 (仅 owner/admin)"""
    kb = await require_kb_access(db, kb_id, user, write=True)
    if not payload.items:
        return {"ok": True}
    user_ids = {p.user_id for p in payload.items}
    targets = {
        u.user_id: u for u in (await db.execute(
            select(SysUser).where(SysUser.user_id.in_(user_ids), SysUser.is_delete.is_(False))
        )).scalars().all()
    }
    for p in payload.items:
        if p.perm not in ("read", "write", "admin"):
            raise HTTPException(status_code=400, detail=f"perm {p.perm} 必须是 read/write/admin")
        if p.user_id not in targets:
            raise HTTPException(status_code=404, detail=f"用户不存在: {p.user_id}")
        existing = (await db.execute(
            select(RagKbPermission).where(
                RagKbPermission.is_delete.is_(False),
                RagKbPermission.kb_id == kb_id,
                RagKbPermission.user_id == p.user_id,
            )
        )).scalars().first()
        if existing:
            existing.perm = p.perm
        else:
            db.add(RagKbPermission(
                id=generate_id(), kb_id=kb_id, user_id=p.user_id, perm=p.perm
            ))
    await db.commit()
    return {"ok": True}


@router.delete("/{kb_id}/permissions/{perm_id}")
async def revoke_permission(kb_id: int, perm_id: int, user: SysUser = Depends(require_user),
                            db: AsyncSession = Depends(get_db)) -> dict:
    """撤销授权 (仅 owner/admin 授权者)"""
    await require_kb_access(db, kb_id, user, write=True)
    perm = await db.get(RagKbPermission, perm_id)
    if perm and not perm.is_delete and perm.kb_id == kb_id:
        perm.is_delete = True
        await db.commit()
    return {"ok": True}


# ---------- 文档级授权 ----------

@router.get("/{kb_id}/doc-permissions")
async def list_doc_permissions(kb_id: int, user: SysUser = Depends(require_user),
                               db: AsyncSession = Depends(get_db)) -> dict:
    """知识库内所有文档级授权列表"""
    kb = await require_kb_access(db, kb_id, user)
    result = await db.execute(
        select(RagDocPermission, RagDocument.file_name, SysUser.name, SysUser.department)
        .join(RagDocument, RagDocument.doc_id == RagDocPermission.doc_id)
        .join(SysUser, SysUser.user_id == RagDocPermission.user_id)
        .where(
            RagDocPermission.is_delete.is_(False),
            RagDocument.is_delete.is_(False),
            RagDocument.kb_id == kb_id,
        )
        .order_by(RagDocPermission.doc_id, RagDocPermission.id)
    )
    return {
        "items": [
            {"id": dp.id, "doc_id": dp.doc_id, "file_name": fname,
             "user_id": dp.user_id, "user_name": uname, "department": dept or "", "perm": dp.perm}
            for dp, fname, uname, dept in result.all()
        ]
    }


@router.post("/{kb_id}/doc-permissions")
async def grant_doc_permission(kb_id: int, payload: DocGrantIn,
                               user: SysUser = Depends(require_user),
                               db: AsyncSession = Depends(get_db)) -> dict:
    """文档级授权 (仅 owner/admin)"""
    kb = await require_kb_access(db, kb_id, user, write=True)
    doc = await db.get(RagDocument, payload.doc_id)
    if not doc or doc.is_delete or doc.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="文档不存在或不在该知识库")
    if payload.perm not in ("read", "write", "admin"):
        raise HTTPException(status_code=400, detail="perm 必须是 read/write/admin")
    target = await db.get(SysUser, payload.user_id)
    if not target or target.is_delete:
        raise HTTPException(status_code=404, detail="目标用户不存在")
    existing = (await db.execute(
        select(RagDocPermission).where(
            RagDocPermission.is_delete.is_(False),
            RagDocPermission.doc_id == payload.doc_id,
            RagDocPermission.user_id == payload.user_id,
        )
    )).scalars().first()
    if existing:
        existing.perm = payload.perm
    else:
        db.add(RagDocPermission(
            id=generate_id(), doc_id=payload.doc_id, user_id=payload.user_id, perm=payload.perm
        ))
    await db.commit()
    return {"ok": True}


@router.post("/{kb_id}/doc-permissions/batch")
async def batch_grant_doc_permission(kb_id: int, payload: BatchDocGrantIn,
                                     user: SysUser = Depends(require_user),
                                     db: AsyncSession = Depends(get_db)) -> dict:
    """批量文档级授权 (仅 owner/admin)"""
    kb = await require_kb_access(db, kb_id, user, write=True)
    if not payload.items:
        return {"ok": True}
    doc_ids = {p.doc_id for p in payload.items}
    user_ids = {p.user_id for p in payload.items}
    docs = {
        d.doc_id: d for d in (await db.execute(
            select(RagDocument).where(
                RagDocument.doc_id.in_(doc_ids),
                RagDocument.is_delete.is_(False),
                RagDocument.kb_id == kb_id,
            )
        )).scalars().all()
    }
    targets = {
        u.user_id: u for u in (await db.execute(
            select(SysUser).where(SysUser.user_id.in_(user_ids), SysUser.is_delete.is_(False))
        )).scalars().all()
    }
    for p in payload.items:
        if p.perm not in ("read", "write", "admin"):
            raise HTTPException(status_code=400, detail=f"perm {p.perm} 必须是 read/write/admin")
        if p.doc_id not in docs:
            raise HTTPException(status_code=404, detail=f"文档不存在: {p.doc_id}")
        if p.user_id not in targets:
            raise HTTPException(status_code=404, detail=f"用户不存在: {p.user_id}")
        existing = (await db.execute(
            select(RagDocPermission).where(
                RagDocPermission.is_delete.is_(False),
                RagDocPermission.doc_id == p.doc_id,
                RagDocPermission.user_id == p.user_id,
            )
        )).scalars().first()
        if existing:
            existing.perm = p.perm
        else:
            db.add(RagDocPermission(
                id=generate_id(), doc_id=p.doc_id, user_id=p.user_id, perm=p.perm
            ))
    await db.commit()
    return {"ok": True}


@router.delete("/{kb_id}/doc-permissions/{perm_id}")
async def revoke_doc_permission(kb_id: int, perm_id: int, user: SysUser = Depends(require_user),
                                db: AsyncSession = Depends(get_db)) -> dict:
    """撤销文档级授权 (仅 owner/admin)"""
    await require_kb_access(db, kb_id, user, write=True)
    perm = await db.get(RagDocPermission, perm_id)
    if perm and not perm.is_delete:
        doc = await db.get(RagDocument, perm.doc_id)
        if doc and doc.kb_id == kb_id:
            perm.is_delete = True
            await db.commit()
    return {"ok": True}


# ---------- 用户列表 (用于授权弹窗) ----------

@router.get("/users/options")
async def users_options(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """全部有效用户列表 (用于授权弹窗)"""
    rows = (await db.execute(
        select(SysUser.user_id, SysUser.name, SysUser.department)
        .where(SysUser.is_delete.is_(False), SysUser.is_active.is_(True))
        .order_by(SysUser.department.nulls_last(), SysUser.name)
    )).all()
    return {
        "items": [
            {"user_id": uid, "name": name, "department": dept or ""}
            for uid, name, dept in rows
        ]
    }


@router.get("/projects/options")
async def project_options(user: SysUser = Depends(require_user), db: AsyncSession = Depends(get_db)) -> dict:
    """项目下拉选项 (同库直读 pro_projects, project 级知识库关联用)"""
    rows = (await db.execute(
        text("SELECT id, name, title FROM pro_projects WHERE is_delete = false ORDER BY sort_order, id")
    )).all()
    return {"items": [{"id": r[0], "name": r[1], "title": r[2] or ""} for r in rows]}
