"""使用日志记录服务 · 操作日志/LLM token 统一落库 (独立会话, 异常静默)"""
import logging

from app.models.usage_log import OperationLog

logger = logging.getLogger(__name__)


async def record_operation(
    user_name: str = "",
    method: str = "",
    path: str = "",
    entity_type: str = "",
    entity_id: int | None = None,
    action: str = "",
    detail: str = "",
    tokens: int = 0,
) -> None:
    """写入一条操作日志 (独立会话提交; 任何异常仅告警, 不影响主流程)"""
    try:
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            session.add(OperationLog(
                user_name=(user_name or "")[:64],
                method=(method or "")[:8],
                path=(path or "")[:256],
                entity_type=(entity_type or "")[:32],
                entity_id=entity_id,
                action=(action or "")[:16],
                detail=(detail or "")[:2000],
                tokens=int(tokens or 0),
            ))
            await session.commit()
    except Exception as e:  # noqa: BLE001
        logger.warning("操作日志写入失败: %s", e)


async def record_llm_usage(user_name: str, source: str, total_tokens: int, detail: str = "") -> None:
    """记录一次 LLM 调用的 token 消耗

    source: 调用来源 (数字分身/技能/周报概括/会议纪要), 作为 entity_type 便于看板分组
    """
    await record_operation(
        user_name=user_name or "system",
        method="LLM",
        path=source,
        entity_type=source,
        action="llm_call",
        detail=detail,
        tokens=total_tokens,
    )
