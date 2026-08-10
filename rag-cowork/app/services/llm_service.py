"""LLM 调用封装 · OpenAI 兼容协议 (MAIN/SMALL/VISION 通道)"""
import base64
import logging
from typing import Optional

import httpx
from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_main_client: Optional[AsyncOpenAI] = None
_small_client: Optional[AsyncOpenAI] = None


def _get_main() -> AsyncOpenAI:
    global _main_client
    if _main_client is None:
        _main_client = AsyncOpenAI(
            base_url=settings.MAIN_API_URL, api_key=settings.MAIN_API_KEY or "none",
            timeout=httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0),
        )
    return _main_client


def _get_small() -> AsyncOpenAI:
    global _small_client
    if _small_client is None:
        _small_client = AsyncOpenAI(
            base_url=settings.small_api_url, api_key=settings.small_api_key or "none",
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0),
        )
    return _small_client


async def chat_main(prompt: str, system: str = "") -> str:
    """主推理模型对话 (实体抽取/RAG 生成), 返回文本"""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    resp = await _get_main().chat.completions.create(
        model=settings.MAIN_MODEL, messages=messages, temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()


async def chat_small(prompt: str, system: str = "") -> str:
    """轻量模型对话 (快速任务)"""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    resp = await _get_small().chat.completions.create(
        model=settings.small_model, messages=messages, temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()


async def vision_describe(image_bytes: bytes, prompt: str = "") -> str:
    """VLM 图片内容识别: 输入图片字节, 返回中文详细描述"""
    if not settings.VISION_API_URL:
        return ""
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    text_prompt = prompt or (
        "请详细描述这张图片的内容, 包括图中的文字、表格、图表数据与关键信息, "
        "用于知识库检索。直接输出描述文本, 不要多余解释。"
    )
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=180.0, write=60.0, pool=10.0)
    ) as client:
        resp = await client.post(
            settings.VISION_API_URL.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {settings.VISION_API_KEY}"},
            json={
                "model": settings.VISION_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": text_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }],
                "temperature": 0.2,
            },
        )
    if resp.status_code != 200:
        logger.warning("VLM 识别失败 HTTP %s: %s", resp.status_code, resp.text[:200])
        return ""
    data = resp.json()
    try:
        return (data["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError):
        return ""
