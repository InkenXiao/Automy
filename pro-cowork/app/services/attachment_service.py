"""附件确定性预处理 · 音频/图片/PDF 在送入主模型前先解析为文本

对话页与长任务共用:
- audio → ASR 逐片转写 (on_segment → emit asr_segment 实时输出转写文字)
- image → VLM 视觉识别 (vision_start/vision_done)
- pdf   → PyMuPDF/mineru/paddleocr 解析 (doc_parse_start/doc_parse_done)

解析文本作为附件内容直接注入提示词, 主模型基于解析结果生成内容,
不再依赖主模型"自愿"调用 run_skill (转写/纪要场景链路确定化)。
"""
import logging
from pathlib import Path
from typing import Awaitable, Callable, Optional

from app.services.file_prompt import TASK_FILES_ROOT, file_kind, safe_filename

logger = logging.getLogger(__name__)

# 过程事件回调: async def emit(etype, payload)
EventEmitter = Callable[[str, dict], Awaitable[None]]

MAX_ATTACH_CHARS = 20000  # 单附件解析文本注入提示词的上限


def find_task_file(project_id: Optional[int], file_name: str) -> Optional[Path]:
    """按 项目目录 → 全部项目目录 顺序查找附件 (意图识别切换项目后仍可命中)"""
    direct = TASK_FILES_ROOT / str(project_id or 0) / file_name
    if direct.exists():
        return direct
    if TASK_FILES_ROOT.exists():
        for d in sorted(TASK_FILES_ROOT.iterdir()):
            if d.is_dir() and d.name != "_cache":
                candidate = d / file_name
                if candidate.exists():
                    return candidate
    return None


async def _preprocess_audio(path: Path, file_name: str, emit: EventEmitter) -> str:
    """录音 → ASR 转写文本 (逐段实时回调 asr_segment)"""
    from app.services.asr_service import transcribe_audio

    await emit("asr_start", {"file": file_name})

    async def on_segment(seg: dict) -> None:
        await emit("asr_segment", seg)

    result = await transcribe_audio(path, on_segment=on_segment)
    transcript = result["text"]
    await emit("asr_done", {
        "file": file_name,
        "duration_s": result["duration_s"],
        "segments": len(result.get("segments") or []),
        "chars": len(transcript),
    })
    return (
        f"【录音转写 {file_name}】以下为录音的语音转文字全文 "
        f"(时长 {result['duration_s']}s), 请直接基于转写内容理解与生成, 无需再调用会议纪要技能:\n"
        f"{transcript[:MAX_ATTACH_CHARS]}"
    )


async def _preprocess_image(path: Path, file_name: str, emit: EventEmitter, user_name: str) -> str:
    """图片 → VLM 识别文本"""
    from app.services.vision_service import recognize_image

    await emit("vision_start", {"file": file_name})
    result = await recognize_image(path, user_name=user_name)
    await emit("vision_done", {"file": file_name, "chars": len(result["text"])})
    return (
        f"【图片识别 {file_name}】以下为图片内容识别结果, 请直接基于识别内容理解与生成, "
        f"无需再调用图像识别技能:\n{result['text'][:MAX_ATTACH_CHARS]}"
    )


async def _preprocess_pdf(path: Path, file_name: str, emit: EventEmitter) -> str:
    """PDF → 文档解析文本"""
    from app.services.doc_parse_service import parse_pdf

    await emit("doc_parse_start", {"file": file_name})
    result = await parse_pdf(path)
    await emit("doc_parse_done", {
        "file": file_name, "pages": result["pages"],
        "chars": len(result["text"]), "engine": result["engine"],
    })
    return (
        f"【文档解析 {file_name}】以下为 PDF 解析出的全文 (引擎 {result['engine']}), "
        f"请直接基于文档内容理解与生成, 无需再调用文档解析技能:\n"
        f"{result['text'][:MAX_ATTACH_CHARS]}"
    )


async def preprocess_attachments(
    project_id: Optional[int],
    file_names: list[str],
    emit: EventEmitter,
    user_name: str = "system",
) -> list[str]:
    """对音频/图片/PDF 附件逐个确定性预处理, 返回提示词片段列表

    过程事件经 emit 实时推送; 单附件失败不阻断其余附件, 失败原因作为片段注入。
    office/text 附件不在此处理 (由 file_prompt 直接内联)。
    """
    parts: list[str] = []
    for raw in file_names or []:
        fname = safe_filename(raw)
        kind = file_kind(fname)
        if kind not in ("audio", "image", "pdf"):
            continue
        path = find_task_file(project_id, fname)
        if not path:
            parts.append(f"【附件 {fname}】文件不存在, 请重新上传后再试")
            continue
        try:
            if kind == "audio":
                parts.append(await _preprocess_audio(path, fname, emit))
            elif kind == "image":
                parts.append(await _preprocess_image(path, fname, emit, user_name))
            else:
                parts.append(await _preprocess_pdf(path, fname, emit))
        except Exception as e:  # noqa: BLE001
            logger.warning("附件预处理失败 %s: %s", fname, e)
            await emit(f"{kind}_error", {"file": fname, "error": str(e)[:300]})
            parts.append(f"【附件 {fname}】预处理失败: {str(e)[:200]}")
    return parts
