-- ============================================================
-- abs-site 数据库完整脚本 (艾宾浩斯背单词)
-- 数据库: PostgreSQL, 数据库名: XIN
--
-- 包含: 建表 + 索引 + 外键 + 备注
-- 特点: 幂等可重复执行 (IF NOT EXISTS)
--
-- 执行方式:
--   docker exec -i pg_db psql -U dbuser -d XIN < scripts/abs-site.sql
--   或: psql -h localhost -p 11000 -U dbuser -d XIN -f scripts/abs-site.sql
-- ============================================================

-- ============================================================
-- 1. 建表 (按外键依赖顺序)
-- ============================================================

-- ---------- vocab_units 单词单元 ----------
CREATE TABLE IF NOT EXISTS vocab_units (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    description TEXT         DEFAULT '',
    sort_order  INTEGER      DEFAULT 0,
    created_at  TIMESTAMP    DEFAULT NOW(),
    is_delete   BOOLEAN      DEFAULT FALSE
);
COMMENT ON TABLE  vocab_units IS '单词单元 (词书分册)';
COMMENT ON COLUMN vocab_units.id IS '主键ID, 自增';
COMMENT ON COLUMN vocab_units.name IS '单元名称';
COMMENT ON COLUMN vocab_units.description IS '单元描述';
COMMENT ON COLUMN vocab_units.sort_order IS '排序序号';
COMMENT ON COLUMN vocab_units.created_at IS '记录创建时间';
COMMENT ON COLUMN vocab_units.is_delete IS '是否已软删除';

-- ---------- vocab_words 单词 ----------
CREATE TABLE IF NOT EXISTS vocab_words (
    id                 SERIAL PRIMARY KEY,
    english            VARCHAR(256) NOT NULL,
    phonetic           VARCHAR(128) DEFAULT '',
    definition         TEXT         NOT NULL,
    example            TEXT         DEFAULT '',
    unit_id            INTEGER,
    sort_order         INTEGER      DEFAULT 0,
    status             VARCHAR(20)  DEFAULT 'new',
    consecutive_passes INTEGER      DEFAULT 0,
    learned_at         TIMESTAMP,
    created_at         TIMESTAMP    DEFAULT NOW(),
    is_delete          BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_vocab_words_unit FOREIGN KEY (unit_id) REFERENCES vocab_units(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_vocab_words_english ON vocab_words(english);
CREATE INDEX IF NOT EXISTS idx_vocab_words_unit_id ON vocab_words(unit_id);
COMMENT ON TABLE  vocab_words IS '单词表 (艾宾浩斯背单词)';
COMMENT ON COLUMN vocab_words.id IS '主键ID, 自增';
COMMENT ON COLUMN vocab_words.english IS '英文单词 (建索引)';
COMMENT ON COLUMN vocab_words.phonetic IS '音标';
COMMENT ON COLUMN vocab_words.definition IS '核心释义 (1-2条)';
COMMENT ON COLUMN vocab_words.example IS '例句';
COMMENT ON COLUMN vocab_words.unit_id IS '所属单元ID, 关联 vocab_units.id (可空, 建索引)';
COMMENT ON COLUMN vocab_words.sort_order IS '单元内排序序号';
COMMENT ON COLUMN vocab_words.status IS '学习状态: new(新词)/learning(学习中)/mastered(已掌握)';
COMMENT ON COLUMN vocab_words.consecutive_passes IS '连续答对次数 (用于决定下次复习难度)';
COMMENT ON COLUMN vocab_words.learned_at IS '首次学习时间';
COMMENT ON COLUMN vocab_words.created_at IS '记录创建时间';
COMMENT ON COLUMN vocab_words.is_delete IS '是否已软删除';

-- ---------- vocab_review_schedules 复习计划 ----------
CREATE TABLE IF NOT EXISTS vocab_review_schedules (
    id              SERIAL PRIMARY KEY,
    word_id         INTEGER     NOT NULL,
    unit_id         INTEGER,
    interval_index  INTEGER     NOT NULL,
    scheduled_at    TIMESTAMP   NOT NULL,
    completed_at    TIMESTAMP,
    mark            VARCHAR(20),
    status          VARCHAR(20) DEFAULT 'pending',
    created_at      TIMESTAMP   DEFAULT NOW(),
    is_delete       BOOLEAN     DEFAULT FALSE,
    CONSTRAINT fk_vocab_review_schedules_word FOREIGN KEY (word_id) REFERENCES vocab_words(id) ON DELETE CASCADE,
    CONSTRAINT fk_vocab_review_schedules_unit FOREIGN KEY (unit_id) REFERENCES vocab_units(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_vocab_review_schedules_word_id ON vocab_review_schedules(word_id);
CREATE INDEX IF NOT EXISTS idx_vocab_review_schedules_unit_id ON vocab_review_schedules(unit_id);
CREATE INDEX IF NOT EXISTS idx_vocab_review_schedules_status  ON vocab_review_schedules(status);
COMMENT ON TABLE  vocab_review_schedules IS '复习计划 (艾宾浩斯遗忘曲线 8 个间隔点)';
COMMENT ON COLUMN vocab_review_schedules.id IS '主键ID, 自增';
COMMENT ON COLUMN vocab_review_schedules.word_id IS '单词ID, 关联 vocab_words.id (建索引)';
COMMENT ON COLUMN vocab_review_schedules.unit_id IS '单元ID, 关联 vocab_units.id (可空, 建索引)';
COMMENT ON COLUMN vocab_review_schedules.interval_index IS '间隔点索引 0-7, 对应艾宾浩斯 8 个复习间隔';
COMMENT ON COLUMN vocab_review_schedules.scheduled_at IS '计划到期复习时间';
COMMENT ON COLUMN vocab_review_schedules.completed_at IS '实际完成复习时间 (未完成为空)';
COMMENT ON COLUMN vocab_review_schedules.mark IS '复习结果: pass(通过)/struggle(困难)/fail(失败)';
COMMENT ON COLUMN vocab_review_schedules.status IS '复习状态: pending(待复习)/done(已完成)/skipped(已跳过)';
COMMENT ON COLUMN vocab_review_schedules.created_at IS '记录创建时间';
COMMENT ON COLUMN vocab_review_schedules.is_delete IS '是否已软删除';

-- ============================================================
-- 脚本执行完成
-- 表清单: vocab_units / vocab_words / vocab_review_schedules
--
-- 说明: abs-site 无预置字典数据, 单词与单元由用户通过界面导入
-- ============================================================
