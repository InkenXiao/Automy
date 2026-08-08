"""图像识别服务 · 调用视觉多模态模型 (VISION_*) 解析图片内容

- 图片 base64 编码后以 OpenAI 兼容多模态消息 (image_url data URL) 发送
- 未配置视觉模型时抛出 RuntimeError (由调用方降级处理)
"""
import base64
import mimetypes
from pathlib import Path

from app.services import llm

DEFAULT_QUESTION = "请详细描述这张图片的内容。若图片包含文字/表格/图表, 请完整转录关键信息; 若为界面截图, 请说明页面结构与关键数据。"


async def recognize_image(
    file_path: str | Path, question: str = "", user_name: str = "system"
) -> dict:
    """识别图片内容, 返回 {"text": 识别结果, "model": 模型名}

    失败抛出 RuntimeError (含原因)。
    """
    path = Path(file_path)
    if not path.exists():
        raise RuntimeError(f"图片文件不存在: {path.name}")
    client = llm.vision_client()
    if not client:
        raise RuntimeError("视觉模型未配置: 请在 .env 中设置 VISION_API_URL / VISION_API_KEY / VISION_MODEL")

    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")

    resp = await client.chat.completions.create(
        model=llm.vision_model(),
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": (question or "").strip() or DEFAULT_QUESTION},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ],
        }],
        stream=False,
        timeout=120,
    )
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("视觉模型未返回识别内容")

    total_tokens = resp.usage.total_tokens if resp.usage else 0
    if total_tokens:
        from app.services.log_service import record_llm_usage

        await record_llm_usage(user_name, "图像识别", total_tokens, llm.vision_model())
    return {"text": text, "model": llm.vision_model()}
