# 表名前缀规范化（pro_/sys_）与 sys_users 数据同步修复计划

## 一、概述

对 XIN 库中与项目管理强相关的 16 张表加 `pro_` 前缀、2 张系统日志表加 `sys_` 前缀（共 18 张重命名），同步修改 pro-cowork / pro-site / rag-cowork / mcp-cowork 四个工程的全部引用点；并修复"pro-cowork 新增项目成员/修改密码不同步 sys_users"的数据一致性问题。

**已确认的三项决策**：
1. pro-site（8088 老工程）**同步修改**，保持 8088/8091 双运行、数据实时互通
2. 只改列举的 18 张表；agents/skills/task_runs/user_credentials 等 9 张智能体平台表**不动**
3. sys_users 同步采用 **pro-cowork 双写 + rag/mcp 启动种子改 upsert 兜底**

## 二、现状分析（Phase 1 探索结论）

### 2.1 重命名映射表（18 张）

| # | 现表名 | 新表名 | ORM 定义位置 |
|---|--------|--------|--------------|
| 1 | projects | pro_projects | pro-cowork/app/models/project.py；pro-site/app/models/project.py |
| 2 | modules | pro_modules | 两工程 models/module.py |
| 3 | phases | pro_phases | 两工程 models/phase.py |
| 4 | progress_tasks | pro_progress_tasks | 两工程 models/progress_task.py |
| 5 | meetings | pro_meetings | 两工程 models/meeting.py |
| 6 | meeting_items | pro_meeting_items | 两工程 models/meeting.py |
| 7 | project_members | pro_project_members | pro-cowork/app/models/project_member.py |
| 8 | weekly_reports | pro_weekly_reports | 两工程 models/weekly_report.py |
| 9 | weekly_kpis | pro_weekly_kpis | 两工程 models/weekly_report.py |
| 10 | weekly_progress_items | pro_weekly_progress_items | 两工程 models/weekly_report.py |
| 11 | weekly_plan_tasks | pro_weekly_plan_tasks | 两工程 models/weekly_report.py |
| 12 | weekly_risks | pro_weekly_risks | 两工程 models/weekly_report.py |
| 13 | weekly_work_tasks | pro_weekly_work_tasks | 两工程 models/work_task.py |
| 14 | personal_reports | pro_personal_reports | pro-cowork/app/models/personal_report.py |
| 15 | personal_report_work_items | pro_personal_report_work_items | 同上 |
| 16 | personal_report_plan_items | pro_personal_report_plan_items | 同上 |
| 17 | login_logs | sys_login_logs | pro-cowork/app/models/usage_log.py |
| 18 | operation_logs | sys_operation_logs | 同上 |

### 2.2 引用点清单（已逐一核实）

| 位置 | 引用点 | 数量 |
|------|--------|------|
| pro-cowork/app/models/*.py | `__tablename__` + `ForeignKey("projects.id")` 等字符串（含不改名表 agent.py:99、task_run.py:24 指向 projects 的 FK） | 16 个 tablename + 25 处 FK |
| pro-cowork/app/models/usage_log.py | login_logs / operation_logs 两个 `__tablename__` | 2 |
| pro-cowork/app/database.py | 启动幂等迁移的原生 SQL（ALTER TABLE projects/meetings/weekly_reports/personal_report_work_items、UPDATE project_members） | 10 处 |
| pro-site/app/models/*.py | `__tablename__`（12 张业务表）+ ForeignKey 字符串 | 12 个 tablename + 19 处 FK |
| rag-cowork/app/deps.py:39 | 原生 SQL 读 `project_members`（项目级知识库权限） | 1 |
| rag-cowork/app/mcp_tools.py:118 | 原生 SQL 读 `projects` | 1 |
| rag-cowork/app/routers/knowledge_bases.py:104,235 | 原生 SQL 读 `projects`（校验+下拉选项） | 2 |
| rag-cowork/app/database.py:75,82 | 种子读 `user_credentials`（不改名）+ `project_members`（改名） | 1 处需改 |
| mcp-cowork/app/database.py:64,72 附近 | 种子读 `user_credentials` + `project_members` | 1 处需改 |
| scripts/pro-site.sql / pro-cowork.sql | 全量建表脚本中的 DDL/DML | 全量更新 |
| scripts/add_project_id.sql | 历史迁移脚本（幂等 ADD COLUMN） | 同步更新表名 |
| scripts/db_comments.sql | 42 表注释（RENAME 后注释自动跟随，但文件需重新生成保持一致） | 重新生成 |
| README × 3 | 表名清单章节 | 同步更新 |

### 2.3 数据库层关键事实

- **25 个物理 FK 全部在 pro-cowork 表内部**（projects/phases/meetings/agents/task_runs 等互指）；rag_*/mcp_* 表对 projects 只有逻辑关联（裸 BigInteger），**无跨工程物理 FK**
- PostgreSQL `ALTER TABLE RENAME`：FK 约束、序列 OWNED BY、列默认值 `nextval()` 全部自动跟随，**零数据丢失**；约束名/索引名保留旧名（功能无损，本计划不强制改名，避免扩大变更面）
- 无引用这些表的视图/物化视图/触发器

### 2.4 sys_users 数据不一致根因

- rag-cowork/app/database.py `_seed_sys_users` 与 mcp-cowork/app/database.py 同名函数：**只在服务启动时执行一次**，且 `if name in existing: continue` —— 只插入新名字，**从不更新已有用户的 password_hash**
- 后果：① pro-cowork 新增项目成员后，rag/mcp 不重启则 sys_users 无此人（8092/8094 登录报"用户未注册"）；② 已存在用户在 pro-cowork 改密码后，sys_users 永不同步
- 当前数据库实测（刚重启后种子跑过）：project_members / user_credentials 与 sys_users **无差异**、密码有无状态无不一致
- 两体系密码哈希算法**完全一致**（pbkdf2_hmac sha256 / 10 万迭代 / `salt$hex`），可直接拷贝
- sys_users.name 有 `unique=True`，支持 `INSERT ... ON CONFLICT (name) DO UPDATE`

## 三、变更方案

### 3.1 数据库脚本（新增 1 个）

**新建 `scripts/rename_tables_pro_prefix.sql`**：
- 18 条 `ALTER TABLE <old> RENAME TO <new>;`，用 DO 块 + `to_regclass()` 判断实现幂等（新名已存在则跳过，旧名不存在则跳过）
- 附带重命名后行数校验查询（SELECT count 对比用）
- 执行：`docker exec -i pg_db psql -U dbuser -d XIN < scripts/rename_tables_pro_prefix.sql`

### 3.2 pro-cowork（8091）

1. **models/*.py（11 个文件）**：16 个 `__tablename__` 改新名；25 处 `ForeignKey("projects.id")` 等字符串改新表名；列 comment 中 `FK→projects.id` 描述同步改（保持注释准确）
2. **models/usage_log.py**：login_logs → sys_login_logs、operation_logs → sys_operation_logs
3. **app/database.py**：10 处原生 SQL 迁移语句的表名更新
4. **新增 app/services/snowflake.py**：雪花 ID 生成器（与 rag/mcp 同算法，`_EPOCH=1735689600000`，worker_id 取 **3**，rag=1/mcp=2 已占用）；config.py 加 `SNOWFLAKE_WORKER_ID: int = 3`
5. **新增 app/services/user_sync.py**：`async def sync_sys_user(db, name, password_hash=None)` — 按 name upsert sys_users（不存在则雪花 ID 新建，display_name=name，department 留空；password_hash 传 None 不触碰密码、传字符串则覆盖，含空串=清除密码）
6. **routers/project_members.py 双写**：
   - `POST /`（新增成员）：成员落库后调用 `sync_sys_user(db, name)`（不碰密码）
   - `PUT /{id}`（改名场景）：若 name 变更，同步新建新名字账号（旧账号保留不动，避免误删 rag/mcp 侧数据）
   - `DELETE /{id}`（逻辑删除成员）：**不同步删除** sys_users（成员可能属于其他项目，且 rag/mcp 数据需保留）
7. **routers/auth.py 双写**：
   - `POST /password`（设置/修改/清除密码）：user_credentials 提交前调用 `sync_sys_user(db, name, password_hash=new_hash)` 同步覆盖 sys_users.password_hash
   - 登录逻辑不变（仍走 user_credentials）

### 3.3 pro-site（8088）

- **app/models/*.py（8 个文件）**：12 个 `__tablename__` 改新名 + 19 处 ForeignKey 字符串改新表名（pro-site 无原生 SQL、无 user_credentials/login_logs 引用）

### 3.4 rag-cowork（8092/8093）

1. **app/deps.py:39**：`project_members` → `pro_project_members`
2. **app/mcp_tools.py:118**：`projects` → `pro_projects`
3. **app/routers/knowledge_bases.py:104,235**：`projects` → `pro_projects`
4. **app/database.py `_seed_sys_users`**：
   - 第 82 行 `project_members` → `pro_project_members`（75 行 user_credentials 不改名，保持）
   - 种子逻辑改 upsert：`INSERT ... ON CONFLICT (name) DO UPDATE SET password_hash = EXCLUDED.password_hash`（已有用户同步最新密码，含空串清除；新用户插入），删除 `if name in existing: continue` 跳过逻辑

### 3.5 mcp-cowork（8094）

- **app/database.py `_seed_sys_users`**：与 rag-cowork 相同改造（表名 + upsert）

### 3.6 scripts 既有脚本

- `scripts/pro-site.sql`、`scripts/pro-cowork.sql`：全量建表脚本中 18 张表名更新（DDL + 初始数据 DML + 注释）
- `scripts/add_project_id.sql`：表名更新保持幂等可重放
- `scripts/db_comments.sql`：全部代码改完后，用既有方法（容器内分进程读 ORM metadata）重新生成并应用

### 3.7 文档

- pro-cowork/README.md（5.1 表清单/5.3 建表逻辑等章节表名）
- rag-cowork/README.md（"pro-cowork projects.id" 等描述）
- mcp-cowork/README.md（种子描述）
- 操作手册/cowork-site README 无表名引用，不改

## 四、执行顺序（关键：避免 reload 窗口报错）

1. **备份**：`docker exec pg_db pg_dump -U dbuser XIN > /tmp/XIN_backup_$(date +%Y%m%d_%H%M).sql`（全库安全网）
2. **停容器**：`docker compose stop`（pg_db 独立容器不受影响）
3. **改代码**：3.2 ~ 3.6 全部文件修改（含重命名 SQL 脚本编写）
4. **执行 RENAME**：`docker exec -i pg_db psql ... < scripts/rename_tables_pro_prefix.sql`，逐表核对行数与约束
5. **启动**：`docker compose up -d`（代码卷挂载无需 build）
6. **重新生成并应用 db_comments.sql**
7. **冒烟验证**（见第五节）
8. **更新文档**（3.7）

## 五、验证步骤

1. **表结构**：`\dt` 确认 18 张新表名存在、旧名不存在；`pg_constraint` 确认 25 个 FK 仍有效；抽查 `pro_projects` 行数 = 重命名前 projects 行数
2. **各服务冒烟**：
   - 8088 pro-site：`GET /api/projects/`、`GET /api/weekly-reports/` 200 且有数据
   - 8091 pro-cowork：登录（已设密码账号密码通过）→ 项目/进度/会议/周报/成员/个人周报/操作日志各列表 200
   - 8092 rag-cowork：登录 → 知识库列表 → 项目级知识库可见性（deps.py 改的 SQL）→ RAG 问答一次
   - 8094 mcp-cowork：登录 → 服务列表 → 调用统计
3. **双写验证**（核心）：
   - pro-cowork 新增测试成员"测试同步"→ 立刻查 sys_users 存在该 name（不重启 rag/mcp）→ 用该姓名登录 8092 成功
   - pro-cowork 给"测试同步"设密码 → sys_users.password_hash 同步 → 8092 登录需密码且同密码通过 → pro-cowork 清除密码 → 8092 恢复姓名直登
   - 验证后删除测试成员与 sys_users 测试记录
4. **种子兜底验证**：直接 SQL 改 user_credentials 某测试密码 → 重启 xin-ai 容器 → sys_users 已 upsert
5. **注释完整**：42 表 `\d+` 抽查中文注释仍在；`obj_description` 统计 0 表缺注释

## 六、回滚方案

- 数据库：`rename_tables_pro_prefix.sql` 附反向 RENAME 段（注释形式，需时取消注释执行）；极端情况用 pg_dump 备份恢复
- 代码：`git checkout -- <file>` 逐文件回退（变更未提交前）

## 七、假设与边界

- FK 约束名/索引名/序列名保留旧命名（PG 允许，无功能影响），不做额外改名
- pro-site 无登录/成员管理功能（无 user_credentials 引用），双写只需在 pro-cowork 实现
- project_members 改名单纯新增新账号，不做账号合并/删除（防止误删 rag/mcp 侧已有业务数据）
- rag-cowork department 级知识库依赖 sys_users.department，该字段目前种子与双写均不填（保持现状，project_members 无部门信息来源）
