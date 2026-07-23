"""周报种子数据脚本 · 从 SQLite 数据库解析周报并写入 PostgreSQL

数据来源:
    - 信投AI2.0_周报_2026-07-21.db (含 2 条周报的 HTML body)

执行方式:
    python -m app.seed_weekly_reports            # 仅在无同名周报时插入
    python -m app.seed_weekly_reports --force    # 强制覆盖 (按 week_start 删除旧数据再插入)
    python -m app.seed_weekly_reports --dry-run  # 仅解析不写入
"""
import asyncio
import logging
import os
import re
import sqlite3
import sys
from datetime import date
from pathlib import Path

# 关闭 SQLAlchemy 的 SQL echo 日志
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

from bs4 import BeautifulSoup
from sqlalchemy import delete, select, text

from app.database import AsyncSessionLocal
from app.models.module import Module
from app.models.weekly_report import (
    WeeklyKpi,
    WeeklyPlanTask,
    WeeklyProgressItem,
    WeeklyReport,
    WeeklyRisk,
)


# ---------- 路径 ----------
PROJ_ROOT = Path(__file__).resolve().parent.parent
SQLITE_DB_PATH = PROJ_ROOT / "信投AI2.0_周报_2026-07-21.db"


# ---------- 工具函数 ----------
def parse_week_range(range_str: str) -> tuple[date, date]:
    """把 '07.20 — 07.23' 解析为 (2026-07-20, 2026-07-23)"""
    if not range_str:
        return (date(2026, 7, 20), date(2026, 7, 26))
    # 匹配 "07.20 — 07.23" 或 "07.20-07.23" 等
    m = re.search(r"(\d{1,2})\.(\d{1,2})\s*[—\-~]+\s*(\d{1,2})\.(\d{1,2})", range_str)
    if not m:
        # 兜底: 找两个 MM.DD
        nums = re.findall(r"(\d{1,2})\.(\d{1,2})", range_str)
        if len(nums) >= 2:
            m1, d1 = int(nums[0][0]), int(nums[0][1])
            m2, d2 = int(nums[1][0]), int(nums[1][1])
            return (date(2026, m1, d1), date(2026, m2, d2))
        return (date(2026, 7, 20), date(2026, 7, 26))
    m1, d1, m2, d2 = (int(x) for x in m.groups())
    return (date(2026, m1, d1), date(2026, m2, d2))


def extract_module_idx(text: str) -> str:
    """从 '01 · 底座' 或 '01 算力与模型基础底座建设' 提取模块编号 '01'"""
    if not text:
        return ""
    m = re.match(r"\s*(\d{2})\b", text.strip())
    return m.group(1) if m else ""


def clean_text(s: str) -> str:
    """清理文本: 去除多余空白、&nbsp; 等"""
    if not s:
        return ""
    return re.sub(r"\s+", " ", s.replace("\u00a0", " ")).strip()


def get_selected_option(select_tag) -> str:
    """从 BeautifulSoup 的 <select> 取选中 option 的 value"""
    if not select_tag:
        return ""
    # 优先找 selected 的
    for opt in select_tag.find_all("option"):
        if opt.has_attr("selected"):
            return opt.get("value", "").strip()
    # 兜底: 第一个 option
    opt = select_tag.find("option")
    return opt.get("value", "").strip() if opt else ""


# ---------- 解析单条周报 HTML ----------
def parse_weekly_body(body_html: str, title: str, range_str: str) -> dict:
    """解析周报 body HTML, 返回结构化数据"""
    soup = BeautifulSoup(body_html, "html.parser")
    week_start, week_end = parse_week_range(range_str)

    result = {
        "title": title.strip(),
        "week_range": range_str.strip(),
        "week_start": week_start,
        "week_end": week_end,
        "overview_summary": "",
        "kpis": [],
        "progress_items": [],
        "plan_tasks": [],
        "risks": [],
    }

    # === KPI (本周概览) ===
    overview_sec = soup.find("div", {"data-node": "overview"})
    if overview_sec:
        for kpi in overview_sec.select(".kpi"):
            n_text = kpi.select_one(".n")
            t_text = kpi.select_one(".t")
            pct_input = kpi.select_one("input.pct")
            st_select = kpi.select_one("select.st")
            idx = extract_module_idx(n_text.get_text() if n_text else "")
            pct = int(pct_input.get("value", "0")) if pct_input else 0
            status = get_selected_option(st_select) or "正常"
            result["kpis"].append({
                "module_idx": idx,
                "progress_pct": pct,
                "status": status,
                "module_title": clean_text(t_text.get_text()) if t_text else "",
            })

    # === 进展项 (本周进展) ===
    progress_sec = soup.find("div", {"data-node": "progress"})
    if progress_sec:
        for row in progress_sec.select(".row"):
            idx_div = row.select_one(".idx")
            ow_input = row.select_one(".ow input")
            pp_span = row.select_one(".pp span[data-pct]") or row.select_one(".pp span")
            st_select = row.select_one("select.st")
            idx = extract_module_idx(idx_div.get_text() if idx_div else "")
            owner = ow_input.get("value", "").strip() if ow_input else ""
            pct_text = pp_span.get_text() if pp_span else "0"
            m = re.search(r"\d+", pct_text)
            pct = int(m.group()) if m else 0
            status = get_selected_option(st_select) or "正常"

            # 解析事项列表 (每个 li 一条进展项)
            for li in row.select(".rb ul li"):
                # 移除 .del-item 按钮
                for del_btn in li.select(".del-item"):
                    del_btn.decompose()
                # 提取 <b> 标题 (优先) 或 <span style="font-weight: 600;">
                b_tag = li.find("b")
                if not b_tag:
                    span_bold = li.find("span", style=re.compile(r"font-weight:\s*600"))
                    b_tag = span_bold
                content = clean_text(b_tag.get_text()) if b_tag else clean_text(li.get_text())
                # 详情 = li 全文去掉标题后的剩余
                if b_tag:
                    b_tag_text = b_tag.get_text()
                    full_text = clean_text(li.get_text())
                    # 去掉标题部分
                    detail = full_text
                    if detail.startswith(clean_text(b_tag_text)):
                        detail = detail[len(clean_text(b_tag_text)):].strip()
                else:
                    detail = ""
                # 去掉前导分隔符
                detail = re.sub(r"^[\s、,，。·\-—]+", "", detail).strip()
                if content or detail:
                    result["progress_items"].append({
                        "module_idx": idx,
                        "content": content,
                        "detail": detail,
                        "owner": owner,
                        "progress_pct": pct,
                        "status": status,
                    })

    # === 计划任务 (下周计划) ===
    plan_sec = soup.find("div", {"data-node": "plan"})
    if plan_sec:
        for nc in plan_sec.select(".nc"):
            # 模块编号: 从 h4 > .nc-title 提取
            title_tag = nc.select_one(".nc-title")
            nc_title_text = title_tag.get_text() if title_tag else ""
            idx = extract_module_idx(nc_title_text)
            # is_key: .tag-toggle 是否有 on 类
            tag_toggle = nc.select_one(".tag-toggle")
            is_key = bool(tag_toggle and "on" in (tag_toggle.get("class") or []))
            # 事项列表
            for li in nc.select("ul li"):
                for del_btn in li.select(".del-item"):
                    del_btn.decompose()
                name = clean_text(li.get_text())
                # 过滤掉空内容或 "事项" 占位符
                if name and name != "事项":
                    result["plan_tasks"].append({
                        "module_idx": idx,
                        "name": name,
                        "is_key": is_key,
                        "owner": "",
                    })

    # === 风险 (风险与应对) ===
    risk_sec = soup.find("div", {"data-node": "risk"})
    if risk_sec:
        for rk in risk_sec.select(".rk"):
            lv = rk.select_one(".lv")
            rk_title = rk.select_one(".rk-title")
            rk_content = rk.select_one(".rk-content")
            urgency_select = rk.select_one("select.urgency")
            seq = clean_text(lv.get_text()) if lv else "R1"
            title_r = clean_text(rk_title.get_text()) if rk_title else ""
            coord = clean_text(rk_content.get_text()) if rk_content else ""
            urgency = get_selected_option(urgency_select) or "中"
            if title_r or coord:
                result["risks"].append({
                    "seq": seq,
                    "title": title_r,
                    "coordination": coord,
                    "urgency": urgency,
                })

    return result


# ---------- 读取 SQLite ----------
def read_sqlite_reports() -> list[dict]:
    """读取 SQLite 中的周报, 返回 [{title, range, body}, ...]"""
    if not SQLITE_DB_PATH.exists():
        raise FileNotFoundError(f"SQLite 数据库不存在: {SQLITE_DB_PATH}")

    conn = sqlite3.connect(str(SQLITE_DB_PATH))
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT sort_order, title, range, body, created_at FROM weeks ORDER BY sort_order"
    )
    rows = cursor.fetchall()
    conn.close()

    reports = []
    for r in rows:
        reports.append({
            "sort_order": r["sort_order"],
            "title": r["title"] or "",
            "range": r["range"] or "",
            "body": r["body"] or "",
            "created_at": r["created_at"] or "",
        })
    return reports


# ---------- 写入 PostgreSQL ----------
async def upsert_report(db, parsed: dict, force: bool) -> tuple[int, int, int, int]:
    """upsert 一条周报, 返回 (report_id, kpis, progress_items, plan_tasks, risks)"""
    # 查模块映射 idx -> id
    result = await db.execute(select(Module))
    modules = result.scalars().all()
    idx_to_id = {m.idx: m.id for m in modules}

    if force:
        # 按 week_start 查出已存在的周报 id 列表
        existing = await db.execute(
            select(WeeklyReport.id).where(WeeklyReport.week_start == parsed["week_start"])
        )
        existing_ids = [row[0] for row in existing]
        if existing_ids:
            # 手动删除所有关联数据 (Core DELETE 不触发 ORM cascade)
            await db.execute(
                delete(WeeklyPlanTask).where(WeeklyPlanTask.report_id.in_(existing_ids))
            )
            await db.execute(
                delete(WeeklyKpi).where(WeeklyKpi.report_id.in_(existing_ids))
            )
            await db.execute(
                delete(WeeklyProgressItem).where(WeeklyProgressItem.report_id.in_(existing_ids))
            )
            await db.execute(
                delete(WeeklyRisk).where(WeeklyRisk.report_id.in_(existing_ids))
            )
            # 再删除周报主记录
            await db.execute(
                delete(WeeklyReport).where(WeeklyReport.id.in_(existing_ids))
            )
            await db.flush()  # 确保删除生效

    # 创建周报主记录
    report = WeeklyReport(
        title=parsed["title"],
        week_range=parsed["week_range"],
        week_start=parsed["week_start"],
        week_end=parsed["week_end"],
        overview_summary=parsed["overview_summary"],
        status="submitted",
    )
    db.add(report)
    await db.flush()  # 获取 report.id
    report_id = report.id

    # 写入 KPI
    n_kpis = 0
    for k in parsed["kpis"]:
        module_id = idx_to_id.get(k["module_idx"])
        if not module_id:
            print(f"  ⚠️  KPI 模块编号 {k['module_idx']} 未找到, 跳过")
            continue
        db.add(WeeklyKpi(
            report_id=report_id,
            module_id=module_id,
            progress_pct=k["progress_pct"],
            status=k["status"],
        ))
        n_kpis += 1

    # 写入进展项
    n_progress = 0
    for i, p in enumerate(parsed["progress_items"]):
        module_id = idx_to_id.get(p["module_idx"])
        if not module_id:
            print(f"  ⚠️  进展项模块编号 {p['module_idx']} 未找到, 跳过")
            continue
        db.add(WeeklyProgressItem(
            report_id=report_id,
            module_id=module_id,
            content=p["content"][:500],
            detail=p["detail"],
            sort_order=i,
        ))
        n_progress += 1

    # 写入下周计划任务
    n_plan = 0
    for i, t in enumerate(parsed["plan_tasks"]):
        module_id = idx_to_id.get(t["module_idx"])
        if not module_id:
            print(f"  ⚠️  计划任务模块编号 {t['module_idx']} 未找到, 跳过")
            continue
        db.add(WeeklyPlanTask(
            report_id=report_id,
            module_id=module_id,
            name=t["name"][:500],
            is_key=t["is_key"],
            owner=t.get("owner", ""),
            plan_period=parsed["week_range"],
            status="待开始",
            sort_order=i,
        ))
        n_plan += 1

    # 写入风险
    n_risks = 0
    for i, r in enumerate(parsed["risks"]):
        db.add(WeeklyRisk(
            report_id=report_id,
            seq=r["seq"],
            title=r["title"][:250],
            coordination=r["coordination"],
            urgency=r["urgency"],
            sort_order=i,
        ))
        n_risks += 1

    return (report_id, n_kpis, n_progress, n_plan, n_risks)


# ---------- 主流程 ----------
async def seed_all(force: bool = False, dry_run: bool = False):
    if not SQLITE_DB_PATH.exists():
        print(f"❌ SQLite 数据库不存在: {SQLITE_DB_PATH}")
        sys.exit(1)

    print(f"📖 读取 SQLite: {SQLITE_DB_PATH.name}")
    raw_reports = read_sqlite_reports()
    print(f"  共 {len(raw_reports)} 条周报")

    # 解析每条周报
    parsed_reports = []
    for r in raw_reports:
        parsed = parse_weekly_body(r["body"], r["title"], r["range"])
        parsed_reports.append(parsed)
        print(f"  ✓ 解析 [{r['sort_order']}] {parsed['title']} ({parsed['week_range']})")
        print(f"     KPI={len(parsed['kpis'])} 进展={len(parsed['progress_items'])} "
              f"计划={len(parsed['plan_tasks'])} 风险={len(parsed['risks'])}")
        if dry_run:
            # 详细打印
            for k in parsed["kpis"]:
                print(f"     KPI {k['module_idx']} {k['module_title'][:20]}: {k['progress_pct']}% {k['status']}")
            for p in parsed["progress_items"][:3]:
                print(f"     进展 {p['module_idx']}: [{p['content'][:30]}] 详情={p['detail'][:50]}")
            for t in parsed["plan_tasks"][:3]:
                print(f"     计划 {t['module_idx']} key={t['is_key']}: {t['name'][:50]}")
            for r in parsed["risks"]:
                print(f"     风险 {r['seq']} [{r['urgency']}]: {r['title']} - {r['coordination'][:50]}")

    if dry_run:
        print("\n[DRY-RUN] 未写入数据库")
        return

    # 写入 PostgreSQL
    print(f"\n💾 写入 PostgreSQL (mode={'强制覆盖' if force else '幂等插入'})")
    async with AsyncSessionLocal() as db:
        try:
            total = {"kpis": 0, "progress": 0, "plan": 0, "risks": 0}
            for parsed in parsed_reports:
                report_id, n_kpis, n_prog, n_plan, n_risks = await upsert_report(db, parsed, force)
                total["kpis"] += n_kpis
                total["progress"] += n_prog
                total["plan"] += n_plan
                total["risks"] += n_risks
                print(f"  ✓ 写入 #{report_id} {parsed['title']} "
                      f"(KPI={n_kpis} 进展={n_prog} 计划={n_plan} 风险={n_risks})")
            await db.commit()
            print(f"\n✅ 完成: 共 {len(parsed_reports)} 条周报, "
                  f"KPI {total['kpis']} 条, 进展 {total['progress']} 条, "
                  f"计划 {total['plan']} 条, 风险 {total['risks']} 条")
        except Exception as e:
            await db.rollback()
            print(f"❌ 写入失败: {e}")
            raise


if __name__ == "__main__":
    force_mode = "--force" in sys.argv
    dry_run_mode = "--dry-run" in sys.argv
    asyncio.run(seed_all(force=force_mode, dry_run=dry_run_mode))
