-- ============================================================
-- pro-site 数据库完整脚本 (项目管理工作台)
-- 数据库: PostgreSQL, 数据库名: XIN
--
-- 包含: 建表 + 索引 + 外键 + 备注 + 初始字典数据
-- 特点: 幂等可重复执行 (IF NOT EXISTS / ON CONFLICT)
--
-- 执行方式:
--   docker exec -i pg_db psql -U dbuser -d XIN < scripts/pro-site.sql
--   或: psql -h localhost -p 11000 -U dbuser -d XIN -f scripts/pro-site.sql
-- ============================================================

-- ============================================================
-- 1. 建表 (按外键依赖顺序)
-- ============================================================

-- ---------- pro_projects 项目元信息 ----------
CREATE TABLE IF NOT EXISTS pro_projects (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(64)  NOT NULL,
    title       VARCHAR(256) NOT NULL,
    based_doc   VARCHAR(256) DEFAULT '',
    start_date  DATE,
    end_date    DATE,
    is_active   BOOLEAN      DEFAULT FALSE,
    sort_order  INTEGER      DEFAULT 0,
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW(),
    is_delete   BOOLEAN      DEFAULT FALSE,
    manager     VARCHAR(64)  DEFAULT '' NOT NULL,
    status      VARCHAR(16)  DEFAULT '进行中' NOT NULL
);
COMMENT ON TABLE  pro_projects IS '项目元信息 (一个项目对应一张进度计划执行图, 多项目隔离)';
COMMENT ON COLUMN pro_projects.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_projects.name IS '项目名称, 如 信投AI2.0';
COMMENT ON COLUMN pro_projects.title IS '执行图标题';
COMMENT ON COLUMN pro_projects.based_doc IS '基于文档';
COMMENT ON COLUMN pro_projects.start_date IS '项目开始日期';
COMMENT ON COLUMN pro_projects.end_date IS '项目结束日期';
COMMENT ON COLUMN pro_projects.is_active IS '是否为当前激活项目 (业务接口默认用激活项目)';
COMMENT ON COLUMN pro_projects.sort_order IS '排序序号';
COMMENT ON COLUMN pro_projects.created_at IS '记录创建时间';
COMMENT ON COLUMN pro_projects.updated_at IS '记录更新时间';
COMMENT ON COLUMN pro_projects.is_delete IS '是否已软删除';
COMMENT ON COLUMN pro_projects.manager IS '项目经理';
COMMENT ON COLUMN pro_projects.status IS '项目状态: 进行中/已停止/已完成';

-- ---------- pro_modules 项目模块字典 ----------
CREATE TABLE IF NOT EXISTS pro_modules (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER      NOT NULL,
    idx         VARCHAR(4)   NOT NULL,
    tag         VARCHAR(16)  NOT NULL,
    title       VARCHAR(128) NOT NULL,
    owner       VARCHAR(64)  DEFAULT '',
    color       VARCHAR(16)  DEFAULT '#FF8C00',
    color_bg    VARCHAR(16)  DEFAULT '#FFF3E0',
    sort_order  INTEGER      DEFAULT 0,
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW(),
    is_delete   BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_modules_project FOREIGN KEY (project_id) REFERENCES pro_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_modules_project_id ON pro_modules(project_id);
COMMENT ON TABLE  pro_modules IS '项目模块字典 (底座/数据/智能体/应用/需求/协调, 按项目隔离)';
COMMENT ON COLUMN pro_modules.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_modules.project_id IS '★所属项目ID, 关联 pro_projects.id';
COMMENT ON COLUMN pro_modules.idx IS '模块编号, 如 01/02';
COMMENT ON COLUMN pro_modules.tag IS '模块标签, 如 底座/数据/智能体/应用/需求/协调';
COMMENT ON COLUMN pro_modules.title IS '模块名称';
COMMENT ON COLUMN pro_modules.owner IS '模块负责人';
COMMENT ON COLUMN pro_modules.color IS '模块主题色 (HEX)';
COMMENT ON COLUMN pro_modules.color_bg IS '模块背景色 (HEX)';
COMMENT ON COLUMN pro_modules.sort_order IS '排序序号';
COMMENT ON COLUMN pro_modules.is_delete IS '是否已软删除';

-- ---------- pro_phases 项目阶段字典 ----------
CREATE TABLE IF NOT EXISTS pro_phases (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER      NOT NULL,
    name        VARCHAR(32)  NOT NULL,
    subtitle    VARCHAR(32)  DEFAULT '',
    description TEXT         DEFAULT '',
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW(),
    is_delete   BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_phases_project FOREIGN KEY (project_id) REFERENCES pro_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_phases_project_id ON pro_phases(project_id);
COMMENT ON TABLE  pro_phases IS '项目阶段字典 (第一阶段/第二阶段/第三阶段, 按项目隔离)';
COMMENT ON COLUMN pro_phases.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_phases.project_id IS '★所属项目ID, 关联 pro_projects.id';
COMMENT ON COLUMN pro_phases.name IS '阶段名称';
COMMENT ON COLUMN pro_phases.subtitle IS '阶段副标题, 如 有得用/用起来/用得好';
COMMENT ON COLUMN pro_phases.description IS '阶段描述';
COMMENT ON COLUMN pro_phases.start_date IS '阶段开始日期';
COMMENT ON COLUMN pro_phases.end_date IS '阶段结束日期';
COMMENT ON COLUMN pro_phases.is_delete IS '是否已软删除';

-- ---------- pro_progress_tasks 项目进度计划任务 ----------
CREATE TABLE IF NOT EXISTS pro_progress_tasks (
    id            SERIAL PRIMARY KEY,
    project_id    INTEGER      NOT NULL,
    task_uid      VARCHAR(16)  UNIQUE,
    name          VARCHAR(256) NOT NULL,
    phase_id      INTEGER,
    start_date    DATE,
    end_date      DATE,
    status        VARCHAR(16)  DEFAULT 'planned',
    full_desc     TEXT         DEFAULT '',
    owner         VARCHAR(64)  DEFAULT '',
    is_milestone  BOOLEAN      DEFAULT FALSE,
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW(),
    is_delete     BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_progress_tasks_project FOREIGN KEY (project_id) REFERENCES pro_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_progress_tasks_phase   FOREIGN KEY (phase_id)   REFERENCES pro_phases(id)
);
CREATE INDEX IF NOT EXISTS idx_progress_tasks_project_id ON pro_progress_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_tasks_phase_id   ON pro_progress_tasks(phase_id);
COMMENT ON TABLE  pro_progress_tasks IS '项目进度计划任务 (执行图任务节点, 按项目隔离)';
COMMENT ON COLUMN pro_progress_tasks.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_progress_tasks.project_id IS '★所属项目ID, 关联 pro_projects.id';
COMMENT ON COLUMN pro_progress_tasks.task_uid IS '任务唯一编号, 如 1-1/M1';
COMMENT ON COLUMN pro_progress_tasks.name IS '任务名称';
COMMENT ON COLUMN pro_progress_tasks.phase_id IS '所属阶段ID, 关联 pro_phases.id (可空)';
COMMENT ON COLUMN pro_progress_tasks.start_date IS '计划开始日期';
COMMENT ON COLUMN pro_progress_tasks.end_date IS '计划结束日期';
COMMENT ON COLUMN pro_progress_tasks.status IS '状态: ongoing(进行中)/planned(计划中)/milestone(里程碑)/done(已完成)';
COMMENT ON COLUMN pro_progress_tasks.full_desc IS '完整描述 (含责任方)';
COMMENT ON COLUMN pro_progress_tasks.owner IS '任务负责人';
COMMENT ON COLUMN pro_progress_tasks.is_milestone IS '是否为里程碑节点';
COMMENT ON COLUMN pro_progress_tasks.is_delete IS '是否已软删除';

-- ---------- pro_meetings 会议主记录 ----------
CREATE TABLE IF NOT EXISTS pro_meetings (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER      NOT NULL,
    title       VARCHAR(256) DEFAULT '项目周例会',
    meet_date   VARCHAR(32)  DEFAULT '',
    meet_time   VARCHAR(32)  DEFAULT '',
    place       VARCHAR(128) DEFAULT '',
    host        VARCHAR(64)  DEFAULT '',
    attendees   TEXT         DEFAULT '',
    description TEXT         DEFAULT '',
    sort_order  INTEGER      DEFAULT 0,
    created_at  TIMESTAMP    DEFAULT NOW(),
    updated_at  TIMESTAMP    DEFAULT NOW(),
    is_delete   BOOLEAN      DEFAULT FALSE,
    audio_file  VARCHAR(256) DEFAULT '' NOT NULL,
    transcript  TEXT         DEFAULT '' NOT NULL,
    CONSTRAINT fk_meetings_project FOREIGN KEY (project_id) REFERENCES pro_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meetings_project_id ON pro_meetings(project_id);
COMMENT ON TABLE  pro_meetings IS '会议主记录 (项目周例会等, 按项目隔离)';
COMMENT ON COLUMN pro_meetings.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_meetings.project_id IS '★所属项目ID, 关联 pro_projects.id';
COMMENT ON COLUMN pro_meetings.title IS '会议主题 (默认"项目周例会")';
COMMENT ON COLUMN pro_meetings.meet_date IS '会议日期, 格式 YYYY-MM-DD';
COMMENT ON COLUMN pro_meetings.meet_time IS '会议时间, 如 09:00-10:00';
COMMENT ON COLUMN pro_meetings.place IS '会议地点';
COMMENT ON COLUMN pro_meetings.host IS '主持人';
COMMENT ON COLUMN pro_meetings.attendees IS '参会人员, 逗号分隔';
COMMENT ON COLUMN pro_meetings.description IS '会议描述/纪要';
COMMENT ON COLUMN pro_meetings.sort_order IS '排序序号';
COMMENT ON COLUMN pro_meetings.is_delete IS '是否已软删除';
COMMENT ON COLUMN pro_meetings.audio_file IS '原始录音文件名 (任务附件目录内)';
COMMENT ON COLUMN pro_meetings.transcript IS '录音转写完整文字 (带时间戳)';

-- ---------- pro_meeting_items 会议议程项 ----------
CREATE TABLE IF NOT EXISTS pro_meeting_items (
    id           SERIAL PRIMARY KEY,
    meeting_id   INTEGER      NOT NULL,
    item_time    VARCHAR(32)  DEFAULT '',
    theme        VARCHAR(256) DEFAULT '',
    speaker      VARCHAR(64)  DEFAULT '',
    duration     VARCHAR(32)  DEFAULT '',
    note         VARCHAR(256) DEFAULT '',
    description  TEXT         DEFAULT '',
    sort_order   INTEGER      DEFAULT 0,
    created_at   TIMESTAMP    DEFAULT NOW(),
    updated_at   TIMESTAMP    DEFAULT NOW(),
    is_delete    BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_meeting_items_meeting FOREIGN KEY (meeting_id) REFERENCES pro_meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meeting_items_meeting_id ON pro_meeting_items(meeting_id);
COMMENT ON TABLE  pro_meeting_items IS '会议议程项 (从属于 pro_meetings)';
COMMENT ON COLUMN pro_meeting_items.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_meeting_items.meeting_id IS '所属会议ID, 关联 pro_meetings.id (级联删除)';
COMMENT ON COLUMN pro_meeting_items.item_time IS '议程时间段, 如 09:00-09:10';
COMMENT ON COLUMN pro_meeting_items.theme IS '议程主题';
COMMENT ON COLUMN pro_meeting_items.speaker IS '汇报人';
COMMENT ON COLUMN pro_meeting_items.duration IS '议程时长';
COMMENT ON COLUMN pro_meeting_items.note IS '备注';
COMMENT ON COLUMN pro_meeting_items.description IS '议程内容简介';
COMMENT ON COLUMN pro_meeting_items.sort_order IS '排序序号';
COMMENT ON COLUMN pro_meeting_items.is_delete IS '是否已软删除';

-- ---------- pro_weekly_reports 项目周报 ----------
CREATE TABLE IF NOT EXISTS pro_weekly_reports (
    id                SERIAL PRIMARY KEY,
    project_id        INTEGER      NOT NULL,
    title             VARCHAR(128) DEFAULT '',
    week_range        VARCHAR(32)  DEFAULT '',
    week_start        DATE,
    week_end          DATE,
    overview_summary  TEXT         DEFAULT '',
    status            VARCHAR(16)  DEFAULT 'draft',
    week_digest       TEXT         DEFAULT '' NOT NULL,
    created_at        TIMESTAMP    DEFAULT NOW(),
    updated_at        TIMESTAMP    DEFAULT NOW(),
    is_delete         BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_weekly_reports_project FOREIGN KEY (project_id) REFERENCES pro_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_project_id ON pro_weekly_reports(project_id);
COMMENT ON TABLE  pro_weekly_reports IS '项目周报主表 (按项目隔离)';
COMMENT ON COLUMN pro_weekly_reports.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_weekly_reports.project_id IS '★所属项目ID, 关联 pro_projects.id (复制上周周报时继承源周报)';
COMMENT ON COLUMN pro_weekly_reports.title IS '周报标题';
COMMENT ON COLUMN pro_weekly_reports.week_range IS '周次范围显示文本, 如 07.01 — 07.07';
COMMENT ON COLUMN pro_weekly_reports.week_start IS '本周开始日期 (周一)';
COMMENT ON COLUMN pro_weekly_reports.week_end IS '本周结束日期 (周日)';
COMMENT ON COLUMN pro_weekly_reports.overview_summary IS '本周总结/概览说明';
COMMENT ON COLUMN pro_weekly_reports.status IS '周报状态: draft(草稿/待汇报)/submitted(已汇报)';
COMMENT ON COLUMN pro_weekly_reports.week_digest IS '周报概括 (AI 生成, 微信汇报版)';
COMMENT ON COLUMN pro_weekly_reports.is_delete IS '是否已软删除';

-- ---------- pro_weekly_kpis 周报本周概览 KPI ----------
CREATE TABLE IF NOT EXISTS pro_weekly_kpis (
    id           SERIAL PRIMARY KEY,
    report_id    INTEGER     NOT NULL,
    module_id    INTEGER     NOT NULL,
    progress_pct INTEGER     DEFAULT 0,
    status       VARCHAR(16) DEFAULT '正常',
    is_delete    BOOLEAN     DEFAULT FALSE,
    CONSTRAINT fk_weekly_kpis_report FOREIGN KEY (report_id) REFERENCES pro_weekly_reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_weekly_kpis_module FOREIGN KEY (module_id) REFERENCES pro_modules(id),
    CONSTRAINT uq_weekly_kpis_report_module UNIQUE (report_id, module_id)
);
COMMENT ON TABLE  pro_weekly_kpis IS '周报-本周概览 KPI (每模块一条, 唯一约束 report_id+module_id)';
COMMENT ON COLUMN pro_weekly_kpis.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_weekly_kpis.report_id IS '所属周报ID, 关联 pro_weekly_reports.id (级联删除)';
COMMENT ON COLUMN pro_weekly_kpis.module_id IS '所属模块ID, 关联 pro_modules.id';
COMMENT ON COLUMN pro_weekly_kpis.progress_pct IS '完成进度百分比 0-100';
COMMENT ON COLUMN pro_weekly_kpis.status IS '模块状态: 正常/关注/风险';
COMMENT ON COLUMN pro_weekly_kpis.is_delete IS '是否已软删除';

-- ---------- pro_weekly_progress_items 周报本周进展 ----------
CREATE TABLE IF NOT EXISTS pro_weekly_progress_items (
    id          SERIAL PRIMARY KEY,
    report_id   INTEGER      NOT NULL,
    module_id   INTEGER,
    content     VARCHAR(512) DEFAULT '',
    detail      TEXT         DEFAULT '',
    sort_order  INTEGER      DEFAULT 0,
    is_delete   BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_weekly_progress_items_report FOREIGN KEY (report_id) REFERENCES pro_weekly_reports(id) ON DELETE CASCADE,
    CONSTRAINT fk_weekly_progress_items_module FOREIGN KEY (module_id) REFERENCES pro_modules(id)
);
COMMENT ON TABLE  pro_weekly_progress_items IS '周报-本周进展 (每模块多条)';
COMMENT ON COLUMN pro_weekly_progress_items.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_weekly_progress_items.report_id IS '所属周报ID, 关联 pro_weekly_reports.id (级联删除)';
COMMENT ON COLUMN pro_weekly_progress_items.module_id IS '所属模块ID, 关联 pro_modules.id';
COMMENT ON COLUMN pro_weekly_progress_items.content IS '进展事项标题';
COMMENT ON COLUMN pro_weekly_progress_items.detail IS '进展补充说明';
COMMENT ON COLUMN pro_weekly_progress_items.sort_order IS '排序序号';
COMMENT ON COLUMN pro_weekly_progress_items.is_delete IS '是否已软删除';

-- ---------- pro_weekly_plan_tasks 周报下周任务 (★核心关联表) ----------
CREATE TABLE IF NOT EXISTS pro_weekly_plan_tasks (
    id                SERIAL PRIMARY KEY,
    report_id         INTEGER      NOT NULL,
    module_id         INTEGER,
    progress_task_id  INTEGER,
    name              VARCHAR(512) DEFAULT '',
    is_key            BOOLEAN      DEFAULT FALSE,
    owner             VARCHAR(64)  DEFAULT '',
    plan_period       VARCHAR(64)  DEFAULT '',
    status            VARCHAR(16)  DEFAULT '待开始',
    remark            TEXT         DEFAULT '',
    sort_order        INTEGER      DEFAULT 0,
    created_at        TIMESTAMP    DEFAULT NOW(),
    updated_at        TIMESTAMP    DEFAULT NOW(),
    is_delete         BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_weekly_plan_tasks_report        FOREIGN KEY (report_id)        REFERENCES pro_weekly_reports(id)  ON DELETE CASCADE,
    CONSTRAINT fk_weekly_plan_tasks_module        FOREIGN KEY (module_id)        REFERENCES pro_modules(id),
    CONSTRAINT fk_weekly_plan_tasks_progress_task FOREIGN KEY (progress_task_id) REFERENCES pro_progress_tasks(id)
);
COMMENT ON TABLE  pro_weekly_plan_tasks IS '周报-下周任务 (★核心关联表, 可关联 pro_progress_tasks 进度计划任务)';
COMMENT ON COLUMN pro_weekly_plan_tasks.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_weekly_plan_tasks.report_id IS '所属周报ID, 关联 pro_weekly_reports.id (级联删除)';
COMMENT ON COLUMN pro_weekly_plan_tasks.module_id IS '所属模块ID, 关联 pro_modules.id';
COMMENT ON COLUMN pro_weekly_plan_tasks.progress_task_id IS '★关联进度计划任务ID, 关联 pro_progress_tasks.id (可空, 表示未关联)';
COMMENT ON COLUMN pro_weekly_plan_tasks.name IS '任务/事项名称';
COMMENT ON COLUMN pro_weekly_plan_tasks.is_key IS '是否为重点任务';
COMMENT ON COLUMN pro_weekly_plan_tasks.owner IS '任务负责人';
COMMENT ON COLUMN pro_weekly_plan_tasks.plan_period IS '计划周期, 如 下周/7.21-7.27';
COMMENT ON COLUMN pro_weekly_plan_tasks.status IS '任务状态: 待开始/进行中/已完成';
COMMENT ON COLUMN pro_weekly_plan_tasks.remark IS '备注';
COMMENT ON COLUMN pro_weekly_plan_tasks.sort_order IS '排序序号';
COMMENT ON COLUMN pro_weekly_plan_tasks.is_delete IS '是否已软删除';

-- ---------- pro_weekly_risks 周报风险与应对 ----------
CREATE TABLE IF NOT EXISTS pro_weekly_risks (
    id             SERIAL PRIMARY KEY,
    report_id      INTEGER      NOT NULL,
    seq            VARCHAR(16)  DEFAULT '',
    title          VARCHAR(512) DEFAULT '',
    coordination   TEXT         DEFAULT '',
    urgency        VARCHAR(16)  DEFAULT '中',
    sort_order     INTEGER      DEFAULT 0,
    is_delete      BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_weekly_risks_report FOREIGN KEY (report_id) REFERENCES pro_weekly_reports(id) ON DELETE CASCADE
);
COMMENT ON TABLE  pro_weekly_risks IS '周报-风险与应对';
COMMENT ON COLUMN pro_weekly_risks.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_weekly_risks.report_id IS '所属周报ID, 关联 pro_weekly_reports.id (级联删除)';
COMMENT ON COLUMN pro_weekly_risks.seq IS '风险编号, 如 R1/R2';
COMMENT ON COLUMN pro_weekly_risks.title IS '风险标题/描述';
COMMENT ON COLUMN pro_weekly_risks.coordination IS '需要协调的内容/应对措施';
COMMENT ON COLUMN pro_weekly_risks.urgency IS '紧急程度: 高/中/低';
COMMENT ON COLUMN pro_weekly_risks.sort_order IS '排序序号';
COMMENT ON COLUMN pro_weekly_risks.is_delete IS '是否已软删除';

-- ---------- pro_weekly_work_tasks 每周工作任务安排 (★核心关联表) ----------
CREATE TABLE IF NOT EXISTS pro_weekly_work_tasks (
    id              SERIAL PRIMARY KEY,
    project_id      INTEGER      NOT NULL,
    week_start      DATE,
    week_end        DATE,
    plan_task_id    INTEGER,
    name            VARCHAR(512) NOT NULL,
    module_id       INTEGER,
    owner           VARCHAR(64)  DEFAULT '',
    is_temporary    BOOLEAN      DEFAULT FALSE,
    priority        VARCHAR(8)   DEFAULT 'medium',
    status          VARCHAR(16)  DEFAULT '待开始',
    planned_hours   NUMERIC(5,1) DEFAULT 0,
    actual_hours    NUMERIC(5,1) DEFAULT 0,
    remark          TEXT         DEFAULT '',
    sort_order      INTEGER      DEFAULT 0,
    created_at      TIMESTAMP    DEFAULT NOW(),
    updated_at      TIMESTAMP    DEFAULT NOW(),
    is_delete       BOOLEAN      DEFAULT FALSE,
    CONSTRAINT fk_weekly_work_tasks_project   FOREIGN KEY (project_id)    REFERENCES pro_projects(id)          ON DELETE CASCADE,
    CONSTRAINT fk_weekly_work_tasks_plan_task FOREIGN KEY (plan_task_id)  REFERENCES pro_weekly_plan_tasks(id),
    CONSTRAINT fk_weekly_work_tasks_module    FOREIGN KEY (module_id)     REFERENCES pro_modules(id)
);
CREATE INDEX IF NOT EXISTS idx_weekly_work_tasks_project_id ON pro_weekly_work_tasks(project_id);
COMMENT ON TABLE  pro_weekly_work_tasks IS '每周工作任务安排 (★核心关联表, 可关联 pro_weekly_plan_tasks 周报下周任务, 按项目隔离)';
COMMENT ON COLUMN pro_weekly_work_tasks.id IS '主键ID, 自增';
COMMENT ON COLUMN pro_weekly_work_tasks.project_id IS '★所属项目ID, 关联 pro_projects.id (从周报批量生成时继承周报)';
COMMENT ON COLUMN pro_weekly_work_tasks.week_start IS '本周开始日期 (周一)';
COMMENT ON COLUMN pro_weekly_work_tasks.week_end IS '本周结束日期 (周日)';
COMMENT ON COLUMN pro_weekly_work_tasks.plan_task_id IS '★关联周报下周任务ID, 关联 pro_weekly_plan_tasks.id (可空, 表示临时任务)';
COMMENT ON COLUMN pro_weekly_work_tasks.name IS '任务名称';
COMMENT ON COLUMN pro_weekly_work_tasks.module_id IS '所属模块ID, 关联 pro_modules.id (可空)';
COMMENT ON COLUMN pro_weekly_work_tasks.owner IS '任务负责人';
COMMENT ON COLUMN pro_weekly_work_tasks.is_temporary IS '是否为临时任务';
COMMENT ON COLUMN pro_weekly_work_tasks.priority IS '优先级: high(高)/medium(中)/low(低)';
COMMENT ON COLUMN pro_weekly_work_tasks.status IS '任务状态: 待开始/进行中/已完成/已取消';
COMMENT ON COLUMN pro_weekly_work_tasks.planned_hours IS '计划工时 (小时, 1位小数)';
COMMENT ON COLUMN pro_weekly_work_tasks.actual_hours IS '实际工时 (小时, 1位小数)';
COMMENT ON COLUMN pro_weekly_work_tasks.remark IS '备注';
COMMENT ON COLUMN pro_weekly_work_tasks.sort_order IS '排序序号';
COMMENT ON COLUMN pro_weekly_work_tasks.is_delete IS '是否已软删除';


-- ============================================================
-- 2. 初始字典数据 (幂等, 重复执行不会报错)
-- ============================================================

-- ---------- 项目 ----------
INSERT INTO pro_projects (id, name, title, based_doc, start_date, end_date, is_active, sort_order)
VALUES
    (1, '信投AI2.0',          '信投 AI 2.0 项目进度计划执行图',                            '20260710信投AI2.0项目进度计划V2.3', '2026-07-01', '2026-12-31', TRUE,  0),
    (2, '皮肤病医院数转专项', '2026数据要素驱动的皮肤专病精准诊疗-护理联动模式的创新实践', '项目周报',                          '2026-07-01', '2026-12-31', FALSE, 1)
ON CONFLICT (id) DO UPDATE SET
    name       = EXCLUDED.name,
    title      = EXCLUDED.title,
    based_doc  = EXCLUDED.based_doc,
    start_date = EXCLUDED.start_date,
    end_date   = EXCLUDED.end_date,
    is_active  = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order;
SELECT setval(pg_get_serial_sequence('pro_projects','id'), (SELECT MAX(id) FROM pro_projects));

-- ---------- 模块 (信投AI2.0 项目, project_id=1) ----------
INSERT INTO pro_modules (id, project_id, idx, tag, title, owner, color, color_bg, sort_order)
VALUES
    (1, 1, '01', '底座',   '算力与模型基础底座建设',         '数字智能事业部', '#2563EB', '#EFF6FF', 1),
    (2, 1, '02', '数据',   '数据治理与知识库构建',           '数字智能事业部', '#0D9488', '#F0FDFA', 2),
    (3, 1, '03', '智能体', '企业智能体平台建设',             '智科研发中心',   '#7C3AED', '#F5F3FF', 3),
    (4, 1, '04', '应用',   '运营管理系统升级与智能应用建设', '数字智能事业部', '#E85D1C', '#FFF7ED', 4),
    (5, 1, '05', '需求',   '用户需求及技术方案',             '智科技术团队',   '#D97706', '#FFFBEB', 5),
    (6, 1, '06', '协调',   '其他组织协调工作',               '现场项目组',     '#E11D48', '#FFF1F2', 6)
ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    idx        = EXCLUDED.idx,
    tag        = EXCLUDED.tag,
    title      = EXCLUDED.title,
    owner      = EXCLUDED.owner,
    color      = EXCLUDED.color,
    color_bg   = EXCLUDED.color_bg,
    sort_order = EXCLUDED.sort_order;
SELECT setval(pg_get_serial_sequence('pro_modules','id'), (SELECT MAX(id) FROM pro_modules));

-- ---------- 阶段 (信投AI2.0 项目, project_id=1) ----------
INSERT INTO pro_phases (id, project_id, name, subtitle, description, start_date, end_date)
VALUES
    (1, 1, '第一阶段', '有得用', '本地大模型与工作台搭建，挂载外部知识，全员"有得用"',           '2026-07-01', '2026-08-31'),
    (2, 1, '第二阶段', '用起来', '治理内部数据形成本地知识库，完成运营系统升级，AI进入既有业务', '2026-09-01', '2026-10-31'),
    (3, 1, '第三阶段', '用得好', 'AI全面融入投资主业，系统数据准确靠谱，全面切换自研智能体',     '2026-11-01', '2026-12-31')
ON CONFLICT (id) DO UPDATE SET
    project_id  = EXCLUDED.project_id,
    name        = EXCLUDED.name,
    subtitle    = EXCLUDED.subtitle,
    description = EXCLUDED.description,
    start_date  = EXCLUDED.start_date,
    end_date    = EXCLUDED.end_date;
SELECT setval(pg_get_serial_sequence('pro_phases','id'), (SELECT MAX(id) FROM pro_phases));

-- ============================================================
-- 脚本执行完成
-- 表清单: pro_projects / pro_modules / pro_phases / pro_progress_tasks
--         / pro_meetings / pro_meeting_items
--         / pro_weekly_reports / pro_weekly_kpis / pro_weekly_progress_items
--         / pro_weekly_plan_tasks / pro_weekly_risks / pro_weekly_work_tasks
-- ============================================================
