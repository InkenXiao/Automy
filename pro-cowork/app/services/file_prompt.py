"""任务/对话附件 → 提示词片段 共享构建器

供 routers/task_runs.py (长任务) 与 routers/agents.py (数字分身对话/调试) 共用:
- 音频: 指引 Agent 经 run_skill 调用「会议纪要生成」技能
- 图片: 指引 Agent 经 run_skill 调用「图像识别」技能 (视觉多模态模型)
- PDF : 指引 Agent 经 run_skill 调用「文档解析」技能 (PyMuPDF/mineru/paddleocr)
- 其他文本类附件: 直接内联文件内容 (截断至 MAX_FILE_CONTENT_CHARS)
"""
from pathlib import Path
from typing import Optional

# 任务附件存储目录 (与 routers/task_runs.py 一致): pro-cowork/data/task_files/<project_id>/<filename>
TASK_FILES_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "task_files"
MAX_FILE_CONTENT_CHARS = 20000  # 注入提示词的文件内容上限

AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma", ".opus"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
PDF_EXTS = {".pdf"}


def file_kind(filename: str) -> str:
    """附件类别: audio / image / pdf / text"""
    ext = Path(filename).suffix.lower()
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in IMAGE_EXTS:
        return "image"
    if ext in PDF_EXTS:
        return "pdf"
    return "text"


def safe_filename(name: str) -> str:
    """去除路径分隔符, 防目录穿越"""
    return Path(name).name


def read_task_file_text(project_id: Optional[int], filename: str) -> str:
    """读取文本类附件内容 (音频/图片/PDF 不内联, 由对应技能处理)"""
    path = TASK_FILES_ROOT / str(project_id or 0) / safe_filename(filename)
    if not path.exists():
        return ""
    if file_kind(filename) != "text":
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:MAX_FILE_CONTENT_CHARS]
    except Exception:
        return ""


def build_file_prompt_parts(
    project_id: Optional[int], file_names: list[str]
) -> list[str]:
    """将附件列表转换为提示词片段列表 (音频/图片/PDF 给技能调用指引, 文本内联内容)"""
    parts: list[str] = []
    for fname in file_names or []:
        fname = safe_filename(fname)
        kind = file_kind(fname)
        pid = project_id or 0
        if kind == "audio":
            parts.append(
                f"【录音文件 {fname}】音频附件, 请通过 run_skill 调用「会议纪要生成」技能处理 "
                f"(input_data: {{\"file_name\": \"{fname}\", \"project_id\": {pid}}}), "
                f"并将转写文字与生成的会议纪要完整展示"
            )
        elif kind == "image":
            parts.append(
                f"【图片文件 {fname}】图片附件, 请通过 run_skill 调用「图像识别」技能处理 "
                f"(input_data: {{\"file_name\": \"{fname}\", \"project_id\": {pid}}}), "
                f"并将识别出的图片内容完整展示"
            )
        elif kind == "pdf":
            parts.append(
                f"【PDF文件 {fname}】文档附件, 请通过 run_skill 调用「文档解析」技能处理 "
                f"(input_data: {{\"file_name\": \"{fname}\", \"project_id\": {pid}}}), "
                f"并将解析出的文档内容完整展示"
            )
        else:
            content = read_task_file_text(project_id, fname)
            if content:
                parts.append(f"【附件 {fname}】\n{content}")
    return parts
