# 艾宾浩斯背单词应用 (abs-site)

> 一句话定位: 基于 FastAPI + SQLAlchemy 2.0 async + 原生 JS 的轻量级背单词 Web 应用, 核心是依据艾宾浩斯遗忘曲线编排的 8 点复习调度引擎, 帮助学习者在最接近遗忘临界点的时刻主动回忆, 以最小时间成本把短期记忆固化为长期记忆。

艾宾浩斯遗忘曲线的业务价值: 单词在记忆后的遗忘速度呈现"先快后慢"特征, 若在学习后的 5 分钟 / 30 分钟 / 12 小时 / 1 天 / 2 天 / 4 天 / 7 天 / 15 天 8 个关键节点上进行"主动回忆 + 即时反馈", 可显著提升留存率。本工程把这 8 个间隔点固化为数据库复习计划 (`vocab_review_schedules`), 由调度器自动到期推送、按 pass / struggle / fail 三档反馈动态调整后续节奏。

---

## 1. 项目概述

- **应用名**: 艾宾浩斯背单词 (FastAPI 工程)
- **运行端口**: `8089`
- **进程入口**: `run.py` → `app.main:app`
- **后端**: FastAPI (异步) + SQLAlchemy 2.0 async + asyncpg + PostgreSQL
- **前端**: 原生 HTML / CSS / JS (无构建步骤), 通过 FastAPI `StaticFiles` 直接挂载在根路径 `/`
- **依赖环境**: 复用同仓 `pro-site` 的 Python venv (位于 `../pro-site/venv`)
- **核心能力**:
  - 单词 / 单元 (词书分册) CRUD 与批量导入
  - 按单元一键开始学习, 自动生成 8 条艾宾浩斯复习计划
  - 今日复习队列 (含逾期与断更恢复)
  - 三档反馈 (pass / struggle / fail) 驱动的复习状态流转
  - 仪表盘统计 (连续学习天数、7 日复习趋势、顽固词)
  - 前端 PDF 导出 (基于 `html2pdf.js`)

---

## 2. 技术栈

### 后端依赖 (来自 `../pro-site/requirements.txt`)

| 包 | 版本要求 | 用途 |
| --- | --- | --- |
| `fastapi` | `>=0.110.0` | Web 框架, 提供路由 / Pydantic 校验 / OpenAPI |
| `uvicorn` | `>=0.27.0` | ASGI 服务器, 含 `--reload` 热重载 |
| `sqlalchemy[asyncio]` | `>=2.0.25` | ORM (2.0 风格 `Mapped` / `mapped_column` / `DeclarativeBase`) |
| `asyncpg` | `>=0.29.0` | PostgreSQL 异步驱动 |
| `pydantic-settings` | `>=2.1.0` | 从 `.env` 加载配置 (`BaseSettings`) |
| `python-dotenv` | `>=1.0.0` | `.env` 文件解析 |

### 数据库

- **PostgreSQL** (异步连接串 `postgresql+asyncpg://...`)
- 默认库: `XIN`, 默认端口: `11000` (见 `.env`)
- 表结构由 SQLAlchemy `Base.metadata.create_all` 在应用启动时自动创建, 无需手写迁移脚本

### 前端关键库

| 库 | 引入方式 | 用途 |
| --- | --- | --- |
| 原生 JS (ES5 风格对象模块) | 本地 `web/js/*.js` | 全部业务逻辑, 无框架 |
| `html2pdf.js` `0.10.1` | CDN (`cdnjs`) | 复习清单 PDF 导出 |
| 原生 CSS | 本地 `web/css/style.css` | 蓝色系设计令牌, 三栏布局 |

---

## 3. 代码结构

```text
abs-site/
├── .env                      # 环境变量 (含 DB 密码, 勿提交)
├── run.py                    # 启动脚本: uvicorn 监听 0.0.0.0:8089, reload
├── app/
│   ├── main.py               # FastAPI 应用工厂: lifespan/init_db, CORS, 路由注册, 静态挂载
│   ├── config.py             # Settings(BaseSettings): 读取 .env, 暴露 database_url
│   ├── database.py           # 异步引擎 / 会话工厂 / DeclarativeBase / get_db / init_db
│   ├── models/
│   │   ├── __init__.py       # 导入三个模型, 触发 metadata 注册
│   │   ├── word.py           # Word → vocab_words
│   │   ├── unit.py           # Unit → vocab_units
│   │   └── review.py         # ReviewSchedule → vocab_review_schedules
│   ├── routers/
│   │   ├── __init__.py       # (空)
│   │   ├── words.py          # 单词 CRUD + 批量导入
│   │   ├── units.py          # 单元 CRUD (级联删除单词)
│   │   └── review.py         # 艾宾浩斯复习引擎 (核心)
│   └── schemas/
│       ├── __init__.py       # (空)
│       ├── word.py           # WordCreate / WordUpdate / WordOut / WordBatchImport
│       ├── unit.py           # UnitCreate / UnitUpdate / UnitOut (含 words)
│       └── review.py         # ReviewScheduleOut / StartLearningRequest / MarkReviewRequest
└── web/                      # 前端静态资源, 挂载于根路径 /
    ├── index.html            # 三栏布局 (侧栏导航 / 主视图 / 详情面板), 5 个视图
    ├── css/style.css         # 蓝色系设计令牌 + 组件样式
    └── js/
        ├── app.js            # API 封装 / App 主控 / Toast / 详情面板 / PDF 导出
        ├── dashboard.js      # 仪表盘: 统计卡片 + 累计进度 + 7 日趋势柱状图
        ├── words.js          # 单词库: 增删改查 / 行内编辑 / 批量导入
        ├── review.js         # 复习卡片: 主动回忆 + 三档反馈 + 键盘快捷键
        ├── learn.js          # 学习新词: 10 词/页 + 回忆测试 + 触发复习计划
        └── stubborn.js       # 顽固词本 (占位, 待实现)
```

---

## 4. 核心业务模块

### 4.1 单词管理 (words)

- **路由文件**: `app/routers/words.py` (前缀 `/api/words`, tag `单词库`)
- **模型**: `app/models/word.py` → `Word` (表 `vocab_words`)
- **职责**:
  - 单词 CRUD (含按 `q` 模糊搜索 `english` / `definition`, 按 `unit_id` / `status` 过滤)
  - 创建时若指定 `unit_id` 则自动把 `sort_order` 置为该单元当前最大值 + 1
  - 批量导入: 接收原始文本, 每行 `word|phonetic|definition|example` (`example` 可选), 由后端解析并逐行入库, 返回 `success / failed / errors`
- **状态字段 `status`**: `new` (未学习) / `learning` (学习中) / `mastered` (已掌握), 由复习引擎流转

### 4.2 单元 / 词库管理 (units)

- **路由文件**: `app/routers/units.py` (前缀 `/api/units`, tag `单元`)
- **模型**: `app/models/unit.py` → `Unit` (表 `vocab_units`)
- **职责**:
  - 单元 CRUD, 每个单元即"词书分册"
  - 列表 / 详情接口均通过 `selectinload(Unit.words)` 预加载下属单词, 避免 async 懒加载报错
  - 删除单元时通过 ORM `cascade="all, delete-orphan"` 级联删除其下全部单词

### 4.3 复习调度 (review) — 艾宾浩斯复习引擎

- **路由文件**: `app/routers/review.py` (前缀 `/api/review`, tag `复习`)
- **模型**: `app/models/review.py` → `ReviewSchedule` (表 `vocab_review_schedules`)
- **核心常量**: `INTERVAL_OFFSETS` (复习间隔, 见下文第 6 节)
- **职责**:
  - `start-learning`: 拉取指定单元下所有 `status='new'` 的词, 把它们置为 `learning`, 写入 `learned_at`, 并为每个新词 **一次性生成 8 条** `ReviewSchedule` 记录 (interval_index 0~7, scheduled_at = learned_at + 对应间隔)
  - `today-reviews`: 查询所有 `status='pending'` 且 `scheduled_at <= now` 的复习计划, 即"今日及逾期待复习"。天然支持断更恢复 — 逾期未做的任务会一直停留在 pending 队列里
  - `mark-review`: 接收一次复习结果 (`pass` / `struggle` / `fail`), 更新本次计划状态, 并按反馈调整 `Word.consecutive_passes` 与剩余待复习计划 (详见第 6 节)
  - `stats`: 仪表盘聚合统计 (今日待复习 / 今日新学 / 已掌握 / 顽固词 / 总词数 / 学习中 / 新词 / 连续学习天数 / 近 7 日每日完成数)
  - `stubborn-words`: 列出"存在 fail 复习记录且未掌握"的顽固词, 附 `fail_count`

---

## 5. 数据模型与数据库脚本

### 5.1 SQLAlchemy 模型 → 表对照

| 模型类 | 表名 | 文件 |
| --- | --- | --- |
| `Word` | `vocab_words` | `app/models/word.py` |
| `Unit` | `vocab_units` | `app/models/unit.py` |
| `ReviewSchedule` | `vocab_review_schedules` | `app/models/review.py` |

### 5.2 表结构详解

#### `vocab_units` (单元 / 词书分册)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | Integer | PK, autoincrement | 主键 |
| `name` | String(128) | not null | 单元名 |
| `description` | Text | default '' | 描述 |
| `sort_order` | Integer | default 0 | 排序权重 |
| `created_at` | DateTime | server_default now() | 创建时间 |

关系: `words` → `Word` 反向 `unit`, `cascade="all, delete-orphan"` (删单元连带删词)

#### `vocab_words` (单词)

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | Integer | PK, autoincrement | 主键 |
| `english` | String(256) | not null, index | 英文单词 |
| `phonetic` | String(128) | default '' | 音标 |
| `definition` | Text | not null | 核心 1-2 条中文释义 |
| `example` | Text | default '' | 例句 |
| `unit_id` | Integer | FK → `vocab_units.id`, nullable, index | 所属单元 |
| `sort_order` | Integer | default 0 | 单元内排序 |
| `status` | String(20) | default 'new' | `new` / `learning` / `mastered` |
| `consecutive_passes` | Integer | default 0 | 连续 pass 次数 (≥3 触发掌握) |
| `learned_at` | DateTime | nullable | 首次学习时间 (`start-learning` 时写入) |
| `created_at` | DateTime | server_default now() | 创建时间 |

关系: `unit` → `Unit` 反向 `words`

#### `vocab_review_schedules` (复习计划 — 艾宾浩斯调度表) ★

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | Integer | PK, autoincrement | 主键 |
| `word_id` | Integer | FK → `vocab_words.id`, not null, index | 关联单词 |
| `unit_id` | Integer | FK → `vocab_units.id`, nullable, index | 冗余字段, 便于按单元统计 |
| `interval_index` | Integer | not null | 间隔序号 0~7, 对应 8 个复习点 |
| `scheduled_at` | DateTime | not null | 该次复习到期时间 (= learned_at + INTERVAL_OFFSETS[idx]) |
| `completed_at` | DateTime | nullable | 实际完成时间 (mark-review 时写入) |
| `mark` | String(20) | nullable | 本次反馈: `pass` / `struggle` / `fail` |
| `status` | String(20) | default 'pending' | `pending` / `done` / `skipped` |
| `created_at` | DateTime | server_default now() | 创建时间 |

关系: `word` → `Word`

### 5.3 表间关系

```text
vocab_units  1 ──< N  vocab_words  1 ──< N  vocab_review_schedules
   (单元)                 (单词)                   (复习计划)
   │                                                │
   └────────── unit_id 冗余 FK ─────────────────────┘
```

- `Unit → Word`: 一对多, 删除单元级联删词
- `Word → ReviewSchedule`: 一对多 (逻辑关系, 未声明 ORM relationship 反向, 通过 `word_id` FK 关联)
- `ReviewSchedule.unit_id`: 冗余外键, 复制自 `Word.unit_id`, 用于跳过 join 直接按单元统计

### 5.4 建表逻辑

- **自动建表**: 应用启动时 `lifespan` 调用 `app/database.py` 中的 `init_db()`, 先 `import app.models` 触发三个模型类注册到 `Base.metadata`, 再 `engine.begin()` 内 `run_sync(Base.metadata.create_all)` 同步建表
- **无需 Alembic 迁移**: 当前工程未集成迁移工具, 表结构变更依赖 `create_all` 的"存在则跳过"语义; **新增字段需手动 `ALTER TABLE` 或 DROP 重建**
- **会话管理**: `get_db()` 异步生成器, 正常 `commit`, 异常 `rollback`, `finally` 关闭; 路由通过 `Depends(get_db)` 注入

---

## 6. 艾宾浩斯复习算法

### 6.1 复习间隔策略

定义于 `app/routers/review.py` 模块顶部:

```python
INTERVAL_OFFSETS: List[timedelta] = [
    timedelta(minutes=5),    # 0  ← 首次回忆
    timedelta(minutes=30),   # 1
    timedelta(hours=12),     # 2
    timedelta(days=1),       # 3
    timedelta(days=2),       # 4
    timedelta(days=4),       # 5
    timedelta(days=7),       # 6
    timedelta(days=15),      # 7  ← 末次长期巩固
]
```

8 个间隔点构成"先密后疏"的复习曲线, 索引 `interval_index` 0→7 严格递增, 所有间隔均 **从 `learned_at` (首次学习时间) 起算**。

### 6.2 新词学习与复习词的调度逻辑

1. **开始学习** (`POST /api/review/start-learning`, `app/routers/review.py:39`):
   - 拉取指定单元下 `status='new'` 的全部词 (按 `sort_order, id` 升序)
   - 对每个词:
     - `Word.status` 置为 `learning`
     - `Word.learned_at = now`
     - `Word.consecutive_passes = 0`
     - **一次性插入 8 条** `ReviewSchedule` 记录, `interval_index` 0~7, `scheduled_at = now + INTERVAL_OFFSETS[idx]`, `status='pending'`
   - 返回 `started` (实际开启学习词数)

2. **今日复习队列** (`GET /api/review/today-reviews`, `app/routers/review.py:74`):
   - 查询条件: `status='pending'` 且 `scheduled_at <= now`
   - 即"已到期但未完成"的所有计划, 按到期时间升序排列
   - 额外统计 `overdue_count` (到期时间早于今日 0 点的数量), 用于前端"断更恢复"提示
   - **断更恢复天然支持**: 逾期的 pending 计划不会自动消失, 会在用户下次打开时一并出现在今日队列里

3. **标记复习结果** (`POST /api/review/mark-review`, `app/routers/review.py:101`):
   - 先把本次 `ReviewSchedule` 置为 `status='done'`, 写入 `mark` 与 `completed_at`
   - 按 `mark` 分支处理 (见 6.3)

### 6.3 复习状态流转 (pass / struggle / fail)

| 反馈 | 对 `Word.consecutive_passes` 的影响 | 对剩余待复习计划的影响 | 触发掌握? |
| --- | --- | --- | --- |
| **pass** | +1 | 若 `consecutive_passes >= 3` 且 `interval_index < 7`, 把该单词剩余 `status='pending'` 计划批量 `update` 为 `skipped` | 累计 ≥3 次 pass → `status='mastered'` |
| **struggle** | 重置为 0 | 不改动任何 pending 计划 (按原节奏继续) | 否 |
| **fail** | 重置为 0 | 找到该单词下一条 `pending` 计划 (按 `interval_index` 升序), 把它的 `scheduled_at` 改写为 `now + 5 分钟`; 若已无 pending 计划, 则新建一条 `interval_index=0` 的 pending 计划, 实现"5 分钟后立即重测" | 否 |

**掌握判定**: `Word.status` 流转 `new → learning → mastered`, 掌握的唯一触发条件是"在复习 (非学习) 中连续 pass 3 次"。一旦掌握, 该单词剩余的艾宾浩斯复习计划被一次性 `skipped`, 不再进入今日队列。

### 6.4 状态机示意

```text
                      start-learning (8 条 pending 计划)
        new ─────────────────────────────► learning
                                                │
                              ┌─────────────────┼─────────────────┐
                              ▼                 ▼                 ▼
                          pass×3           struggle/fail        pass(<3)
                              │                 │                 │
                              ▼                 ▼                 │
                          mastered      consecutive_passes=0      │
                              │            5 分钟后重测            │
                              ▼                                 (继续按原节奏)
                  剩余 pending → skipped
```

### 6.5 顽固词识别

`GET /api/review/stubborn-words` 定义: `status != 'mastered'` 且存在 `mark='fail'` 的复习记录的单词, 附带 `fail_count` (该词所有 fail 复习记录数)。前端 `learn.js` / `stubborn.js` 用于重点再学习。

---

## 7. API 接口清单

所有路由统一前缀 `/api`, 由 `app/main.py:32` 注册。

### 7.1 单词库 (`/api/words`)

| 方法 | 路径 | 说明 | 所属模块 |
| --- | --- | --- | --- |
| GET | `/api/words/` | 列出全部单词, 支持 `q` / `unit_id` / `status` 过滤, 按 `sort_order, id` 排序 | words |
| POST | `/api/words/` | 创建单词, 指定 `unit_id` 时自动计算 `sort_order = max+1` | words |
| POST | `/api/words/batch-import` | 批量导入, body `{"text": "..."}`, 每行 `word\|phonetic\|definition\|example` | words |
| GET | `/api/words/{word_id}` | 查询单个单词 | words |
| PUT | `/api/words/{word_id}` | 更新单词 (部分字段) | words |
| DELETE | `/api/words/{word_id}` | 删除单词 | words |

### 7.2 单元 (`/api/units`)

| 方法 | 路径 | 说明 | 所属模块 |
| --- | --- | --- | --- |
| GET | `/api/units/` | 列出全部单元 (含下属单词) | units |
| GET | `/api/units/{unit_id}` | 查询单个单元 (含单词) | units |
| POST | `/api/units/` | 创建单元 | units |
| PUT | `/api/units/{unit_id}` | 更新单元 | units |
| DELETE | `/api/units/{unit_id}` | 删除单元 (级联删除其下单词) | units |

### 7.3 复习 (`/api/review`)

| 方法 | 路径 | 说明 | 所属模块 |
| --- | --- | --- | --- |
| POST | `/api/review/start-learning` | 开始学习某单元全部新词, 生成 8 条复习计划; body `{"unit_id": int}` | review |
| GET | `/api/review/today-reviews` | 获取今日及逾期的待复习计划 (含 `overdue_count`) | review |
| POST | `/api/review/mark-review` | 标记一次复习结果; body `{"review_id": int, "mark": "pass"\|"struggle"\|"fail"}` | review |
| GET | `/api/review/stats` | 仪表盘统计 (today_pending / today_learned / mastered / stubborn / total_words / learning_words / new_words / streak_days / weekly_reviews) | review |
| GET | `/api/review/stubborn-words` | 顽固单词列表 (含 `fail_count`) | review |

> FastAPI 自动生成的交互式文档: 启动后访问 `http://localhost:8089/docs` (Swagger) 或 `http://localhost:8089/redoc` (ReDoc)。

---

## 8. 配置说明

配置类位于 `app/config.py`, 通过 `pydantic-settings` 从工程根的 `.env` 读取。下表只列出变量名与含义, **不包含真实密码**。

| 环境变量 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `POSTGRES_HOST` | str | `localhost` | PostgreSQL 主机地址 |
| `POSTGRES_PORT` | int | `11000` | PostgreSQL 端口 |
| `POSTGRES_DB` | str | `XIN` | 数据库名 |
| `POSTGRES_USER` | str | `dbuser` | 数据库用户名 |
| `POSTGRES_PASSWORD` | str | `""` | 数据库密码 (敏感, 勿入库勿外泄) |
| `DEBUG` | bool | `True` | 调试模式; 同时控制 SQLAlchemy `echo=True` 打印 SQL |
| `LOG_LEVEL` | str | `INFO` | 日志级别 |
| `ENVIRONMENT` | str | (未在 Settings 中显式声明, `extra="ignore"` 忽略) | 环境标识 (`.env` 中存在但代码未读取) |

派生属性:
- `settings.database_url` → `postgresql+asyncpg://{USER}:{PASSWORD}@{HOST}:{PORT}/{DB}` (见 `app/config.py:21`)
- `.env` 中另含完整 `DATABASE_URL` 变量, 但代码实际使用 `settings.database_url` 动态拼接, `DATABASE_URL` 仅作记录

---

## 9. 启动命令

端口固定 `8089` (见 `run.py:8`)。

### 方式一: 复用 pro-site 的 venv (推荐, 工程默认)

```bash
/mnt/data0/ai_deployment/proj/src/xin-ai/pro-site/venv/bin/python run.py
```

### 方式二: 自建 venv

```bash
# 在 abs-site 目录下
python3 -m venv venv
source venv/bin/activate
pip install -r ../pro-site/requirements.txt
python run.py
```

启动后:
- 后端 API: `http://localhost:8089/api/...`
- 前端页面: `http://localhost:8089/` (静态文件挂载在根路径)
- Swagger 文档: `http://localhost:8089/docs`

> `run.py` 已开启 `reload=True, reload_dirs=["app", "web"]`, 后端 Python 代码或前端 `web/` 资源变更会自动重启 / 刷新。

---

## 10. 开发指南

### 10.1 代码修改后自动重载

- **后端**: `run.py` 中 `uvicorn.run(..., reload=True, reload_dirs=["app", "web"])`, 修改 `app/` 下任意 `.py` 文件, uvicorn 自动重启进程
- **前端**: `web/` 同在 reload 监听目录内; 浏览器侧直接刷新即可看到最新静态资源 (无构建步骤)
- **数据库 schema 变更**: `init_db()` 仅 `create_all`, 不会自动 `ALTER`。新增字段需手动执行 SQL, 或先 DROP 表再重启让其重建 (会丢数据)

### 10.2 新增单词 (单条)

1. 通过 `POST /api/words/` 提交 JSON, 或在前端"单词库"视图行内编辑新增
2. 必填字段: `english`, `definition`; 可选: `phonetic`, `example`, `unit_id`, `sort_order`
3. 指定 `unit_id` 时后端自动计算 `sort_order`, 无需手动传值

### 10.3 新增单词 (批量导入)

1. 准备文本, 每行格式 `word|phonetic|definition|example` (`example` 可省略)
2. 调用 `POST /api/words/batch-import?unit_id={id}`, body `{"text": "..."}`
3. 后端逐行解析, 返回 `{"success": N, "failed": M, "errors": [...]}`

### 10.4 新增单元 / 词书

1. `POST /api/units/` 创建单元 (`name` 必填, `description` / `sort_order` 可选)
2. 在该单元下批量导入或逐条新增单词
3. 前端"学习新词"视图会自动仅展示含 `new` 词的单元

### 10.5 修改艾宾浩斯复习规则

复习间隔定义在 `app/routers/review.py:23` 的 `INTERVAL_OFFSETS` 列表中, 直接编辑 `timedelta` 即可调整全局策略。修改后:

- **对新开始学习的词**: 立即生效, `start-learning` 会按新间隔生成计划
- **对已生成的复习计划**: 不会回溯调整 `scheduled_at`, 需手动更新 `vocab_review_schedules` 表或重置该单词的复习计划

如需把间隔点数量从 8 改为 N, 需同步:
1. `INTERVAL_OFFSETS` 列表长度
2. `mark-review` 中 `if interval_index < 7` 的硬编码 7 (改为 `len(INTERVAL_OFFSETS) - 1`, 见 `app/routers/review.py:137`)
3. `ReviewSchedule.interval_index` 注释 (仅文档性质)

### 10.6 调整掌握阈值

掌握判定阈值 `consecutive_passes >= 3` 硬编码于 `app/routers/review.py:134`, 修改该数字即可调高 / 调低掌握难度。
