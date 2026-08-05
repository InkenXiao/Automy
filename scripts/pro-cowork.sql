-- ============================================================
-- pro-cowork 智能体平台新增表 (幂等, 可重复执行)
-- 共用 XIN 数据库: 仅增量添加 6 张表, 12 张业务表结构零变更
-- 执行: docker exec -i pg_db psql -U dbuser -d XIN < scripts/pro-cowork.sql
-- ============================================================

-- ---------- 智能体定义 ----------
CREATE TABLE IF NOT EXISTS agents (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    type          VARCHAR(32)  NOT NULL,           -- progress/meeting/weekly_report/work_plan/custom
    description   TEXT         DEFAULT '',
    system_prompt TEXT         DEFAULT '',
    config        JSONB        DEFAULT '{}',
    tools         JSONB        DEFAULT '[]',
    is_active     BOOLEAN      DEFAULT TRUE,
    created_at    TIMESTAMPTZ  DEFAULT now(),
    updated_at    TIMESTAMPTZ  DEFAULT now()
);
COMMENT ON TABLE  agents IS '智能体定义';
COMMENT ON COLUMN agents.type IS '类型: progress/meeting/weekly_report/work_plan/custom';
COMMENT ON COLUMN agents.tools IS '可用工具名列表 (JSON 数组)';

-- ---------- 智能体会话 ----------
CREATE TABLE IF NOT EXISTS agent_sessions (
    id         SERIAL PRIMARY KEY,
    agent_id   INTEGER      NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title      VARCHAR(256) DEFAULT '',
    status     VARCHAR(16)  DEFAULT 'active',      -- active/archived
    created_at TIMESTAMPTZ  DEFAULT now(),
    updated_at TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_agent_sessions_agent_id ON agent_sessions(agent_id);
COMMENT ON TABLE agent_sessions IS '智能体会话';

-- ---------- 智能体消息 ----------
CREATE TABLE IF NOT EXISTS agent_messages (
    id           SERIAL PRIMARY KEY,
    session_id   INTEGER     NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    role         VARCHAR(16) NOT NULL,             -- user/assistant/system/tool
    content      TEXT        DEFAULT '',
    tool_calls   JSONB,
    tool_results JSONB,
    tokens_used  INTEGER     DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_agent_messages_session_id ON agent_messages(session_id);
COMMENT ON TABLE agent_messages IS '智能体对话消息';

-- ---------- 智能体记忆 ----------
CREATE TABLE IF NOT EXISTS agent_memories (
    id          SERIAL PRIMARY KEY,
    agent_id    INTEGER      NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    session_id  INTEGER      REFERENCES agent_sessions(id) ON DELETE SET NULL,
    memory_type VARCHAR(32)  NOT NULL,             -- fact/preference/context/decision
    key         VARCHAR(128) DEFAULT '',
    content     TEXT         NOT NULL,
    extra_data  JSONB        DEFAULT '{}',
    created_at  TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_agent_memories_agent_id ON agent_memories(agent_id);
COMMENT ON TABLE agent_memories IS '智能体长期记忆';

-- ---------- 技能定义 ----------
CREATE TABLE IF NOT EXISTS skills (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    description  TEXT         DEFAULT '',
    category     VARCHAR(32)  DEFAULT '',          -- data/api/workflow/notification
    trigger_type VARCHAR(32)  DEFAULT 'manual',    -- manual/scheduled/event
    config       JSONB        DEFAULT '{}',
    code         TEXT         DEFAULT '',          -- JSON 工作流: {"steps": [{"tool", "arguments"}]}
    is_active    BOOLEAN      DEFAULT TRUE,
    created_at   TIMESTAMPTZ  DEFAULT now(),
    updated_at   TIMESTAMPTZ  DEFAULT now()
);
COMMENT ON TABLE skills IS '技能定义 (JSON 工作流工具链)';

-- ---------- 技能执行记录 ----------
CREATE TABLE IF NOT EXISTS skill_executions (
    id          SERIAL PRIMARY KEY,
    skill_id    INTEGER     NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    session_id  INTEGER     REFERENCES agent_sessions(id) ON DELETE SET NULL,
    input_data  JSONB       DEFAULT '{}',
    output_data JSONB       DEFAULT '{}',
    status      VARCHAR(16) DEFAULT 'pending',     -- pending/running/success/failed
    error       TEXT        DEFAULT '',
    duration_ms INTEGER     DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_skill_executions_skill_id ON skill_executions(skill_id);
COMMENT ON TABLE skill_executions IS '技能执行记录 (可追溯)';
