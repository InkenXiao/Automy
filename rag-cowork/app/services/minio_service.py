"""MinIO 对象存储服务 · 知识库文件归档 (改造自 pro-cowork minio_service)

- 桶: settings.RAG_MINIO_BUCKET (默认 ragkb), 首次使用自动创建
- 对象路径: {kb_id}/{yyyymm}/{文件名}
- minio SDK 为同步客户端, 统一 asyncio.to_thread 包装
"""
import asyncio
import io
import logging
import re
from datetime import datetime
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

_client = None
_bucket_ready = False


def _get_client():
    """惰性构建 MinIO 客户端 (未配置返回 None)"""
    global _client
    if _client is not None:
        return _client
    if not settings.MINIO_ENDPOINT:
        return None
    from minio import Minio

    _client = Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
        region=settings.MINIO_REGION or None,
    )
    return _client


def _ensure_bucket(client) -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    if not client.bucket_exists(settings.RAG_MINIO_BUCKET):
        client.make_bucket(settings.RAG_MINIO_BUCKET, location=settings.MINIO_REGION or None)
        logger.info("MinIO 桶 %s 已创建", settings.RAG_MINIO_BUCKET)
    _bucket_ready = True


def _safe_part(name: str, fallback: str) -> str:
    """路径段清洗: 去掉路径分隔符与控制字符"""
    name = re.sub(r'[/\\:\x00-\x1f]', "", (name or "").strip())
    return name or fallback


def build_object_key(kb_id: int, filename: str) -> str:
    """{kb_id}/{yyyymm}/{文件名}"""
    month = datetime.now().strftime("%Y%m")
    return f"{kb_id}/{month}/{_safe_part(filename, 'unnamed')}"


async def upload_bytes(kb_id: int, filename: str, data: bytes, content_type: str = "application/octet-stream") -> Optional[str]:
    """上传知识库文件到 MinIO, 返回对象 key; 未配置/失败返回 None"""
    client = _get_client()
    if not client:
        return None
    key = build_object_key(kb_id, filename)

    def _put() -> str:
        _ensure_bucket(client)
        client.put_object(
            settings.RAG_MINIO_BUCKET, key, io.BytesIO(data), len(data),
            content_type=content_type,
        )
        return key

    try:
        result = await asyncio.to_thread(_put)
        logger.info("MinIO 归档成功: %s (%d bytes)", result, len(data))
        await _register_upload(kb_id=kb_id, filename=filename, content_type=content_type, size=len(data), key=key)
        return result
    except Exception as e:  # noqa: BLE001
        logger.warning("MinIO 归档失败 %s: %s", key, e)
        return None


async def _register_upload(*, kb_id: int, filename: str, content_type: str, size: int, key: str) -> None:
    """上传成功登记 sys_files (对象名取知识库名称; 失败仅告警不阻断)"""
    try:
        from sqlalchemy import text

        from app.database import AsyncSessionLocal

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        async with AsyncSessionLocal() as db:
            await db.execute(
                text(
                    "INSERT INTO sys_files (file_name, file_type, file_size, app, object_name,"
                    " member_name, bucket, object_key, content_type, uploaded_at) "
                    "VALUES (:fn, :ft, :fs, 'rag-cowork', "
                    "COALESCE((SELECT name FROM rag_knowledge_bases WHERE kb_id = :kb AND is_delete = false), :fb), "
                    "'', :bk, :key, :ct, now()) "
                    "ON CONFLICT (bucket, object_key) DO UPDATE SET "
                    "file_size = EXCLUDED.file_size, content_type = EXCLUDED.content_type, "
                    "uploaded_at = EXCLUDED.uploaded_at, is_delete = false, updated_at = now()"
                ),
                {
                    "fn": filename, "ft": ext, "fs": size, "kb": kb_id, "fb": str(kb_id),
                    "bk": settings.RAG_MINIO_BUCKET, "key": key, "ct": content_type,
                },
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001 - 登记失败不阻断上传
        logger.warning("sys_files 登记失败 %s: %s", key, e)


async def download_bytes(object_key: str, bucket: str = "") -> Optional[bytes]:
    """按对象 key 从 MinIO 下载文件内容 (bucket 为空用默认桶; 传 doc.minio_bucket 兼容历史归档)"""
    client = _get_client()
    if not client:
        return None
    bucket = bucket or settings.RAG_MINIO_BUCKET

    def _get() -> bytes:
        _ensure_bucket(client)
        resp = client.get_object(bucket, object_key)
        try:
            return resp.read()
        finally:
            resp.close()
            resp.release_conn()

    try:
        return await asyncio.to_thread(_get)
    except Exception as e:  # noqa: BLE001
        logger.warning("MinIO 下载失败 %s: %s", object_key, e)
        return None


async def delete_object(object_key: str, bucket: str = "") -> bool:
    """删除 MinIO 对象 (文档删除时清理归档; bucket 为空用默认桶)"""
    client = _get_client()
    if not client:
        return False
    bucket = bucket or settings.RAG_MINIO_BUCKET

    def _del():
        client.remove_object(bucket, object_key)

    try:
        await asyncio.to_thread(_del)
        try:  # 登记行软删除 (失败不阻断删除主流程)
            from sqlalchemy import text

            from app.database import AsyncSessionLocal

            async with AsyncSessionLocal() as db:
                await db.execute(
                    text("UPDATE sys_files SET is_delete = true, updated_at = now() WHERE bucket = :bk AND object_key = :key"),
                    {"bk": bucket, "key": object_key},
                )
                await db.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning("sys_files 软删除失败 %s: %s", object_key, e)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("MinIO 删除失败 %s: %s", object_key, e)
        return False
