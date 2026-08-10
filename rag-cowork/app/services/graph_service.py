"""实体/关系抽取服务 · LightRAG 思路轻量实现 (MAIN 模型, JSON 输出)

对分块文本调用 LLM 抽取命名实体与实体间关系, 结果供 PG 与 Neo4j 写入。
"""
import json
import logging
import re
from typing import Dict, List

from app.services import llm_service

logger = logging.getLogger(__name__)

_EXTRACT_SYSTEM = """你是知识图谱构建助手。从文本中抽取命名实体与实体间关系, 严格输出 JSON。

输出格式示例 (文本: 王五在清华大学任教, 他主持了国家自然科学基金项目):
{
  "entities": [
    {"name": "王五", "type": "人物", "description": "清华大学教师"},
    {"name": "清华大学", "type": "机构", "description": "中国高等学府"},
    {"name": "国家自然科学基金项目", "type": "项目", "description": "王五主持的科研项目"}
  ],
  "relations": [
    {"src": "王五", "tgt": "清华大学", "type": "任职于", "description": "王五在清华大学任教", "keywords": "任教"},
    {"src": "王五", "tgt": "国家自然科学基金项目", "type": "主持", "description": "王五主持该基金项目", "keywords": "主持,基金"}
  ]
}

要求: 实体名精简规范 (不超过 30 字); type 取 人物/机构/地点/概念/项目/产品/技术/事件; 关系的 src/tgt 必须出现在 entities 中; 最多 15 个实体、15 条关系; 只输出 JSON, 不要任何解释。"""


def _parse_json(text: str) -> dict:
    """容错解析 LLM 输出的 JSON (去除代码围栏/截取花括号段)"""
    raw = text.strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start:end + 1]
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        logger.warning("实体抽取 JSON 解析失败: %s", raw[:200])
        return {}


async def extract_from_chunk(content: str) -> Dict[str, List[dict]]:
    """从单个分块抽取实体/关系; 失败返回空"""
    if len(content.strip()) < 20:
        return {"entities": [], "relations": []}
    try:
        answer = await llm_service.chat_main(
            f"请抽取以下文本的实体与关系:\n\n{content[:3000]}", system=_EXTRACT_SYSTEM
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("实体抽取 LLM 调用失败: %s", e)
        return {"entities": [], "relations": []}
    data = _parse_json(answer)
    entities = [e for e in data.get("entities") or [] if isinstance(e, dict) and e.get("name")]
    relations = [r for r in data.get("relations") or [] if isinstance(r, dict) and r.get("src") and r.get("tgt")]
    return {"entities": entities[:15], "relations": relations[:15]}


def merge_extraction(parts: List[Dict[str, List[dict]]]) -> Dict[str, List[dict]]:
    """合并多个分块的抽取结果: 实体按 name 去重 (保留信息量大的描述), 关系按 (src,tgt,type) 去重"""
    entities: Dict[str, dict] = {}
    relations: Dict[tuple, dict] = {}
    for part in parts:
        for e in part.get("entities") or []:
            name = str(e.get("name") or "").strip()
            if not name:
                continue
            if name not in entities or len(str(e.get("description") or "")) > len(str(entities[name].get("description") or "")):
                entities[name] = {
                    "name": name,
                    "type": str(e.get("type") or "UNKNOWN").strip() or "UNKNOWN",
                    "description": str(e.get("description") or "").strip(),
                }
        for r in part.get("relations") or []:
            src, tgt = str(r.get("src") or "").strip(), str(r.get("tgt") or "").strip()
            if not src or not tgt or src not in entities or tgt not in entities:
                continue
            key = (src, tgt, str(r.get("type") or "RELATED").strip() or "RELATED")
            if key not in relations:
                relations[key] = {
                    "src": src, "tgt": tgt, "type": key[2],
                    "description": str(r.get("description") or "").strip(),
                    "keywords": str(r.get("keywords") or "").strip(),
                }
    return {"entities": list(entities.values()), "relations": list(relations.values())}
