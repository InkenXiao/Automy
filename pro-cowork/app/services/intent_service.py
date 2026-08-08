"""任务意图识别服务 · 根据任务描述自动选择 项目/数字分身/技能

规则:
- project_id: 与任务最相关的项目, 无法判断时用当前项目 (默认当前项目)
- agent_id: 职责描述与任务最匹配的数字分身; 无法可靠判断时返回 None → 由用户在执行窗口选择
- skill_ids: 完成任务明确需要的技能; 不确定返回 []
- LLM 不可用时的启发式: 仅 1 个分身直接用; 任务描述提到分身名称直接用; 含录音文件关联纪要技能
"""
import json
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.project import Project
from app.models.skill import Skill
from app.services import llm
from app.services.file_prompt import AUDIO_EXTS, IMAGE_EXTS, PDF_EXTS

logger = logging.getLogger(__name__)

_AUDIO_EXTS = tuple(AUDIO_EXTS)
_IMAGE_EXTS = tuple(IMAGE_EXTS)
_DOC_EXTS = tuple(PDF_EXTS)

# 附件类型 → 自动关联的技能名称关键词 (按文件名后缀匹配)
_FILE_SKILL_MAP = (
    (_AUDIO_EXTS, "会议纪要"),
    (_IMAGE_EXTS, "图像识别"),
    (_DOC_EXTS, "文档解析"),
)

INTENT_PROMPT = """你是任务分流助手。根据用户的任务描述与附件, 从给定列表中选择最合适的项目、数字分身和技能。

## 项目列表
{projects}

## 数字分身列表
{agents}

## 技能列表
{skills}

## 选择规则
1. project_id: 与任务内容最相关的项目 id; 无法判断时取 {current_project_id} (当前项目)
2. agent_id: 职责描述与任务最匹配的分身 id; 如果没有明显匹配的, 返回 null
3. skill_ids: 完成任务明确需要的技能 id 数组; 不确定返回 []
4. 任务包含录音文件且要求生成纪要/转写时, 务必包含"会议纪要生成"技能
5. 只输出一行 JSON, 不要输出其他内容:
{{"project_id": 数字, "agent_id": 数字或null, "skill_ids": [数字], "reason": "一句话选择理由"}}

## 任务描述
{input_text}

## 附件
{file_names}"""


def _extract_json(text: str) -> dict | None:
    """从模型输出中提取首个 JSON 对象"""
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def recognize_intent(
    db: AsyncSession,
    input_text: str,
    file_names: list[str],
    current_project_id: int | None,
) -> dict:
    """识别任务意图, 返回 {"project_id","agent_id","skill_ids","reason"}

    agent_id 为 None 表示识别不了, 需要用户在执行输出窗口自行选择。
    """
    projects = (
        (await db.execute(select(Project).where(Project.is_delete.is_(False))))
        .scalars().all()
    )
    agents = (
        (await db.execute(
            select(Agent).where(Agent.is_active.is_(True), Agent.is_delete.is_(False))
        ))
        .scalars().all()
    )
    skills = (
        (await db.execute(
            select(Skill).where(Skill.is_active.is_(True), Skill.is_delete.is_(False))
        ))
        .scalars().all()
    )

    project_ids = {p.id for p in projects}
    agent_map = {a.id: a for a in agents}
    skill_map = {s.id: s for s in skills}
    current_pid = current_project_id if current_project_id in project_ids else (
        next((p.id for p in projects if getattr(p, "is_active", False)), None)
        or (projects[0].id if projects else None)
    )

    result = {"project_id": current_pid, "agent_id": None, "skill_ids": [], "reason": ""}

    def _heuristic() -> bool:
        """无 LLM 时的兜底识别; 返回是否识别出分身"""
        if len(agents) == 1:
            result["agent_id"] = agents[0].id
            result["reason"] = "系统内仅有 1 个数字分身, 自动选用"
            return True
        for a in agents:
            if a.name and a.name in (input_text or ""):
                result["agent_id"] = a.id
                result["reason"] = f"任务描述中明确提到「{a.name}」"
                return True
        return False

    # 附件类型 → 自动关联对应技能 (录音→会议纪要, 图片→图像识别, PDF→文档解析)
    def _apply_file_skills():
        names = [(f or "").lower() for f in file_names or []]
        for exts, keyword in _FILE_SKILL_MAP:
            if any(n.endswith(exts) for n in names):
                for s in skills:
                    if keyword in (s.name or "") and s.id not in result["skill_ids"]:
                        result["skill_ids"].append(s.id)

    client = llm.small_client()  # 意图识别: 轻量快推模型
    if not client:
        _heuristic()
        _apply_file_skills()
        return result

    # ---- LLM 意图识别 ----
    try:
        resp = await client.chat.completions.create(
            model=llm.small_model(),
            messages=[{"role": "user", "content": INTENT_PROMPT.format(
                projects="\n".join(
                    f"- id={p.id} {p.name}{' (当前项目)' if p.id == current_pid else ''}"
                    for p in projects
                ) or "(无)",
                agents="\n".join(
                    f"- id={a.id} {a.name}: {(a.description or '')[:80]}" for a in agents
                ) or "(无)",
                skills="\n".join(
                    f"- id={s.id} {s.name}: {(s.description or '')[:80]}" for s in skills
                ) or "(无)",
                current_project_id=current_pid,
                input_text=(input_text or "").strip()[:4000] or "(空)",
                file_names=", ".join(file_names or []) or "(无)",
            )}],
            stream=False,
            timeout=30,
        )
        data = _extract_json(resp.choices[0].message.content or "")
    except Exception as e:  # noqa: BLE001
        logger.warning("意图识别 LLM 调用失败: %s", e)
        data = None

    if data is None:
        # LLM 不可用/输出无效 → 启发式
        if not _heuristic():
            result["reason"] = "未能自动识别合适的数字分身"
        _apply_file_skills()
        return result

    pid = data.get("project_id")
    if isinstance(pid, int) and pid in project_ids:
        result["project_id"] = pid
    aid = data.get("agent_id")
    if isinstance(aid, int) and aid in agent_map:
        result["agent_id"] = aid
    sids = data.get("skill_ids")
    if isinstance(sids, list):
        result["skill_ids"] = [s for s in sids if isinstance(s, int) and s in skill_map]
    result["reason"] = str(data.get("reason") or "")
    _apply_file_skills()
    return result
