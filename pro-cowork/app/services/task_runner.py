"""任务后台执行管理器 · 长任务脱离 HTTP 连接执行, 过程事件持久化

- start(run_id): 创建 asyncio 后台任务, 独立 DB 会话执行 Agent 引擎
- 执行事件 (user/content/tool_call/tool_result/error/done) 逐条写入 task_run_events
- 内存队列供 SSE 实时订阅; 页面关闭/切换不影响执行, 重进可回放+续看
- 服务重启后 running 任务由 recover_interrupted_runs 一次性置为 failed
"""
import asyncio
import json
import logging
from typing import Optional

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.agent import Agent, AgentMemory, AgentMessage, AgentSession
from app.models.task_run import TaskRun, TaskRunEvent
from sqlalchemy import or_

logger = logging.getLogger(__name__)

CONTENT_FLUSH_CHARS = 300  # content 缓冲聚合阈值 (字符)


class TaskRunner:
    """后台任务执行器 (进程内单例)"""

    def __init__(self):
        self._tasks: dict[int, asyncio.Task] = {}
        self._subscribers: dict[int, list[asyncio.Queue]] = {}

    # ---------- 对外: 启动 / 订阅 ----------

    def start(self, run_id: int) -> None:
        """启动后台执行 (调用方需已完成 prepare: 会话/用户消息/状态)"""
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

    # ---------- 内部: 后台执行主流程 ----------

    async def _execute(self, run_id: int) -> None:
        from app.services.agent_engine import AgentEngine

        async with AsyncSessionLocal() as db:
            reply_parts: list[str] = []
            failed = False
            try:
                run = await db.get(TaskRun, run_id)
                agent = await db.get(Agent, run.agent_id)
                session = await db.get(AgentSession, run.session_id)

                # 会话历史: 最后一条 user 为本轮输入, 其余为上下文
                msg_result = await db.execute(
                    select(AgentMessage)
                    .where(AgentMessage.session_id == session.id)
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
                        or_(
                            AgentMemory.project_id == run.project_id,
                            AgentMemory.project_id.is_(None),
                        ),
                    )
                    .order_by(AgentMemory.created_at.desc())
                    .limit(20)
                )
                memories = mem_result.scalars().all()

                # 事件序号起点
                seq_result = await db.execute(
                    select(func.max(TaskRunEvent.seq)).where(TaskRunEvent.run_id == run_id)
                )
                seq = (seq_result.scalar() or 0) + 1

                engine = AgentEngine(db)
                content_buf: list[str] = []

                async def flush_content() -> None:
                    nonlocal seq
                    if not content_buf:
                        return
                    text = "".join(content_buf)
                    content_buf.clear()
                    reply_parts.append(text)
                    await self._emit(db, run_id, seq, "content", "", {"content": text})
                    seq += 1

                async for event in engine.chat(agent, session, history, memories, message):
                    etype = event.get("type")
                    if etype == "content":
                        content_buf.append(event["content"])
                        if sum(len(p) for p in content_buf) >= CONTENT_FLUSH_CHARS:
                            await flush_content()
                    elif etype == "tool_call":
                        await flush_content()
                        await self._emit(db, run_id, seq, "tool_call", event["name"],
                                         {"arguments": event["arguments"]})
                        seq += 1
                    elif etype == "tool_result":
                        await flush_content()
                        await self._emit(db, run_id, seq, "tool_result", event["name"], {
                            "result": event["result"],
                            "duration_ms": event["duration_ms"],
                        })
                        seq += 1

                await flush_content()

            except asyncio.CancelledError:
                failed = True
                logger.warning("任务 %s 后台执行被取消", run_id)
                raise
            except Exception as e:  # noqa: BLE001
                failed = True
                logger.exception("任务 %s 后台执行异常", run_id)
                try:
                    seq_result = await db.execute(
                        select(func.max(TaskRunEvent.seq)).where(TaskRunEvent.run_id == run_id)
                    )
                    seq = (seq_result.scalar() or 0) + 1
                    await self._emit(db, run_id, seq, "error", "", {"content": str(e)})
                except Exception:  # noqa: BLE001
                    pass
            finally:
                try:
                    result_text = "".join(reply_parts)
                    if result_text.lstrip().startswith("⚠️"):
                        failed = True
                    run = await db.get(TaskRun, run_id)
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

                    seq_result = await db.execute(
                        select(func.max(TaskRunEvent.seq)).where(TaskRunEvent.run_id == run_id)
                    )
                    seq = (seq_result.scalar() or 0) + 1
                    await self._emit(db, run_id, seq, "done", "", {
                        "run_id": run_id, "status": run.status,
                        "session_id": run.session_id,
                    })
                except Exception:  # noqa: BLE001
                    logger.exception("任务 %s 收尾持久化失败", run_id)
                finally:
                    self._finish_broadcast(run_id)


task_runner = TaskRunner()


async def recover_interrupted_runs() -> None:
    """服务启动巡检: 上次进程退出时仍在 running 的任务标记为失败"""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(TaskRun).where(TaskRun.status == "running"))
        runs = result.scalars().all()
        for run in runs:
            run.status = "failed"
            seq_result = await db.execute(
                select(func.max(TaskRunEvent.seq)).where(TaskRunEvent.run_id == run.id)
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
