"""ASR 语音识别服务 · 录音文件切片转文字

参照 demo/transcribe.py 的伪流式(HTTP 切片)方案:
- pydub + ffmpeg 加载任意音频格式, 按 ASR_CHUNK_MS 切片导出 wav
- 逐片 POST OpenAI 兼容转录接口 (paraformer-large, verbose_json 带 segments)
- 合并各片 segments 并按全局时间偏移生成 [mm:ss] 时间戳文本
"""
import asyncio
import math
import os
import tempfile
from pathlib import Path

import httpx

from app.config import settings

MAX_CHUNK_RETRIES = 2  # 单片段最大尝试次数 (首次 + 重试 1 次)


def _fmt_ts(seconds: float) -> str:
    """秒 → [mm:ss] 或 [hh:mm:ss]"""
    total = int(seconds)
    m, s = divmod(total, 60)
    h, m = divmod(m, 60)
    return f"[{h:02d}:{m:02d}:{s:02d}]" if h > 0 else f"[{m:02d}:{s:02d}]"


async def _post_chunk(client: httpx.AsyncClient, wav_path: str, chunk_no: int) -> dict:
    """上传单个音频切片到 ASR 接口, 失败重试 1 次"""
    last_err: Exception | None = None
    for attempt in range(MAX_CHUNK_RETRIES):
        try:
            with open(wav_path, "rb") as f:
                resp = await client.post(
                    settings.ASR_API_URL,
                    headers={"Authorization": f"Bearer {settings.ASR_API_KEY}"},
                    files={"file": f},
                    data={"model": settings.ASR_MODEL, "response_format": "verbose_json"},
                    timeout=httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0),
                )
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            return resp.json()
        except Exception as e:  # noqa: BLE001 - 重试后统一抛错
            last_err = e
            if attempt + 1 < MAX_CHUNK_RETRIES:
                await asyncio.sleep(1)
    raise RuntimeError(f"片段 {chunk_no} 转录失败: {last_err}")


async def transcribe_audio(file_path: str | Path) -> dict:
    """将录音文件转录为带时间戳的文字

    返回 {"text": 带时间戳全文, "segments": [{start, text}], "duration_s": 音频时长}
    失败抛出 RuntimeError (含原因)。
    """
    path = Path(file_path)
    if not path.exists():
        raise RuntimeError(f"音频文件不存在: {path.name}")
    if not settings.ASR_API_URL:
        raise RuntimeError("ASR 未配置: 请在 .env 中设置 ASR_API_URL / ASR_API_KEY")

    try:
        from pydub import AudioSegment
    except ImportError as e:
        raise RuntimeError("缺少 pydub 依赖, 请安装 pydub 并确认容器内有 ffmpeg") from e

    loop = asyncio.get_running_loop()
    try:
        audio = await loop.run_in_executor(None, AudioSegment.from_file, str(path))
    except Exception as e:
        raise RuntimeError(f"音频加载失败 (需 ffmpeg 支持该格式): {e}") from e

    total_ms = len(audio)
    chunk_ms = max(int(settings.ASR_CHUNK_MS), 10000)
    total_chunks = max(1, math.ceil(total_ms / chunk_ms))

    segments: list[dict] = []
    async with httpx.AsyncClient() as client:
        for i in range(total_chunks):
            start_ms = i * chunk_ms
            end_ms = min((i + 1) * chunk_ms, total_ms)
            chunk = audio[start_ms:end_ms]

            tmp = tempfile.NamedTemporaryFile(
                prefix=f"asr_chunk_{i}_", suffix=".wav", delete=False
            )
            tmp_path = tmp.name
            tmp.close()
            try:
                await loop.run_in_executor(
                    None, lambda c=chunk, p=tmp_path: c.export(p, format="wav")
                )
                data = await _post_chunk(client, tmp_path, i + 1)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

            chunk_segments = data.get("segments") or []
            if chunk_segments:
                for seg in chunk_segments:
                    text = (seg.get("text") or "").strip()
                    if text:
                        segments.append(
                            {
                                "start": (seg.get("start") or 0) + start_ms / 1000,
                                "text": text,
                            }
                        )
            else:
                text = (data.get("text") or "").strip()
                if text:
                    segments.append({"start": start_ms / 1000, "text": text})

    lines = [f"{_fmt_ts(s['start'])} {s['text']}" for s in segments]
    return {
        "text": "\n".join(lines),
        "segments": segments,
        "duration_s": round(total_ms / 1000, 1),
        "chunks": total_chunks,
    }
