"""Milvus 向量存储 · ragcowork_* 4 集合 (改造自 demo milvus_store, 增加 kb_id 标量过滤)

集合:
- ragcowork_chunks   : 文本分块向量 (chunk_id PK, kb_id, doc_id, content, embedding)
- ragcowork_resources: 多模态资源描述向量 (resource_id PK, kb_id, doc_id, desc, embedding)
- ragcowork_entities : 实体向量 (entity_id PK, kb_id, name, description, embedding)
- ragcowork_relations: 关系向量 (relation_id PK, kb_id, src, tgt, description, embedding)

检索统一以 kb_id IN [...] 做权限/范围过滤。
"""
import logging
from typing import Any, Dict, List, Optional

from pymilvus import (
    Collection,
    CollectionSchema,
    DataType,
    FieldSchema,
    MilvusException,
    connections,
    utility,
)

from app.config import settings

logger = logging.getLogger(__name__)

COLL_CHUNKS = "ragcowork_chunks"
COLL_RESOURCES = "ragcowork_resources"
COLL_ENTITIES = "ragcowork_entities"
COLL_RELATIONS = "ragcowork_relations"

_INDEX = {"index_type": "HNSW", "metric_type": "COSINE", "params": {"M": 16, "efConstruction": 200}}

_connected = False
_collections: Dict[str, Collection] = {}


def connect() -> None:
    """建立 Milvus 连接 (幂等)"""
    global _connected
    if _connected:
        return
    connections.connect(
        alias="default",
        host=settings.MILVUS_HOST,
        port=str(settings.MILVUS_PORT),
        db_name=settings.MILVUS_DB_NAME,
    )
    _connected = True


def _get(name: str) -> Collection:
    if name not in _collections:
        _collections[name] = Collection(name)
    return _collections[name]


def _make(name: str, pk: str, extra_fields: List[FieldSchema], desc: str) -> None:
    """建集合 + 向量索引 + load (已存在则跳过)"""
    if utility.has_collection(name):
        return
    fields = [
        FieldSchema(name=pk, dtype=DataType.INT64, is_primary=True),
        FieldSchema(name="kb_id", dtype=DataType.INT64),
        FieldSchema(name="doc_id", dtype=DataType.INT64),
        *extra_fields,
        FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=settings.EMBEDDING_DIM),
    ]
    coll = Collection(name, CollectionSchema(fields, description=desc))
    coll.create_index("embedding", _INDEX)
    coll.create_index("kb_id", {"index_type": "STL_SORT"})
    coll.load()
    logger.info("Milvus 集合 %s 已创建 (dim=%d)", name, settings.EMBEDDING_DIM)


def init_collections() -> None:
    """初始化全部集合 (幂等)"""
    connect()
    _make(COLL_CHUNKS, "chunk_id", [
        FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=8192),
    ], "KB text chunk embeddings")
    _make(COLL_RESOURCES, "resource_id", [
        FieldSchema(name="description", dtype=DataType.VARCHAR, max_length=4096),
    ], "KB multimodal resource embeddings")
    _make(COLL_ENTITIES, "entity_id", [
        FieldSchema(name="name", dtype=DataType.VARCHAR, max_length=512),
        FieldSchema(name="description", dtype=DataType.VARCHAR, max_length=4096),
    ], "KB entity embeddings")
    _make(COLL_RELATIONS, "relation_id", [
        FieldSchema(name="src", dtype=DataType.VARCHAR, max_length=512),
        FieldSchema(name="tgt", dtype=DataType.VARCHAR, max_length=512),
        FieldSchema(name="description", dtype=DataType.VARCHAR, max_length=4096),
    ], "KB relation embeddings")


def insert(coll_name: str, rows: List[Dict[str, Any]]) -> None:
    """批量插入 (dict 列表, 键需与集合字段一致)"""
    if not rows:
        return
    connect()
    try:
        _get(coll_name).insert(rows)
        _get(coll_name).flush()
    except MilvusException as e:
        logger.error("Milvus 插入失败 %s (%d 行): %s", coll_name, len(rows), e)
        raise


def search(coll_name: str, vector: List[float], kb_ids: List[int], top_k: int = 10,
           output_fields: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """向量检索, kb_id IN 过滤; 返回 [{id, distance, ...output_fields}]"""
    connect()
    coll = _get(coll_name)
    coll.load()
    expr = f"kb_id in [{','.join(str(k) for k in kb_ids)}]" if kb_ids else ""
    res = coll.search(
        data=[vector],
        anns_field="embedding",
        param={"metric_type": "COSINE", "params": {"ef": 64}},
        limit=top_k,
        expr=expr or None,
        output_fields=output_fields or [],
    )
    hits: List[Dict[str, Any]] = []
    for hit in res[0] if res else []:
        item = {"id": hit.id, "distance": float(hit.distance)}
        entity = hit.entity
        if hasattr(entity, "to_dict"):
            item.update(entity.to_dict().get("entity", entity.to_dict()) or {})
        elif hasattr(entity, "_row_data"):  # 兼容旧版 pymilvus
            item.update(entity._row_data)
        hits.append(item)
    return hits


def get_by_ids(coll_name: str, pk_field: str, ids: List[int],
               output_fields: Optional[List[str]] = None) -> Dict[int, Dict[str, Any]]:
    """按主键 id 列表查询, 返回 {id: row} (用于分块明细核对向量存在性)"""
    if not ids:
        return {}
    connect()
    coll = _get(coll_name)
    try:
        coll.load()
    except MilvusException:
        pass
    fields = list(output_fields or [])
    if pk_field not in fields:
        fields.insert(0, pk_field)
    expr = f"{pk_field} in [{','.join(str(int(i)) for i in ids)}]"
    try:
        rows = coll.query(expr=expr, output_fields=fields, limit=len(ids))
    except MilvusException as e:
        logger.warning("Milvus 按 id 查询失败 %s: %s", coll_name, e)
        return {}
    return {int(r[pk_field]): dict(r) for r in rows if pk_field in r}


def delete_by_doc(coll_name: str, doc_id: int) -> None:
    """按 doc_id 删除 (文档删除时清理向量)"""
    connect()
    try:
        _get(coll_name).delete(f"doc_id == {doc_id}")
    except MilvusException as e:
        logger.warning("Milvus 删除失败 %s doc_id=%s: %s", coll_name, doc_id, e)


def delete_by_kb(kb_id: int) -> None:
    """按 kb_id 清空全部集合 (知识库删除时调用)"""
    connect()
    for name in (COLL_CHUNKS, COLL_RESOURCES, COLL_ENTITIES, COLL_RELATIONS):
        try:
            _get(name).delete(f"kb_id == {kb_id}")
        except MilvusException as e:
            logger.warning("Milvus 删除失败 %s kb_id=%s: %s", name, kb_id, e)
