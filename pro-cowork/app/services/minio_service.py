"""MinIO 对象存储服务 · 上传文件同步归档

- 桶: settings.MINIO_BUCKET (默认 xuanpu), 首次使用自动创建
- 对象路径: {分身名}/{成员名}/{yyyymm}/{文件名}
  - 分身名: 上传时已知 (分身对话/调试/记忆测试) 或 "通用" (新建任务尚未指定分身)
  - 成员名: 登录人 (X-User-Name 请求头), 未登录为 "匿名"
  - yyyymm: 上传月份, 如 202608
- minio SDK 为同步客户端, 统一 asyncio.to_thread 包装; 未配置 endpoint 时静默跳过
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
    if not client.bucket_exists(settings.MINIO_BUCKET):
        client.make_bucket(settings.MINIO_BUCKET, location=settings.MINIO_REGION or None)
        logger.info("MinIO 桶 %s 已创建", settings.MINIO_BUCKET)
    _bucket_ready = True


def _safe_part(name: str, fallback: str) -> str:
    """路径段清洗: 去掉路径分隔符与控制字符, 空则回退默认名"""
    name = re.sub(r'[/\\:\x00-\x1f]', "", (name or "").strip())
    return name or fallback


def build_object_key(agent_name: str, member_name: str, filename: str) -> str:
    """{分身}/{成员}/{yyyymm}/{文件名}"""
    agent = _safe_part(agent_name, "通用")
    member = _safe_part(member_name, "匿名")
    month = datetime.now().strftime("%Y%m")
    return f"{agent}/{member}/{month}/{_safe_part(filename, 'unnamed')}"


async def upload_bytes(
    filename: str,
    data: bytes,
    content_type: str = "application/octet-stream",
    agent_name: str = "",
    member_name: str = "",
) -> Optional[str]:
    """同步上传文件到 MinIO, 返回对象 key; 未配置/失败返回 None (不影响本地存储主流程)"""
    client = _get_client()
    if not client:
        return None
    key = build_object_key(agent_name, member_name, filename)

    def _put() -> str:
        _ensure_bucket(client)
        client.put_object(
            settings.MINIO_BUCKET, key, io.BytesIO(data), len(data),
            content_type=content_type,
        )
        return key

    try:
        result = await asyncio.to_thread(_put)
        logger.info("MinIO 归档成功: %s (%d bytes)", result, len(data))
        await _register_upload(
            filename=filename,
            content_type=content_type,
            size=len(data),
            object_name=_safe_part(agent_name, "通用"),
            member_name=_safe_part(member_name, "匿名"),
            key=key,
        )
        return result
    except Exception as e:  # noqa: BLE001 - 对象存储失败不阻断本地上传
        logger.warning("MinIO 归档失败 %s: %s", key, e)
        return None


async def _register_upload(
    *, filename: str, content_type: str, size: int,
    object_name: str, member_name: str, key: str,
) -> None:
    """上传成功登记 sys_files (bucket+object_key 幂等 upsert; 失败仅告警不阻断)"""
    try:
        from sqlalchemy import text

        from app.database import AsyncSessionLocal

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        async with AsyncSessionLocal() as db:
            await db.execute(
                text(
                    "INSERT INTO sys_files (file_name, file_type, file_size, app, object_name,"
                    " member_name, bucket, object_key, content_type, uploaded_at) "
                    "VALUES (:fn, :ft, :fs, 'pro-cowork', :obj, :mem, :bk, :key, :ct, now()) "
                    "ON CONFLICT (bucket, object_key) DO UPDATE SET "
                    "file_size = EXCLUDED.file_size, content_type = EXCLUDED.content_type, "
                    "uploaded_at = EXCLUDED.uploaded_at, is_delete = false, updated_at = now()"
                ),
                {
                    "fn": filename, "ft": ext, "fs": size, "obj": object_name,
                    "mem": member_name, "bk": settings.MINIO_BUCKET, "key": key, "ct": content_type,
                },
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001 - 登记失败不阻断上传
        logger.warning("sys_files 登记失败 %s: %s", key, e)


async def restore_by_filename(filename: str, dest) -> Optional[str]:
    """按文件名在 MinIO 归档中查找并下载到 dest (本地附件被清理后回源)

    工作台页打开会清空项目附件目录, 聊天历史中的图片/语音靠此从对象存储恢复。
    匹配规则: 对象 key 以 /{filename} 结尾 (路径为 {分身}/{成员}/{yyyymm}/{文件名})。
    返回对象 key; 未配置/未找到/失败返回 None。
    """
    from pathlib import Path

    client = _get_client()
    if not client:
        return None
    dest = Path(dest)
    suffix = f"/{filename}"

    def _restore() -> Optional[str]:
        _ensure_bucket(client)
        for obj in client.list_objects(settings.MINIO_BUCKET, recursive=True):
            if obj.object_name.endswith(suffix):
                dest.parent.mkdir(parents=True, exist_ok=True)
                client.fget_object(settings.MINIO_BUCKET, obj.object_name, str(dest))
                return obj.object_name
        return None

    try:
        result = await asyncio.to_thread(_restore)
        if result:
            logger.info("MinIO 回源成功: %s -> %s", result, dest.name)
        return result
    except Exception as e:  # noqa: BLE001 - 回源失败按 404 处理
        logger.warning("MinIO 回源失败 %s: %s", filename, e)
        return None
