"""Agent 路由 · CRUD + 会话 + 对话(SSE) + 调试(Trace) + 记忆"""
import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.agent import Agent, AgentMemory, AgentMessage, AgentSession
from app.utils import get_active_project_id
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
    SessionUpdate,
)

router = APIRouter(prefix="/agents", tags=["智能体"])

# 记忆规则触发: 用户显式要求记住时自动沉淀
MEMORY_TRIGGER = re.compile(r"(记住|请记住|以后|偏好|习惯)")


# ---------- Agent CRUD ----------

@router.get("/", response_model=list[AgentOut])
async def list_agents(
    type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[AgentOut]:
    q = select(Agent).where(Agent.is_active.is_(True), Agent.is_delete.is_(False))
    if type:
        q = q.where(Agent.type == type)
    q = q.order_by(Agent.id)
    result = await db.execute(q)
    return [AgentOut.model_validate(a) for a in result.scalars().all()]


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(agent_id: int, db: AsyncSession = Depends(get_db)) -> AgentOut:
    agent = await db.get(Agent, agent_id)
    if not agent or agent.is_delete:
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
    if not agent or agent.is_delete:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(agent, key, value)
    await db.flush()
    await db.refresh(agent)
    return AgentOut.model_validate(agent)


@router.delete("/{agent_id}")
async def delete_agent(agent_id: int, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if not agent or agent.is_delete:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    agent.is_delete = True
    agent.is_active = False
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True}


# ---------- 会话管理 ----------

@router.post("/{agent_id}/sessions", response_model=SessionOut)
async def create_session(
    agent_id: int, payload: SessionCreate, db: AsyncSession = Depends(get_db)
) -> SessionOut:
    agent = await db.get(Agent, agent_id)
    if not agent or agent.is_delete:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    session = AgentSession(agent_id=agent_id, title=payload.title or f"会话 {agent.name}")
    db.add(session)
    await db.commit()  # 显式提交: 保证紧随的列表刷新能读到新会话
    await db.refresh(session)
    return SessionOut.model_validate(session)


@router.get("/{agent_id}/sessions", response_model=list[SessionOut])
async def list_sessions(agent_id: int, db: AsyncSession = Depends(get_db)) -> list[SessionOut]:
    result = await db.execute(
        select(AgentSession)
        .where(
            AgentSession.agent_id == agent_id,
            AgentSession.status == "active",
            AgentSession.is_delete.is_(False),
        )
        .order_by(AgentSession.updated_at.desc())
    )
    return [SessionOut.model_validate(s) for s in result.scalars().all()]


@router.patch("/sessions/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: int, payload: SessionUpdate, db: AsyncSession = Depends(get_db)
) -> SessionOut:
    """会话改名 / 状态变更"""
    session = await db.get(AgentSession, session_id)
    if not session or session.is_delete:
        raise HTTPException(status_code=404, detail="会话不存在")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(session, key, value)
    await db.flush()
    await db.refresh(session)
    return SessionOut.model_validate(session)


@router.delete("/sessions/{session_id}")
async def archive_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """删除会话 (逻辑删除, 消息保留)"""
    session = await db.get(AgentSession, session_id)
    if not session or session.is_delete:
        raise HTTPException(status_code=404, detail="会话不存在")
    session.is_delete = True
    session.status = "archived"
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True}


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
async def get_messages(session_id: int, db: AsyncSession = Depends(get_db)) -> list[MessageOut]:
    session = await db.get(AgentSession, session_id)
    if not session or session.is_delete:
        raise HTTPException(status_code=404, detail="会话不存在")
    result = await db.execute(
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id, AgentMessage.is_delete.is_(False))
        .order_by(AgentMessage.id)
    )
    return [MessageOut.model_validate(m) for m in result.scalars().all()]


# ---------- 对话 (SSE 流式, 结构化事件) ----------

@router.post("/{agent_id}/chat")
async def chat(agent_id: int, payload: ChatRequest, db: AsyncSession = Depends(get_db)):
    """发送消息并流式返回 Agent 回复

    SSE 事件类型:
    - content: 文本增量 {"type","content","session_id"}
    - tool_call: 工具调用 {"type","name","arguments"}
    - tool_result: 工具结果 {"type","name","result","duration_ms"}
    - done / error: 结束
    """
    from app.services.agent_engine import AgentEngine

    agent = await db.get(Agent, agent_id)
    if not agent or agent.is_delete:
        raise HTTPException(status_code=404, detail="Agent 不存在")

    # 获取或创建会话
    if payload.session_id:
        session = await db.get(AgentSession, payload.session_id)
        if not session or session.agent_id != agent_id or session.is_delete:
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

    # 当前激活项目 (记忆按项目隔离)
    active_pid = await get_active_project_id(db)

    # 记忆规则触发: 用户显式要求记住 → 自动沉淀为 preference 记忆
    if MEMORY_TRIGGER.search(payload.message):
        db.add(AgentMemory(
            agent_id=agent_id,
            project_id=active_pid,
            session_id=session.id,
            memory_type="preference",
            key=payload.message[:30],
            content=payload.message,
        ))
        await db.flush()

    # 加载历史消息
    result = await db.execute(
        select(AgentMessage)
        .where(AgentMessage.session_id == session.id, AgentMessage.is_delete.is_(False))
        .order_by(AgentMessage.id)
    )
    history = result.scalars().all()

    # 加载记忆: 当前激活项目的记忆 + 未关联项目的通用记忆
    mem_result = await db.execute(
        select(AgentMemory)
        .where(
            AgentMemory.agent_id == agent_id,
            AgentMemory.is_delete.is_(False),
            or_(
                AgentMemory.project_id == active_pid,
                AgentMemory.project_id.is_(None),
            ),
        )
        .order_by(AgentMemory.created_at.desc())
        .limit(20)
    )
    memories = mem_result.scalars().all()

    engine = AgentEngine(db)

    async def event_stream():
        reply_parts: list[str] = []
        try:
            async for event in engine.chat(agent, session, history, memories, payload.message):
                etype = event.get("type")
                if etype == "content":
                    reply_parts.append(event["content"])
                    yield f"data: {json.dumps({'type': 'content', 'content': event['content'], 'session_id': session.id}, ensure_ascii=False)}\n\n"
                elif etype == "tool_call":
                    reply_parts.append(f"\n\n> 🔧 执行工具: **{event['name']}**\n\n")
                    yield f"data: {json.dumps({'type': 'tool_call', 'name': event['name'], 'arguments': event['arguments']}, ensure_ascii=False, default=str)}\n\n"
                elif etype == "tool_result":
                    result_str = json.dumps(event["result"], ensure_ascii=False, default=str)
                    reply_parts.append(f"> ✅ 工具结果: {result_str[:200]}{'...' if len(result_str) > 200 else ''}\n\n")
                    yield f"data: {json.dumps({'type': 'tool_result', 'name': event['name'], 'result': event['result'], 'duration_ms': event['duration_ms']}, ensure_ascii=False, default=str)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"
        finally:
            # 保存助手消息 (含可读工具轨迹)
            db.add(AgentMessage(
                session_id=session.id, role="assistant", content="".join(reply_parts)
            ))
            await db.flush()
            yield f"data: {json.dumps({'type': 'done', 'session_id': session.id})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------- 调试 (非流式 Trace + 上下文会话) ----------

@router.post("/{agent_id}/debug")
async def debug_agent(agent_id: int, payload: ChatRequest, db: AsyncSession = Depends(get_db)):
    """调试模式: 非流式执行一轮对话, 返回结构化执行轨迹

    上下文记忆:
    - 传入 session_id 时复用该调试会话的历史消息 (上一轮创建会议后, 本轮"保存会议纪要"
      可定位到同一会议); 不传则新建调试会话 (status=debug, 不出现在正式会话列表)
    - 调试消息落库到调试会话, 供多轮上下文引用
    返回: {reply, trace(每轮入参/出参/耗时), memories(本次注入的记忆), session_id, model}
    """
    from app.services.agent_engine import AgentEngine

    agent = await db.get(Agent, agent_id)
    if not agent or agent.is_delete:
        raise HTTPException(status_code=404, detail="Agent 不存在")

    # 调试会话: 复用或新建 (status=debug 与正式会话隔离)
    if payload.session_id:
        session = await db.get(AgentSession, payload.session_id)
        if not session or session.agent_id != agent_id or session.is_delete:
            raise HTTPException(status_code=404, detail="调试会话不存在")
    else:
        session = AgentSession(
            agent_id=agent_id, title=f"[调试] {payload.message[:40]}", status="debug"
        )
        db.add(session)
        await db.flush()
        await db.refresh(session)

    # 加载记忆 (与正式对话一致): 当前激活项目 + 通用记忆
    active_pid = await get_active_project_id(db)
    mem_result = await db.execute(
        select(AgentMemory)
        .where(
            AgentMemory.agent_id == agent_id,
            AgentMemory.is_delete.is_(False),
            or_(
                AgentMemory.project_id == active_pid,
                AgentMemory.project_id.is_(None),
            ),
        )
        .order_by(AgentMemory.created_at.desc())
        .limit(20)
    )
    memories = mem_result.scalars().all()

    # 调试会话历史 (上下文记忆)
    msg_result = await db.execute(
        select(AgentMessage)
        .where(AgentMessage.session_id == session.id, AgentMessage.is_delete.is_(False))
        .order_by(AgentMessage.id)
    )
    history = msg_result.scalars().all()

    # 用户消息落库
    db.add(AgentMessage(session_id=session.id, role="user", content=payload.message))
    await db.flush()

    engine = AgentEngine(db)
    result = await engine.chat_with_trace(agent, history, memories, payload.message)

    # 助手回复落库 (供下轮上下文)
    if result.get("reply"):
        db.add(AgentMessage(
            session_id=session.id, role="assistant", content=result["reply"]
        ))
        await db.flush()

    result["session_id"] = session.id
    result["memories"] = [
        {"id": m.id, "memory_type": m.memory_type, "key": m.key,
         "content": m.content, "project_id": m.project_id}
        for m in memories
    ]
    return result


# ---------- 记忆管理 ----------

@router.get("/{agent_id}/memories", response_model=list[MemoryOut])
async def list_memories(
    agent_id: int,
    memory_type: Optional[str] = None,
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> list[MemoryOut]:
    q = select(AgentMemory).where(
        AgentMemory.agent_id == agent_id, AgentMemory.is_delete.is_(False)
    )
    if memory_type:
        q = q.where(AgentMemory.memory_type == memory_type)
    if project_id is not None:
        q = q.where(AgentMemory.project_id == project_id)
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
    if not memory or memory.agent_id != agent_id or memory.is_delete:
        raise HTTPException(status_code=404, detail="记忆不存在")
    memory.is_delete = True
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True}
