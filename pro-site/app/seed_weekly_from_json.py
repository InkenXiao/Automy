"""从 JSON 文件同步周报数据到 PostgreSQL

数据来源:
    - text.txk (JSON 格式: [{title, range, body}, ...])

执行方式:
    python -m app.seed_weekly_from_json            # 仅在无同名周报时插入
    python -m app.seed_weekly_from_json --force    # 强制覆盖
    python -m app.seed_weekly_from_json --dry-run  # 仅解析不写入
"""
import asyncio
import json
import logging
import sys
from pathlib import Path

logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

from app.seed_weekly_reports import parse_weekly_body, upsert_report
from app.database import AsyncSessionLocal

PROJ_ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = PROJ_ROOT / "text.txk"


def read_json_reports() -> list[dict]:
    """读取 JSON 文件中的周报, 返回 [{title, range, body}, ...]"""
    if not JSON_PATH.exists():
        raise FileNotFoundError(f"JSON 文件不存在: {JSON_PATH}")
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    reports = []
    for i, item in enumerate(data):
        reports.append({
            "sort_order": i + 1,
            "title": item.get("title", ""),
            "range": item.get("range", ""),
            "body": item.get("body", ""),
        })
    return reports


async def seed_all(force: bool = False, dry_run: bool = False):
    print(f"📖 读取 JSON: {JSON_PATH.name}")
    raw_reports = read_json_reports()
    print(f"  共 {len(raw_reports)} 条周报")

    parsed_reports = []
    for r in raw_reports:
        parsed = parse_weekly_body(r["body"], r["title"], r["range"])
        parsed_reports.append(parsed)
        print(f"  ✓ 解析 [{r['sort_order']}] {parsed['title']} ({parsed['week_range']})")
        print(f"     KPI={len(parsed['kpis'])} 进展={len(parsed['progress_items'])} "
              f"计划={len(parsed['plan_tasks'])} 风险={len(parsed['risks'])}")
        if dry_run:
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
