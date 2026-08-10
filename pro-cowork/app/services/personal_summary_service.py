"""个人周报概括服务 · 将本人一周工作明细提炼为 2-3 段话 (本周主要工作内容 + 下周工作计划)

与 digest_service (项目周报微信汇报版小结) 区分: 本服务面向个人周报填写页右栏,
基于当前表单明细实时生成, 非流式一次性返回, 结果可人工修改后随周报保存。
"""
from app.services import llm

SUMMARY_PROMPT = """你是一位项目管理助理, 请将以下 {member} 的个人周报明细 ({week_range}) 概括成 2-3 段话。

要求:
1. 第一段概括本周主要工作内容: 按项目/事项归纳叙述, 点出关键交付物, 不必逐日罗列
2. 第二段概括下周工作计划
3. 内容较少时可合并为一段; 使用正式周报语气, 客观精炼, 总字数 250 字以内
4. 不使用 markdown、不使用列表符号、不使用表情符号, 段落之间空一行
5. 忠于所给明细, 禁止编造未提及的事实

个人周报明细:
{source}"""

_DAYS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def build_summary_source(
    member_name: str,
    week_range: str,
    work_items: list,
    plan_items: list,
    project_names: dict[int, str],
) -> str:
    """汇总本周工作行与下周计划行, 构建 LLM 输入材料 (project_names: id→项目名)"""
    def pname(pid) -> str:
        return project_names.get(pid, "未指定项目") if pid else "未指定项目"

    lines = [f"填报人: {member_name}", f"周报周期: {week_range}"]

    works = [w for w in work_items if (w.content or "").strip()]
    if works:
        total = round(sum(w.hours or 0 for w in works), 2)
        lines.append(f"本周工作 (总工时 {total}H):")
        for w in works:
            day = _DAYS[w.day_of_week] if 1 <= (w.day_of_week or 0) <= 7 else ""
            extras = "、".join(x for x in [
                f"参与: {w.participants}" if (w.participants or "").strip() else "",
                f"交付物: {w.deliverable}" if (w.deliverable or "").strip() else "",
                f"{w.hours}H" if w.hours else "",
            ] if x)
            lines.append(f"- [{pname(w.project_id)}] {day} {w.content.strip()}" + (f" ({extras})" if extras else ""))

    plans = [p for p in plan_items if (p.content or "").strip()]
    if plans:
        lines.append("下周工作计划:")
        for p in plans:
            lines.append(f"- [{pname(p.project_id)}] {p.content.strip()}")

    return "\n".join(lines)


async def generate_personal_summary(
    member_name: str,
    week_range: str,
    work_items: list,
    plan_items: list,
    project_names: dict[int, str],
    user_name: str = "system",
) -> str:
    """一次性生成个人周报概括 (轻量快推模型); 无明细内容时抛 RuntimeError"""
    source = build_summary_source(member_name, week_range, work_items, plan_items, project_names)
    if "本周工作" not in source and "下周工作计划" not in source:
        raise RuntimeError("本周工作内容与下周计划均为空, 请先填写后再生成概括")

    client = llm.small_client()  # 概括/润色类任务: 轻量快推模型
    if not client:
        raise RuntimeError("轻量模型未配置: 请在 .env 中设置 SMALL_API_URL / SMALL_API_KEY / SMALL_MODEL")

    resp = await client.chat.completions.create(
        model=llm.small_model(),
        messages=[{"role": "user", "content": SUMMARY_PROMPT.format(
            member=member_name, week_range=week_range, source=source[:12000]
        )}],
        stream=False,
    )
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("模型返回空内容, 请重试")

    # token 消耗落库 (异常静默)
    from app.services.log_service import record_llm_usage

    usage = getattr(resp, "usage", None)
    await record_llm_usage(user_name, "个人周报概括", (usage.total_tokens if usage else 0) or 0, llm.small_model())
    return text
