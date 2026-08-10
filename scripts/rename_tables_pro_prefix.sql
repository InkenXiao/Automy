-- ============================================================================
-- 表名前缀规范化: 16 张项目管理表加 pro_ 前缀, 3 张系统表加 sys_ 前缀
-- (login_logs/operation_logs 系统日志 + user_credentials 登录凭据)
-- 幂等: 旧名存在且新名不存在才执行 RENAME, 可重复执行
-- 执行: docker exec -i pg_db psql -U dbuser -d XIN < scripts/rename_tables_pro_prefix.sql
-- 说明: ALTER TABLE RENAME 后 FK 约束/序列/列默认值自动跟随, 零数据丢失;
--       约束名/索引名/序列名保留旧命名 (PG 允许, 无功能影响)
-- ============================================================================

DO $$
DECLARE
    mapping jsonb := '{
        "projects":                     "pro_projects",
        "modules":                      "pro_modules",
        "phases":                       "pro_phases",
        "progress_tasks":               "pro_progress_tasks",
        "meetings":                     "pro_meetings",
        "meeting_items":                "pro_meeting_items",
        "project_members":              "pro_project_members",
        "weekly_reports":               "pro_weekly_reports",
        "weekly_kpis":                  "pro_weekly_kpis",
        "weekly_progress_items":        "pro_weekly_progress_items",
        "weekly_plan_tasks":            "pro_weekly_plan_tasks",
        "weekly_risks":                 "pro_weekly_risks",
        "weekly_work_tasks":            "pro_weekly_work_tasks",
        "personal_reports":             "pro_personal_reports",
        "personal_report_work_items":   "pro_personal_report_work_items",
        "personal_report_plan_items":   "pro_personal_report_plan_items",
        "login_logs":                   "sys_login_logs",
        "operation_logs":               "sys_operation_logs",
        "user_credentials":             "sys_user_credentials"
    }';
    old_name text;
    new_name text;
    cnt bigint;
BEGIN
    FOR old_name, new_name IN SELECT key, value FROM jsonb_each_text(mapping) LOOP
        IF to_regclass('public.' || old_name) IS NOT NULL
           AND to_regclass('public.' || new_name) IS NULL THEN
            EXECUTE format('SELECT count(*) FROM public.%I', old_name) INTO cnt;
            EXECUTE format('ALTER TABLE public.%I RENAME TO %I', old_name, new_name);
            RAISE NOTICE 'renamed % -> % (rows=%)', old_name, new_name, cnt;
        ELSE
            RAISE NOTICE 'skip % -> % (old_exists=%, new_exists=%)',
                old_name, new_name,
                to_regclass('public.' || old_name) IS NOT NULL,
                to_regclass('public.' || new_name) IS NOT NULL;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 重命名后校验: 应返回 19 行新表名
-- ============================================================================
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND (tablename LIKE 'pro\_%' OR tablename IN ('sys_login_logs', 'sys_operation_logs', 'sys_user_credentials'))
ORDER BY tablename;

-- ============================================================================
-- 回滚段 (需要时取消注释执行): 新名改回旧名
-- ============================================================================
-- DO $$
-- DECLARE
--     mapping jsonb := '{
--         "pro_projects":                     "projects",
--         "pro_modules":                      "modules",
--         "pro_phases":                       "phases",
--         "pro_progress_tasks":               "progress_tasks",
--         "pro_meetings":                     "meetings",
--         "pro_meeting_items":                "meeting_items",
--         "pro_project_members":              "project_members",
--         "pro_weekly_reports":               "weekly_reports",
--         "pro_weekly_kpis":                  "weekly_kpis",
--         "pro_weekly_progress_items":        "weekly_progress_items",
--         "pro_weekly_plan_tasks":            "weekly_plan_tasks",
--         "pro_weekly_risks":                 "weekly_risks",
--         "pro_weekly_work_tasks":            "weekly_work_tasks",
--         "pro_personal_reports":             "personal_reports",
--         "pro_personal_report_work_items":   "personal_report_work_items",
--         "pro_personal_report_plan_items":   "personal_report_plan_items",
--         "sys_login_logs":                   "login_logs",
--         "sys_operation_logs":               "operation_logs",
--         "sys_user_credentials":             "user_credentials"
--     }';
--     old_name text;
--     new_name text;
-- BEGIN
--     FOR old_name, new_name IN SELECT key, value FROM jsonb_each_text(mapping) LOOP
--         IF to_regclass('public.' || old_name) IS NOT NULL
--            AND to_regclass('public.' || new_name) IS NULL THEN
--             EXECUTE format('ALTER TABLE public.%I RENAME TO %I', old_name, new_name);
--             RAISE NOTICE 'renamed % -> %', old_name, new_name;
--         END IF;
--     END LOOP;
-- END $$;
