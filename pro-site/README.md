# XIN · 项目管理工作台

信投 AI 2.0 项目建设专项的项目管理工作台，提供周报管理、进度计划、每周任务三大模块的协同管理能力。

## 技术架构

### 技术栈

| 层级 | 技术选型 | 说明 |
|---|---|---|
| Web 框架 | FastAPI | 异步 ASGI 框架，提供 RESTful API |
| 应用服务器 | Uvicorn | ASGI 服务器，支持热重载 |
| ORM | SQLAlchemy 2.0 (async) | 异步 ORM，使用 `Mapped` / `mapped_column` 声明式模型 |
| 数据库驱动 | asyncpg | PostgreSQL 异步驱动 |
| 数据库 | PostgreSQL | 主数据存储 |
| 配置管理 | pydantic-settings + python-dotenv | 从 `.env` 文件读取配置 |
| 前端 | 原生 HTML / CSS / JavaScript | 单页三栏布局，无前端框架 |
| HTML 解析 | BeautifulSoup4 | 解析周报工具 HTML body 导入数据 |

### 目录结构

```
pro-site/
├── app/                        # 后端应用
│   ├── main.py                 # FastAPI 主应用 (路由注册 / 静态文件挂载)
│   ├── config.py               # 配置读取 (从 .env)
│   ├── database.py             # 引擎 / 会话工厂 / Base
│   ├── seed.py                 # 种子数据: 模块 / 阶段 / 进度任务
│   ├── seed_weekly_reports.py  # 周报导入: 从 SQLite 解析并写入 PostgreSQL
│   ├── models/                 # ORM 模型
│   │   ├── base.py             # Base + TimestampMixin
│   │   ├── module.py           # 项目模块字典 (6 个模块)
│   │   ├── phase.py            # 项目阶段字典 (3 个阶段)
│   │   ├── progress_task.py    # 进度计划任务
│   │   ├── weekly_report.py    # 周报 + KPI / 进展 / 计划 / 风险
│   │   └── work_task.py        # 每周工作任务安排
│   ├── schemas/                # Pydantic 校验模型
│   └── routers/                # API 路由
│       ├── modules.py
│       ├── phases.py
│       ├── progress_tasks.py
│       ├── weekly_reports.py
│       └── work_tasks.py
├── web/                        # 前端静态文件
│   ├── index.html              # 单页入口 (三栏布局)
│   ├── css/workbench.css       # 工作台样式 (设计令牌 + 模块样式)
│   └── js/
│       ├── app.js              # 应用主逻辑 (导航切换 / 全局状态)
│       ├── api.js              # API 调用封装
│       ├── weekly-report.js    # 周报管理视图
│       ├── progress-plan.js    # 进度计划视图 (甘特图)
│       └── work-tasks.js       # 每周任务视图
├── XIN.png                     # 项目 Logo
├── run.py                      # 启动脚本 (uvicorn)
├── requirements.txt            # Python 依赖
└── .env                        # 环境变量配置
```

### 数据模型

```
Module (模块字典, 6 条)
  ├── WeeklyKpi (周报 KPI)
  ├── WeeklyProgressItem (周报进展)
  ├── WeeklyPlanTask (周报下周任务)
  └── WeeklyWorkTask (每周工作任务)

Phase (阶段字典, 3 条)
  └── ProgressTask (进度计划任务)
        └── WeeklyPlanTask (关联: 周报下周任务 → 进度计划任务)

WeeklyReport (周报)
  ├── WeeklyKpi         (本周概览 KPI, 每模块一条)
  ├── WeeklyProgressItem(本周进展, 每模块多条)
  ├── WeeklyPlanTask    (下周计划任务, 可关联 ProgressTask)
  └── WeeklyRisk        (风险与应对)

WeeklyWorkTask (每周工作任务, 可关联 WeeklyPlanTask)
```

核心关联链路: `ProgressTask → WeeklyPlanTask → WeeklyWorkTask`，打通「进度计划 → 周报下周任务 → 每周工作安排」三级闭环。

## 功能模块

### 1. 周报管理

- 周报列表与详情切换
- 四区块结构展示（严格参照 `信投AI2.0_项目周报工具.html`）:
  - **本周概览**: 6 模块 KPI 卡片（进度百分比 + 状态标签）
  - **本周进展**: 按模块分组的进展事项列表
  - **下周计划**: 任务卡片（重点标记 / 负责人 / 关联进度任务）
  - **风险与应对**: 风险表（紧急程度 + 协调内容）
- KPI 编辑 / 任务新增 / 关联进度计划

### 2. 进度计划

- 甘特图布局（严格参照执行图设计）:
  - 阶段标题行（第一阶段 / 第二阶段 / 第三阶段）
  - 任务条 / 菱形里程碑 / 今天线
  - 月份 + 双周日期表头
- 统计栏: 阶段任务数 + 完成进度
- 工具栏: 阶段筛选 / 状态筛选 / 搜索
- 图例: 阶段色 + 里程碑 + 今天线
- 任务条点击查看详情

### 3. 每周任务

- 按周次列出工作任务
- 关联周报下周计划任务
- 状态管理（待开始 / 进行中 / 已完成 / 已取消）
- 工时统计（计划 / 实际）

## API 接口

所有接口统一前缀 `/api`，需尾斜杠。

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/modules/` | GET | 模块列表 |
| `/api/phases/` | GET | 阶段列表 |
| `/api/progress-tasks/` | GET | 进度任务列表 |
| `/api/progress-tasks/{id}` | PATCH | 更新任务状态 |
| `/api/weekly-reports/` | GET | 周报列表（含关联） |
| `/api/weekly-reports/{id}` | GET | 周报详情 |
| `/api/weekly-reports/{id}/kpis` | POST | 新增 KPI |
| `/api/weekly-reports/{id}/progress-items` | POST | 新增进展项 |
| `/api/weekly-reports/{id}/plan-tasks` | POST | 新增计划任务 |
| `/api/weekly-reports/{id}/plan-tasks/{id}` | PATCH/DELETE | 更新/删除计划任务 |
| `/api/weekly-reports/{id}/plan-tasks/link` | POST | 关联进度计划任务 |
| `/api/weekly-reports/{id}/risks` | POST | 新增风险 |
| `/api/work-tasks/` | GET/POST | 每周任务列表/新增 |
| `/api/work-tasks/{id}` | PATCH/DELETE | 更新/删除任务 |
| `/api/work-tasks/from-plan/{report_id}` | GET | 从周报计划生成任务 |

## 配置

### 环境变量 (`.env`)

```ini
POSTGRES_HOST=pg_db
POSTGRES_PORT=5432
POSTGRES_DB=ragKB
POSTGRES_USER=dbuser
POSTGRES_PASSWORD=<your-password>
DEBUG=True
LOG_LEVEL=INFO
```

### 依赖安装

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 运行

```bash
source venv/bin/activate
python run.py
```

启动后访问 http://localhost:8088/，API 文档 http://localhost:8088/docs。

## 数据初始化

```bash
# 1. 导入模块 / 阶段 / 进度计划任务 (从参照 HTML 解析)
python -m app.seed                 # 仅在空库时插入
python -m app.seed --force         # 强制同步覆盖

# 2. 从 SQLite 导入周报数据 (解析 HTML body)
python -m app.seed_weekly_reports            # 仅在无同名周报时插入
python -m app.seed_weekly_reports --force    # 强制覆盖
python -m app.seed_weekly_reports --dry-run  # 仅解析不写入
```

数据来源:
- `信投AI2.0_项目周报工具.html` → 模块定义 / 周报结构
- `20260710信投AI2.0项目进度计划V2.3 执行图.html` → 阶段 / 进度任务
- `信投AI2.0_周报_2026-07-21.db` → 周报数据 (SQLite, weeks 表含 HTML body)

## 设计令牌

工作台采用橙色品牌主色系:

| 令牌 | 值 | 用途 |
|---|---|---|
| `--color-primary` | `#FF8C00` | 品牌主色 |
| `--color-primary-hover` | `#FF7A00` | 悬停态 |
| `--color-primary-light` | `#FFF3E0` | 浅色背景 |
| `--color-gradient` | `linear-gradient(135deg, #FF8C00, #FF5D00)` | 渐变 |

模块配色（与周报工具 HTML 一致）:

| 模块 | 主色 | 浅色背景 |
|---|---|---|
| 01 底座 | `#2563EB` | `#EFF6FF` |
| 02 数据 | `#0D9488` | `#F0FDFA` |
| 03 智能体 | `#7C3AED` | `#F5F3FF` |
| 04 应用 | `#E85D1C` | `#FFF7ED` |
| 05 需求 | `#D97706` | `#FFFBEB` |
| 06 协调 | `#E11D48` | `#FFF1F2` |
