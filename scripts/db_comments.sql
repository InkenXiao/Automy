-- ============================================================
-- XIN-AI 数据库表与字段备注 (PostgreSQL COMMENT ON)
-- 数据库: XIN
-- 包含: pro-site (10张表) + abs-site (3张表)
--
-- 执行方式 (推荐, 通过 pg_db 容器):
--   docker exec -i pg_db psql -U dbuser -d XIN < scripts/db_comments.sql
--
-- 或宿主机直连:
--   psql -h localhost -p 11000 -U dbuser -d XIN -f scripts/db_comments.sql
--
-- 特点: COMMENT 语句幂等, 可重复执行, 仅更新备注不改表结构
-- ============================================================


-- ===============================================================
-- pro-site 表
-- ===============================================================

-- ---------- meetings 会议主记录 ----------
COMMENT ON TABLE meetings IS '会议主记录 (项目周例会等, 按项目隔离)';
COMMENT ON COLUMN meetings.id IS '主键ID, 自增';
COMMENT ON COLUMN meetings.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目)';
COMMENT ON COLUMN meetings.title IS '会议主题 (默认"项目周例会")';
COMMENT ON COLUMN meetings.meet_date IS '会议日期, 格式 YYYY-MM-DD';
COMMENT ON COLUMN meetings.meet_time IS '会议时间, 如 09:00-10:00';
COMMENT ON COLUMN meetings.place IS '会议地点';
COMMENT ON COLUMN meetings.host IS '主持人';
COMMENT ON COLUMN meetings.attendees IS '参会人员, 逗号分隔';
COMMENT ON COLUMN meetings.description IS '会议描述/纪要';
COMMENT ON COLUMN meetings.sort_order IS '排序序号, 越小越靠前';
COMMENT ON COLUMN meetings.created_at IS '记录创建时间';
COMMENT ON COLUMN meetings.updated_at IS '记录更新时间';
COMMENT ON COLUMN meetings.is_delete IS '是否已软删除 (true=已删除, 查询需过滤)';

-- ---------- meeting_items 会议议程项 ----------
COMMENT ON TABLE meeting_items IS '会议议程项 (从属于 meetings)';
COMMENT ON COLUMN meeting_items.id IS '主键ID, 自增';
COMMENT ON COLUMN meeting_items.meeting_id IS '所属会议ID, 关联 meetings.id (级联删除)';
COMMENT ON COLUMN meeting_items.item_time IS '议程时间段, 如 09:00-09:10';
COMMENT ON COLUMN meeting_items.theme IS '议程主题';
COMMENT ON COLUMN meeting_items.speaker IS '汇报人';
COMMENT ON COLUMN meeting_items.duration IS '议程时长, 如 10分钟';
COMMENT ON COLUMN meeting_items.note IS '备注';
COMMENT ON COLUMN meeting_items.description IS '议程内容简介';
COMMENT ON COLUMN meeting_items.sort_order IS '排序序号';
COMMENT ON COLUMN meeting_items.created_at IS '记录创建时间';
COMMENT ON COLUMN meeting_items.updated_at IS '记录更新时间';
COMMENT ON COLUMN meeting_items.is_delete IS '是否已软删除';

-- ---------- modules 项目模块字典 ----------
COMMENT ON TABLE modules IS '项目模块字典 (底座/数据/智能体/应用/需求/协调)';
COMMENT ON COLUMN modules.id IS '主键ID, 自增';
COMMENT ON COLUMN modules.idx IS '模块编号, 如 01/02';
COMMENT ON COLUMN modules.tag IS '模块标签, 如 底座/数据/智能体/应用/需求/协调';
COMMENT ON COLUMN modules.title IS '模块名称';
COMMENT ON COLUMN modules.owner IS '模块负责人';
COMMENT ON COLUMN modules.color IS '模块主题色 (HEX), 如 #FF8C00';
COMMENT ON COLUMN modules.color_bg IS '模块背景色 (HEX), 如 #FFF3E0';
COMMENT ON COLUMN modules.sort_order IS '排序序号';
COMMENT ON COLUMN modules.created_at IS '记录创建时间';
COMMENT ON COLUMN modules.updated_at IS '记录更新时间';
COMMENT ON COLUMN modules.is_delete IS '是否已软删除';

-- ---------- phases 项目阶段字典 ----------
COMMENT ON TABLE phases IS '项目阶段字典 (第一阶段/第二阶段/第三阶段)';
COMMENT ON COLUMN phases.id IS '主键ID, 自增';
COMMENT ON COLUMN phases.name IS '阶段名称, 如 第一阶段/第二阶段/第三阶段';
COMMENT ON COLUMN phases.subtitle IS '阶段副标题, 如 有得用/用起来/用得好';
COMMENT ON COLUMN phases.description IS '阶段描述';
COMMENT ON COLUMN phases.start_date IS '阶段开始日期';
COMMENT ON COLUMN phases.end_date IS '阶段结束日期';
COMMENT ON COLUMN phases.created_at IS '记录创建时间';
COMMENT ON COLUMN phases.updated_at IS '记录更新时间';
COMMENT ON COLUMN phases.is_delete IS '是否已软删除';

-- ---------- progress_tasks 项目进度计划任务 ----------
COMMENT ON TABLE progress_tasks IS '项目进度计划任务 (执行图任务节点, 按项目隔离)';
COMMENT ON COLUMN progress_tasks.id IS '主键ID, 自增';
COMMENT ON COLUMN progress_tasks.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目)';
COMMENT ON COLUMN progress_tasks.task_uid IS '任务唯一编号, 如 1-1/M1';
COMMENT ON COLUMN progress_tasks.name IS '任务名称';
COMMENT ON COLUMN progress_tasks.phase_id IS '所属阶段ID, 关联 phases.id (可空)';
COMMENT ON COLUMN progress_tasks.start_date IS '计划开始日期';
COMMENT ON COLUMN progress_tasks.end_date IS '计划结束日期';
COMMENT ON COLUMN progress_tasks.status IS '任务状态: ongoing(进行中)/planned(计划中)/milestone(里程碑)/done(已完成)';
COMMENT ON COLUMN progress_tasks.full_desc IS '完整描述 (含责任方)';
COMMENT ON COLUMN progress_tasks.owner IS '任务负责人';
COMMENT ON COLUMN progress_tasks.is_milestone IS '是否为里程碑节点';
COMMENT ON COLUMN progress_tasks.created_at IS '记录创建时间';
COMMENT ON COLUMN progress_tasks.updated_at IS '记录更新时间';
COMMENT ON COLUMN progress_tasks.is_delete IS '是否已软删除';

-- ---------- projects 项目元信息 ----------
COMMENT ON TABLE projects IS '项目元信息 (一个项目对应一张进度计划执行图)';
COMMENT ON COLUMN projects.id IS '主键ID, 自增';
COMMENT ON COLUMN projects.name IS '项目名称, 如 信投AI2.0';
COMMENT ON COLUMN projects.title IS '执行图标题';
COMMENT ON COLUMN projects.based_doc IS '基于文档';
COMMENT ON COLUMN projects.start_date IS '项目开始日期';
COMMENT ON COLUMN projects.end_date IS '项目结束日期';
COMMENT ON COLUMN projects.is_active IS '是否为当前激活项目';
COMMENT ON COLUMN projects.sort_order IS '排序序号';
COMMENT ON COLUMN projects.created_at IS '记录创建时间';
COMMENT ON COLUMN projects.updated_at IS '记录更新时间';
COMMENT ON COLUMN projects.is_delete IS '是否已软删除';

-- ---------- weekly_reports 项目周报 ----------
COMMENT ON TABLE weekly_reports IS '项目周报主表 (按项目隔离)';
COMMENT ON COLUMN weekly_reports.id IS '主键ID, 自增';
COMMENT ON COLUMN weekly_reports.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目; 复制上周周报时继承源周报)';
COMMENT ON COLUMN weekly_reports.title IS '周报标题';
COMMENT ON COLUMN weekly_reports.week_range IS '周次范围显示文本, 如 07.01 — 07.07';
COMMENT ON COLUMN weekly_reports.week_start IS '本周开始日期 (周一)';
COMMENT ON COLUMN weekly_reports.week_end IS '本周结束日期 (周日)';
COMMENT ON COLUMN weekly_reports.overview_summary IS '本周总结/概览说明';
COMMENT ON COLUMN weekly_reports.status IS '周报状态: draft(草稿/待汇报)/submitted(已汇报)';
COMMENT ON COLUMN weekly_reports.created_at IS '记录创建时间';
COMMENT ON COLUMN weekly_reports.updated_at IS '记录更新时间';
COMMENT ON COLUMN weekly_reports.is_delete IS '是否已软删除';

-- ---------- weekly_kpis 周报本周概览 KPI ----------
COMMENT ON TABLE weekly_kpis IS '周报-本周概览 KPI (每模块一条, 唯一约束 report_id+module_id)';
COMMENT ON COLUMN weekly_kpis.id IS '主键ID, 自增';
COMMENT ON COLUMN weekly_kpis.report_id IS '所属周报ID, 关联 weekly_reports.id (级联删除)';
COMMENT ON COLUMN weekly_kpis.module_id IS '所属模块ID, 关联 modules.id';
COMMENT ON COLUMN weekly_kpis.progress_pct IS '完成进度百分比 0-100';
COMMENT ON COLUMN weekly_kpis.status IS '模块状态: 正常/关注/风险';
COMMENT ON COLUMN weekly_kpis.is_delete IS '是否已软删除';

-- ---------- weekly_progress_items 周报本周进展 ----------
COMMENT ON TABLE weekly_progress_items IS '周报-本周进展 (每模块多条)';
COMMENT ON COLUMN weekly_progress_items.id IS '主键ID, 自增';
COMMENT ON COLUMN weekly_progress_items.report_id IS '所属周报ID, 关联 weekly_reports.id (级联删除)';
COMMENT ON COLUMN weekly_progress_items.module_id IS '所属模块ID, 关联 modules.id';
COMMENT ON COLUMN weekly_progress_items.content IS '进展事项标题';
COMMENT ON COLUMN weekly_progress_items.detail IS '进展补充说明';
COMMENT ON COLUMN weekly_progress_items.sort_order IS '排序序号';
COMMENT ON COLUMN weekly_progress_items.is_delete IS '是否已软删除';

-- ---------- weekly_plan_tasks 周报下周任务 (★核心关联表) ----------
COMMENT ON TABLE weekly_plan_tasks IS '周报-下周任务 (★核心关联表, 可关联 progress_tasks 进度计划任务)';
COMMENT ON COLUMN weekly_plan_tasks.id IS '主键ID, 自增';
COMMENT ON COLUMN weekly_plan_tasks.report_id IS '所属周报ID, 关联 weekly_reports.id (级联删除)';
COMMENT ON COLUMN weekly_plan_tasks.module_id IS '所属模块ID, 关联 modules.id';
COMMENT ON COLUMN weekly_plan_tasks.progress_task_id IS '★关联进度计划任务ID, 关联 progress_tasks.id (可空, 表示未关联)';
COMMENT ON COLUMN weekly_plan_tasks.name IS '任务/事项名称';
COMMENT ON COLUMN weekly_plan_tasks.is_key IS '是否为重点任务';
COMMENT ON COLUMN weekly_plan_tasks.owner IS '任务负责人';
COMMENT ON COLUMN weekly_plan_tasks.plan_period IS '计划周期, 如 下周/7.21-7.27';
COMMENT ON COLUMN weekly_plan_tasks.status IS '任务状态: 待开始/进行中/已完成';
COMMENT ON COLUMN weekly_plan_tasks.remark IS '备注';
COMMENT ON COLUMN weekly_plan_tasks.sort_order IS '排序序号';
COMMENT ON COLUMN weekly_plan_tasks.created_at IS '记录创建时间';
COMMENT ON COLUMN weekly_plan_tasks.updated_at IS '记录更新时间';
COMMENT ON COLUMN weekly_plan_tasks.is_delete IS '是否已软删除';

-- ---------- weekly_risks 周报风险与应对 ----------
COMMENT ON TABLE weekly_risks IS '周报-风险与应对';
COMMENT ON COLUMN weekly_risks.id IS '主键ID, 自增';
COMMENT ON COLUMN weekly_risks.report_id IS '所属周报ID, 关联 weekly_reports.id (级联删除)';
COMMENT ON COLUMN weekly_risks.seq IS '风险编号, 如 R1/R2';
COMMENT ON COLUMN weekly_risks.title IS '风险标题/描述';
COMMENT ON COLUMN weekly_risks.coordination IS '需要协调的内容/应对措施';
COMMENT ON COLUMN weekly_risks.urgency IS '紧急程度: 高/中/低';
COMMENT ON COLUMN weekly_risks.sort_order IS '排序序号';
COMMENT ON COLUMN weekly_risks.is_delete IS '是否已软删除';

-- ---------- weekly_work_tasks 每周工作任务安排 (★核心关联表) ----------
COMMENT ON TABLE weekly_work_tasks IS '每周工作任务安排 (★核心关联表, 可关联 weekly_plan_tasks 周报下周任务, 按项目隔离)';
COMMENT ON COLUMN weekly_work_tasks.id IS '主键ID, 自增';
COMMENT ON COLUMN weekly_work_tasks.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目; 从周报批量生成时继承周报)';
COMMENT ON COLUMN weekly_work_tasks.week_start IS '本周开始日期 (周一)';
COMMENT ON COLUMN weekly_work_tasks.week_end IS '本周结束日期 (周日)';
COMMENT ON COLUMN weekly_work_tasks.plan_task_id IS '★关联周报下周任务ID, 关联 weekly_plan_tasks.id (可空, 表示临时任务)';
COMMENT ON COLUMN weekly_work_tasks.name IS '任务名称';
COMMENT ON COLUMN weekly_work_tasks.module_id IS '所属模块ID, 关联 modules.id (可空)';
COMMENT ON COLUMN weekly_work_tasks.owner IS '任务负责人';
COMMENT ON COLUMN weekly_work_tasks.is_temporary IS '是否为临时任务';
COMMENT ON COLUMN weekly_work_tasks.priority IS '优先级: high(高)/medium(中)/low(低)';
COMMENT ON COLUMN weekly_work_tasks.status IS '任务状态: 待开始/进行中/已完成/已取消';
COMMENT ON COLUMN weekly_work_tasks.planned_hours IS '计划工时 (小时, 1位小数)';
COMMENT ON COLUMN weekly_work_tasks.actual_hours IS '实际工时 (小时, 1位小数)';
COMMENT ON COLUMN weekly_work_tasks.remark IS '备注';
COMMENT ON COLUMN weekly_work_tasks.sort_order IS '排序序号';
COMMENT ON COLUMN weekly_work_tasks.created_at IS '记录创建时间';
COMMENT ON COLUMN weekly_work_tasks.updated_at IS '记录更新时间';
COMMENT ON COLUMN weekly_work_tasks.is_delete IS '是否已软删除';


-- ===============================================================
-- abs-site 表 (艾宾浩斯背单词)
-- ===============================================================

-- ---------- vocab_words 单词 ----------
COMMENT ON TABLE vocab_words IS '单词表 (艾宾浩斯背单词)';
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

-- ---------- vocab_units 单词单元 ----------
COMMENT ON TABLE vocab_units IS '单词单元 (词书分册)';
COMMENT ON COLUMN vocab_units.id IS '主键ID, 自增';
COMMENT ON COLUMN vocab_units.name IS '单元名称';
COMMENT ON COLUMN vocab_units.description IS '单元描述';
COMMENT ON COLUMN vocab_units.sort_order IS '排序序号';
COMMENT ON COLUMN vocab_units.created_at IS '记录创建时间';
COMMENT ON COLUMN vocab_units.is_delete IS '是否已软删除';

-- ---------- vocab_review_schedules 复习计划 ----------
COMMENT ON TABLE vocab_review_schedules IS '复习计划 (艾宾浩斯遗忘曲线 8 个间隔点)';
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
-- 执行完成
-- 验证备注: SELECT table_name, obj_description('表名'::regclass) AS table_comment;
--           SELECT column_name, col_description('表名'::regclass, ordinal_position) FROM information_schema.columns WHERE table_name='表名';
-- ============================================================
