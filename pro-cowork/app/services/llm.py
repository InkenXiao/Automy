"""模型客户端工厂 · 按用途从 .env 读取配置 (OpenAI 兼容协议)

用途分工 (见 pro-cowork/.env):
- MAIN   主推理模型: 智能体对话 (function calling 主循环)、会议纪要等主力生成
- SMALL  轻量快推模型: 意图识别、内容润色、周工作小结概括等快速任务
- CODER  代码生成模型 (预留: AI coding)
- EMBEDDING  向量抽取模型 (知识库构建)
- RERANKER   结果重排模型 (RAG 重排)
- VISION 视觉多模态模型 (图片内容识别)
- ASR    语音转文字 (asr_service 直连 HTTP, 非 OpenAI 协议)
- TTS    文字合成语音 (预留)
"""
from typing import Optional

from openai import AsyncOpenAI

from app.config import settings


def _build(url: str, key: str) -> Optional[AsyncOpenAI]:
    if not url or not key:
        return None
    return AsyncOpenAI(api_key=key, base_url=url)


def main_client() -> Optional[AsyncOpenAI]:
    """主推理模型客户端 (未配置返回 None)"""
    return _build(settings.MAIN_API_URL, settings.MAIN_API_KEY)


def small_client() -> Optional[AsyncOpenAI]:
    """轻量快推模型客户端; 未单独配置时回退主推理模型"""
    return _build(settings.SMALL_API_URL, settings.SMALL_API_KEY) or main_client()


def coder_client() -> Optional[AsyncOpenAI]:
    """代码生成模型客户端 (预留)"""
    return _build(settings.CODER_API_URL, settings.CODER_API_KEY)


def embedding_client() -> Optional[AsyncOpenAI]:
    """向量抽取模型客户端 (知识库构建)"""
    return _build(settings.EMBEDDING_API_URL, settings.EMBEDDING_API_KEY)


def reranker_client() -> Optional[AsyncOpenAI]:
    """结果重排模型客户端 (RAG)"""
    return _build(settings.RERANKER_API_URL, settings.RERANKER_API_KEY)


def vision_client() -> Optional[AsyncOpenAI]:
    """视觉多模态模型客户端 (图片识别)"""
    return _build(settings.VISION_API_URL, settings.VISION_API_KEY)


def main_model() -> str:
    return settings.MAIN_MODEL


def small_model() -> str:
    """轻量模型名; 未单独配置时回退主推理模型名"""
    return settings.SMALL_MODEL or settings.MAIN_MODEL


def vision_model() -> str:
    return settings.VISION_MODEL
