"""预置技能定义 (启动时幂等播种)

技能 code 为 JSON 工作流, 由 SkillEngine 按 steps 顺序执行工具链,
参数支持 {{input.xxx}} / {{results.N.result.xxx}} 变量引用。
"""
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skill import Skill

PRESET_SKILLS = [
    {
        "name": "延期任务扫描",
        "description": "扫描当前项目全部进度任务, 结合当前日期输出任务清单, 供智能体识别逾期风险",
        "category": "data",
        "trigger_type": "manual",
        "config": {"icon": "⏰", "color": "#EF4444"},
        "code": json.dumps({
            "steps": [
                {"tool": "get_today", "arguments": {}},
                {"tool": "get_progress_tasks", "arguments": {}},
            ]
        }, ensure_ascii=False),
    },
    {
        "name": "周报草稿生成",
        "description": "获取当前周次、历史周报与模块列表, 辅助生成周报草稿",
        "category": "workflow",
        "trigger_type": "manual",
        "config": {"icon": "📝", "color": "#10B981"},
        "code": json.dumps({
            "steps": [
                {"tool": "get_today", "arguments": {}},
                {"tool": "get_weekly_reports", "arguments": {}},
                {"tool": "get_modules", "arguments": {}},
            ]
        }, ensure_ascii=False),
    },
    {
        "name": "会议议程准备",
        "description": "拉取项目信息与最近会议记录, 为筹备新会议提供上下文",
        "category": "data",
        "trigger_type": "manual",
        "config": {"icon": "📋", "color": "#8B5CF6"},
        "code": json.dumps({
            "steps": [
                {"tool": "get_project_info", "arguments": {}},
                {"tool": "get_meetings", "arguments": {}},
            ]
        }, ensure_ascii=False),
    },
    {
        "name": "周计划生成",
        "description": "汇总当前周次、本周工作任务与最近周报, 辅助制定周工作计划",
        "category": "workflow",
        "trigger_type": "manual",
        "config": {"icon": "📅", "color": "#F59E0B"},
        "code": json.dumps({
            "steps": [
                {"tool": "get_today", "arguments": {}},
                {"tool": "get_work_tasks", "arguments": {}},
                {"tool": "get_weekly_reports", "arguments": {}},
            ]
        }, ensure_ascii=False),
    },
]


async def seed_preset_skills(db: AsyncSession):
    """初始化预置 Skill（幂等: 已存在则同步描述/分类/配置/工作流）"""
    for preset in PRESET_SKILLS:
        result = await db.execute(select(Skill).where(Skill.name == preset["name"]))
        existing = result.scalars().first()
        if existing:
            existing.description = preset["description"]
            existing.category = preset["category"]
            existing.trigger_type = preset["trigger_type"]
            existing.config = preset["config"]
            existing.code = preset["code"]
            continue
        db.add(Skill(**preset))
    await db.flush()
