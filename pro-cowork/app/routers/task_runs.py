"""工作台任务路由 · 项目 × 文件 × 智能体 × 技能 组合执行

执行模型 (v2): 后台执行 + 过程持久化
- POST /{run_id}/run 与 /{run_id}/continue: 准备数据后启动后台任务, 立即返回
- GET  /{run_id}/events?after_seq=N (SSE): 重放持久化事件 + 实时 tail, 支持断线续看
- 执行过程不受页面切换/关闭影响; 历史任务可完整回放 (含工具调用与录音转写内容)
"""
import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.agent import Agent, AgentMessage, AgentSession
from app.models.task_run import TaskRun, TaskRunEvent
from app.schemas.task_run import TaskRunChoice, TaskRunContinue, TaskRunCreate, TaskRunOut
from app.services.task_runner import task_runner
from app.utils import get_active_project_id

router = APIRouter(prefix="/task-runs", tags=["工作台任务"])

# 任务附件存储目录: pro-cowork/data/task_files/<project_id>/<filename>
UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "task_files"
MAX_FILE_SIZE = 200 * 1024 * 1024  # 200MB (支持录音文件)


def _safe_filename(name: str) -> str:
    """去除路径分隔符, 防目录穿越"""
    return Path(name).name


def _project_upload_dir(project_id: Optional[int]) -> Path:
    d = UPLOAD_ROOT / str(project_id or 0)
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------- 任务附件 ----------

@router.post("/files/upload")
async def upload_file(
    project_id: Optional[int] = None,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """上传任务附件 (按项目分目录存储, 支持录音文件)"""
    pid = project_id or await get_active_project_id(db)
    name = _safe_filename(file.filename or "unnamed")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件过大 (限制 200MB)")
    path = _project_upload_dir(pid) / name
    path.write_bytes(content)
    return {"ok": True, "name": name, "size": len(content)}


@router.get("/files/list")
async def list_files(
    project_id: Optional[int] = None, db: AsyncSession = Depends(get_db)
):
    """列出项目已上传的任务附件"""
    pid = project_id or await get_active_project_id(db)
    d = _project_upload_dir(pid)
    return [
        {"name": f.name, "size": f.stat().st_size}
        for f in sorted(d.iterdir())
        if f.is_file()
    ]


@router.delete("/files")
async def clear_files(
    project_id: Optional[int] = None, db: AsyncSession = Depends(get_db)
):
    """清空项目全部任务附件 (需求: 重新打开新建长任务页时默认清空历史文件)"""
    pid = project_id or await get_active_project_id(db)
    d = _project_upload_dir(pid)
    removed = 0
    for f in d.iterdir():
        if f.is_file():
            f.unlink()
            removed += 1
    return {"ok": True, "removed": removed}


@router.delete("/files/{filename}")
async def delete_file(
    filename: str,
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    pid = project_id or await get_active_project_id(db)
    path = _project_upload_dir(pid) / _safe_filename(filename)
    if path.exists():
        path.unlink()
    return {"ok": True}


# ---------- 任务 CRUD ----------

@router.get("/", response_model=list[TaskRunOut])
async def list_task_runs(
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
) -> list[TaskRunOut]:
    q = select(TaskRun).where(TaskRun.is_delete.is_(False))
    if project_id is not None:
        q = q.where(TaskRun.project_id == project_id)
    if status:
        q = q.where(TaskRun.status == status)
    q = q.order_by(TaskRun.updated_at.desc()).limit(100)
    result = await db.execute(q)
    return [TaskRunOut.model_validate(t) for t in result.scalars().all()]


@router.post("/", response_model=TaskRunOut)
async def create_task_run(
    payload: TaskRunCreate, db: AsyncSession = Depends(get_db)
) -> TaskRunOut:
    # agent_id 可不传: 执行时由意图识别自动选择, 识别不了由用户在执行窗口选择
    if payload.agent_id is not None:
        agent = await db.get(Agent, payload.agent_id)
        if not agent or agent.is_delete:
            raise HTTPException(status_code=404, detail="智能体不存在")
    pid = payload.project_id or await get_active_project_id(db)
    run = TaskRun(
        project_id=pid,
        agent_id=payload.agent_id,
        title=payload.title or (payload.input_text[:40] or "未命名任务"),
        input_text=payload.input_text,
        skill_ids=payload.skill_ids,
        file_names=[_safe_filename(f) for f in payload.file_names],
        status="draft",
    )
    db.add(run)
    await db.flush()
    await db.refresh(run)
    return TaskRunOut.model_validate(run)


@router.get("/{run_id}", response_model=TaskRunOut)
async def get_task_run(run_id: int, db: AsyncSession = Depends(get_db)) -> TaskRunOut:
    run = await db.get(TaskRun, run_id)
    if not run or run.is_delete:
        raise HTTPException(status_code=404, detail="任务不存在")
    return TaskRunOut.model_validate(run)


@router.delete("/{run_id}")
async def delete_task_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(TaskRun, run_id)
    if not run or run.is_delete:
        raise HTTPException(status_code=404, detail="任务不存在")
    run.is_delete = True
    task_runner.resolve_choice(run_id, None)  # 若正等待用户选择: 取消等待
    await db.commit()  # 显式提交: 保证前端紧随的列表刷新能读到删除结果
    return {"ok": True}


@router.get("/{run_id}/messages")
async def list_task_messages(run_id: int, db: AsyncSession = Depends(get_db)):
    """任务会话消息列表 (按时间正序), 用于前端对话回放"""
    run = await db.get(TaskRun, run_id)
    if not run or run.is_delete:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not run.session_id:
        return []
    result = await db.execute(
        select(AgentMessage)
        .where(AgentMessage.session_id == run.session_id, AgentMessage.is_delete.is_(False))
        .order_by(AgentMessage.id)
    )
    return [
        {"role": m.role, "content": m.content, "created_at": m.created_at}
        for m in result.scalars().all()
    ]


# ---------- 任务执行 (后台 + 过程事件) ----------


async def _build_prompt(
    db: AsyncSession,
    project_id: Optional[int],
    input_text: str,
    file_names: list[str],
    skill_ids: list[int],
) -> str:
    """组装任务提示词: 任务描述 + 附件内容/技能指引 + 指定技能"""
    from app.models.skill import Skill
    from app.services.file_prompt import build_file_prompt_parts

    prompt_parts: list[str] = []
    if input_text:
        prompt_parts.append(input_text)
    prompt_parts.extend(build_file_prompt_parts(project_id, file_names))
    if skill_ids:
        skill_result = await db.execute(select(Skill).where(Skill.id.in_(skill_ids)))
        skills = skill_result.scalars().all()
        if skills:
            names = "、".join(s.name for s in skills)
            prompt_parts.append(
                f"【指定技能】完成本任务时, 请通过 run_skill 工具按需调用以下技能: {names}"
            )
    return "\n\n".join(prompt_parts)


async def _next_seq(db: AsyncSession, run_id: int) -> int:
    from sqlalchemy import func
    result = await db.execute(
        select(func.max(TaskRunEvent.seq)).where(
            TaskRunEvent.run_id == run_id, TaskRunEvent.is_delete.is_(False)
        )
    )
    return (result.scalar() or 0) + 1


@router.post("/{run_id}/run")
async def run_task(run_id: int, db: AsyncSession = Depends(get_db)):
    """启动任务执行 (后台): 准备会话与首条消息后交由 TaskRunner 执行, 立即返回

    - 已指定分身: 直接创建会话与首条消息
    - 未指定分身 (agent_id 为空): 仅写入用户事件, 由 TaskRunner 先进行意图识别,
      识别不了时通过 choice_request 事件等待用户在执行输出窗口选择
    执行过程通过 GET /{run_id}/events (SSE) 订阅。
    """
    run = await db.get(TaskRun, run_id)
    if not run or run.is_delete:
        raise HTTPException(status_code=404, detail="任务不存在")
    if run.status == "running" or task_runner.is_running(run_id):
        raise HTTPException(status_code=409, detail="任务正在执行中")

    if run.agent_id is not None:
        agent = await db.get(Agent, run.agent_id)
        if not agent or agent.is_delete:
            raise HTTPException(status_code=404, detail="智能体不存在")

    message = await _build_prompt(
        db, run.project_id, run.input_text, run.file_names, run.skill_ids or []
    )
    if not message:
        raise HTTPException(status_code=400, detail="任务内容为空, 请填写任务描述或选择文件")

    session_id = None
    if run.agent_id is not None:
        # ---- 创建执行会话 (run 模式总是新会话; status=task 与分身会话列表隔离, 防误删致续跑失败) ----
        session = AgentSession(agent_id=run.agent_id, title=run.title[:50], status="task")
        db.add(session)
        await db.flush()
        await db.refresh(session)
        session_id = session.id
        run.session_id = session.id
        db.add(AgentMessage(session_id=session.id, role="user", content=message))
    # 未指定分身: 会话与首条消息由 TaskRunner 在意图识别后创建

    run.status = "running"

    # 清理旧事件 (重新执行时, 逻辑删除) 并写入 user 事件
    old_events = await db.execute(
        select(TaskRunEvent).where(
            TaskRunEvent.run_id == run_id, TaskRunEvent.is_delete.is_(False)
        )
    )
    for ev in old_events.scalars().all():
        ev.is_delete = True
    db.add(TaskRunEvent(run_id=run_id, seq=1, type="user", name="", payload={"content": message}))
    await db.commit()

    task_runner.start(run_id)
    return {"ok": True, "run_id": run_id, "session_id": session_id, "status": "running"}


@router.post("/{run_id}/choose")
async def choose_task_agent(
    run_id: int, payload: TaskRunChoice, db: AsyncSession = Depends(get_db)
):
    """意图识别失败后的用户选择: 指定数字分身 (+可选技能), 任务继续执行

    用户的选择结果会沉淀为对应智能体的长期记忆 (由 TaskRunner 完成)。
    """
    run = await db.get(TaskRun, run_id)
    if not run or run.is_delete:
        raise HTTPException(status_code=404, detail="任务不存在")
    agent = await db.get(Agent, payload.agent_id)
    if not agent or agent.is_delete:
        raise HTTPException(status_code=404, detail="智能体不存在")
    ok = task_runner.resolve_choice(run_id, {
        "agent_id": payload.agent_id,
        "skill_ids": payload.skill_ids or [],
    })
    if not ok:
        raise HTTPException(status_code=409, detail="任务不在等待选择状态 (可能已完成/超时)")
    return {"ok": True}


@router.post("/{run_id}/continue")
async def continue_task(
    run_id: int, payload: TaskRunContinue, db: AsyncSession = Depends(get_db)
):
    """任务继续对话 (后台): 在原任务会话中补充内容, 可追加文件/技能"""
    run = await db.get(TaskRun, run_id)
    if not run or run.is_delete:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not run.session_id:
        raise HTTPException(status_code=400, detail="任务尚未执行, 无法继续对话")
    if run.status == "running" or task_runner.is_running(run_id):
        raise HTTPException(status_code=409, detail="任务正在执行中")
    agent = await db.get(Agent, run.agent_id)
    if not agent or agent.is_delete:
        raise HTTPException(status_code=404, detail="智能体不存在")
    session = await db.get(AgentSession, run.session_id)
    if not session or session.is_delete:
        raise HTTPException(status_code=404, detail="任务会话不存在")

    # 新附件/技能并入任务记录 (去重)
    new_files = [_safe_filename(f) for f in payload.file_names]
    new_skill_ids = list(payload.skill_ids or [])

    message = await _build_prompt(
        db, run.project_id, payload.input_text, new_files, new_skill_ids
    )
    if not message:
        raise HTTPException(status_code=400, detail="补充内容为空, 请填写内容或添加文件/技能")

    db.add(AgentMessage(session_id=session.id, role="user", content=message))
    run.file_names = list(dict.fromkeys((run.file_names or []) + new_files))
    run.skill_ids = list(dict.fromkeys((run.skill_ids or []) + new_skill_ids))
    run.status = "running"

    seq = await _next_seq(db, run_id)
    db.add(TaskRunEvent(run_id=run_id, seq=seq, type="user", name="", payload={"content": message}))
    await db.commit()

    task_runner.start(run_id)
    return {"ok": True, "run_id": run_id, "session_id": session.id, "status": "running"}


@router.get("/{run_id}/events")
async def stream_task_events(
    run_id: int, after_seq: int = 0, db: AsyncSession = Depends(get_db)
):
    """任务执行事件流 (SSE): 先重放 seq > after_seq 的持久化事件, 若任务仍在执行则实时 tail

    事件格式: {"seq", "type": user|content|tool_call|tool_result|error|done, "name", "payload"}
    收到 done 事件后流结束; 断线后可用最后收到的 seq 重连 (after_seq)。
    """
    run = await db.get(TaskRun, run_id)
    if not run or run.is_delete:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 先注册订阅再查历史, 避免间隙丢事件
    queue = task_runner.subscribe(run_id) if run.status == "running" else None

    result = await db.execute(
        select(TaskRunEvent)
        .where(
            TaskRunEvent.run_id == run_id,
            TaskRunEvent.seq > after_seq,
            TaskRunEvent.is_delete.is_(False),
        )
        .order_by(TaskRunEvent.seq)
    )
    backlog = result.scalars().all()

    async def event_stream():
        last_seq = after_seq
        try:
            # continue 续跑后历史中存在上一轮 done 事件: 仅当 done 为 backlog 最后一条
            # 且无实时订阅时才结束流, 否则继续回放/tail 后续轮次事件
            for idx, ev in enumerate(backlog):
                last_seq = ev.seq
                yield _fmt_event(ev.seq, ev.type, ev.name, ev.payload)
                if ev.type == "done" and queue is None and idx == len(backlog) - 1:
                    return
            if queue is None:
                return
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=30)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if data is None:  # 执行结束信号
                    return
                if data["seq"] <= last_seq:  # 注册前已回放的事件
                    continue
                last_seq = data["seq"]
                yield _fmt_event(data["seq"], data["type"], data["name"], data["payload"])
                if data["type"] == "done":
                    return
        finally:
            if queue is not None:
                task_runner.unsubscribe(run_id, queue)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _fmt_event(seq: int, etype: str, name: str, payload: dict) -> str:
    return f"data: {json.dumps({'seq': seq, 'type': etype, 'name': name, 'payload': payload}, ensure_ascii=False, default=str)}\n\n"
