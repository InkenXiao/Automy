"""Obsidian 同步服务 · 通过 Local REST API 插件读取 vault 笔记, 导入个人知识库

依赖 Obsidian "Local REST API" 插件 (coddingtonbear):
- 默认 HTTPS 27124 (自签证书, 需 verify=False) / HTTP 27123
- 认证: Authorization: Bearer {api_key}
- 列目录: GET {host}/vault/{dir}/   → {"files": ["a.md", "sub/"]} ("/" 结尾为子目录)
- 读文件: GET {host}/vault/{path}   → Markdown 原文 (Accept: text/markdown)
"""
import logging
from typing import List

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import RagDocument, RagKnowledgeBase, RagObsidianConfig, SysUser
from app.services import minio_service, parse_pipeline
from app.services.snowflake import generate_id

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(connect=8.0, read=60.0, write=30.0, pool=10.0)
MAX_NOTE_BYTES = 20 * 1024 * 1024   # 单篇笔记上限 20MB
MAX_SYNC_FILES = 500                # 单次同步文件数上限


def _client(host: str, api_key: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=host.rstrip("/"),
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=_TIMEOUT,
        verify=False,  # Obsidian Local REST API 使用自签证书
    )


async def test_connection(host: str, api_key: str) -> dict:
    """测试连接: GET {host}/ 返回 200 即插件可用"""
    if not host:
        return {"ok": False, "error": "host 未配置"}
    try:
        async with _client(host, api_key) as client:
            resp = await client.get("/")
        if resp.status_code == 200:
            return {"ok": True, "info": resp.text[:200]}
        return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:160]}"}
    except Exception as e:  # noqa: BLE001
        msg = str(e).strip() or type(e).__name__
        return {"ok": False, "error": f"{type(e).__name__}: {msg}"[:220]}


async def _list_dir(client: httpx.AsyncClient, path: str) -> List[str]:
    """列目录, 返回条目名列表 (子目录以 '/' 结尾); 失败返回空"""
    resp = await client.get(f"/vault/{path.strip('/')}/" if path.strip("/") else "/vault/")
    if resp.status_code != 200:
        return []
    data = resp.json() if resp.content else {}
    return data.get("files") or []


async def list_markdown(host: str, api_key: str, base_path: str = "",
                        _depth: int = 0) -> List[str]:
    """递归收集 vault 中全部 Markdown 笔记路径 (相对 vault 根)"""
    if _depth > 12:  # 防循环/过深
        return []
    out: List[str] = []
    async with _client(host, api_key) as client:
        async def _walk(client: httpx.AsyncClient, prefix: str, depth: int) -> None:
            if depth > 12 or len(out) >= MAX_SYNC_FILES:
                return
            for entry in await _list_dir(client, prefix):
                if len(out) >= MAX_SYNC_FILES:
                    return
                full = f"{prefix.strip('/')}/{entry}" if prefix.strip("/") else entry
                if entry.endswith("/"):
                    await _walk(client, full.rstrip("/"), depth + 1)
                elif entry.lower().endswith(".md"):
                    out.append(full)
        await _walk(client, base_path, _depth)
    return out


async def read_note(client: httpx.AsyncClient, path: str) -> str:
    """读取单篇笔记 Markdown 原文"""
    resp = await client.get(f"/vault/{path}", headers={"Accept": "text/markdown"})
    if resp.status_code != 200:
        raise RuntimeError(f"读取失败 HTTP {resp.status_code}")
    return resp.text


async def _upload_note(kb_id: int, user: SysUser, file_name: str, text: str) -> tuple[RagDocument, bool]:
    """笔记文本入库: 哈希去重 + MinIO 归档 + rag_documents 记录; 返回 (doc, 是否新建)"""
    import hashlib

    data = text.encode("utf-8")
    file_hash = hashlib.sha256(data).hexdigest()
    async with AsyncSessionLocal() as session:
        dup = (await session.execute(
            select(RagDocument).where(
                RagDocument.is_delete.is_(False),
                RagDocument.kb_id == kb_id,
                RagDocument.file_hash == file_hash,
            )
        )).scalars().first()
        if dup:
            return dup, False
        object_key = await minio_service.upload_bytes(kb_id, file_name, data, "text/markdown")
        if object_key is None:
            raise RuntimeError("MinIO 归档失败")
        doc = RagDocument(
            doc_id=generate_id(), kb_id=kb_id, file_name=file_name,
            file_ext="md", file_size=len(data), file_hash=file_hash,
            minio_bucket=settings.RAG_MINIO_BUCKET, minio_path=object_key,
            parse_status="pending", user_id=user.user_id,
        )
        session.add(doc)
        await session.commit()
        return doc, True


async def sync_vault(config: RagObsidianConfig, user: SysUser, kb: RagKnowledgeBase) -> dict:
    """同步 Obsidian vault 的 Markdown 笔记到知识库; 返回同步摘要"""
    paths = await list_markdown(config.host, config.api_key, config.base_path)
    created = skipped = failed = 0
    errors: List[str] = []
    async with _client(config.host, config.api_key) as client:
        for path in paths:
            file_name = path.rsplit("/", 1)[-1]
            try:
                text = await read_note(client, path)
                if not text.strip():
                    skipped += 1
                    continue
                if len(text.encode("utf-8")) > MAX_NOTE_BYTES:
                    skipped += 1
                    continue
                doc, is_new = await _upload_note(kb.kb_id, user, file_name, text)
                if not is_new:
                    skipped += 1
                    continue
                created += 1
                if config.auto_parse:
                    try:
                        await parse_pipeline.create_and_launch_parse(doc.doc_id)
                    except Exception as e:  # noqa: BLE001
                        logger.warning("笔记解析启动失败 %s: %s", file_name, e)
            except Exception as e:  # noqa: BLE001
                failed += 1
                errors.append(f"{file_name}: {str(e)[:80]}")
    return {
        "total": len(paths), "created": created, "skipped": skipped, "failed": failed,
        "errors": errors[:20],
    }
