-- ============================================================
-- pro-cowork 智能体平台新增表 (幂等, 可重复执行)
-- 共用 XIN 数据库: 增量 16 张表, 12 张 pro-site 业务表结构零变更 (见 pro-site.sql)
--   智能体平台: agents / agent_sessions / agent_messages / agent_memories
--              skills / skill_executions / task_runs / task_run_events
--   协同扩展:   pro_project_members / pro_personal_reports (+工作内容/下周计划 2 子表)
--   认证日志:   sys_user_credentials / sys_login_logs / sys_operation_logs
--   文件登记:   sys_files (MinIO 对象登记, 各应用共享)
-- 说明: 本文件由 pro-cowork ORM 元数据自动生成 (表与字段注释见 db_comments.sql)
-- 执行: docker exec -i pg_db psql -U dbuser -d XIN < scripts/pro-cowork.sql
-- ============================================================

-- ---------- 智能体定义 ----------
CREATE TABLE IF NOT EXISTS agents (
	id SERIAL NOT NULL, 
	name VARCHAR(128) NOT NULL, 
	type VARCHAR(32) NOT NULL, 
	description TEXT NOT NULL, 
	system_prompt TEXT NOT NULL, 
	config JSONB DEFAULT '{}' NOT NULL, 
	tools JSONB DEFAULT '[]' NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id)
);

-- ---------- 技能定义 ----------
CREATE TABLE IF NOT EXISTS skills (
	id SERIAL NOT NULL, 
	name VARCHAR(128) NOT NULL, 
	description TEXT NOT NULL, 
	category VARCHAR(32) NOT NULL, 
	trigger_type VARCHAR(32) NOT NULL, 
	config JSONB DEFAULT '{}' NOT NULL, 
	code TEXT NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id)
);

-- ---------- MinIO 文件登记 ----------
CREATE TABLE IF NOT EXISTS sys_files (
	id SERIAL NOT NULL, 
	file_name VARCHAR(256) NOT NULL, 
	file_type VARCHAR(32) NOT NULL, 
	file_size BIGINT NOT NULL, 
	app VARCHAR(32) NOT NULL, 
	object_name VARCHAR(128) NOT NULL, 
	member_name VARCHAR(64) NOT NULL, 
	bucket VARCHAR(64) NOT NULL, 
	object_key VARCHAR(512) NOT NULL, 
	content_type VARCHAR(128) NOT NULL, 
	kb_indexed BOOLEAN DEFAULT 'false' NOT NULL, 
	uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_sys_files_bucket_key UNIQUE (bucket, object_key)
);

CREATE INDEX IF NOT EXISTS ix_sys_files_app ON sys_files (app);

CREATE INDEX IF NOT EXISTS ix_sys_files_file_type ON sys_files (file_type);

CREATE INDEX IF NOT EXISTS ix_sys_files_object_name ON sys_files (object_name);

-- ---------- 登录日志 ----------
CREATE TABLE IF NOT EXISTS sys_login_logs (
	id SERIAL NOT NULL, 
	user_name VARCHAR(64) NOT NULL, 
	is_valid BOOLEAN NOT NULL, 
	ip VARCHAR(64) NOT NULL, 
	user_agent VARCHAR(256) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_sys_login_logs_user_name ON sys_login_logs (user_name);

-- ---------- 操作日志 ----------
CREATE TABLE IF NOT EXISTS sys_operation_logs (
	id SERIAL NOT NULL, 
	user_name VARCHAR(64) NOT NULL, 
	method VARCHAR(8) NOT NULL, 
	path VARCHAR(256) NOT NULL, 
	entity_type VARCHAR(32) NOT NULL, 
	entity_id INTEGER, 
	action VARCHAR(16) NOT NULL, 
	detail TEXT NOT NULL, 
	tokens INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS ix_sys_operation_logs_action ON sys_operation_logs (action);

CREATE INDEX IF NOT EXISTS ix_sys_operation_logs_entity_type ON sys_operation_logs (entity_type);

CREATE INDEX IF NOT EXISTS ix_sys_operation_logs_user_name ON sys_operation_logs (user_name);

-- ---------- 成员登录凭据 ----------
CREATE TABLE IF NOT EXISTS sys_user_credentials (
	id SERIAL NOT NULL, 
	name VARCHAR(64) NOT NULL, 
	password_hash VARCHAR(256) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_sys_user_credentials_name ON sys_user_credentials (name);

-- ---------- 智能体会话 ----------
CREATE TABLE IF NOT EXISTS agent_sessions (
	id SERIAL NOT NULL, 
	agent_id INTEGER NOT NULL, 
	title VARCHAR(256) NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(agent_id) REFERENCES agents (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_agent_sessions_agent_id ON agent_sessions (agent_id);

-- ---------- 个人周报主表 ----------
CREATE TABLE IF NOT EXISTS pro_personal_reports (
	id SERIAL NOT NULL, 
	project_id INTEGER NOT NULL, 
	member_name VARCHAR(64) NOT NULL, 
	week_start DATE NOT NULL, 
	week_end DATE NOT NULL, 
	summary TEXT DEFAULT '' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES pro_projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_pro_personal_reports_member_name ON pro_personal_reports (member_name);

CREATE INDEX IF NOT EXISTS ix_pro_personal_reports_project_id ON pro_personal_reports (project_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_preport_proj_member_week ON pro_personal_reports (project_id, member_name, week_start) WHERE is_delete = false;

-- ---------- 项目成员 ----------
CREATE TABLE IF NOT EXISTS pro_project_members (
	id SERIAL NOT NULL, 
	project_id INTEGER NOT NULL, 
	name VARCHAR(64) NOT NULL, 
	role VARCHAR(64) NOT NULL, 
	join_date DATE, 
	status VARCHAR(16) NOT NULL, 
	sort_order INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES pro_projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_pro_project_members_project_id ON pro_project_members (project_id);

-- ---------- 智能体记忆 ----------
CREATE TABLE IF NOT EXISTS agent_memories (
	id SERIAL NOT NULL, 
	agent_id INTEGER NOT NULL, 
	project_id INTEGER, 
	session_id INTEGER, 
	memory_type VARCHAR(32) NOT NULL, 
	key VARCHAR(128) NOT NULL, 
	content TEXT NOT NULL, 
	extra_data JSONB DEFAULT '{}' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(agent_id) REFERENCES agents (id) ON DELETE CASCADE, 
	FOREIGN KEY(project_id) REFERENCES pro_projects (id) ON DELETE SET NULL, 
	FOREIGN KEY(session_id) REFERENCES agent_sessions (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_agent_memories_agent_id ON agent_memories (agent_id);

-- ---------- 智能体消息 ----------
CREATE TABLE IF NOT EXISTS agent_messages (
	id SERIAL NOT NULL, 
	session_id INTEGER NOT NULL, 
	role VARCHAR(16) NOT NULL, 
	content TEXT NOT NULL, 
	tool_calls JSONB, 
	tool_results JSONB, 
	tokens_used INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(session_id) REFERENCES agent_sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_agent_messages_session_id ON agent_messages (session_id);

-- ---------- 个人周报下周计划 ----------
CREATE TABLE IF NOT EXISTS pro_personal_report_plan_items (
	id SERIAL NOT NULL, 
	report_id INTEGER NOT NULL, 
	project_id INTEGER, 
	content TEXT NOT NULL, 
	sort_order INTEGER NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(report_id) REFERENCES pro_personal_reports (id) ON DELETE CASCADE, 
	FOREIGN KEY(project_id) REFERENCES pro_projects (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_pro_personal_report_plan_items_report_id ON pro_personal_report_plan_items (report_id);

-- ---------- 个人周报工作内容 ----------
CREATE TABLE IF NOT EXISTS pro_personal_report_work_items (
	id SERIAL NOT NULL, 
	report_id INTEGER NOT NULL, 
	project_id INTEGER, 
	day_of_week INTEGER NOT NULL, 
	content TEXT NOT NULL, 
	participants VARCHAR(256) NOT NULL, 
	deliverable VARCHAR(256) NOT NULL, 
	hours FLOAT NOT NULL, 
	sort_order INTEGER NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(report_id) REFERENCES pro_personal_reports (id) ON DELETE CASCADE, 
	FOREIGN KEY(project_id) REFERENCES pro_projects (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_pro_personal_report_work_items_report_id ON pro_personal_report_work_items (report_id);

-- ---------- 技能执行记录 ----------
CREATE TABLE IF NOT EXISTS skill_executions (
	id SERIAL NOT NULL, 
	skill_id INTEGER NOT NULL, 
	session_id INTEGER, 
	input_data JSONB DEFAULT '{}' NOT NULL, 
	output_data JSONB DEFAULT '{}' NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	error TEXT NOT NULL, 
	duration_ms INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(skill_id) REFERENCES skills (id) ON DELETE CASCADE, 
	FOREIGN KEY(session_id) REFERENCES agent_sessions (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_skill_executions_skill_id ON skill_executions (skill_id);

-- ---------- 工作台任务 ----------
CREATE TABLE IF NOT EXISTS task_runs (
	id SERIAL NOT NULL, 
	project_id INTEGER, 
	agent_id INTEGER, 
	title VARCHAR(256) NOT NULL, 
	input_text TEXT NOT NULL, 
	skill_ids JSONB DEFAULT '[]' NOT NULL, 
	file_names JSONB DEFAULT '[]' NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	user_name VARCHAR(64) NOT NULL, 
	result_text TEXT NOT NULL, 
	session_id INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES pro_projects (id) ON DELETE SET NULL, 
	FOREIGN KEY(agent_id) REFERENCES agents (id) ON DELETE CASCADE, 
	FOREIGN KEY(session_id) REFERENCES agent_sessions (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_task_runs_user_name ON task_runs (user_name);

-- ---------- 任务执行事件 ----------
CREATE TABLE IF NOT EXISTS task_run_events (
	id SERIAL NOT NULL, 
	run_id INTEGER NOT NULL, 
	seq INTEGER NOT NULL, 
	type VARCHAR(16) NOT NULL, 
	name VARCHAR(64) NOT NULL, 
	payload JSONB DEFAULT '{}' NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	is_delete BOOLEAN DEFAULT 'false' NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(run_id) REFERENCES task_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_task_run_events_run_id ON task_run_events (run_id);
