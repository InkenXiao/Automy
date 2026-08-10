"""共享依赖 · 当前用户识别 (X-User-Name) 与知识库五级权限判定"""
from urllib.parse import unquote

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import RagDocPermission, RagDocument, RagKbPermission, RagKnowledgeBase, SysUser


def get_user_name(request: Request) -> str:
    """从 X-User-Name 请求头取登录人姓名 (前端 encodeURIComponent, 此处还原)"""
    raw = (request.headers.get("x-user-name") or "").strip()
    return unquote(raw) if raw else ""


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> SysUser | None:
    """按姓名查 sys_users; 未登录/未注册返回 None"""
    name = get_user_name(request)
    if not name:
        return None
    result = await db.execute(
        select(SysUser).where(SysUser.is_delete.is_(False), SysUser.name == name, SysUser.is_active.is_(True))
    )
    return result.scalars().first()


async def require_user(user: SysUser | None = Depends(get_current_user)) -> SysUser:
    """要求已登录且为注册用户"""
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


async def _user_project_ids(db: AsyncSession, name: str) -> list[int]:
    """用户所属项目 id 列表 (同库直读 pro-cowork pro_project_members)"""
    rows = (await db.execute(
        text("SELECT DISTINCT project_id FROM pro_project_members WHERE is_delete = false AND name = :name"),
        {"name": name},
    )).all()
    return [r[0] for r in rows]


async def visible_kb_ids(db: AsyncSession, user: SysUser) -> list[int]:
    """用户可见知识库 id 集合 (五级权限规则)

    company   : 全员可读
    department: department 与用户部门一致
    project   : 用户为该项目成员
    personal  : owner 本人
    external  : 仅显式授权
    另: 显式授权 (rag_kb_permissions) 对任意级别附加可见
    """
    result = await db.execute(
        select(RagKnowledgeBase).where(RagKnowledgeBase.is_delete.is_(False))
    )
    kbs = list(result.scalars().all())

    project_ids = set(await _user_project_ids(db, user.name))
    granted = set((await db.execute(
        select(RagKbPermission.kb_id).where(
            RagKbPermission.is_delete.is_(False), RagKbPermission.user_id == user.user_id
        )
    )).scalars().all())

    ids: list[int] = []
    for kb in kbs:
        if kb.owner_user_id == user.user_id:
            ids.append(kb.kb_id)  # owner 对任意级别可见 (部门/外接库创建者兜底)
            continue
        if kb.kb_id in granted:
            ids.append(kb.kb_id)
            continue
        if kb.level == "company":
            ids.append(kb.kb_id)
        elif kb.level == "department" and user.department and kb.department == user.department:
            ids.append(kb.kb_id)
        elif kb.level == "project" and kb.project_id in project_ids:
            ids.append(kb.kb_id)
        elif kb.level == "personal" and kb.owner_user_id == user.user_id:
            ids.append(kb.kb_id)
    return ids


async def require_kb_access(db: AsyncSession, kb_id: int, user: SysUser, write: bool = False) -> RagKnowledgeBase:
    """校验知识库可见 (write=True 时校验可写); 返回知识库记录

    可写判定: owner / admin 授权 / write 授权; department 与 project 级成员默认可写;
    company 级仅 owner 或 admin 授权可写。
    """
    kb = await db.get(RagKnowledgeBase, kb_id)
    if not kb or kb.is_delete:
        raise HTTPException(status_code=404, detail="知识库不存在")

    ids = await visible_kb_ids(db, user)
    if kb.kb_id not in ids:
        raise HTTPException(status_code=403, detail="无权访问该知识库")
    if not write:
        return kb

    # 写权限
    if kb.owner_user_id == user.user_id:
        return kb
    perm = (await db.execute(
        select(RagKbPermission).where(
            RagKbPermission.is_delete.is_(False),
            RagKbPermission.kb_id == kb.kb_id,
            RagKbPermission.user_id == user.user_id,
        )
    )).scalars().first()
    if perm and perm.perm in ("write", "admin"):
        return kb
    if kb.level in ("department", "project"):
        return kb  # 成员默认可写
    raise HTTPException(status_code=403, detail="无该知识库写权限")


async def accessible_doc_ids(db: AsyncSession, kb_id: int, user: SysUser) -> list[int] | None:
    """用户在指定知识库内可访问的文档 id 集合; None 表示不受限 (可访问全部)

    规则:
    - KB owner / KB admin 授权者 → None (不受限, 可访问全部)
    - 普通成员/只读者 → 仅返回 (无单独授权记录的公开文档) + (单独授权给自己的文档)
    """
    kb = await db.get(RagKnowledgeBase, kb_id)
    if not kb or kb.is_delete:
        return []
    if kb.owner_user_id == user.user_id:
        return None  # owner 不受限

    # KB admin 授权 → 不受限
    kb_perm = (await db.execute(
        select(RagKbPermission).where(
            RagKbPermission.is_delete.is_(False),
            RagKbPermission.kb_id == kb_id,
            RagKbPermission.user_id == user.user_id,
        )
    )).scalars().first()
    if kb_perm and kb_perm.perm == "admin":
        return None

    # 该库下所有未删除文档
    all_docs = set((await db.execute(
        select(RagDocument.doc_id).where(
            RagDocument.is_delete.is_(False), RagDocument.kb_id == kb_id
        )
    )).scalars().all())

    # 有单独授权记录的文档 → 受限文档
    restricted_docs = set((await db.execute(
        select(RagDocPermission.doc_id).where(
            RagDocPermission.is_delete.is_(False),
            RagDocPermission.doc_id.in_(all_docs) if all_docs else text("false"),
        ).distinct()
    )).scalars().all())

    # 公开文档 = 全部 - 受限
    public_docs = all_docs - restricted_docs

    # 单独授权给自己的文档
    my_doc_grants = set((await db.execute(
        select(RagDocPermission.doc_id).where(
            RagDocPermission.is_delete.is_(False),
            RagDocPermission.doc_id.in_(restricted_docs) if restricted_docs else text("false"),
            RagDocPermission.user_id == user.user_id,
        )
    )).scalars().all())

    return sorted(public_docs | my_doc_grants)
