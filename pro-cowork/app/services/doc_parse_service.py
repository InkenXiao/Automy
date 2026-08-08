"""PDF 文档解析服务 · 文本层抽取 (PyMuPDF) → mineru → paddleocr 逐级降级

解析策略:
1. PyMuPDF (fitz) 直接抽取文本层: 对电子版 PDF 快速准确, 无额外模型依赖
2. 文本层为空 (扫描件): 依次尝试 mineru (magic_pdf) / paddleocr 本地推理 (惰性导入,
   未安装时跳过), 均不可用时抛出含安装指引的 RuntimeError

返回 {"text": 全文, "pages": 页数, "engine": 实际使用的解析引擎}
"""
import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# 文本层判定阈值: 全文 extracted 字符数低于该值视为扫描件, 转 OCR 流程
MIN_TEXT_CHARS = 50


def _parse_with_pymupdf(path: Path) -> tuple[str, int]:
    """PyMuPDF 抽取文本层, 返回 (全文, 页数)"""
    import fitz  # PyMuPDF

    parts: list[str] = []
    with fitz.open(str(path)) as doc:
        pages = doc.page_count
        for i, page in enumerate(doc, start=1):
            text = (page.get_text("text") or "").strip()
            if text:
                parts.append(f"----- 第 {i} 页 -----\n{text}")
    return "\n\n".join(parts), pages


def _parse_with_mineru(path: Path) -> str:
    """mineru (magic_pdf) 解析扫描件 PDF, 返回 markdown 文本; 未安装抛 ImportError"""
    import tempfile

    from magic_pdf.data.data_reader_writer import FileBasedDataReader, FileBasedDataWriter
    from magic_pdf.data.dataset import PymuDocDataset
    from magic_pdf.model.doc_analyze_by_custom_model import doc_analyze

    reader = FileBasedDataReader("")
    pdf_bytes = reader.read(str(path))
    ds = PymuDocDataset(pdf_bytes)
    infer = ds.apply(doc_analyze, ocr=True)
    with tempfile.TemporaryDirectory(prefix="mineru_") as tmp:
        writer = FileBasedDataWriter(tmp)
        pipe = infer.pipe_ocr_mode(writer)
        md = pipe.get_markdown("content")
    return (md or "").strip()


def _parse_with_paddleocr(path: Path) -> str:
    """paddleocr 对逐页渲染图做 OCR; 未安装抛 ImportError"""
    import fitz  # 渲染页面为图片
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    parts: list[str] = []
    with fitz.open(str(path)) as doc:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(dpi=200)
            img_bytes = pix.tobytes("png")
            result = ocr.ocr(img_bytes, cls=True)
            lines: list[str] = []
            for block in result or []:
                for item in block or []:
                    # item: [bbox, (text, score)]
                    if item and len(item) >= 2 and item[1]:
                        lines.append(str(item[1][0]))
            if lines:
                parts.append(f"----- 第 {i} 页 -----\n" + "\n".join(lines))
    return "\n\n".join(parts)


async def parse_pdf(file_path: str | Path) -> dict:
    """解析 PDF 为文本, 返回 {"text", "pages", "engine"}; 失败抛出 RuntimeError"""
    path = Path(file_path)
    if not path.exists():
        raise RuntimeError(f"PDF 文件不存在: {path.name}")

    loop = asyncio.get_running_loop()

    # ---- 第 1 级: PyMuPDF 文本层 ----
    try:
        text, pages = await loop.run_in_executor(None, _parse_with_pymupdf, path)
    except ImportError as e:
        raise RuntimeError("缺少 PyMuPDF 依赖: pip install PyMuPDF") from e
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"PDF 打开失败: {e}") from e

    if len(text) >= MIN_TEXT_CHARS:
        return {"text": text, "pages": pages, "engine": "pymupdf"}

    # ---- 第 2 级: mineru (扫描件) ----
    try:
        md = await loop.run_in_executor(None, _parse_with_mineru, path)
        if md:
            return {"text": md, "pages": pages, "engine": "mineru"}
    except ImportError:
        logger.info("mineru 未安装, 跳过 (pip install magic-pdf[full])")
    except Exception as e:  # noqa: BLE001
        logger.warning("mineru 解析失败: %s", e)

    # ---- 第 3 级: paddleocr (扫描件) ----
    try:
        ocr_text = await loop.run_in_executor(None, _parse_with_paddleocr, path)
        if ocr_text:
            return {"text": ocr_text, "pages": pages, "engine": "paddleocr"}
    except ImportError:
        logger.info("paddleocr 未安装, 跳过 (pip install paddlepaddle paddleocr)")
    except Exception as e:  # noqa: BLE001
        logger.warning("paddleocr 解析失败: %s", e)

    raise RuntimeError(
        "该 PDF 无文本层 (扫描件), 且本地未安装 mineru / paddleocr OCR 引擎。"
        "请安装其一后重试: pip install magic-pdf[full] 或 pip install paddlepaddle paddleocr"
    )
