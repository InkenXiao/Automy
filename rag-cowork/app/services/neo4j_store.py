"""Neo4j 图谱存储 · 实体/关系/文档节点 (kb_id 属性隔离)

节点标签: RagEntity / RagDocument / RagKnowledgeBase
关系:     (RagEntity)-[:RAG_RELATES {relation_type, kb_id, doc_id}]->(RagEntity)
          (RagEntity)-[:RAG_MENTIONED_IN]->(RagDocument)
          (RagDocument)-[:RAG_BELONGS_TO]->(RagKnowledgeBase)
所有查询带 kb_id 过滤, 保证知识库间数据隔离。
"""
import logging
from typing import Dict, List, Optional

from neo4j import GraphDatabase

from app.config import settings

logger = logging.getLogger(__name__)

_driver = None


def _get_driver():
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        )
    return _driver


def init_schema() -> None:
    """初始化约束 (幂等)"""
    driver = _get_driver()
    with driver.session() as session:
        session.run(
            "CREATE CONSTRAINT rag_entity_id IF NOT EXISTS "
            "FOR (n:RagEntity) REQUIRE n.entity_id IS UNIQUE"
        )
        session.run(
            "CREATE CONSTRAINT rag_doc_id IF NOT EXISTS "
            "FOR (n:RagDocument) REQUIRE n.doc_id IS UNIQUE"
        )
        session.run(
            "CREATE CONSTRAINT rag_kb_id IF NOT EXISTS "
            "FOR (n:RagKnowledgeBase) REQUIRE n.kb_id IS UNIQUE"
        )
    logger.info("Neo4j 约束初始化完成")


def upsert_kb(kb_id: int, name: str, level: str) -> None:
    with _get_driver().session() as session:
        session.run(
            "MERGE (k:RagKnowledgeBase {kb_id: $kb_id}) SET k.name=$name, k.level=$level",
            kb_id=kb_id, name=name, level=level,
        )


def upsert_document(doc_id: int, kb_id: int, file_name: str) -> None:
    with _get_driver().session() as session:
        session.run(
            "MERGE (d:RagDocument {doc_id: $doc_id}) SET d.file_name=$fn, d.kb_id=$kb_id",
            doc_id=doc_id, fn=file_name, kb_id=kb_id,
        )
        session.run(
            "MATCH (d:RagDocument {doc_id:$doc_id}), (k:RagKnowledgeBase {kb_id:$kb_id}) "
            "MERGE (d)-[:RAG_BELONGS_TO]->(k)",
            doc_id=doc_id, kb_id=kb_id,
        )


def upsert_entity(entity_id: int, kb_id: int, doc_id: int, name: str,
                  entity_type: str, description: str, weight: float = 1.0) -> None:
    with _get_driver().session() as session:
        session.run(
            "MERGE (e:RagEntity {entity_id: $eid}) "
            "SET e.name=$name, e.kb_id=$kb_id, e.doc_id=$doc_id, "
            "    e.entity_type=$etype, e.description=$desc, e.weight=$weight",
            eid=entity_id, name=name, kb_id=kb_id, doc_id=doc_id,
            etype=entity_type, desc=description, weight=weight,
        )
        session.run(
            "MATCH (e:RagEntity {entity_id:$eid}), (d:RagDocument {doc_id:$doc_id}) "
            "MERGE (e)-[:RAG_MENTIONED_IN]->(d)",
            eid=entity_id, doc_id=doc_id,
        )


def upsert_relation(src_entity_id: int, tgt_entity_id: int, kb_id: int, doc_id: int,
                    relation_type: str, description: str, keywords: str = "") -> None:
    with _get_driver().session() as session:
        session.run(
            "MATCH (s:RagEntity {entity_id:$sid}), (t:RagEntity {entity_id:$tid}) "
            "MERGE (s)-[r:RAG_RELATES {kb_id:$kb_id, doc_id:$doc_id, relation_type:$rtype}]->(t) "
            "SET r.description=$desc, r.keywords=$kw",
            sid=src_entity_id, tid=tgt_entity_id, kb_id=kb_id, doc_id=doc_id,
            rtype=relation_type, desc=description, kw=keywords,
        )


def entity_context(names: List[str], kb_ids: List[int], max_rels: int = 30) -> List[Dict]:
    """按实体名取图谱邻域 (限定 kb 范围), 供 RAG 生成图谱上下文"""
    if not names or not kb_ids:
        return []
    with _get_driver().session() as session:
        result = session.run(
            "MATCH (s:RagEntity)-[r:RAG_RELATES]->(t:RagEntity) "
            "WHERE s.name IN $names AND r.kb_id IN $kb_ids "
            "RETURN s.name AS src, r.relation_type AS type, t.name AS tgt, "
            "       r.description AS desc LIMIT $limit",
            names=names, kb_ids=kb_ids, limit=max_rels,
        )
        return [dict(record) for record in result]


def find_entities_by_names(names: List[str], kb_ids: List[int], limit: int = 20) -> List[Dict]:
    """按名称模糊命中实体 (用于查询侧实体链接)"""
    if not names or not kb_ids:
        return []
    with _get_driver().session() as session:
        result = session.run(
            "MATCH (e:RagEntity) WHERE e.kb_id IN $kb_ids AND "
            "any(n IN $names WHERE e.name CONTAINS n OR n CONTAINS e.name) "
            "RETURN e.entity_id AS entity_id, e.name AS name, e.description AS desc "
            "LIMIT $limit",
            names=names, kb_ids=kb_ids, limit=limit,
        )
        return [dict(record) for record in result]


def doc_graph(doc_id: int, limit: int = 200) -> Dict:
    """文档图谱明细: 该文档抽取的实体与关系 (供分块明细展示 Neo4j 关联)"""
    with _get_driver().session() as session:
        entities = [
            dict(r) for r in session.run(
                "MATCH (e:RagEntity) WHERE e.doc_id = $doc_id "
                "RETURN e.entity_id AS entity_id, e.name AS name, "
                "       e.entity_type AS type, e.description AS desc LIMIT $limit",
                doc_id=doc_id, limit=limit,
            )
        ]
        relations = [
            dict(r) for r in session.run(
                "MATCH (s:RagEntity)-[r:RAG_RELATES]->(t:RagEntity) WHERE r.doc_id = $doc_id "
                "RETURN s.name AS src, r.relation_type AS type, t.name AS tgt, "
                "       r.description AS desc, r.keywords AS keywords LIMIT $limit",
                doc_id=doc_id, limit=limit,
            )
        ]
    return {"entities": entities, "relations": relations}


def delete_by_doc(doc_id: int) -> None:
    """删除文档节点及其关联实体/关系 (实体仅删属于该文档的)"""
    with _get_driver().session() as session:
        session.run(
            "MATCH (e:RagEntity) WHERE e.doc_id = $doc_id DETACH DELETE e",
            doc_id=doc_id,
        )
        session.run(
            "MATCH (d:RagDocument {doc_id: $doc_id}) DETACH DELETE d",
            doc_id=doc_id,
        )


def delete_by_kb(kb_id: int) -> None:
    """清空知识库全部图谱数据"""
    with _get_driver().session() as session:
        session.run(
            "MATCH (e:RagEntity) WHERE e.kb_id = $kb_id DETACH DELETE e",
            kb_id=kb_id,
        )
        session.run(
            "MATCH (d:RagDocument) WHERE d.kb_id = $kb_id DETACH DELETE d",
            kb_id=kb_id,
        )
        session.run(
            "MATCH (k:RagKnowledgeBase {kb_id: $kb_id}) DETACH DELETE k",
            kb_id=kb_id,
        )


def kb_graph_stats(kb_ids: Optional[List[int]] = None) -> Dict:
    """图谱统计: 实体数/关系数 (可按 kb 过滤)"""
    where = "WHERE e.kb_id IN $kb_ids" if kb_ids else ""
    rel_where = "WHERE r.kb_id IN $kb_ids" if kb_ids else ""
    with _get_driver().session() as session:
        entities = session.run(
            f"MATCH (e:RagEntity) {where} RETURN count(e) AS c", kb_ids=kb_ids or []
        ).single()["c"]
        rels = session.run(
            f"MATCH ()-[r:RAG_RELATES]->() {rel_where} RETURN count(r) AS c", kb_ids=kb_ids or []
        ).single()["c"]
    return {"entities": entities, "relations": rels}
