"""任务后台执行管理器 · 长任务脱离 HTTP 连接执行, 过程事件持久化

- start(run_id): 创建 asyncio 后台任务, 独立 DB 会话执行 Agent 引擎
- 执行事件 (user/content/tool_call/tool_result/error/done + intent/choice/model/asr/minutes)
  逐条写入 task_run_events; 内存队列供 SSE 实时订阅; 页面关闭/切换不影响执行
- 意图识别: agent_id 为空的任务先识别 项目/分身/技能; 识别不了则发出 choice_request
  事件并挂起等待用户在执行窗口选择 (POST /{run_id}/choose), 选择结果沉淀为分身记忆
- 运行事件直发通道 (register/emit): 技能内置能力(如会议纪要)在工具结果返回前
  实时推送 asr_segment / minutes_delta 等过程事件
- 服务重启后 running 任务由 recover_interrupted_runs 一次性置为 failed
"""
import asyncio
import logging
from typing import Awaitable, Callable, Optional

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.agent import Agent, AgentMemory, AgentMessage, AgentSession
from app.models.task_run import TaskRun, TaskRunEvent
from sqlalchemy import or_

logger = logging.getLogger(__name__)

CONTENT_FLUSH_CHARS = 300  # content 缓冲聚合阈值 (字符)
CHOICE_TIMEOUT_S = 600     # 等待用户在执行窗口选择分身/技能的超时时间

# ---------- 运行事件直发通道 (会话级) ----------
# session_id -> async fn(etype, payload); 由 TaskRunner._execute 注册/注销,
# 供 skill_engine 内置能力在工具结果返回前实时推送过程事件 (如录音转写分段)
RunEmitter = Callable[[str, dict], Awaitable[None]]
_run_emitters: dict[int, RunEmitter] = {}


def register_run_emitter(session_id: int, fn: RunEmitter) -> None:
    _run_emitters[session_id] = fn


def unregister_run_emitter(session_id: int) -> None:
    _run_emitters.pop(session_id, None)


async def emit_run_event(session_id: Optional[int], etype: str, payload: dict) -> None:
    """向正在执行的任务推送过程事件; 无订阅(非任务上下文)时静默忽略"""
    if not session_id:
        return
    fn = _run_emitters.get(session_id)
    if fn:
        try:
            await fn(etype, payload)
        except Exception:  # noqa: BLE001 - 过程事件失败不阻断主流程
            logger.warning("推送过程事件失败 session=%s type=%s", session_id, etype)


class TaskRunner:
    """后台任务执行器 (进程内单例)"""

    def __init__(self):
        self._tasks: dict[int, asyncio.Task] = {}
        self._subscribers: dict[int, list[asyncio.Queue]] = {}
        self._pending_choices: dict[int, asyncio.Future] = {}

    # ---------- 对外: 启动 / 订阅 ----------

    def start(self, run_id: int) -> None:
        """启动后台执行 (调用方需已完成 prepare: 用户事件/状态)"""
        if run_id in self._tasks and not self._tasks[run_id].done():
            raise RuntimeError("任务正在执行中")
        self._tasks[run_id] = asyncio.create_task(self._execute(run_id))

    def subscribe(self, run_id: int) -> asyncio.Queue:
        """订阅实时事件 (SSE 用); 队列收到 None 表示执行结束"""
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(run_id, []).append(q)
        return q

    def unsubscribe(self, run_id: int, q: asyncio.Queue) -> None:
        subs = self._subscribers.get(run_id)
        if subs and q in subs:
            subs.remove(q)

    def is_running(self, run_id: int) -> bool:
        t = self._tasks.get(run_id)
        return bool(t and not t.done())

    # ---------- 对外: 用户选择 (意图识别失败时) ----------

    def resolve_choice(self, run_id: int, data: Optional[dict]) -> bool:
        """用户在选择面板完成选择; data=None 表示取消 (任务被删除等)"""
        fut = self._pending_choices.get(run_id)
        if fut and not fut.done():
            fut.set_result(data)
            return True
        return False

    async def _wait_choice(self, run_id: int, timeout: int = CHOICE_TIMEOUT_S) -> Optional[dict]:
        """挂起等待用户选择, 超时/取消返回 None"""
        fut = asyncio.get_running_loop().create_future()
        self._pending_choices[run_id] = fut
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            self._pending_choices.pop(run_id, None)

    # ---------- 内部: 事件持久化 + 广播 ----------

    async def _emit(self, db, run_id: int, seq: int, etype: str, name: str, payload: dict) -> dict:
        event = TaskRunEvent(run_id=run_id, seq=seq, type=etype, name=name or "", payload=payload)
        db.add(event)
        await db.commit()
        data = {"seq": seq, "type": etype, "name": name or "", "payload": payload}
        for q in self._subscribers.get(run_id, []):
            q.put_nowait(data)
        return data

    def _finish_broadcast(self, run_id: int) -> None:
        for q in self._subscribers.get(run_id, []):
            q.put_nowait(None)

    async def _max_seq(self, db, run_id: int) -> int:
        result = await db.execute(
            select(func.max(TaskRunEvent.seq)).where(
                TaskRunEvent.run_id == run_id, TaskRunEvent.is_delete.is_(False)
            )
        )
        return result.scalar() or 0

    # ---------- 内部: 意图识别 + 用户选择 ----------

    async def _resolve_intent(self, db, run: TaskRun, emit) -> None:
        """agent_id 为空的任务: 意图识别 → 识别不了则等待用户选择 → 创建会话与首条消息"""
        from app.services.intent_service import recognize_intent

        await emit("intent", "", {"stage": "start", "content": "正在根据任务描述进行意图识别…"})
        intent = await recognize_intent(db, run.input_text, run.file_names or [], run.project_id)
        if intent.get("project_id"):
            run.project_id = intent["project_id"]
        run.skill_ids = list(intent.get("skill_ids") or [])
        agent_id = intent.get("agent_id")
        await emit("intent", "", {
            "stage": "done",
            "project_id": run.project_id,
            "agent_id": agent_id,
            "skill_ids": run.skill_ids,
            "reason": intent.get("reason") or "",
        })

        if not agent_id:
            # 识别不了: 挂起等待用户在执行输出窗口选择
            from app.models.skill import Skill

            agents = (await db.execute(
                select(Agent)
                .where(Agent.is_active.is_(True), Agent.is_delete.is_(False))
                .order_by(Agent.id)
            )).scalars().all()
            skills = (await db.execute(
                select(Skill)
                .where(Skill.is_active.is_(True), Skill.is_delete.is_(False))
                .order_by(Skill.id)
            )).scalars().all()
            await db.commit()  # 提交 run 字段变更, 保证等待期间数据一致
            await emit("choice_request", "", {
                "reason": intent.get("reason") or "未能自动识别合适的数字分身, 请手动选择",
                "agents": [
                    {"id": a.id, "name": a.name,
                     "icon": (a.config or {}).get("icon", "🤖"),
                     "description": a.description or ""}
                    for a in agents
                ],
                "skills": [
                    {"id": s.id, "name": s.name,
                     "icon": (s.config or {}).get("icon", "⚡")}
                    for s in skills
                ],
            })
            choice = await self._wait_choice(run.id)
            if not choice:
                raise RuntimeError("等待用户选择超时或已取消")
            agent_id = choice["agent_id"]
            extra_skills = [s for s in (choice.get("skill_ids") or []) if isinstance(s, int)]
            run.skill_ids = list(dict.fromkeys(run.skill_ids + extra_skills))
            run.agent_id = agent_id

            # 用户选择沉淀为对应智能体的长期记忆 (后续同类任务可自动分流)
            agent_obj = await db.get(Agent, agent_id)
            skill_names = ""
            if extra_skills:
                rows = (await db.execute(
                    select(Skill).where(Skill.id.in_(extra_skills))
                )).scalars().all()
                skill_names = "、".join(s.name for s in rows)
            db.add(AgentMemory(
                agent_id=agent_id,
                project_id=run.project_id,
                memory_type="preference",
                key="任务分流选择",
                content=(
                    f"任务「{run.title}」由用户在执行窗口指定分身「{agent_obj.name if agent_obj else agent_id}」"
                    + (f", 附加技能: {skill_names}" if skill_names else "")
                    + f"。任务描述: {(run.input_text or '')[:120]}"
                ),
            ))
            await emit("choice_done", "", {
                "agent_id": agent_id,
                "agent_name": agent_obj.name if agent_obj else str(agent_id),
                "skill_ids": run.skill_ids,
            })
        else:
            run.agent_id = agent_id

        # 组装提示词 (带入识别/选择的技能) + 创建会话与首条消息
        from app.routers.task_runs import _build_prompt

        message = await _build_prompt(
            db, run.project_id, run.input_text, run.file_names or [], run.skill_ids or []
        )
        session = AgentSession(agent_id=run.agent_id, title=run.title[:50])
        db.add(session)
        await db.flush()
        await db.refresh(session)
        run.session_id = session.id
        db.add(AgentMessage(session_id=session.id, role="user", content=message))
        await db.commit()

    # ---------- 内部: 后台执行主流程 ----------

    async def _execute(self, run_id: int) -> None:
        from app.services.agent_engine import AgentEngine

        async with AsyncSessionLocal() as db:
            reply_parts: list[str] = []
            failed = False
            bound_session_id: Optional[int] = None
            try:
                run = await db.get(TaskRun, run_id)
                if run.is_delete:
                    # 任务在启动间隙被删除: 静默退出, 不产生任何事件/状态变更
                    return

                seq_holder = {"seq": await self._max_seq(db, run_id) + 1}

                async def emit(etype: str, name: str, payload: dict) -> None:
                    await self._emit(db, run_id, seq_holder["seq"], etype, name, payload)
                    seq_holder["seq"] += 1

                # ---- 意图识别 (创建时未指定分身) ----
                if run.agent_id is None:
                    await self._resolve_intent(db, run, emit)
                    run = await db.get(TaskRun, run_id)  # 重新加载, 避免过期状态

                agent = await db.get(Agent, run.agent_id)
                session = await db.get(AgentSession, run.session_id)

                # 注册过程事件直发通道 (技能内置能力实时输出)
                bound_session_id = session.id

                async def _direct(etype: str, payload: dict) -> None:
                    await emit(etype, "", payload)

                register_run_emitter(session.id, _direct)

                # 会话历史: 最后一条 user 为本轮输入, 其余为上下文
                msg_result = await db.execute(
                    select(AgentMessage)
                    .where(
                        AgentMessage.session_id == session.id,
                        AgentMessage.is_delete.is_(False),
                    )
                    .order_by(AgentMessage.id)
                )
                all_msgs = msg_result.scalars().all()
                message = all_msgs[-1].content if all_msgs else ""
                history = all_msgs[:-1]

                # 记忆: 任务关联项目 + 通用记忆
                mem_result = await db.execute(
                    select(AgentMemory)
                    .where(
                        AgentMemory.agent_id == agent.id,
                        AgentMemory.is_delete.is_(False),
                        or_(
                            AgentMemory.project_id == run.project_id,
                            AgentMemory.project_id.is_(None),
                        ),
                    )
                    .order_by(AgentMemory.created_at.desc())
                    .limit(20)
                )
                memories = mem_result.scalars().all()

                engine = AgentEngine(db)
                content_buf: list[str] = []

                async def flush_content() -> None:
                    if not content_buf:
                        return
                    text = "".join(content_buf)
                    content_buf.clear()
                    reply_parts.append(text)
                    await emit("content", "", {"content": text})

                async for event in engine.chat(agent, session, history, memories, message):
                    etype = event.get("type")
                    if etype == "content":
                        content_buf.append(event["content"])
                        if sum(len(p) for p in content_buf) >= CONTENT_FLUSH_CHARS:
                            await flush_content()
                    elif etype == "model_call":
                        await flush_content()
                        payload = {k: v for k, v in event.items() if k != "type"}
                        await emit("model", "", payload)
                    elif etype == "tool_call":
                        await flush_content()
                        await emit("tool_call", event["name"], {"arguments": event["arguments"]})
                    elif etype == "tool_result":
                        await flush_content()
                        await emit("tool_result", event["name"], {
                            "result": event["result"],
                            "duration_ms": event["duration_ms"],
                        })

                await flush_content()

            except asyncio.CancelledError:
                failed = True
                logger.warning("任务 %s 后台执行被取消", run_id)
                raise
            except Exception as e:  # noqa: BLE001
                failed = True
                logger.exception("任务 %s 后台执行异常", run_id)
                try:
                    await self._emit(
                        db, run_id, await self._max_seq(db, run_id) + 1,
                        "error", "", {"content": str(e)},
                    )
                except Exception:  # noqa: BLE001
                    pass
            finally:
                if bound_session_id:
                    unregister_run_emitter(bound_session_id)
                self.resolve_choice(run_id, None)  # 清理可能悬挂的选择等待
                try:
                    result_text = "".join(reply_parts)
                    if result_text.lstrip().startswith("⚠️"):
                        failed = True
                    run = await db.get(TaskRun, run_id)
                    if run.is_delete:
                        # 执行期间被删除: 不回写结果/状态, 仅广播结束
                        return
                    if run.session_id:
                        session = await db.get(AgentSession, run.session_id)
                        if session and result_text:
                            db.add(AgentMessage(
                                session_id=session.id, role="assistant", content=result_text
                            ))
                    # continue 模式: 追加到任务结果 (保留前轮输出)
                    run.result_text = (
                        (run.result_text + "\n\n" + result_text) if run.result_text else result_text
                    )
                    run.status = "failed" if failed else "done"
                    await db.commit()

                    await self._emit(
                        db, run_id, await self._max_seq(db, run_id) + 1,
                        "done", "", {
                            "run_id": run_id, "status": run.status,
                            "session_id": run.session_id,
                        },
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("任务 %s 收尾持久化失败", run_id)
                finally:
                    self._finish_broadcast(run_id)


task_runner = TaskRunner()


async def recover_interrupted_runs() -> None:
    """服务启动巡检: 上次进程退出时仍在 running 的任务标记为失败"""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(TaskRun).where(TaskRun.status == "running", TaskRun.is_delete.is_(False))
        )
        runs = result.scalars().all()
        for run in runs:
            run.status = "failed"
            seq_result = await db.execute(
                select(func.max(TaskRunEvent.seq)).where(
                    TaskRunEvent.run_id == run.id, TaskRunEvent.is_delete.is_(False)
                )
            )
            seq = (seq_result.scalar() or 0) + 1
            db.add(TaskRunEvent(
                run_id=run.id, seq=seq, type="error", name="",
                payload={"content": "服务重启, 任务执行中断"},
            ))
            seq += 1
            db.add(TaskRunEvent(
                run_id=run.id, seq=seq, type="done", name="",
                payload={"run_id": run.id, "status": "failed", "session_id": run.session_id},
            ))
        if runs:
            await db.commit()
            logger.info("已将 %d 个中断任务标记为 failed", len(runs))
