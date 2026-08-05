# pro-site 升级为 pro-cowork 项目管理智能体工作平台 · 实施计划

## 一、Summary(目标概述)

复制 `pro-site` 为 `pro-cowork`,在完整保留四大业务功能(进度计划/项目会议/项目周报/每周任务)与 12 张业务表结构的前提下,修复已有智能体骨架代码的 bug,补全「构建、调试、执行 Agent、Skill」四大平台能力,落地四大智能体(项目进度管理/项目会议管理/项目周报编写/周工作计划制作),每个智能体具备「感知、记忆、决策、交互、执行」五大能力,并参照 Workbuddy/CoWork 主流工作台理念(以 xin-cowork 原型为设计参照)用原生 HTML/JS 重新设计工作台 UI。pro-site 目录与运行环境完全不动。

**已确认决策**:
1. 数据库:pro-cowork 与 pro-site **共用 XIN 数据库**,新表(agents/skills 等 6 张)仅增量添加,对 pro-site 零影响;
2. 前端:**原生 HTML/JS**(与 pro-site 一致,FastAPI 挂载,无构建工具);
3. 骨架代码:复制为 pro-cowork 起点,**pro-site 目录不做任何修改**。

## 二、Current State Analysis(现状分析)

### 2.1 pro-site 现状(端口 8088)
- 后端:FastAPI + SQLAlchemy 2.0 async + PostgreSQL,入口 [main.py](../../pro-site/app/main.py),统一 `/api` 前缀,9 个路由。
- 前端:`web/` 原生 JS 单页工作台(左导航 + 主区 + 右侧详情面板),4 个业务视图 JS + `api.js` 封装。
- 数据:12 张业务表,核心链路 `Phase → ProgressTask → WeeklyPlanTask → WeeklyWorkTask`,6 张顶级表含 `project_id` 多项目隔离。
- **已有未提交的智能体骨架**(git status 显示为未跟踪/未提交):
  - 模型:[agent.py](../../pro-site/app/models/agent.py)(Agent/AgentSession/AgentMessage/AgentMemory)、[skill.py](../../pro-site/app/models/skill.py)(Skill/SkillExecution)—— 6 张新表,设计合理;
  - 服务:[agent_engine.py](../../pro-site/app/services/agent_engine.py)(OpenAI 兼容流式对话 + function calling 循环)、[agent_presets.py](../../pro-site/app/services/agent_presets.py)(四大预置智能体 prompt)、[skill_engine.py](../../pro-site/app/services/skill_engine.py)(JSON 工作流工具链执行器,支持 `{{input.xxx}}` 变量引用);
  - 路由:[agents.py](../../pro-site/app/routers/agents.py)(CRUD + 会话 + SSE 对话 + 记忆)、[skills.py](../../pro-site/app/routers/skills.py)(CRUD + 执行 + 执行记录);
  - 配置:[config.py](../../pro-site/app/config.py) 已加 `OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL`,requirements.txt 已加 `openai>=1.30.0`。

### 2.2 骨架代码已确认的 bug(必须修复)
[agent_tools.py](../../pro-site/app/services/agent_tools.py) 与真实模型字段不匹配:

| 位置 | 问题 | 真实字段 |
|------|------|----------|
| `_tool_get_modules` | 使用 `m.name` | Module 是 `tag`/`title`,无 `name` |
| `_tool_get_meetings` | 使用 `Meeting.meeting_date`、`m.summary` | 实际是 `meet_date`、`description` |
| `_tool_create_meeting` | kwargs 用 `meeting_date/meeting_type/start_time/end_time/location/participants/summary` | 实际是 `meet_date/meet_time/place/host/attendees/description`;且 `project_id` 必填未注入 |
| `_tool_get_progress_tasks` | `order_by(ProgressTask.sort_order)` | ProgressTask **无** `sort_order` 字段;且缺 `project_id` 过滤 |
| `_tool_get_phases` | `order_by(Phase.sort_order)` | Phase **无** `sort_order` 字段(应按 `start_date`) |
| `_tool_create_progress_task` | 未注入 `project_id`(必填);日期字符串未转 `date` | `start_date/end_date` 是 `Date` 类型 |
| `_tool_create_work_task` | 未注入 `project_id`、`week_start/week_end`(均必填,Date 类型) | WeeklyWorkTask 模型 |
| `_tool_get_weekly_report_detail` | 直接访问 `report.kpis` 等懒加载关系 | async 环境必须 `selectinload` 预加载,否则 MissingGreenlet |
| `_tool_get_work_tasks` | `week_start` 字符串直接比对 Date 列 | 需 `date.fromisoformat` 转换 |

其他缺口:无前端智能体/技能界面;无调试(Trace)能力;Agent 无法调用 Skill;记忆只能手动写入,无自动沉淀;预置 Skill 为空。

### 2.3 部署现状
单容器 `xin-ai` 跑 4 个服务(8087 xin-site / 8088 pro-site / 8089 abs-site / 8090 xin-cowork),[docker-compose.yml](../../docker-compose.yml) 源码卷挂载,[docker-entrypoint.sh](../../docker-entrypoint.sh) 统一拉起,Python 依赖装在镜像内 `/app/venv`(命名卷保护,依赖变更需 `down -v` + rebuild)。[.docker.env.example](../../.docker.env.example) 已含 `OPENAI_*` 配置段(第 29-33 行)。

### 2.4 设计参照
[xin-cowork](../../xin-cowork/) 已有 Workbuddy 风格静态原型:`cowork/agents`(index/detail/builder)、`cowork/skills`(index/detail/builder)、`cowork/memory`、`cowork/sessions`、`cowork/workspace` 页面及 `assets/css/cowork.css`,作为 pro-cowork UI 布局与交互的设计参照(不抄其实现,其为纯静态 JSON 原型)。

## 三、Proposed Changes(变更方案)

### Step 1 · 复制 pro-site → pro-cowork
```bash
rsync -a --exclude 'venv/' --exclude '__pycache__/' --exclude '*.pyc' pro-site/ pro-cowork/
```
- 保留 `.env`(用户约定环境变量走 .env);`run.py` 端口改为 **8091**,标题改为「XIN · CoWork 项目管理智能体工作平台」。
- pro-cowork/README.md 在 pro-site 版本基础上追加智能体平台章节(端口 8091、新增表、新增 API)。
- 此后所有改动只发生在 pro-cowork。

### Step 2 · 修复并增强 Agent 工具层(`pro-cowork/app/services/agent_tools.py`)
1. 按 2.2 表格逐项修正字段名、排序字段(`ProgressTask` 按 `phase_id, id`;`Phase` 按 `start_date`);
2. 所有查询/写入工具统一注入**当前激活项目** `project_id`(复用 `_tool_get_project_info` 逻辑抽取 `_get_active_project_id()`);
3. 日期参数统一 `date.fromisoformat()` 转换;
4. `_tool_get_weekly_report_detail` 改为 `selectinload` 显式预加载子表;
5. **新增工具**(补全四大智能体执行能力):
   - `run_skill`(agent 可执行技能,参数 `skill_id`/`skill_name` + `input_data`,内部调 SkillEngine)——打通 Agent→Skill;
   - `create_weekly_report`(复制上周周报逻辑等价于 `POST /weekly-reports/copy-last`);
   - `update_work_task`(状态/工时更新);
   - `save_memory`(让 Agent 决策后自主沉淀记忆);
   - `get_today`(返回当前日期/周次,支撑感知)。
6. 同步更新 `TOOL_DEFINITIONS` 中 `create_meeting` 等参数 schema,使其与真实字段一致。

### Step 3 · 补全五大能力(后端)
以 [agent_engine.py](../../pro-site/app/services/agent_engine.py) 为核心扩展:

| 能力 | 实现 |
|------|------|
| **感知** | 新增 `app/services/agent_context.py`:对话前采集项目快照(激活项目信息、进度任务统计与逾期清单、最近会议、最新周报状态、本周任务数)+ 当前日期,注入 system prompt;配合数据查询工具形成「环境感知 + 主动查询」双通道 |
| **记忆** | 对话结束后做轻量记忆抽取(用户消息含"记住/以后/偏好"等规则触发 + 助手调用 `save_memory` 工具主动沉淀);注入与 CRUD API 已存在,保持不变 |
| **决策** | 保留 function-calling 循环(max_rounds=5);SSE 事件结构化:新增 `tool_call` / `tool_result` 事件类型(替代当前的 emoji 文本混入),前端可渲染执行轨迹 |
| **交互** | SSE 流式对话已存在;会话 API 增补 `PATCH /api/agents/sessions/{id}`(改标题)、`DELETE /api/agents/sessions/{id}`(归档) |
| **执行** | 修复后的工具集 + `run_skill` + SkillEngine 工作流;执行结果写 `skill_executions` 表可追溯 |

同时更新 [agent_presets.py](../../pro-site/app/services/agent_presets.py):四大预置智能体的 `tools` 列表补充新工具(如周报助手加 `create_weekly_report`、计划助手加 `update_work_task`、全员加 `run_skill/save_memory/get_today`),system_prompt 补充五大能力行为约定;seed 逻辑保持幂等(已存在的 preset 更新 tools/prompt 字段)。

### Step 4 · 构建(Builder)与调试(Debug)能力
1. **Agent 调试接口**:新增 `POST /api/agents/{id}/debug` —— 非流式执行一轮对话,返回结构化 Trace:每轮的 messages、tool_calls、工具入参/出参、耗时、tokens,供构建器调试面板展示。
2. **Skill 预置**:新增 `app/services/skill_presets.py`,lifespan 幂等播种 4 个示例技能(周报草稿生成、延期任务扫描、会议议程准备、周计划生成),code 为 JSON 工作流(复用 SkillEngine 的 steps/变量引用格式)。
3. Skill 执行/执行记录 API 已存在(`POST /skills/{id}/execute` 即调试运行 + `GET /skills/{id}/executions` 追溯),保持不变。
4. 数据库脚本 `scripts/pro-cowork.sql`:6 张新表 `CREATE TABLE IF NOT EXISTS`(与仓库 scripts 约定一致,幂等;开发期仍靠 `init_db()` 自动建表)。

### Step 5 · 前端 Workbuddy 风格重构(`pro-cowork/web/`)
保留 4 个业务视图 JS 文件**不改逻辑**,仅接入新导航。参照 xin-cowork 原型的布局语言:

- **index.html 重构**:左侧导航分两组——「智能体」(🤖 智能体、🛠 技能、🧠 记忆)与「项目管理」(📊 进度计划、📅 项目会议、📋 项目周报、✅ 每周任务);右侧详情面板保留。
- **新增视图**:
  - `js/agents.js`:智能体卡片列表(图标/颜色取自 config)+ 对话视图(左会话列表、中聊天气泡、右侧该 Agent 记忆面板);SSE 流式渲染,`tool_call/tool_result` 事件渲染为可折叠执行轨迹;
  - `js/agent-builder.js`:智能体构建/编辑表单(名称、类型、描述、system_prompt 编辑器、工具勾选、config JSON)+ 调试面板(调 `/debug` 接口展示 Trace);
  - `js/skills.js`:技能卡片列表 + 详情(描述/分类/触发方式 + 最近执行记录);
  - `js/skill-builder.js`:技能构建器(JSON 工作流代码编辑器 + 输入参数表单 + 「试运行」面板展示 output_data/耗时/状态);
  - `js/memories.js`:记忆列表(按 agent/type 过滤,支持删除)。
- **css/cowork.css**:新增工作台样式(卡片、聊天气泡、轨迹折叠块、builder 表单),配色沿用现有 XIN 风格;`workbench.css` 不动。
- `js/api.js`:仅追加 `API.stream(url, payload, onEvent)` SSE 封装(fetch + ReadableStream 解析 `data:` 行),其余不变。

### Step 6 · 部署接入(根目录 3 个文件)
1. [docker-compose.yml](../../docker-compose.yml):端口段加 `"8091:8091"`,卷段加 `- ./pro-cowork:/app/pro-cowork`,头部注释同步;
2. [docker-entrypoint.sh](../../docker-entrypoint.sh):新增 `start_service "pro-cowork" 8091 "${APP_ROOT}/pro-cowork" python -m uvicorn app.main:app --host 0.0.0.0 --port 8091 --reload --reload-dir app`,头部注释同步;
3. [Dockerfile](../../Dockerfile):`EXPOSE` 加 8091,注释同步;requirements 以 pro-site/requirements.txt 安装(已含 openai),**依赖变更需 `docker compose down -v && docker compose up -d --build`**(写入交付说明);
4. [.docker.env.example](../../.docker.env.example):`OPENAI_*` 段已存在,无需改动;实际 `.docker.env` 需用户填入真实 `OPENAI_API_KEY`。

### Step 7 · 验证(Verification)
1. `cd pro-cowork && ./venv 不存在则用 python3 -m venv venv && pip install -r requirements.txt`(或直接容器验证);
2. 启动后 `http://localhost:8091/docs` 可见 agents/skills 路由;`GET /api/agents/` 返回 4 个预置智能体;
3. 回归四大功能:`GET /api/progress-tasks/`、`/api/meetings/`、`/api/weekly-reports/`、`/api/work-tasks/` 数据与 pro-site(8088)一致(共用库);
4. 智能体对话:向「进度管理助手」发"本周有哪些逾期任务",确认工具调用成功且返回真实数据;发"帮我创建一个进度任务 编号 X-1",确认 `project_id` 注入、落库成功;
5. 构建与调试:builder 新建自定义 Agent → `/debug` 返回结构化 Trace;技能「延期任务扫描」试运行成功并在 executions 留痕;
6. 记忆:对话中说"记住我偏好周报用简洁格式"→ `GET /api/agents/{id}/memories` 可见;
7. 容器:`docker compose up -d` 后 8091 可访问,8088 pro-site 不受影响。

## 四、Assumptions & Decisions(假设与决策)

1. 共用 XIN 库:6 张新表只增不改;12 张业务表结构**零变更**,满足"相互兼容";
2. pro-site 目录(含其未提交骨架)完全不动;pro-cowork 内修复 bug 不回灌 pro-site;
3. pro-cowork 端口 **8091**(顺承 8087-8090);
4. 前端原生 JS,不引入 node 构建;xin-cowork 仅作设计参照;
5. LLM 走 OpenAI 兼容协议(`OPENAI_*` 环境变量),Key 由用户在 `.env` / `.docker.env` 填写;未配置时 Agent 回复友好降级提示(骨架已有该逻辑);
6. 记忆自动抽取采用规则触发 + 工具主动沉淀的轻量方案,不引入额外 LLM 摘要调用;
7. 不引入 Alembic,沿用 `init_db()` 自动建表 + scripts SQL 脚本的现有约定。

## 五、实施顺序与工时分布(执行时按此 todo 推进)

1. 复制工程 + 端口/标题调整(Step 1)
2. agent_tools.py 修复与新增工具(Step 2)
3. 五大能力补全:agent_context.py、agent_engine.py、agent_presets.py、会话 API(Step 3)
4. 调试接口 + 预置技能 + pro-cowork.sql(Step 4)
5. 前端重构:agents/agent-builder/skills/skill-builder/memories 视图 + 导航(Step 5)
6. 部署接入:docker-compose / entrypoint / Dockerfile(Step 6)
7. 端到端验证(Step 7)
