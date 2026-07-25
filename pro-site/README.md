# XIN · 项目管理工作台

> 信投 AI 2.0 项目建设专项的项目管理后端，基于 FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL，统一管理「进度计划、项目例会、项目周报、每周工作任务」四大协同模块，为项目治理提供结构化数据底座与可追溯的任务关联链路。

---

## 一、项目概述

本工程是「XIN 项目管理工作台」的后端服务，运行在 **8088** 端口，对外提供 `/api/*` RESTful 接口，并在根路径挂载 `web/` 前端静态页面。其业务价值在于：

- 将项目「阶段 → 进度计划任务 → 周报下周任务 → 每周工作任务」打通为可追溯的关联链条；
- 周报结构化拆分为 KPI、本周进展、下周任务、风险四类子资源，支持批量保存与级联删除；
- 提供项目例会议程的父子结构管理，支持议程项排序与批量创建。

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
pro-site/
├── run.py                      # 启动脚本: uvicorn 监听 0.0.0.0:8088, reload 监听 app/ 与 web/
├── requirements.txt            # Python 依赖清单
├── .env                        # 环境变量配置 (含密码, 勿提交)
├── README.md                   # 本文件
├── venv/                       # 本地虚拟环境 (venv/bin/python)
├── xintou_weekly_reports_2026-07-22.json   # 周报种子 JSON 数据
└── app/                        # FastAPI 后端应用
    ├── __init__.py
    ├── main.py                 # FastAPI 入口: lifespan/CORS/路由注册/静态文件挂载
    ├── config.py               # pydantic-settings 读取 .env, 构建 database_url
    ├── database.py             # 异步引擎/会话工厂/Base/get_db/init_db
    ├── seed.py                 # 种子脚本: 模块/阶段/进度计划任务
    ├── seed_weekly_reports.py  # 种子脚本: 从 SQLite 解析周报写入 PG
    ├── seed_weekly_from_json.py# 种子脚本: 从 JSON 同步周报
    ├── models/                 # SQLAlchemy ORM 模型
    │   ├── __init__.py         # 模型汇总导出 (注意: Project 仅在 __all__, 未 import)
    │   ├── base.py             # Base + TimestampMixin (created_at/updated_at)
    │   ├── project.py          # projects 表: 项目元信息
    │   ├── module.py           # modules 表: 项目模块字典
    │   ├── phase.py            # phases 表: 项目阶段字典
    │   ├── progress_task.py    # progress_tasks 表: 进度计划任务
    │   ├── meeting.py          # meetings / meeting_items 表: 会议与议程项
    │   ├── weekly_report.py    # weekly_reports 及 4 张子表
    │   └── work_task.py        # weekly_work_tasks 表: 每周工作任务
    ├── routers/                # API 路由 (统一前缀 /api)
    │   ├── __init__.py
    │   ├── projects.py         # 项目元信息 (含 /active 幂等创建默认项目)
    │   ├── modules.py          # 模块字典 CRUD
    │   ├── phases.py           # 阶段字典只读
    │   ├── progress_tasks.py   # 进度计划任务 CRUD + 状态切换
    │   ├── meetings.py         # 会议 + 议程项子资源
    │   ├── weekly_reports.py   # 周报 + KPI/进展/下周任务/风险 子资源
    │   └── work_tasks.py       # 每周工作任务 + 从周报批量生成
    └── schemas/                # Pydantic v2 模型 (Create/Update/Out)
        ├── __init__.py
        ├── project.py
        ├── module.py
        ├── phase.py
        ├── progress_task.py
        ├── meeting.py
        ├── weekly_report.py
        └── work_task.py
└── web/                        # 前端静态资源 (由 FastAPI StaticFiles 挂载到 /)
    ├── index.html              # 单页入口, 左侧导航 + 主区 + 右侧关联面板
    ├── css/
    │   └── workbench.css       # 工作台样式
    ├── js/
    │   ├── api.js              # 统一 fetch 封装, baseUrl=/api
    │   ├── app.js              # 视图切换/周次选择器入口
    │   ├── progress-plan.js    # 进度计划执行图视图
    │   ├── meeting.js          # 项目例会视图
    │   ├── weekly-report.js    # 周报视图
    │   └── work-tasks.js       # 每周工作任务视图
    └── images/
        └── XIN.png             # 站点 LOGO
```

---

## 四、核心业务模块

| 模块 | 路由文件 | 模型 | 职责 |
|------|----------|------|------|
| 项目元信息 | `app/routers/projects.py` | `Project` | 管理多项目（如「信投AI2.0」），`is_active` 标识当前项目；`GET /active` 在无项目时幂等创建默认项目 |
| 模块字典 | `app/routers/modules.py` | `Module` | 维护六大模块（底座/数据/智能体/应用/需求/协调），含颜色配置，作为周报与任务的归类维度 |
| 阶段字典 | `app/routers/phases.py` | `Phase` | 维护项目三阶段（有得用/用起来/用得好）及起止日期，供进度计划任务归属 |
| 进度计划 | `app/routers/progress_tasks.py` | `ProgressTask` | 项目甘特任务（含里程碑 `is_milestone`），按 `task_uid` 唯一标识，支持按 `phase_id`/`status` 筛选与状态切换 |
| 项目例会 | `app/routers/meetings.py` | `Meeting` / `MeetingItem` | 会议主记录 + 议程项父子结构，议程项按 `sort_order` 排序，会议删除级联议程项 |
| 项目周报 | `app/routers/weekly_reports.py` | `WeeklyReport` 及 4 子表 | 周报主体 + KPI（每模块一条，唯一约束）/ 本周进展 / 下周任务 / 风险；下周任务可关联进度计划任务 |
| 每周工作任务 | `app/routers/work_tasks.py` | `WeeklyWorkTask` | 周任务执行层，可关联周报下周任务（`plan_task_id`），支持「从周报下周任务批量生成」 |

**核心关联链路**：`Phase → ProgressTask → WeeklyPlanTask(周报下周任务) → WeeklyWorkTask(每周工作任务)`，四张表通过外键串联，实现计划到执行的追溯。

---

## 五、数据模型与数据库脚本

### 5.1 表清单与字段

| 模型类 | 表名 | 文件 | 关键字段 |
|--------|------|------|----------|
| `Project` | `projects` | `app/models/project.py` | `id`, `name`, `title`, `based_doc`, `start_date`, `end_date`, `is_active`, `sort_order` |
| `Module` | `modules` | `app/models/module.py` | `id`, `idx`, `tag`, `title`, `owner`, `color`, `color_bg`, `sort_order` |
| `Phase` | `phases` | `app/models/phase.py` | `id`, `name`, `subtitle`, `description`, `start_date`, `end_date` |
| `ProgressTask` | `progress_tasks` | `app/models/progress_task.py` | `id`, `task_uid`(unique), `name`, `phase_id`(FK→phases), `start_date`, `end_date`, `status`, `full_desc`, `owner`, `is_milestone` |
| `Meeting` | `meetings` | `app/models/meeting.py` | `id`, `title`, `meet_date`, `meet_time`, `place`, `host`, `attendees`, `description`, `sort_order` |
| `MeetingItem` | `meeting_items` | `app/models/meeting.py` | `id`, `meeting_id`(FK→meetings, CASCADE), `item_time`, `theme`, `speaker`, `duration`, `note`, `description`, `sort_order` |
| `WeeklyReport` | `weekly_reports` | `app/models/weekly_report.py` | `id`, `title`, `week_range`, `week_start`, `week_end`, `overview_summary`, `status`(draft/submitted) |
| `WeeklyKpi` | `weekly_kpis` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `module_id`(FK), `progress_pct`, `status`；唯一约束 `uq_kpi_report_module(report_id, module_id)` |
| `WeeklyProgressItem` | `weekly_progress_items` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `module_id`(FK), `content`, `detail`, `sort_order` |
| `WeeklyPlanTask` | `weekly_plan_tasks` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `module_id`(FK), `progress_task_id`(FK→progress_tasks, 可空), `name`, `is_key`, `owner`, `plan_period`, `status`, `remark`, `sort_order` |
| `WeeklyRisk` | `weekly_risks` | `app/models/weekly_report.py` | `id`, `report_id`(FK, CASCADE), `seq`, `title`, `coordination`, `urgency`, `sort_order` |
| `WeeklyWorkTask` | `weekly_work_tasks` | `app/models/work_task.py` | `id`, `week_start`, `week_end`, `plan_task_id`(FK→weekly_plan_tasks, 可空), `name`, `module_id`(FK, 可空), `owner`, `is_temporary`, `priority`, `status`, `planned_hours`, `actual_hours`, `remark`, `sort_order` |

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

- **自动建表**：`app/database.py` 的 `init_db()` 在应用 lifespan 启动时执行 `Base.metadata.create_all`，开发阶段无需手动建表。
- **重要提示**：`app/models/__init__.py` 的 `__all__` 中列出了 `Project`，但 **未实际 `from app.models.project import Project`**。因此 `init_db()` 触发 `import app.models` 时不会注册 `projects` 表的 metadata。`projects` 表需通过 `app/routers/projects.py` 的 `GET /api/projects/active` 在首次访问时由 ORM 操作触发（若表不存在会报错），或手动建表。后续 AI 修改代码时建议补全该 import。

### 5.4 建表 SQL 示例（projects 表）

```sql
CREATE TABLE IF NOT EXISTS projects (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(64)  NOT NULL,
    title       VARCHAR(256) NOT NULL,
    based_doc   VARCHAR(256) DEFAULT '',
    start_date  DATE         NOT NULL,
    end_date    DATE         NOT NULL,
    is_active   BOOLEAN      DEFAULT FALSE,
    sort_order  INTEGER      DEFAULT 0,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);
```

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

### 6.5 项目例会（`/api/meetings`）

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
| GET | `/api/weekly-reports/` | 周报列表（按 week_start 倒序，含全部子表） |
| GET | `/api/weekly-reports/{report_id}` | 周报详情（含 KPI/进展/下周任务/风险） |
| POST | `/api/weekly-reports/` | 新建周报 |
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

---

## 七、配置说明

配置由 `app/config.py` 通过 `pydantic-settings` 从 `pro-site/.env` 读取。**当前后端实际只消费 PostgreSQL 与系统配置两组变量**；其余变量为整体平台预留（Redis / Milvus / Neo4j / MinIO 等），本工程未引用。

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

### 7.3 平台预留变量（本工程未引用，仅 .env 占位）

| 分组 | 变量名 |
|------|--------|
| Redis | `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` / `REDIS_PASSWORD` / `REDIS_URL` |
| Milvus | `MILVUS_HOST` / `MILVUS_PORT` / `MILVUS_USER` / `MILVUS_PASSWORD` / `MILVUS_COLLECTION` |
| Neo4j | `NEO4J_HOST` / `NEO4J_PORT` / `NEO4J_USER` / `NEO4J_PASSWORD` / `NEO4J_URI` / `NEO4J_HEAP` / `NEO4J_PAGECACHE` |
| MinIO | `MINIO_HOST` / `MINIO_PORT` / `MINIO_ROOT_USER` / `MINIO_PASSWORD` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` / `MINIO_ENDPOINT` |
| ClickHouse | `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` |
| MySQL | `MYSQL_ROOT_PASSWORD` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` |
| MongoDB | `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` / `MONGO_INITDB_DATABASE` |
| 模型推理 | `MODEL_VLLM_URL` / `MODEL_NAME` / `MODEL_API_KEY` / `LEGACY_API_BASE` / `LEGACY_API_KEY` |

---

## 八、启动命令

服务固定监听 **8088** 端口，启动脚本见 `run.py`（`host=0.0.0.0`, `port=8088`, `reload=True`, `reload_dirs=["app","web"]`）。

```bash
# 进入工程目录
cd /mnt/data0/ai_deployment/proj/src/xin-ai/pro-site

# 使用工程自带 venv 启动 (开发模式, 自动重载 app/ 与 web/ 下文件变更)
./venv/bin/python run.py
```

启动成功后：

- 后端 API 文档（Swagger）：`http://localhost:8088/docs`
- 前端工作台：`http://localhost:8088/`

> 生产/无重载场景可执行：`./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8088`

---

## 九、依赖安装

```bash
cd /mnt/data0/ai_deployment/proj/src/xin-ai/pro-site

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
```

> 注：`app/seed_weekly_reports.py` 使用了 `beautifulsoup4`（`from bs4 import BeautifulSoup`），但该依赖**未在 `requirements.txt` 中声明**，运行该种子脚本前需手动 `pip install beautifulsoup4`。

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
