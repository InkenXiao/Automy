-- ============================================================
-- 多项目支持迁移脚本 (幂等, 可重复执行)
-- 给 meetings / progress_tasks / weekly_reports / weekly_work_tasks
--     / modules / phases 添加 project_id
--
-- 执行方式:
--   docker exec -i pg_db psql -U dbuser -d XIN < scripts/add_project_id.sql
-- ============================================================

-- 1. 添加 project_id 字段 (可空, 便于先填充数据再加约束)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE progress_tasks ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE weekly_work_tasks ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE phases ADD COLUMN IF NOT EXISTS project_id INTEGER;

-- 2. 填充现有数据的 project_id (取当前激活项目, 兜底取 id 最小的项目)
DO $$
DECLARE
    active_pid INTEGER;
BEGIN
    SELECT id INTO active_pid FROM projects WHERE is_active = TRUE AND is_delete = FALSE LIMIT 1;
    IF active_pid IS NULL THEN
        SELECT id INTO active_pid FROM projects WHERE is_delete = FALSE ORDER BY id LIMIT 1;
    END IF;
    IF active_pid IS NULL THEN
        active_pid := 1;
    END IF;

    UPDATE meetings SET project_id = active_pid WHERE project_id IS NULL;
    UPDATE progress_tasks SET project_id = active_pid WHERE project_id IS NULL;
    UPDATE weekly_reports SET project_id = active_pid WHERE project_id IS NULL;
    UPDATE weekly_work_tasks SET project_id = active_pid WHERE project_id IS NULL;
    UPDATE modules SET project_id = active_pid WHERE project_id IS NULL;
    UPDATE phases SET project_id = active_pid WHERE project_id IS NULL;
END $$;

-- 3. 设置 NOT NULL 约束 (现有数据已填充, 新增数据由应用层保证)
DO $$
BEGIN
    BEGIN EXECUTE 'ALTER TABLE meetings ALTER COLUMN project_id SET NOT NULL'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'ALTER TABLE progress_tasks ALTER COLUMN project_id SET NOT NULL'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'ALTER TABLE weekly_reports ALTER COLUMN project_id SET NOT NULL'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'ALTER TABLE weekly_work_tasks ALTER COLUMN project_id SET NOT NULL'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'ALTER TABLE modules ALTER COLUMN project_id SET NOT NULL'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'ALTER TABLE phases ALTER COLUMN project_id SET NOT NULL'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- 4. 创建索引 (加速按项目过滤查询)
CREATE INDEX IF NOT EXISTS idx_meetings_project_id ON meetings(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_tasks_project_id ON progress_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_project_id ON weekly_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_weekly_work_tasks_project_id ON weekly_work_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_modules_project_id ON modules(project_id);
CREATE INDEX IF NOT EXISTS idx_phases_project_id ON phases(project_id);

-- 5. 添加外键约束 (DO 块包装, 幂等避免重复创建报错)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_meetings_project') THEN
        ALTER TABLE meetings ADD CONSTRAINT fk_meetings_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_progress_tasks_project') THEN
        ALTER TABLE progress_tasks ADD CONSTRAINT fk_progress_tasks_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_weekly_reports_project') THEN
        ALTER TABLE weekly_reports ADD CONSTRAINT fk_weekly_reports_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_weekly_work_tasks_project') THEN
        ALTER TABLE weekly_work_tasks ADD CONSTRAINT fk_weekly_work_tasks_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_modules_project') THEN
        ALTER TABLE modules ADD CONSTRAINT fk_modules_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_phases_project') THEN
        ALTER TABLE phases ADD CONSTRAINT fk_phases_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 6. 添加字段备注
COMMENT ON COLUMN meetings.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目)';
COMMENT ON COLUMN progress_tasks.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目)';
COMMENT ON COLUMN weekly_reports.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目; 复制上周周报时继承源周报)';
COMMENT ON COLUMN weekly_work_tasks.project_id IS '★所属项目ID, 关联 projects.id (新建未传时默认用当前激活项目; 从周报批量生成时继承周报)';
COMMENT ON COLUMN modules.project_id IS '★所属项目ID, 关联 projects.id (模块字典按项目隔离)';
COMMENT ON COLUMN phases.project_id IS '★所属项目ID, 关联 projects.id (阶段字典按项目隔离)';
