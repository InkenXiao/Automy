"""项目周工作小结服务 · 汇总周报与本周会议, 调用 LLM 提炼微信汇报版概括"""
from typing import AsyncGenerator

from openai import AsyncOpenAI

from app.config import settings

DIGEST_PROMPT = """你是一位项目经理助理, 请将以下项目周报与本周会议内容提炼为一段"微信汇报版"周工作小结。

要求:
1. 输出为一段连贯文字, 不使用 markdown、不分点、不使用表情符号, 总长控制在 200 字以内, 极度精炼
2. 结构: 先概括本周重点事项进展 (关键进展/里程碑, 有风险一句话带过), 再概括下周重点任务安排
3. 语言正式简洁, 适合直接通过微信向领导汇报
4. 忠于所给材料, 禁止编造未提及的事实

项目周报与会议内容:
{source}"""


def build_digest_source(report, meetings) -> str:
    """汇总周报(KPI/进展/下周计划/风险)与本周会议纪要, 构建 LLM 输入材料"""
    lines = [f"【项目周报】{report.title or ''} ({report.week_range or ''})"]
    if report.overview_summary:
        lines.append(f"本周总结: {report.overview_summary}")

    kpis = [k for k in (report.kpis or []) if not k.is_delete]
    if kpis:
        lines.append(
            "本周概览: "
            + "; ".join(
                f"{(k.module.title if k.module else f'模块{k.module_id}')} 进度{k.progress_pct}%({k.status})"
                for k in kpis
            )
        )

    progresses = [p for p in (report.progress_items or []) if not p.is_delete]
    if progresses:
        lines.append("本周进展:")
        for p in progresses:
            mod = p.module.title if p.module else ""
            detail = f" — {p.detail[:120]}" if p.detail else ""
            lines.append(f"- [{mod}] {p.content}{detail}")

    risks = [r for r in (report.risks or []) if not r.is_delete]
    if risks:
        lines.append(
            "风险与应对: "
            + "; ".join(f"{r.title}(紧急度:{r.urgency})" for r in risks)
        )

    plans = [t for t in (report.plan_tasks or []) if not t.is_delete]
    if plans:
        lines.append("下周计划:")
        for t in plans:
            mod = t.module.title if t.module else ""
            key = "【重点】" if t.is_key else ""
            owner = f"({t.owner})" if t.owner else ""
            lines.append(f"- {key}[{mod}] {t.name}{owner}")

    for m in meetings:
        minutes = (m.description or "").strip()
        if minutes:
            lines.append(f"【会议】{m.meet_date} {m.title}: {minutes[:600]}")
        else:
            lines.append(f"【会议】{m.meet_date} {m.title}")

    return "\n".join(lines)


async def generate_week_digest_stream(source: str, user_name: str = "system") -> AsyncGenerator[str, None]:
    """流式生成周工作小结: 逐段产出文本增量, 供执行输出窗口实时显示; 流尾记录 token 消耗"""
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("LLM 未配置: 请在 .env 中设置 OPENAI_API_KEY / OPENAI_BASE_URL")
    if not source.strip():
        raise RuntimeError("周报内容为空, 无法生成周工作小结")

    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
    )
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "user", "content": DIGEST_PROMPT.format(source=source[:20000])}
        ],
        stream=True,
        stream_options={"include_usage": True},
    )
    total_tokens = 0
    async for chunk in stream:
        if not chunk.choices:
            if chunk.usage:
                total_tokens = chunk.usage.total_tokens or 0
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
    # 流尾: 落库 token 消耗 (异常静默)
    from app.services.log_service import record_llm_usage

    await record_llm_usage(user_name, "周报概括", total_tokens, settings.OPENAI_MODEL)
