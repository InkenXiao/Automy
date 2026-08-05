"""Agent 感知能力 · 对话前采集项目环境快照注入系统提示词"""
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting import Meeting
from app.models.progress_task import ProgressTask
from app.models.project import Project
from app.models.weekly_report import WeeklyReport
from app.models.work_task import WeeklyWorkTask
from app.utils import get_active_project_id


async def build_project_snapshot(db: AsyncSession) -> str:
    """构建当前项目环境快照文本 (感知能力的数据底座)

    内容: 激活项目信息 / 进度任务统计 / 逾期任务清单 / 最近会议 / 最新周报 / 本周任务统计
    """
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    pid = await get_active_project_id(db)

    lines: list[str] = [
        f"## 当前环境快照 (感知时间: {today}, 本周 {week_start} ~ {week_end})"
    ]

    # ---- 项目信息 ----
    project = await db.get(Project, pid)
    if project:
        lines.append(
            f"\n### 项目\n- {project.title} ({project.name}), 周期 {project.start_date} ~ {project.end_date}"
        )

    # ---- 进度任务统计 ----
    stat_result = await db.execute(
        select(ProgressTask.status, func.count())
        .where(ProgressTask.is_delete.is_(False), ProgressTask.project_id == pid)
        .group_by(ProgressTask.status)
    )
    stats = {status: count for status, count in stat_result.all()}
    if stats:
        stat_text = ", ".join(f"{s}: {c}" for s, c in sorted(stats.items()))
        lines.append(f"\n### 进度任务统计\n- {stat_text}")

    # ---- 逾期任务 (最多 5 条) ----
    overdue_result = await db.execute(
        select(ProgressTask)
        .where(
            ProgressTask.is_delete.is_(False),
            ProgressTask.project_id == pid,
            ProgressTask.end_date < today,
            ProgressTask.status.notin_(["done", "deleted"]),
        )
        .order_by(ProgressTask.end_date)
        .limit(5)
    )
    overdue = overdue_result.scalars().all()
    if overdue:
        lines.append("\n### 逾期任务 (需关注)")
        for t in overdue:
            lines.append(f"- [{t.task_uid}] {t.name} (应完成于 {t.end_date}, 状态 {t.status})")

    # ---- 最近会议 (最多 3 个) ----
    meeting_result = await db.execute(
        select(Meeting)
        .where(Meeting.is_delete.is_(False), Meeting.project_id == pid)
        .order_by(Meeting.meet_date.desc(), Meeting.id.desc())
        .limit(3)
    )
    meetings = meeting_result.scalars().all()
    if meetings:
        lines.append("\n### 最近会议")
        for m in meetings:
            lines.append(f"- {m.meet_date} {m.title} (主持: {m.host or '未定'})")

    # ---- 最新周报 ----
    report_result = await db.execute(
        select(WeeklyReport)
        .where(WeeklyReport.is_delete.is_(False), WeeklyReport.project_id == pid)
        .order_by(WeeklyReport.week_start.desc(), WeeklyReport.id.desc())
        .limit(1)
    )
    report = report_result.scalars().first()
    if report:
        lines.append(
            f"\n### 最新周报\n- {report.title} ({report.week_range}), 状态: {report.status}"
        )
    else:
        lines.append("\n### 最新周报\n- 暂无周报")

    # ---- 本周工作任务统计 ----
    work_stat_result = await db.execute(
        select(WeeklyWorkTask.status, func.count())
        .where(
            WeeklyWorkTask.is_delete.is_(False),
            WeeklyWorkTask.project_id == pid,
            WeeklyWorkTask.week_start == week_start,
        )
        .group_by(WeeklyWorkTask.status)
    )
    work_stats = {s: c for s, c in work_stat_result.all()}
    if work_stats:
        stat_text = ", ".join(f"{s}: {c}" for s, c in sorted(work_stats.items()))
        lines.append(f"\n### 本周工作任务 ({week_start} 起)\n- {stat_text}")
    else:
        lines.append(f"\n### 本周工作任务 ({week_start} 起)\n- 暂无任务")

    return "\n".join(lines)
