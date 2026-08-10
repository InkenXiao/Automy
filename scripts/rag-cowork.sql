-- ============================================================
-- rag-cowork 知识库平台表结构 (幂等, 可重复执行)
-- 共用 XIN 数据库: 12 张 rag_ 表 + sys_users (三系统共享, 若已存在则跳过)
--   知识库:     rag_knowledge_bases / rag_kb_permissions / rag_doc_permissions (文档级授权)
--   文档:       rag_documents / rag_chunks / rag_multimodal_resources
--   图谱:       rag_entities / rag_relations
--   同步台账:   rag_sync_events / rag_parse_tasks / rag_query_logs
--   Obsidian:   rag_obsidian_configs
-- 说明: 本文件与 rag-cowork ORM 元数据 (app/models/*.py) 保持一致 (表与字段注释见 db_comments.sql)
-- 执行: docker exec -i pg_db psql -U dbuser -d XIN < scripts/rag-cowork.sql
-- ============================================================

-- ---------- 共享用户表 (三系统共用, 幂等) ----------
CREATE TABLE IF NOT EXISTS sys_users (
	user_id BIGINT NOT NULL,
	name VARCHAR(64) NOT NULL,
	password_hash VARCHAR(256) DEFAULT '' NOT NULL,
	display_name VARCHAR(64) DEFAULT '' NOT NULL,
	department VARCHAR(64) DEFAULT '' NOT NULL,
	is_active BOOLEAN DEFAULT true NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_sys_users_name ON sys_users (name);
CREATE INDEX IF NOT EXISTS ix_sys_users_department ON sys_users (department);

-- ---------- 知识库 ----------
CREATE TABLE IF NOT EXISTS rag_knowledge_bases (
	kb_id BIGINT NOT NULL,
	name VARCHAR(256) NOT NULL,
	level VARCHAR(20) NOT NULL,
	description TEXT DEFAULT '' NOT NULL,
	owner_user_id BIGINT NOT NULL,
	project_id INTEGER,
	department VARCHAR(64) DEFAULT '' NOT NULL,
	user_id BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (kb_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_knowledge_bases_name ON rag_knowledge_bases (name);
CREATE INDEX IF NOT EXISTS ix_rag_knowledge_bases_level ON rag_knowledge_bases (level);
CREATE INDEX IF NOT EXISTS ix_rag_knowledge_bases_owner_user_id ON rag_knowledge_bases (owner_user_id);
CREATE INDEX IF NOT EXISTS ix_rag_knowledge_bases_project_id ON rag_knowledge_bases (project_id);
CREATE INDEX IF NOT EXISTS ix_rag_knowledge_bases_user_id ON rag_knowledge_bases (user_id);

-- ---------- 知识库级权限 ----------
CREATE TABLE IF NOT EXISTS rag_kb_permissions (
	id BIGINT NOT NULL,
	kb_id BIGINT NOT NULL,
	user_id BIGINT NOT NULL,
	perm VARCHAR(16) DEFAULT 'read' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_rag_kb_permissions_kb_id ON rag_kb_permissions (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_kb_permissions_user_id ON rag_kb_permissions (user_id);

-- ---------- 文档级权限 (新增: 单篇文档单独授权) ----------
CREATE TABLE IF NOT EXISTS rag_doc_permissions (
	id BIGINT NOT NULL,
	doc_id BIGINT NOT NULL,
	user_id BIGINT NOT NULL,
	perm VARCHAR(16) DEFAULT 'read',
	created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
	is_delete BOOLEAN DEFAULT false,
	PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_doc_perm_doc_id ON rag_doc_permissions (doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_perm_user_id ON rag_doc_permissions (user_id);
CREATE INDEX IF NOT EXISTS idx_doc_perm_is_delete ON rag_doc_permissions (is_delete);

-- ---------- 知识库文档 ----------
CREATE TABLE IF NOT EXISTS rag_documents (
	doc_id BIGINT NOT NULL,
	kb_id BIGINT NOT NULL,
	file_name VARCHAR(512) NOT NULL,
	file_ext VARCHAR(16) DEFAULT '' NOT NULL,
	file_size BIGINT DEFAULT 0 NOT NULL,
	file_hash VARCHAR(64) DEFAULT '' NOT NULL,
	minio_bucket VARCHAR(64) DEFAULT '' NOT NULL,
	minio_path VARCHAR(1024) DEFAULT '' NOT NULL,
	parse_status VARCHAR(20) DEFAULT 'pending' NOT NULL,
	parser_type VARCHAR(50) DEFAULT '' NOT NULL,
	total_chunks INTEGER DEFAULT 0 NOT NULL,
	total_images INTEGER DEFAULT 0 NOT NULL,
	total_tables INTEGER DEFAULT 0 NOT NULL,
	error_msg TEXT DEFAULT '' NOT NULL,
	user_id BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (doc_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_documents_kb_id ON rag_documents (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_documents_file_hash ON rag_documents (file_hash);
CREATE INDEX IF NOT EXISTS ix_rag_documents_parse_status ON rag_documents (parse_status);
CREATE INDEX IF NOT EXISTS ix_rag_documents_user_id ON rag_documents (user_id);

-- ---------- 文档分块 ----------
CREATE TABLE IF NOT EXISTS rag_chunks (
	chunk_id BIGINT NOT NULL,
	doc_id BIGINT NOT NULL,
	kb_id BIGINT NOT NULL,
	chunk_index INTEGER NOT NULL,
	content TEXT NOT NULL,
	page_number INTEGER NOT NULL,
	chunk_type VARCHAR(20) DEFAULT 'text' NOT NULL,
	milvus_id BIGINT,
	user_id BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (chunk_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_chunks_doc_id ON rag_chunks (doc_id);
CREATE INDEX IF NOT EXISTS ix_rag_chunks_kb_id ON rag_chunks (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_chunks_user_id ON rag_chunks (user_id);

-- ---------- 多模态资源 ----------
CREATE TABLE IF NOT EXISTS rag_multimodal_resources (
	resource_id BIGINT NOT NULL,
	doc_id BIGINT NOT NULL,
	kb_id BIGINT NOT NULL,
	chunk_id BIGINT,
	resource_type VARCHAR(20) NOT NULL,
	resource_index INTEGER NOT NULL,
	minio_path VARCHAR(1024) DEFAULT '' NOT NULL,
	content_desc TEXT DEFAULT '' NOT NULL,
	milvus_id BIGINT,
	user_id BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (resource_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_multimodal_resources_doc_id ON rag_multimodal_resources (doc_id);
CREATE INDEX IF NOT EXISTS ix_rag_multimodal_resources_kb_id ON rag_multimodal_resources (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_multimodal_resources_user_id ON rag_multimodal_resources (user_id);

-- ---------- 知识图谱实体 ----------
CREATE TABLE IF NOT EXISTS rag_entities (
	entity_id BIGINT NOT NULL,
	kb_id BIGINT NOT NULL,
	doc_id BIGINT NOT NULL,
	entity_name VARCHAR(512) NOT NULL,
	entity_type VARCHAR(100) DEFAULT 'UNKNOWN' NOT NULL,
	description TEXT DEFAULT '' NOT NULL,
	weight DOUBLE PRECISION DEFAULT 1 NOT NULL,
	neo4j_node_id VARCHAR(64) DEFAULT '' NOT NULL,
	milvus_id BIGINT,
	user_id BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (entity_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_entities_kb_id ON rag_entities (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_entities_doc_id ON rag_entities (doc_id);
CREATE INDEX IF NOT EXISTS ix_rag_entities_entity_name ON rag_entities (entity_name);
CREATE INDEX IF NOT EXISTS ix_rag_entities_user_id ON rag_entities (user_id);

-- ---------- 知识图谱关系 ----------
CREATE TABLE IF NOT EXISTS rag_relations (
	relation_id BIGINT NOT NULL,
	kb_id BIGINT NOT NULL,
	doc_id BIGINT NOT NULL,
	src_entity_id BIGINT NOT NULL,
	tgt_entity_id BIGINT NOT NULL,
	relation_type VARCHAR(100) DEFAULT 'RELATED' NOT NULL,
	description TEXT DEFAULT '' NOT NULL,
	keywords VARCHAR(512) DEFAULT '' NOT NULL,
	neo4j_edge_id VARCHAR(64) DEFAULT '' NOT NULL,
	user_id BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (relation_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_relations_kb_id ON rag_relations (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_relations_doc_id ON rag_relations (doc_id);
CREATE INDEX IF NOT EXISTS ix_rag_relations_src_entity_id ON rag_relations (src_entity_id);
CREATE INDEX IF NOT EXISTS ix_rag_relations_tgt_entity_id ON rag_relations (tgt_entity_id);
CREATE INDEX IF NOT EXISTS ix_rag_relations_user_id ON rag_relations (user_id);

-- ---------- 同步事件台账 ----------
CREATE TABLE IF NOT EXISTS rag_sync_events (
	event_id BIGINT NOT NULL,
	action VARCHAR(20) DEFAULT 'insert' NOT NULL,
	target_type VARCHAR(20) NOT NULL,
	target_id BIGINT DEFAULT 0 NOT NULL,
	doc_id BIGINT DEFAULT 0 NOT NULL,
	kb_id BIGINT DEFAULT 0 NOT NULL,
	payload JSONB DEFAULT '{}' NOT NULL,
	status VARCHAR(20) DEFAULT 'pending' NOT NULL,
	retry_count INTEGER DEFAULT 0 NOT NULL,
	error_msg TEXT DEFAULT '' NOT NULL,
	user_id BIGINT DEFAULT 0 NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (event_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_sync_events_doc_id ON rag_sync_events (doc_id);
CREATE INDEX IF NOT EXISTS ix_rag_sync_events_kb_id ON rag_sync_events (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_sync_events_status ON rag_sync_events (status);

-- ---------- 文档解析任务 ----------
CREATE TABLE IF NOT EXISTS rag_parse_tasks (
	task_id BIGINT NOT NULL,
	doc_id BIGINT NOT NULL,
	kb_id BIGINT NOT NULL,
	stage VARCHAR(20) DEFAULT 'parse' NOT NULL,
	status VARCHAR(20) DEFAULT 'running' NOT NULL,
	progress INTEGER DEFAULT 0 NOT NULL,
	error_msg TEXT DEFAULT '' NOT NULL,
	user_id BIGINT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (task_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_parse_tasks_doc_id ON rag_parse_tasks (doc_id);
CREATE INDEX IF NOT EXISTS ix_rag_parse_tasks_kb_id ON rag_parse_tasks (kb_id);
CREATE INDEX IF NOT EXISTS ix_rag_parse_tasks_status ON rag_parse_tasks (status);
CREATE INDEX IF NOT EXISTS ix_rag_parse_tasks_user_id ON rag_parse_tasks (user_id);

-- ---------- RAG 检索日志 ----------
CREATE TABLE IF NOT EXISTS rag_query_logs (
	log_id BIGINT NOT NULL,
	user_id BIGINT NOT NULL,
	kb_ids JSONB DEFAULT '[]' NOT NULL,
	query TEXT NOT NULL,
	mode VARCHAR(20) DEFAULT 'hybrid' NOT NULL,
	answer_excerpt TEXT DEFAULT '' NOT NULL,
	hit_count INTEGER DEFAULT 0 NOT NULL,
	latency_ms INTEGER DEFAULT 0 NOT NULL,
	agent_id BIGINT DEFAULT 0,
	skill_id BIGINT DEFAULT 0,
	sources JSONB DEFAULT '[]',
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (log_id)
);
CREATE INDEX IF NOT EXISTS ix_rag_query_logs_user_id ON rag_query_logs (user_id);

-- 老库迁移: rag_query_logs 新增智能体/技能/来源字段 (幂等)
ALTER TABLE rag_query_logs ADD COLUMN IF NOT EXISTS agent_id BIGINT DEFAULT 0;
ALTER TABLE rag_query_logs ADD COLUMN IF NOT EXISTS skill_id BIGINT DEFAULT 0;
ALTER TABLE rag_query_logs ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]';

-- ---------- Obsidian 连接配置 ----------
CREATE TABLE IF NOT EXISTS rag_obsidian_configs (
	id BIGINT NOT NULL,
	user_id BIGINT NOT NULL,
	kb_id BIGINT DEFAULT 0 NOT NULL,
	host VARCHAR(512) DEFAULT '' NOT NULL,
	api_key VARCHAR(256) DEFAULT '' NOT NULL,
	base_path VARCHAR(512) DEFAULT '' NOT NULL,
	auto_parse BOOLEAN DEFAULT true NOT NULL,
	last_sync_at TIMESTAMP WITH TIME ZONE,
	last_sync_info VARCHAR(512) DEFAULT '' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	is_delete BOOLEAN DEFAULT false NOT NULL,
	PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_rag_obsidian_configs_user_id ON rag_obsidian_configs (user_id);
