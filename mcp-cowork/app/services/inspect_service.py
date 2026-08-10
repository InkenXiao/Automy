"""工具自动巡检服务 · 健康检查 + 工具快照 diff + 测试用例回归门禁

巡检流程 (对用户全部 MCP 服务):
1. 健康检查: list_tools 探测在线状态
2. 在线则 diff 新工具清单与本地快照 (新增/下线/Schema变更), 并更新快照保持最新
3. 回归门禁: 回放该用户保存的全部测试用例, 与用例历史状态对比,
   原先成功本次失败 → 标记 regression (回归失败)
4. 汇总 verdict: fail=有回归失败或服务离线; warn=有工具变更但回归全过; pass=无变更全通过

数字分身的历史功能不受快照更新影响 (分身走 pro-cowork 原生 handler),
回归失败仅在报告与前端标红告警, 由人工处置。
"""
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import (
    McpCallLog, McpInspectReport, McpServer, McpTestCase, McpTool, SysUser,
)
from app.services import mcp_client
from app.services.snowflake import generate_id
from app.routers.servers import _extract_name_zh

logger = logging.getLogger(__name__)


def _schema_sig(schema: dict) -> str:
    """input_schema 规范化签名 (排序后 JSON, 供变更对比)"""
    try:
        return json.dumps(schema or {}, sort_keys=True, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return str(schema)


async def _sync_snapshot(db: AsyncSession, server: McpServer, user: SysUser,
                         live_tools: List[dict]) -> Dict[str, List[str]]:
    """diff 实时工具清单与本地快照并重建快照, 返回变更明细"""
    old_tools = list((await db.execute(
        select(McpTool).where(
            McpTool.is_delete.is_(False), McpTool.server_id == server.server_id
        )
    )).scalars().all())
    old_by_name = {t.tool_name: t for t in old_tools}
    live_by_name = {t["tool_name"]: t for t in live_tools}

    added = sorted(set(live_by_name) - set(old_by_name))
    removed = sorted(set(old_by_name) - set(live_by_name))
    changed = sorted(
        name for name in set(old_by_name) & set(live_by_name)
        if _schema_sig(old_by_name[name].input_schema) != _schema_sig(live_by_name[name]["input_schema"])
    )

    # 重建快照 (与 servers.sync_tools 同逻辑)
    for t in old_tools:
        t.is_delete = True
    now = datetime.now(timezone.utc)
    for t in live_tools:
        db.add(McpTool(
            tool_id=generate_id(), server_id=server.server_id,
            tool_name=t["tool_name"], name_zh=_extract_name_zh(t.get("description", "")),
            description=t.get("description", ""),
            input_schema=t.get("input_schema") or {}, synced_at=now, user_id=user.user_id,
        ))
    return {"added": added, "removed": removed, "changed": changed}


async def _run_case(db: AsyncSession, user: SysUser, server: McpServer,
                    case: McpTestCase) -> Dict[str, Any]:
    """回放单个用例并写调用日志, 返回本次结果 (与 testing._do_call 同语义)"""
    started = time.time()
    try:
        result = await mcp_client.call_tool(server.base_url, case.tool_name, case.params or {}, user.name)
        status = "error" if result["is_error"] else "success"
        excerpt = (result["text"] or "")[:1000]
    except Exception as e:  # noqa: BLE001
        err_text = mcp_client.flatten_exc(e, 1000)
        result = {"text": err_text}
        status = "error"
        excerpt = err_text
    latency = int((time.time() - started) * 1000)
    db.add(McpCallLog(
        log_id=generate_id(), server_id=server.server_id, tool_name=case.tool_name,
        params=case.params or {}, result_excerpt=excerpt, latency_ms=latency,
        status=status, user_id=user.user_id,
    ))
    return {"status": status, "latency_ms": latency, "excerpt": excerpt[:200]}


async def run_for_user(db: AsyncSession, user: SysUser, trigger: str = "manual") -> McpInspectReport:
    """对单个用户执行完整巡检, 落库报告并返回"""
    servers = list((await db.execute(
        select(McpServer).where(
            McpServer.is_delete.is_(False), McpServer.user_id == user.user_id
        ).order_by(McpServer.server_id)
    )).scalars().all())

    server_reports: List[Dict[str, Any]] = []
    online_ids: List[int] = []
    for srv in servers:
        rep: Dict[str, Any] = {
            "server_id": srv.server_id, "name": srv.name,
            "status": "offline", "error": "",
            "tools_added": [], "tools_removed": [], "tools_changed": [],
        }
        try:
            live = await mcp_client.list_tools(srv.base_url, user.name)
            srv.status = "online"
            rep["status"] = "online"
            rep.update(await _sync_snapshot(db, srv, user, live))
            online_ids.append(srv.server_id)
        except Exception as e:  # noqa: BLE001
            srv.status = "offline"
            rep["error"] = mcp_client.flatten_exc(e, 200)
        server_reports.append(rep)

    # 回归门禁: 回放全部用例 (仅在线服务)
    cases = list((await db.execute(
        select(McpTestCase).where(
            McpTestCase.is_delete.is_(False), McpTestCase.user_id == user.user_id
        ).order_by(McpTestCase.case_id)
    )).scalars().all())
    srv_map = {s.server_id: s for s in servers}
    case_reports: List[Dict[str, Any]] = []
    for case in cases:
        srv = srv_map.get(case.server_id)
        prev = case.last_status or ""
        if not srv or srv.server_id not in online_ids:
            case_reports.append({
                "case_id": case.case_id, "case_name": case.case_name,
                "tool_name": case.tool_name, "server": srv.name if srv else "?",
                "status": "skipped", "previous": prev, "regression": False,
                "latency_ms": 0, "error_excerpt": "服务离线, 跳过",
            })
            continue
        cur = await _run_case(db, user, srv, case)
        regression = prev == "success" and cur["status"] == "error"
        case.last_status = cur["status"]
        case.last_result = {"text": cur["excerpt"], "latency_ms": cur["latency_ms"]}
        case_reports.append({
            "case_id": case.case_id, "case_name": case.case_name,
            "tool_name": case.tool_name, "server": srv.name,
            "status": cur["status"], "previous": prev, "regression": regression,
            "latency_ms": cur["latency_ms"],
            "error_excerpt": cur["excerpt"] if cur["status"] == "error" else "",
        })

    summary = {
        "servers_total": len(servers),
        "servers_online": sum(1 for r in server_reports if r["status"] == "online"),
        "servers_offline": sum(1 for r in server_reports if r["status"] == "offline"),
        "tools_added": sum(len(r["tools_added"]) for r in server_reports),
        "tools_removed": sum(len(r["tools_removed"]) for r in server_reports),
        "tools_changed": sum(len(r["tools_changed"]) for r in server_reports),
        "cases_total": len(case_reports),
        "cases_passed": sum(1 for c in case_reports if c["status"] == "success"),
        "cases_failed": sum(1 for c in case_reports if c["status"] == "error"),
        "cases_skipped": sum(1 for c in case_reports if c["status"] == "skipped"),
        "regressions": sum(1 for c in case_reports if c["regression"]),
    }
    if summary["regressions"] > 0 or summary["servers_offline"] > 0:
        verdict = "fail"
    elif summary["tools_added"] or summary["tools_removed"] or summary["tools_changed"] or summary["cases_failed"]:
        verdict = "warn"
    else:
        verdict = "pass"

    report = McpInspectReport(
        report_id=generate_id(), user_id=user.user_id, trigger_type=trigger,
        verdict=verdict, summary=summary,
        detail={"servers": server_reports, "cases": case_reports},
    )
    db.add(report)
    await db.commit()
    return report


async def run_all_users(trigger: str = "scheduled") -> None:
    """定时巡检入口: 遍历全部启用用户, 各自独立会话执行 (单用户失败不影响其他)"""
    async with AsyncSessionLocal() as session:
        users = list((await session.execute(
            select(SysUser).where(SysUser.is_delete.is_(False), SysUser.is_active.is_(True))
        )).scalars().all())
    for user in users:
        try:
            async with AsyncSessionLocal() as session:
                report = await run_for_user(session, user, trigger)
                logger.info(
                    "巡检完成 user=%s verdict=%s regressions=%s",
                    user.name, report.verdict, (report.summary or {}).get("regressions"),
                )
        except Exception:  # noqa: BLE001
            logger.exception("巡检失败 user=%s", user.name)
