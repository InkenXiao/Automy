"""Agent 路由 · CRUD + 会话 + 记忆"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.agent import Agent, AgentMemory, AgentMessage, AgentSession
from app.schemas.agent import (
    AgentCreate,
    AgentOut,
    AgentUpdate,
    ChatRequest,
    MemoryCreate,
    MemoryOut,
    MessageOut,
    SessionCreate,
    SessionOut,
)

router = APIRouter(prefix="/agents", tags=["智能体"])


# ---------- Agent CRUD ----------

@router.get("/", response_model=list[AgentOut])
async def list_agents(
    type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[AgentOut]:
    q = select(Agent).where(Agent.is_active.is_(True))
    if type:
        q = q.where(Agent.type == type)
    q = q.order_by(Agent.id)
    result = await db.execute(q)
    return [AgentOut.model_validate(a) for a in result.scalars().all()]


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(agent_id: int, db: AsyncSession = Depends(get_db)) -> AgentOut:
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    return AgentOut.model_validate(agent)


@router.post("/", response_model=AgentOut)
async def create_agent(payload: AgentCreate, db: AsyncSession = Depends(get_db)) -> AgentOut:
    agent = Agent(**payload.model_dump())
    db.add(agent)
    await db.flush()
    await db.refresh(agent)
    return AgentOut.model_validate(agent)


@router.put("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: int, payload: AgentUpdate, db: AsyncSession = Depends(get_db)
) -> AgentOut:
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(agent, key, value)
    await db.flush()
    await db.refresh(agent)
    return AgentOut.model_validate(agent)


@router.delete("/{agent_id}")
async def delete_agent(agent_id: int, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    agent.is_active = False
    await db.flush()
    return {"ok": True}


# ---------- 会话管理 ----------

@router.post("/{agent_id}/sessions", response_model=SessionOut)
async def create_session(
    agent_id: int, payload: SessionCreate, db: AsyncSession = Depends(get_db)
) -> SessionOut:
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    session = AgentSession(agent_id=agent_id, title=payload.title or f"会话 {agent.name}")
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return SessionOut.model_validate(session)


@router.get("/{agent_id}/sessions", response_model=list[SessionOut])
async def list_sessions(agent_id: int, db: AsyncSession = Depends(get_db)) -> list[SessionOut]:
    result = await db.execute(
        select(AgentSession)
        .where(AgentSession.agent_id == agent_id)
        .order_by(AgentSession.updated_at.desc())
    )
    return [SessionOut.model_validate(s) for s in result.scalars().all()]


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
async def get_messages(session_id: int, db: AsyncSession = Depends(get_db)) -> list[MessageOut]:
    result = await db.execute(
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id)
        .order_by(AgentMessage.id)
    )
    return [MessageOut.model_validate(m) for m in result.scalars().all()]


# ---------- 对话 (SSE 流式) ----------

@router.post("/{agent_id}/chat")
async def chat(agent_id: int, payload: ChatRequest, db: AsyncSession = Depends(get_db)):
    """发送消息并流式返回 Agent 回复"""
    from app.services.agent_engine import AgentEngine

    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")

    # 获取或创建会话
    if payload.session_id:
        session = await db.get(AgentSession, payload.session_id)
        if not session or session.agent_id != agent_id:
            raise HTTPException(status_code=404, detail="会话不存在")
    else:
        session = AgentSession(agent_id=agent_id, title=payload.message[:50])
        db.add(session)
        await db.flush()
        await db.refresh(session)

    # 保存用户消息
    user_msg = AgentMessage(session_id=session.id, role="user", content=payload.message)
    db.add(user_msg)
    await db.flush()

    # 加载历史消息
    result = await db.execute(
        select(AgentMessage)
        .where(AgentMessage.session_id == session.id)
        .order_by(AgentMessage.id)
    )
    history = result.scalars().all()

    # 加载记忆
    mem_result = await db.execute(
        select(AgentMemory)
        .where(AgentMemory.agent_id == agent_id)
        .order_by(AgentMemory.created_at.desc())
        .limit(20)
    )
    memories = mem_result.scalars().all()

    engine = AgentEngine(db)

    async def event_stream():
        full_content = ""
        try:
            async for chunk in engine.chat(agent, session, history, memories, payload.message):
                full_content += chunk
                yield f"data: {json.dumps({'type': 'content', 'content': chunk, 'session_id': session.id})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            # 保存助手消息
            assistant_msg = AgentMessage(
                session_id=session.id, role="assistant", content=full_content
            )
            db.add(assistant_msg)
            await db.flush()
            yield f"data: {json.dumps({'type': 'done', 'session_id': session.id})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------- 记忆管理 ----------

@router.get("/{agent_id}/memories", response_model=list[MemoryOut])
async def list_memories(
    agent_id: int,
    memory_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[MemoryOut]:
    q = select(AgentMemory).where(AgentMemory.agent_id == agent_id)
    if memory_type:
        q = q.where(AgentMemory.memory_type == memory_type)
    q = q.order_by(AgentMemory.created_at.desc())
    result = await db.execute(q)
    return [MemoryOut.model_validate(m) for m in result.scalars().all()]


@router.post("/{agent_id}/memories", response_model=MemoryOut)
async def create_memory(
    agent_id: int, payload: MemoryCreate, db: AsyncSession = Depends(get_db)
) -> MemoryOut:
    memory = AgentMemory(agent_id=agent_id, **payload.model_dump())
    db.add(memory)
    await db.flush()
    await db.refresh(memory)
    return MemoryOut.model_validate(memory)


@router.delete("/{agent_id}/memories/{memory_id}")
async def delete_memory(
    agent_id: int, memory_id: int, db: AsyncSession = Depends(get_db)
):
    memory = await db.get(AgentMemory, memory_id)
    if not memory or memory.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="记忆不存在")
    await db.delete(memory)
    await db.flush()
    return {"ok": True}
