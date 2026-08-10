"""MinIO 文件登记模型 · 各应用上传对象统一登记 (需求: 文件台账)

- 登记范围: pro-cowork 聊天/工作台附件 (桶 xuanpu-pro), rag-cowork 知识库文件 (桶 ragkb)
- 写入时机: minio_service 上传成功后 upsert; rag-cowork 删除对象时软删除登记行
- 唯一约束: bucket + object_key (重复上传同路径对象视为覆盖更新)
"""
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class SysFile(Base, TimestampMixin, SoftDeleteMixin):
    """MinIO 文件登记 (bucket+object_key 唯一)"""

    __tablename__ = "sys_files"
    __table_args__ = (
        UniqueConstraint("bucket", "object_key", name="uq_sys_files_bucket_key"),
        {"comment": "MinIO 文件登记表 (各应用上传对象统一登记, bucket+object_key 唯一)"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, comment="主键ID")
    file_name: Mapped[str] = mapped_column(String(256), comment="文件名")
    file_type: Mapped[str] = mapped_column(String(32), default="", index=True, comment="文件类型 (扩展名小写, 如 pdf/png/m4a)")
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, comment="文件大小(字节)")
    app: Mapped[str] = mapped_column(String(32), default="", index=True, comment="上传应用: pro-cowork/rag-cowork")
    object_name: Mapped[str] = mapped_column(String(128), default="", index=True, comment="关联对象 (智能体名称/技能名称/知识库名称等)")
    member_name: Mapped[str] = mapped_column(String(64), default="", comment="上传人姓名")
    bucket: Mapped[str] = mapped_column(String(64), default="", comment="MinIO 存储桶")
    object_key: Mapped[str] = mapped_column(String(512), default="", comment="MinIO 存储路径 (桶内对象 key)")
    content_type: Mapped[str] = mapped_column(String(128), default="", comment="MIME 类型")
    kb_indexed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false",
        comment="是否已构建到知识库 (rag 解析入库成功后回写)",
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="文件上传时间 (MinIO 对象最后修改时间)",
    )

    def __repr__(self):
        return f"<SysFile {self.id} {self.bucket}/{self.object_key}>"
