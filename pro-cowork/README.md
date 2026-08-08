# XIN · CoWork 项目管理智能体工作平台

> 由 pro-site 升级而来的项目管理智能体工作平台,基于 FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL。在完整保留「进度计划、项目会议、项目周报、每周工作任务」四大协同模块的基础上,新增「构建、调试、执行 Agent、Skill」平台能力,内置项目进度管理、项目会议管理、项目周报编写、周工作计划制作四大智能体,每个智能体具备感知、记忆、决策、交互、执行五大能力。
>
> - 界面导航分为三组:**工作台**(任务/智能体/技能)、**项目台**(进度计划/项目会议/项目周报/每周任务/项目成员/个人周报/操作日志)、**设计台**(智能体设计/技能设计/记忆维护)。
> - **登录认证**: 登录页 + 修改密码; 登录/操作日志统一落库 (`login_logs` / `operation_logs`), 提供操作日志看板与 LLM token 消耗统计。
> - **工作台任务**: 描述任务即自动意图识别 (项目/数字分身/技能), 未命中时执行窗口内交互式选择; 执行输出与补充对话上下布局, 可在同一任务会话中持续补充内容 (可追加文件/技能) 驱动 AI 继续执行。
> - **多模态附件**: 所有 AI 对话窗口 (任务补充区/数字分身对话/构建器调试/记忆测试) 统一支持「＋上传文件」与「Ctrl+V 黏贴图片/文件」; 图片走**图像识别**技能 (视觉多模态模型), PDF 走**文档解析**技能 (PyMuPDF 文本层 → mineru → paddleocr 逐级降级), 录音走**会议纪要生成**技能 (ASR 转写 + 纪要流式生成)。
> - **记忆按项目隔离**: `agent_memories.project_id` 关联项目,每个项目拥有独立记忆空间,对话/任务执行时自动注入当前项目记忆 + 通用记忆。
> - **权限控制**: 项目经理可维护项目成员与查看全部操作日志; 非经理仅查看/填写本人周报与本人操作日志; 未分配项目的用户在项目类视图中不可见业务数据。
> - 与 pro-site **共用 XIN 数据库**,12 张业务表结构零变更,数据实时互通;智能体相关新表仅增量添加。
> - 本服务运行在 **8091** 端口(pro-site 为 8088,互不影响)。

---

## 一、项目概述

本工程是「XIN · CoWork 项目管理智能体工作平台」的后端服务,运行在 **8091** 端口，对外提供 `/api/*` RESTful 接口，并在根路径挂载 `web/` 前端静态页面。其业务价值在于：

- 将项目「阶段 → 进度计划任务 → 周报下周任务 → 每周工作任务」打通为可追溯的关联链条；
- 周报结构化拆分为 KPI、本周进展、下周任务、风险四类子资源，支持批量保存与级联删除；
- 提供项目会议议程的父子结构管理，支持议程项排序与批量创建。

---

## 二、技术栈

| 类别 | 选型 | 版本（来自 `requirements.txt`） |
|------|------|--------------------------------|
| Web 框架 | FastAPI | `>=0.110.0` |
| ASGI 服务器 | Uvicorn | `>=0.27.0` |
| ORM | SQLAlchemy (async) | `>=2.0.25` |
| PG 异步驱动 | asyncpg | `>=0.29.0` |
| 配置管理 | pydantic-settings | `>=2.1.0` |
| 环境变量 | python-dotenv | `>=1.0.0` |
| 数据库 | PostgreSQL | 通过 asyncpg 连接 |
| 前端 | 原生 HTML/CSS/JS | 无构建工具，CDN 引入 `html2pdf.js`、`marked` |

---

## 三、代码结构

```text
pro-cowork/
├── run.py                      # 启动脚本: uvicorn 监听 0.0.0.0:8091, reload 监听 app/ 与 web/
├── requirements.txt            # Python 依赖清单
├── .env                        # 环境变量配置 (含密码, 勿提交)
├── README.md                   # 本文件
├── venv/                       # 本地虚拟环境 (venv/bin/python)
├── xintou_weekly_reports_2026-07-22.json   # 周报种子 JSON 数据
├── data/task_files/<project_id>/           # 任务附件落盘目录 (按项目隔离)
└── app/                        # FastAPI 后端应用
    ├── __init__.py
    ├── main.py                 # FastAPI 入口: lifespan/CORS/路由注册/静态文件挂载
    ├── config.py               # pydantic-settings 读取 .env (PG/系统/八通道模型配置)
    ├── database.py             # 异步引擎/会话工厂/Base/get_db/init_db
    ├── deps.py                 # 登录态/角色依赖 (HTTP 头中文名 latin-1 编码处理)
    ├── middleware.py           # 操作日志中间件 (写操作自动落 operation_logs)
    ├── utils.py                # get_active_project_id 等公共工具
    ├── seed.py                 # 种子脚本: 模块/阶段/进度计划任务
    ├── seed_weekly_reports.py  # 种子脚本: 从 SQLite 解析周报写入 PG
    ├── seed_weekly_from_json.py# 种子脚本: 从 JSON 同步周报
    ├── models/                 # SQLAlchemy ORM 模型
    │   ├── base.py             # Base + TimestampMixin (created_at/updated_at)
    │   ├── project.py          # projects 表: 项目元信息 (含 manager/status)
    │   ├── project_member.py   # project_members 表: 项目成员
    │   ├── module.py / phase.py / progress_task.py / meeting.py / weekly_report.py / work_task.py
    │   ├── agent.py            # agents/agent_sessions/agent_messages/agent_memories
    │   ├── skill.py            # skills/skill_executions
    │   ├── task_run.py         # task_runs/task_run_events (执行事件持久化, SSE 重放)
    │   ├── personal_report.py  # personal_reports + 工作内容/下周计划子表
    │   ├── user_credential.py  # user_credentials 登录账号
    │   └── usage_log.py        # login_logs / operation_logs
    ├── routers/                # API 路由 (统一前缀 /api)
    │   ├── auth.py             # 登录/改密/成员身份确认
    │   ├── projects.py / modules.py / phases.py / progress_tasks.py / meetings.py
    │   ├── weekly_reports.py / work_tasks.py
    │   ├── project_members.py  # 项目成员维护
    │   ├── personal_reports.py # 个人周报 (含 Excel 导出)
    │   ├── usage_logs.py       # 操作日志看板 + token 统计
    │   ├── agents.py           # 智能体 CRUD/会话/对话(SSE)/调试(Trace)/记忆
    │   ├── skills.py           # 技能 CRUD/试运行/执行记录
    │   └── task_runs.py        # 工作台任务 + 事件流 SSE + 附件上传/清空
    ├── services/               # 业务服务层
    │   ├── llm.py              # ★模型客户端工厂: MAIN/SMALL/CODER/EMBEDDING/RERANKER/VISION 六通道
    │   ├── agent_engine.py     # function calling 主循环 (MAIN 模型)
    │   ├── agent_tools.py      # 17+ 业务工具定义与执行
    │   ├── agent_context.py    # 项目快照感知注入
    │   ├── agent_presets.py    # 四大预置智能体播种
    │   ├── intent_service.py   # 意图识别 (SMALL 模型: 项目/分身/技能自动选择)
    │   ├── skill_engine.py     # 技能工作流引擎 (内置能力: 会议纪要/周小结/图像识别/文档解析)
    │   ├── skill_presets.py    # 预置技能播种
    │   ├── task_runner.py      # 任务后台执行器 (事件总线 + 持久化)
    │   ├── minutes_service.py  # 会议纪要流式生成 (MAIN 模型)
    │   ├── digest_service.py   # 周工作小结概括 (SMALL 模型)
    │   ├── asr_service.py      # 录音转写 (ASR_API_URL, 分片上传, 分段回调)
    │   ├── vision_service.py   # 图像识别 (VISION 视觉多模态模型, base64 内联)
    │   ├── doc_parse_service.py# PDF 文档解析 (PyMuPDF → mineru → paddleocr 逐级降级)
    │   ├── file_prompt.py      # ★附件→提示词公共模块 (按扩展名指引技能/内联文本)
    │   ├── excel_export.py     # 周报 Excel 导出
    │   └── log_service.py      # 操作日志/LLM token 统一落库
    └── schemas/                # Pydantic v2 模型 (Create/Update/Out)
└── web/                        # 前端静态资源 (由 FastAPI StaticFiles 挂载到 /)
    ├── index.html              # 单页入口 (登录页 + 左侧导航 + 主区)
    ├── css/                    # workbench.css / cowork.css / auth.css 等
    └── js/
        ├── api.js              # 统一 fetch 封装, baseUrl=/api
        ├── app.js / auth.js    # 视图切换 / 登录与改密
        ├── cowork.js           # ★智能体平台前端 (任务/对话/构建器/技能/记忆 + ChatAttach 附件公共组件)
        ├── progress-plan.js / meeting.js / weekly-report.js / work-tasks.js
        ├── project-team.js     # 项目成员视图
        └── personal-report.js  # 个人周报视图
```

---

## 四、核心业务模块

| 模块 | 路由文件 | 模型 | 职责 |
|------|----------|------|------|
| 项目元信息 | `app/routers/projects.py` | `Project` | 管理多项目（如「信投AI2.0」），`is_active` 标识当前项目；`GET /active` 在无项目时幂等创建默认项目 |
| 模块字典 | `app/routers/modules.py` | `Module` | 维护六大模块（底座/数据/智能体/应用/需求/协调），含颜色配置，作为周报与任务的归类维度 |
| 阶段字典 | `app/routers/phases.py` | `Phase` | 维护项目三阶段（有得用/用起来/用得好）及起止日期，供进度计划任务归属 |
| 进度计划 | `app/routers/progress_tasks.py` | `ProgressTask` | 项目甘特任务（含里程碑 `is_milestone`），按 `task_uid` 唯一标识，支持按 `phase_id`/`status` 筛选与状态切换 |
| 项目会议 | `app/routers/meetings.py` | `Meeting` / `MeetingItem` | 会议主记录 + 议程项父子结构，议程项按 `sort_order` 排序，会议删除级联议程项 |
| 项目周报 | `app/routers/weekly_reports.py` | `WeeklyReport` 及 4 子表 | 周报主体 + KPI（每模块一条，唯一约束）/ 本周进展 / 下周任务 / 风险；下周任务可关联进度计划任务 |
| 每周工作任务 | `app/routers/work_tasks.py` | `WeeklyWorkTask` | 周任务执行层，可关联周报下周任务（`plan_task_id`），支持「从周报下周任务批量生成」 |

**核心关联链路**：`Phase → ProgressTask → WeeklyPlanTask(周报下周任务) → WeeklyWorkTask(每周工作任务)`，四张表通过外键串联，实现计划到执行的追溯。

---

## 五、数据模型与数据库脚本

### 5.1 表清单与字段

| 模型类 | 表名 | 文件 | 关键字段 |
|--------|------|------|----------|
| `Project` | `projects` | `app/models/project.py` | `id`, `name`, `title`, `based_doc`, `start_date`, `end_date`, `is_active`, `sort_order` |
| `Module` | `modules` | `app/models/module.py` | `id`, **`project_id`(FK→projects)**, `idx`, `tag`, `title`, `owner`, `color`, `color_bg`, `sort_order` |
| `Phase` | `phases` | `app/models/phase.py` | `id`, **`project_id`(FK→projects)**, `name`, `subtitle`, `description`, `start_date`, `end_date` |
| `ProgressTask` | `progress_tasks` | `app/models/progress_task.py` | `id`, **`project_id`(FK→projects)**, `task_uid`(unique), `name`, `phase_id`(FK→phases), `start_date`, `end_date`, `status`, `full_desc`, `owner`, `is_milestone` |
| `Meeting` | `meetings` | `app/models/meeting.py` | `id`, **`project_id`(FK→projects)**, `title`, `meet_date`, `meet_time`, `place`, `host`, `attendees`, `description`, `sort_order` |
| `MeetingItem` | `meeting_items` | `app/models/meeting.py` | `id`, `meeting_id`(FK→meetings, CASCADE), `item_time`, `theme`, `speaker`, `duration`, `note`, `description`, `sort_order` |
| `WeeklyReport` | `weekly_reports` | `app/models/weekly_report.py` | `id`, **`project_id`(FK→projects)**, `title`, `week_range`, `week_start`, `week_end`, `overview_summary`, `status`(draft/submitted) |
| `WeeklyKpi` | `weekly_kpis` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `module_id`(FK), `progress_pct`, `status`；唯一约束 `uq_kpi_report_module(report_id, module_id)` |
| `WeeklyProgressItem` | `weekly_progress_items` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `module_id`(FK), `content`, `detail`, `sort_order` |
| `WeeklyPlanTask` | `weekly_plan_tasks` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `module_id`(FK), `progress_task_id`(FK→progress_tasks, 可空), `name`, `is_key`, `owner`, `plan_period`, `status`, `remark`, `sort_order` |
| `WeeklyRisk` | `weekly_risks` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `seq`, `title`, `coordination`, `urgency`, `sort_order` |
| `WeeklyWorkTask` | `weekly_work_tasks` | `app/models/work_task.py` | `id`, **`project_id`(FK→projects)**, `week_start`, `week_end`, `plan_task_id`(FK→weekly_plan_tasks, 可空), `name`, `module_id`(FK, 可空), `owner`, `is_temporary`, `priority`, `status`, `planned_hours`, `actual_hours`, `remark`, `sort_order` |

> ★ **多项目隔离**：`modules` / `phases` / `progress_tasks` / `meetings` / `weekly_reports` / `weekly_work_tasks` 6 张顶级业务表均含 `project_id` 外键（关联 `projects.id`，ON DELETE CASCADE）。子表（`meeting_items` / `weekly_kpis` / `weekly_progress_items` / `weekly_plan_tasks` / `weekly_risks`）通过父表的 `project_id` 间接隔离，无需冗余字段。所有 list 接口支持 `?project_id=N` 查询参数，不传时默认用当前激活项目（`is_active=true`）。

> 除 `WeeklyKpi` / `WeeklyProgressItem` / `WeeklyRisk` 外，其余模型均混入 `TimestampMixin`，自动维护 `created_at` / `updated_at`（带时区）。

### 5.2 表间关系

```text
Project (独立, is_active 标识当前项目)

Phase 1──N ProgressTask 1──N WeeklyPlanTask 1──N WeeklyWorkTask
                                  │
Module 1──N ──────────────────────┤ (module_id)
Module 1──N WeeklyKpi            │
Module 1──N WeeklyProgressItem   │
Module 1──N WeeklyWorkTask ──────┘

WeeklyReport 1──N WeeklyKpi          (CASCADE)
WeeklyReport 1──N WeeklyProgressItem (CASCADE)
WeeklyReport 1──N WeeklyPlanTask     (CASCADE)
WeeklyReport 1──N WeeklyRisk         (CASCADE)
WeeklyKpi: UniqueConstraint(report_id, module_id)

Meeting 1──N MeetingItem (CASCADE)
```

### 5.3 建表逻辑

- **自动建表**：`app/database.py` 的 `init_db()` 在应用 lifespan 启动时执行 `Base.metadata.create_all`，开发阶段无需手动建表（仅创建缺失的表，不修改已有表结构）。
- **完整数据库脚本**：`scripts/pro-site.sql` 包含全部 12 张表的建表语句、索引、外键、字段备注，以及初始字典数据（2 个项目、6 个模块、3 个阶段）。幂等可重复执行。

```bash
# 全新部署时执行完整脚本 (建表 + 初始数据)
docker exec -i pg_db psql -U dbuser -d XIN < scripts/pro-site.sql

# 已有库升级 (补充 project_id 字段)
docker exec -i pg_db psql -U dbuser -d XIN < scripts/add_project_id.sql
```

- **字段变更迁移**：`scripts/add_project_id.sql` 为多项目支持迁移脚本，给 6 张顶级表添加 `project_id` 字段并填充现有数据。幂等可重复执行。

### 5.4 数据库脚本清单

| 脚本 | 作用 | 执行方式 |
|------|------|----------|
| `scripts/pro-site.sql` | pro-site 完整建表 + 初始数据 | `docker exec -i pg_db psql -U dbuser -d XIN < scripts/pro-site.sql` |
| `scripts/abs-site.sql` | abs-site 完整建表 | `docker exec -i pg_db psql -U dbuser -d XIN < scripts/abs-site.sql` |
| `scripts/add_project_id.sql` | 多项目支持迁移 (加 project_id) | `docker exec -i pg_db psql -U dbuser -d XIN < scripts/add_project_id.sql` |
| `scripts/db_comments.sql` | 全部表与字段备注 | `docker exec -i pg_db psql -U dbuser -d XIN < scripts/db_comments.sql` |

### 5.5 种子脚本

| 脚本 | 作用 | 执行方式 |
|------|------|----------|
| `app/seed.py` | 写入 6 个模块、3 个阶段、若干进度计划任务 | `python -m app.seed` (空库插入) / `--force` 强制覆盖 |
| `app/seed_weekly_reports.py` | 从 SQLite 解析周报写入 PG | `python -m app.seed_weekly_reports` / `--force` / `--dry-run` |
| `app/seed_weekly_from_json.py` | 从 `text.txk` JSON 同步周报 | `python -m app.seed_weekly_from_json` / `--force` / `--dry-run` |

---

## 六、API 接口清单

所有接口统一前缀 `/api`，由 `app/main.py` 通过 `app.include_router(router, prefix="/api")` 注册。

### 6.1 项目元信息（`/api/projects`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects/` | 获取全部项目（按 sort_order, id 排序） |
| GET | `/api/projects/active` | 获取当前激活项目；无项目时幂等创建默认项目 |
| GET | `/api/projects/{project_id}` | 获取单个项目 |
| POST | `/api/projects/` | 新建项目；若标记 active 则取消其他项目 active |
| PUT | `/api/projects/{project_id}` | 更新项目；置 active 时取消其他 active |
| PATCH | `/api/projects/{project_id}/activate` | 将指定项目置为激活 |
| DELETE | `/api/projects/{project_id}` | 删除项目 |

### 6.2 模块字典（`/api/modules`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/modules/` | 获取所有模块（按 sort_order 排序） |
| GET | `/api/modules/{item_id}` | 获取模块详情 |
| POST | `/api/modules/` | 新建模块 |
| PUT | `/api/modules/{item_id}` | 更新模块 |

### 6.3 阶段字典（`/api/phases`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/phases/` | 获取所有阶段（按 start_date 排序） |

### 6.4 进度计划（`/api/progress-tasks`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/progress-tasks/` | 列表，支持 `phase_id` / `status` 查询参数筛选 |
| GET | `/api/progress-tasks/{item_id}` | 获取进度计划任务详情（含 phase） |
| POST | `/api/progress-tasks/` | 新建进度计划任务 |
| PUT | `/api/progress-tasks/{item_id}` | 更新进度计划任务 |
| PATCH | `/api/progress-tasks/{item_id}/status` | 仅更新状态（body: `{status}`） |
| DELETE | `/api/progress-tasks/{item_id}` | 删除进度计划任务 |

### 6.5 项目会议（`/api/meetings`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/meetings/` | 获取所有会议（含议程项，按 sort_order 排序） |
| GET | `/api/meetings/{meeting_id}` | 获取会议详情（含议程项） |
| POST | `/api/meetings/` | 创建会议（可携带议程项批量创建） |
| PUT | `/api/meetings/{meeting_id}` | 更新会议主记录 |
| DELETE | `/api/meetings/{meeting_id}` | 删除会议（级联删除议程项） |
| POST | `/api/meetings/{meeting_id}/items` | 新增议程项 |
| PUT | `/api/meetings/{meeting_id}/items/{item_id}` | 更新议程项 |
| DELETE | `/api/meetings/{meeting_id}/items/{item_id}` | 删除议程项 |

### 6.6 项目周报（`/api/weekly-reports`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/weekly-reports/` | 周报列表（支持 `?project_id=N` 过滤，不传用激活项目；按 week_start 倒序） |
| GET | `/api/weekly-reports/{report_id}` | 周报详情（含 KPI/进展/下周任务/风险） |
| POST | `/api/weekly-reports/` | 新建周报（`project_id` 未传时用激活项目） |
| POST | `/api/weekly-reports/copy-last` | ★复制上周周报：只复制子表内容（KPI/进展/任务/风险），主表（标题/周次/总结）新生成；下周任务状态重置为"待开始" |
| PUT | `/api/weekly-reports/{report_id}` | 更新周报 |
| DELETE | `/api/weekly-reports/{report_id}` | 删除周报（级联删除子表） |
| POST | `/api/weekly-reports/{report_id}/plan-tasks` | 新增下周任务 |
| PUT | `/api/weekly-reports/{report_id}/plan-tasks/{task_id}` | 更新下周任务 |
| DELETE | `/api/weekly-reports/{report_id}/plan-tasks/{task_id}` | 删除下周任务 |
| POST | `/api/weekly-reports/{report_id}/plan-tasks/link` | 从进度计划任务关联生成下周任务（body: `{progress_task_id, module_id}`） |
| POST | `/api/weekly-reports/{report_id}/kpis` | 批量保存 KPI（按 module_id upsert） |
| DELETE | `/api/weekly-reports/{report_id}/kpis/{kpi_id}` | 删除单个 KPI |
| POST | `/api/weekly-reports/{report_id}/progress-items` | 新增进展事项 |
| PUT | `/api/weekly-reports/{report_id}/progress-items/{item_id}` | 更新进展事项 |
| DELETE | `/api/weekly-reports/{report_id}/progress-items/{item_id}` | 删除进展事项 |
| POST | `/api/weekly-reports/{report_id}/risks` | 新增风险 |
| PUT | `/api/weekly-reports/{report_id}/risks/{risk_id}` | 更新风险 |
| DELETE | `/api/weekly-reports/{report_id}/risks/{risk_id}` | 删除风险 |

### 6.7 每周工作任务（`/api/work-tasks`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/work-tasks/` | 列表，支持 `week_start` 查询参数筛选 |
| GET | `/api/work-tasks/{item_id}` | 获取每周工作任务详情 |
| POST | `/api/work-tasks/` | 新建每周工作任务 |
| POST | `/api/work-tasks/from-plan/{report_id}` | 从周报下周任务批量生成（body: `{week_start, week_end}`） |
| PUT | `/api/work-tasks/{item_id}` | 更新每周工作任务 |
| DELETE | `/api/work-tasks/{item_id}` | 删除每周工作任务 |

### 6.8 工作台任务（`/api/task-runs`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/task-runs/` | 任务列表, 支持 `?project_id=N&status=done` 过滤 |
| POST | `/api/task-runs/` | 创建任务 (body: `project_id/agent_id/skill_ids[]/file_names[]/input_text`) |
| GET | `/api/task-runs/{run_id}` | 任务详情 (含 status/result_text/session_id) |
| DELETE | `/api/task-runs/{run_id}` | 删除任务 |
| GET | `/api/task-runs/{run_id}/messages` | 任务会话消息列表 (对话回放) |
| POST | `/api/task-runs/{run_id}/run` | 执行任务 (SSE: content/tool_call/tool_result/done/error) |
| POST | `/api/task-runs/{run_id}/continue` | ★继续对话: 补充内容+追加文件/技能, 在原会话中继续执行 (SSE), 结果追加到 result_text |
| GET | `/api/task-runs/{run_id}/events?after_seq=N` | ★任务事件流 (SSE): 重放持久化事件 + 实时 tail, 支持断线续看与续跑轮次回放 |
| POST | `/api/task-runs/files/upload?project_id=N` | 上传任务附件 (multipart, 按项目分目录, ≤200MB 支持录音文件) |
| GET | `/api/task-runs/files/list?project_id=N` | 列出项目附件 |
| DELETE | `/api/task-runs/files/{filename}?project_id=N` | 删除附件 |
| DELETE | `/api/task-runs/files?project_id=N` | 清空项目全部附件 (重开新建任务页时默认调用) |

### 6.9 认证与成员（`/api/auth`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 (成员姓名 + 密码; 首次登录未设密码时引导设置) |
| POST | `/api/auth/change-password` | 修改密码 |
| GET | `/api/auth/members` | 成员身份确认列表 (登录页选择姓名) |

### 6.10 项目成员（`/api/project-members`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/project-members/?project_id=N` | 项目成员列表 |
| POST | `/api/project-members/` | 添加成员 (姓名/角色岗位/入组时间) |
| PUT | `/api/project-members/{id}` | 更新成员 (含 在职/退出 状态) |
| DELETE | `/api/project-members/{id}` | 移除成员 (逻辑删除) |

### 6.11 个人周报（`/api/personal-reports`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/personal-reports/?week_start=...&user_name=...` | 列表 (非项目经理仅见本人) |
| POST | `/api/personal-reports/` | 新建 (工作内容行 + 下周计划, 实时汇总工时) |
| PUT | `/api/personal-reports/{id}` | 更新 |
| DELETE | `/api/personal-reports/{id}` | 删除 (逻辑删除) |
| GET | `/api/personal-reports/{id}/export` | 导出 Excel (与参考格式一致) |

### 6.12 使用日志（`/api/usage-logs`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/usage-logs/operations` | 操作日志看板 (非经理仅见本人操作) |
| GET | `/api/usage-logs/llm-stats` | LLM token 消耗统计 (全员可见统计) |

---

## 七、配置说明

配置由 `app/config.py` 通过 `pydantic-settings` 从 `pro-cowork/.env` 读取。**实际消费三组变量：PostgreSQL、系统配置、八通道模型配置**；其余变量为整体平台预留（Redis / Milvus / Neo4j / MinIO 等），本工程未引用。

> 下方仅列变量名与含义，**不包含任何真实密码值**。

### 7.1 PostgreSQL（本工程实际使用）

| 变量名 | 含义 |
|--------|------|
| `POSTGRES_HOST` | PostgreSQL 主机地址（`.env` 默认 `localhost`，容器内部署改 `pg_db`） |
| `POSTGRES_PORT` | PostgreSQL 端口（`.env` 默认 `11000`，对应宿主机映射端口；容器内为 `5432`） |
| `POSTGRES_DB` | 数据库名（`XIN`） |
| `POSTGRES_USER` | 数据库用户名 |
| `POSTGRES_PASSWORD` | 数据库密码 |
| `DATABASE_URL` | 完整异步连接串（本工程未直接使用，`config.py` 由分段变量拼接 `postgresql+asyncpg://...`） |

### 7.2 系统配置（本工程实际使用）

| 变量名 | 含义 |
|--------|------|
| `DEBUG` | 调试模式开关，控制 SQLAlchemy `echo` 日志 |
| `LOG_LEVEL` | 日志级别（`INFO`） |
| `LOG_FORMAT` | 日志格式（`json`） |
| `ENVIRONMENT` | 运行环境标识（`development`） |

### 7.3 模型配置（八通道, 按用途分离）

所有模型调用统一经 `app/services/llm.py` 客户端工厂按用途取配置 (除 ASR/TTS 为直连 HTTP), 均为 OpenAI 兼容协议。未配置的通道对应能力降级提示, 不影响其余功能。

| 通道前缀 | 用途 | 消费方 |
|----------|------|--------|
| `MAIN_API_URL/KEY/MODEL` | **主推理模型**: 智能体对话 function calling 主循环、会议纪要生成 | `agent_engine.py` / `minutes_service.py` |
| `SMALL_API_URL/KEY/MODEL` | **轻量快推模型**: 意图识别、内容润色、周工作小结概括; 未配置时回退 MAIN | `intent_service.py` / `digest_service.py` |
| `CODER_API_URL/KEY/MODEL` | **代码生成模型** (预留: AI coding) | `llm.coder_client()` |
| `EMBEDDING_API_URL/KEY/MODEL` | **向量抽取模型** (知识库构建) | `llm.embedding_client()` |
| `RERANKER_API_URL/KEY/MODEL` | **结果重排模型** (RAG 重排) | `llm.reranker_client()` |
| `VISION_API_URL/KEY/MODEL` | **视觉多模态模型**: 图片附件内容识别 | `vision_service.py` (图像识别技能) |
| `ASR_API_URL/KEY/MODEL` + `ASR_CHUNK_MS` | **语音转文字**: 录音分片转写 | `asr_service.py` (会议纪要技能前置) |
| `TTS_API_URL/KEY/MODEL` + `TTS_CHUNK_MS` | **文字合成语音** (预留) | — |

> 当前部署经 new-api 网关 (model-api 容器, `:8000`) 按模型名路由: `LLM`→智科 vLLM 主推理, `VLM`→视觉模型, `EMBEDDING`/`RERANKER`→向量/重排; ASR 直连 `192.168.1.13:18888` (paraformer-large)。

### 7.4 平台预留变量（本工程未引用，仅 .env 占位）

| 分组 | 变量名 |
|------|--------|
| Redis | `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` / `REDIS_PASSWORD` / `REDIS_URL` |
| Milvus | `MILVUS_HOST` / `MILVUS_PORT` / `MILVUS_USER` / `MILVUS_PASSWORD` / `MILVUS_COLLECTION` |
| Neo4j | `NEO4J_HOST` / `NEO4J_PORT` / `NEO4J_USER` / `NEO4J_PASSWORD` / `NEO4J_URI` / `NEO4J_HEAP` / `NEO4J_PAGECACHE` |
| MinIO | `MINIO_HOST` / `MINIO_PORT` / `MINIO_ROOT_USER` / `MINIO_PASSWORD` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` / `MINIO_ENDPOINT` |
| ClickHouse | `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` |
| MySQL | `MYSQL_ROOT_PASSWORD` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` |
| MongoDB | `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` / `MONGO_INITDB_DATABASE` |

---

## 八、启动命令

服务固定监听 **8091** 端口，启动脚本见 `run.py`（`host=0.0.0.0`, `port=8091`, `reload=True`, `reload_dirs=["app","web"]`）。

### 8.1 本地开发启动

```bash
# 进入工程目录
cd /mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork

# 使用工程自带 venv 启动 (开发模式, 自动重载 app/ 与 web/ 下文件变更)
./venv/bin/python run.py
```

启动成功后：

- 后端 API 文档（Swagger）：`http://localhost:8091/docs`
- 前端工作台：`http://localhost:8091/`

> 生产/无重载场景可执行：`./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8091`

### 8.2 Docker 容器部署 (推荐)

本工程与 `xin-site` / `abs-site` 共同打包到单一 Docker 容器，详见仓库根目录 `Dockerfile` 与 `docker-compose.yml`。

```bash
# 在仓库根目录执行
cd /mnt/data0/ai_deployment/proj/src/xin-ai

# 一键启动 (源码挂载, 改代码无需 rebuild)
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

容器内 pro-cowork 以 `uvicorn --reload` 模式运行，修改 `pro-cowork/app/` 下 Python 文件后自动重载。

> 依赖变更（`requirements.txt`）才需重新 build：`docker compose down -v && docker compose up -d --build`

---

## 九、依赖安装

```bash
cd /mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork

# 方式一: 使用现有 venv 升级依赖
./venv/bin/pip install -r requirements.txt

# 方式二: 新建虚拟环境
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

`requirements.txt` 内容：

```text
fastapi>=0.110.0
uvicorn>=0.27.0
sqlalchemy[asyncio]>=2.0.25
asyncpg>=0.29.0
pydantic-settings>=2.1.0
python-dotenv>=1.0.0
openai>=1.30.0
python-multipart>=0.0.9
httpx>=0.27.0
pydub>=0.25.1
openpyxl>=3.1.0
PyMuPDF>=1.24.0
```

> 注：`app/seed_weekly_reports.py` 使用了 `beautifulsoup4`（`from bs4 import BeautifulSoup`），但该依赖**未在 `requirements.txt` 中声明**，运行该种子脚本前需手动 `pip install beautifulsoup4`。
> PDF 扫描件 OCR 为可选增强: 需要时手动 `pip install magic-pdf[full]` (mineru) 或 `pip install paddlepaddle paddleocr`; 未安装时扫描件解析给出降级提示。

---

## 十、开发指南

### 10.1 自动重载

`run.py` 已配置 `reload=True` 且 `reload_dirs=["app", "web"]`，修改 `app/` 下 Python 文件或 `web/` 下静态文件后，Uvicorn 会自动重启服务，无需手动停止。

### 10.2 异步 ORM 注意事项

- 会话由 `app/database.py` 的 `get_db()` 依赖提供，自动提交/回滚/关闭。
- 涉及子表关系时**禁止懒加载**（异步上下文会报错），路由中已统一使用 `selectinload` 预加载，并在写操作后重新 `_load_*` 加载完整对象。
- Pydantic Out 模型对未加载的关系字段使用 `field_validator(mode="before")` 将 `None` 转为 `[]`，避免序列化异常。

### 10.3 新增业务模块的套路

以新增「XX」模块为例，遵循以下三件套：

1. **Model**：在 `app/models/xx.py` 定义 `class XX(Base, TimestampMixin)`，并在 `app/models/__init__.py` 中 `from app.models.xx import XX` 同时加入 `__all__`（**注意避免当前 `Project` 那种只写 `__all__` 不 import 的问题**）。
2. **Schema**：在 `app/schemas/xx.py` 定义 `XXBase` / `XXCreate` / `XXUpdate` / `XXOut`，`Out` 类配 `model_config = ConfigDict(from_attributes=True)`；在 `app/schemas/__init__.py` 汇总导出。
3. **Router**：在 `app/routers/xx.py` 创建 `router = APIRouter(prefix="/xxs", tags=["XX"])`，编写 CRUD；在 `app/routers/__init__.py` 导入，并在 `app/main.py` 的 `for router in [...]` 列表中追加 `xx.router`（统一前缀 `/api` 由 `main.py` 注入，router 内不要再加 `/api`）。

### 10.4 前端联动

前端 `web/js/api.js` 封装了 `API.request(path)`，`baseUrl='/api'`。新增模块后只需在对应 `web/js/xx.js` 中调用 `API.request('/xxs/')` 即可对接，无需改 `api.js`。

### 10.5 数据库变更

开发阶段依赖 `init_db()` 的 `create_all` 自动建新表；**字段变更不会自动迁移**，需手动 `ALTER TABLE` 或重置库。生产环境建议引入 Alembic（当前未集成）。

---

## 十一、智能体平台 (pro-cowork 新增)

### 11.1 平台能力

| 能力 | 实现 |
|------|------|
| 构建 Agent | `POST/PUT /api/agents` + 前端智能体构建器 (prompt/工具/config 编辑) |
| 调试 Agent | `POST /api/agents/{id}/debug` 返回结构化 Trace (每轮 messages/tool_calls/工具入参出参/耗时) |
| 执行 Agent | `POST /api/agents/{id}/chat` SSE 流式对话 + function calling 工具执行 |
| Skill 能力 | `POST/PUT /api/skills` 构建 JSON 工作流技能, `POST /api/skills/{id}/execute` 试运行并留痕 (`skill_executions` 表) |

### 11.2 四大预置智能体与五大能力

启动时幂等播种四大智能体 (`app/services/agent_presets.py`):进度管理助手 / 会议管理助手 / 周报编写助手 / 工作计划助手。每个智能体具备:

- **感知**: 对话前注入项目快照 (`app/services/agent_context.py`: 激活项目/进度统计/逾期任务/最近会议/最新周报/本周任务) + 当前日期;
- **记忆**: `agent_memories` 表,支持 Agent 通过 `save_memory` 工具主动沉淀,对话时自动注入最近 20 条;
- **决策**: OpenAI 兼容 function calling 循环 (max 5 轮),SSE 输出结构化 `tool_call`/`tool_result` 事件;
- **交互**: SSE 流式对话 + 会话管理 (新建/列表/改名/归档);
- **执行**: 17 个业务工具 (`app/services/agent_tools.py`) + `run_skill` 调用技能工作流。

### 11.3 新增数据表 (仅增量, 业务表零变更)

智能体平台: `agents` / `agent_sessions` / `agent_messages` / `agent_memories` / `skills` / `skill_executions` / `task_runs` / `task_run_events`; 认证与协作: `user_credentials` / `project_members` / `personal_reports` + 2 张子表 / `login_logs` / `operation_logs`。建表见 `scripts/pro-cowork.sql` (幂等),开发期由 `init_db()` 自动创建。

- `agent_memories.project_id`: 记忆按项目隔离, 对话/调试/任务执行时注入「当前项目记忆 + 通用记忆(project_id 为空)」;存量记忆已幂等回填到首个项目
- `task_runs`: 工作台任务记录 (project_id/agent_id/skill_ids/file_names/status/result_text/session_id), 附件落盘 `data/task_files/<project_id>/`
- `task_run_events`: 任务执行事件持久化 (seq 递增), 支持 SSE 重放/断线续看/续跑多轮次回放
- 全平台删除均为**逻辑删除** (`is_delete`), 前端删除操作不再弹确认框

### 11.4 工作台任务 (TaskRun)

任务页 (工作台→任务) 支持「描述即任务」的自动执行:

1. 左侧创建任务: 上传并勾选附件, 填写任务描述; **意图识别** (SMALL 模型) 自动选择 项目/数字分身/技能, 未命中时执行窗口内弹出交互式选择面板, 选择结果记入分身长期记忆;
2. 右侧上方「执行输出」窗口流式渲染: 意图识别过程、AI 回复、工具调用轨迹 (可折叠)、录音转写文字、流式会议纪要、周工作小结;
3. 右侧下方「补充对话区」: 在原任务会话中继续补充内容, 支持「＋上传 / Ctrl+V 黏贴」追加附件 (图片→图像识别, PDF→文档解析, 录音→会议纪要), Enter 发送, AI 携带完整会话上下文继续执行, 结果在同一输出窗口继续流式输出;
4. 重新打开页面默认清空历史附件 (任务执行中时跳过); 点击历史任务可回放完整执行过程并继续追问。

### 11.5 多模态附件处理 (公共能力)

前端 `ChatAttach` 公共组件 (`web/js/cowork.js`) 为所有 AI 对话窗口 (任务补充区/数字分身对话/构建器调试/记忆测试) 统一提供「＋上传文件」与「Ctrl+V 黏贴图片/文件」; 后端 `app/services/file_prompt.py` 按扩展名将附件转为提示词指引, 由 Agent 经 `run_skill` 调用对应内置能力:

| 附件类型 | 内置能力 | 处理链路 |
|----------|----------|----------|
| 图片 (png/jpg/...) | `image_recognition` 图像识别 | `vision_service.py` → VISION 视觉多模态模型 (base64 内联) |
| PDF | `doc_parsing` 文档解析 | `doc_parse_service.py` → PyMuPDF 文本层直抽, 扫描件逐级降级 mineru → paddleocr |
| 录音 (mp3/m4a/...) | `meeting_minutes` 会议纪要 | `asr_service.py` 分片转写 → `minutes_service.py` MAIN 模型流式生成纪要 |
| 文本类 (txt/md/...) | — | 直接读取内容内联进提示词 |

### 11.6 新增 API 一览

- `/api/auth`: 登录/改密/成员身份确认
- `/api/agents`: CRUD + `/{id}/sessions` 会话管理 + `/{id}/chat` (SSE, 支持 file_names 附件) + `/{id}/debug` (Trace) + `/{id}/memories` 记忆管理 (支持 `?project_id=` 过滤)
- `/api/skills`: CRUD + `/{id}/execute` 试运行 + `/{id}/executions` 执行记录
- `/api/task-runs`: 工作台任务 CRUD + `/{id}/run` + `/{id}/continue` (续聊) + `/{id}/events` (SSE 事件流) + `/{id}/messages` + 附件上传/列表/删除/清空
- `/api/project-members`: 项目成员维护
- `/api/personal-reports`: 个人周报 + Excel 导出
- `/api/usage-logs`: 操作日志看板 + LLM token 统计

### 11.7 LLM 配置

模型调用按用途分八通道配置, 详见 **7.3 模型配置**; 统一入口 `app/services/llm.py`。未配置主推理模型时 Agent 回复降级提示, 其余功能不受影响。
