"""RAG 检索问答路由"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import accessible_doc_ids, require_user, visible_kb_ids
from app.models import SysUser
from app.services import rag_query

router = APIRouter(prefix="/rag", tags=["RAG 检索"])


class SearchIn(BaseModel):
    kb_ids: List[int]
    query: str
    top_k: Optional[int] = 10


class QueryIn(BaseModel):
    kb_ids: List[int]
    query: str
    mode: Optional[str] = "hybrid"  # hybrid/local/global
    top_k: Optional[int] = 8
    agent_id: Optional[int] = 0   # 来源智能体 (pro-cowork 调用时传入)
    skill_id: Optional[int] = 0   # 来源技能


async def _filter_kb_ids(db: AsyncSession, user: SysUser, kb_ids: List[int]) -> List[int]:
    """请求 kb_ids 与可见集合取交集, 越权直接过滤"""
    visible = set(await visible_kb_ids(db, user))
    return [k for k in kb_ids if k in visible]


async def _allowed_doc_ids(db: AsyncSession, user: SysUser, kb_ids: List[int]) -> Optional[set]:
    """合并各 KB 的文档级可见集; 返回 None 表示全部 KB 均不受限"""
    allowed: set[int] = set()
    for kid in kb_ids:
        doc_ids = await accessible_doc_ids(db, kid, user)
        if doc_ids is None:
            return None  # 有一个库不受限即整体不受限
        allowed.update(doc_ids)
    return allowed


@router.post("/search")
async def search(payload: SearchIn, user: SysUser = Depends(require_user),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """纯检索: 返回分块/实体命中 (不生成答案)"""
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="查询内容不能为空")
    kb_ids = await _filter_kb_ids(db, user, payload.kb_ids)
    if not kb_ids:
        raise HTTPException(status_code=403, detail="无可见知识库或知识库越权")
    allowed_docs = await _allowed_doc_ids(db, user, kb_ids)
    return await rag_query.search(kb_ids, payload.query.strip(), payload.top_k or 10,
                                  allowed_doc_ids=allowed_docs)


@router.post("/query")
async def query(payload: QueryIn, user: SysUser = Depends(require_user),
                db: AsyncSession = Depends(get_db)) -> dict:
    """RAG 问答: 混合检索 + LLM 生成 (含引用来源)"""
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    mode = payload.mode if payload.mode in ("hybrid", "local", "global") else "hybrid"
    kb_ids = await _filter_kb_ids(db, user, payload.kb_ids)
    if not kb_ids:
        raise HTTPException(status_code=403, detail="无可见知识库或知识库越权")
    allowed_docs = await _allowed_doc_ids(db, user, kb_ids)
    return await rag_query.query(
        kb_ids, payload.query.strip(), mode=mode, top_k=payload.top_k or 8,
        user_id=user.user_id, allowed_doc_ids=allowed_docs,
        agent_id=payload.agent_id or 0, skill_id=payload.skill_id or 0,
    )
