"""会议纪要生成服务 · 基于转录文字调用 LLM 生成结构化纪要"""
from typing import AsyncGenerator

from openai import AsyncOpenAI

from app.config import settings

MINUTES_PROMPT = """你是一位高级项目经理, 请根据以下会议录音转写文字整理会议纪要。

要求:
1. 输出结构固定为:
   【会议主题】(根据内容概括; 如可辨识时间/参会人也一并列出)
   一、会议结论 (逐条列出达成的共识与决策)
   二、行动项 (逐条列出: 事项 - 负责人 - 截止时间; 未明确的标注"待定")
   三、风险与遗留问题 (逐条列出; 无则写"无")
2. 内容忠于转写原文, 禁止编造未提及的事实; 转写可能存在的同音错别字请按上下文修正
3. 语言简洁专业, 中文输出

会议录音转写文字:
{transcript}"""


async def generate_minutes(transcript: str) -> str:
    """根据转录文字生成会议纪要; LLM 未配置时抛出 RuntimeError"""
    parts: list[str] = []
    async for delta in generate_minutes_stream(transcript):
        parts.append(delta)
    return "".join(parts).strip()


async def generate_minutes_stream(transcript: str) -> AsyncGenerator[str, None]:
    """流式生成会议纪要: 逐段产出文本增量, 供执行输出窗口实时显示"""
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("LLM 未配置: 请在 .env 中设置 OPENAI_API_KEY / OPENAI_BASE_URL")
    if not transcript.strip():
        raise RuntimeError("转录文字为空, 无法生成会议纪要")

    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
    )
    stream = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[
            {"role": "user", "content": MINUTES_PROMPT.format(transcript=transcript[:30000])}
        ],
        stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
