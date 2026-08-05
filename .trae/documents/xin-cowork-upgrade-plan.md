# XIN-CoWork 智能体工作台升级计划

## 一、概要

将现有 `xin-site` 升级为 `xin-cowork`，一个具备构建、调试、执行 Agent 和 Skill 能力的智能体工作台。系统包含四大项目管理智能体，每个智能体具备感知、记忆、决策、交互、执行五大能力。

**核心原则：**
- 复制 `xin-site` → `xin-cowork`，不影响现有运行环境
- 保留 xin-site 全部功能（需求文档、技术架构、产品原型、术语表、路线图等）
- 在此基础上重新构建 AI 工作台 UI，集成四大智能体

## 二、当前状态分析

### 2.1 xin-site 技术栈
- **前端**: 纯静态 HTML + Vanilla JS (ES Modules) + Vite 5.4，无框架
- **路由**: 基于 Hash 的前端路由 (`router.js`)，懒加载 HTML 页面
- **样式**: CSS 变量主题系统 (light/dark)，Inter 字体
- **部署**: Vite build → dist/，可部署到 Cloudflare Pages

### 2.2 xin-site 功能模块
| 模块 | 路径 | 说明 |
|------|------|------|
| 首页 | `index.html` | Hero区、产品定位、核心能力、场景、技术亮点、路线图 |
| 需求文档 | `docs/requirements/` | 12 个需求模块 HTML |
| 技术架构 | `docs/architecture/` | 13 个架构章节 HTML |
| 产品原型 | `prototype/` | 工作台、技能市场、专家市场、MCP集成、知识库等 |
| 术语表 | `docs/glossary.html` | 术语定义 |
| 路线图 | `docs/roadmap.html` | 产品路线图 |
| 共享组件 | `shared/components.html` | UI 组件库 |
| 搜索 | `search.js` | 全站搜索 |
| 主题 | `theme.js` | 亮暗主题切换 |

### 2.3 pro-site 后端（已有）
- FastAPI + PostgreSQL + SQLAlchemy 2.0 async
- 端口 8088，提供项目管理 API（周报、进度、会议、工作任务、模块、阶段）
- 数据库模型已完善：WeeklyReport, ProgressTask, Meeting, WorkTask, Module, Phase, Project

### 2.4 Docker 部署（已有）
- 三合一容器：xin-site (8087) + pro-site (8088) + abs-site (8089)
- 源码卷挂载 + 命名卷保护依赖
- 外部 ai_network，静态 IP 172.28.200.10

## 三、xin-cowork 架构设计

### 3.1 整体架构

```
xin-cowork/
├── index.html              # 保留: 首页 (品牌展示)
├── 404.html                # 保留: 404 页面
├── docs/                   # 保留: 全部文档
├── prototype/              # 保留: 全部原型页面
├── shared/                 # 保留: 共享组件
├── images/                 # 保留: 图片资源
├── assets/
│   ├── css/
│   │   ├── style.css       # 保留: 全局样式 + 主题
│   │   ├── components.css  # 保留: 组件样式
│   │   ├── prototype.css   # 保留: 原型样式
│   │   └── cowork.css      # 新增: CoWork 工作台样式
│   ├── js/
│   │   ├── app.js          # 修改: 注册新路由
│   │   ├── router.js       # 保留: 路由核心
│   │   ├── theme.js        # 保留: 主题
│   │   ├── search.js       # 保留: 搜索
│   │   ├── prototype.js    # 保留: 原型交互
│   │   ├── cowork.js       # 新增: CoWork 主控制器
│   │   ├── agent-engine.js # 新增: Agent 运行时引擎
│   │   ├── agent-ui.js     # 新增: Agent 对话 UI 组件
│   │   ├── skill-builder.js# 新增: Skill 构建器
│   │   ├── skill-engine.js # 新增: Skill 执行引擎
│   │   ├── memory-store.js # 新增: 记忆存储管理
│   │   └── agent-api.js    # 新增: Agent 后端 API 封装
│   └── data/               # 保留: JSON 数据文件
├── cowork/                 # 新增: CoWork 页面目录
│   ├── workspace/          # 新增: AI 工作台主页
│   │   └── index.html
│   ├── agents/             # 新增: Agent 管理页
│   │   ├── index.html      # Agent 列表/创建
│   │   ├── builder.html    # Agent 构建器(可视化编排)
│   │   └── detail.html     # Agent 详情/调试
│   ├── skills/             # 新增: Skill 管理页
│   │   ├── index.html      # Skill 列表
│   │   ├── builder.html    # Skill 构建器
│   │   └── detail.html     # Skill 详情/测试
│   ├── sessions/           # 新增: 会话管理页
│   │   └── index.html
│   └── memory/             # 新增: 记忆管理页
│       └── index.html
├── package.json
├── vite.config.js
└── README.md
```

### 3.2 技术选型（决策）

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 前端框架 | **保持 Vanilla JS + Vite** | 与 xin-site 一致，避免重写成本，可复用全部现有代码 |
| UI 布局 | **三栏式 AI 工作台** | 参考 Claude/ChatGPT 布局：左侧导航栏 + 中间对话/工作区 + 右侧上下文面板 |
| Agent 后端 | **复用 pro-site FastAPI，新增 Agent 路由** | 利用现有 FastAPI 基础设施，新增 `/api/agents/` 路由 |
| LLM 集成 | **OpenAI 兼容 API** | 通过 `openai` Python SDK 调用，支持 OpenAI / DeepSeek / 通义千问等兼容接口 |
| 数据存储 | **复用 PostgreSQL (pro-site 数据库)** | 新增 Agent/Skill/Memory/Session 表到现有数据库 |

### 3.3 四大智能体定义

#### 3.3.1 项目进度管理智能体 (ProgressAgent)
- **感知**: 读取项目阶段、任务列表、甘特图数据、延期预警
- **记忆**: 存储历史进度变更、里程碑达成记录、延期原因分析
- **决策**: 基于当前进度自动生成优化建议、风险预警、资源调配方案
- **交互**: 对话式查询进度、自然语言创建/更新任务、生成进度报告
- **执行**: 自动更新任务状态、生成进度周报、触发延期告警

#### 3.3.2 项目会议管理智能体 (MeetingAgent)
- **感知**: 读取会议列表、会议纪要、待办事项
- **记忆**: 存储历史会议决策、行动项追踪、参与人偏好
- **决策**: 自动提取会议行动项、生成会议纪要摘要、识别关键决策
- **交互**: 对话式创建会议、查询会议记录、生成会议议程
- **执行**: 自动创建会议、分配行动项、发送会议提醒

#### 3.3.3 项目周报编写智能体 (WeeklyReportAgent)
- **感知**: 读取本周 KPI、进展项、下周计划、风险项
- **记忆**: 存储历史周报模板、常用表述、项目上下文
- **决策**: 自动汇总本周数据、智能生成周报草稿、检测数据异常
- **交互**: 对话式调整周报内容、自然语言补充进展、预览周报
- **执行**: 自动生成周报、保存草稿、导出 PDF

#### 3.3.4 周工作计划制作智能体 (WorkPlanAgent)
- **感知**: 读取下周任务、优先级、资源分配、依赖关系
- **记忆**: 存储历史工作计划、任务完成率、个人工作模式
- **决策**: 智能排期、优先级排序、工作量评估、冲突检测
- **交互**: 对话式调整计划、自然语言添加任务、查看工作负载
- **执行**: 自动生成工作计划、分配任务、同步到周报

### 3.4 Agent 五大能力技术实现

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 运行时引擎                          │
├─────────┬─────────┬─────────┬─────────┬─────────────────────┤
│  感知   │  记忆   │  决策   │  交互   │       执行          │
│Perceive │ Memory  │ Decide  │Interact │      Execute        │
├─────────┼─────────┼─────────┼─────────┼─────────────────────┤
│API 数据 │PostgreSQL│LLM 推理 │SSE 流式 │  Tool 调用/函数执行  │
│读取器   │记忆表   │Prompt链 │对话UI   │  API 写操作         │
│事件监听 │向量检索 │规则引擎 │表单交互 │  定时任务           │
└─────────┴─────────┴─────────┴─────────┴─────────────────────┘
```

**感知 (Perceive)**: 通过 `agent-api.js` 调用 pro-site 现有 API 获取项目数据
**记忆 (Memory)**: PostgreSQL 新增 `agent_memories` 表，存储对话历史、决策记录、用户偏好
**决策 (Decide)**: 调用 OpenAI 兼容 API，使用 Prompt 模板 + 上下文记忆生成决策
**交互 (Interact)**: SSE (Server-Sent Events) 流式对话，支持 Markdown 渲染、代码高亮
**执行 (Execute)**: 通过 Tool/Function Calling 调用 pro-site API 执行具体操作

### 3.5 数据库新增表

```sql
-- Agent 定义表
CREATE TABLE agents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,           -- Agent 名称
    type VARCHAR(32) NOT NULL,            -- progress/meeting/weekly_report/work_plan
    description TEXT DEFAULT '',
    system_prompt TEXT DEFAULT '',        -- 系统提示词
    config JSONB DEFAULT '{}',            -- Agent 配置(JSON)
    tools JSONB DEFAULT '[]',             -- 可用工具列表
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent 会话表
CREATE TABLE agent_sessions (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER REFERENCES agents(id),
    title VARCHAR(256) DEFAULT '',
    status VARCHAR(16) DEFAULT 'active',  -- active/archived
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent 消息表
CREATE TABLE agent_messages (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES agent_sessions(id),
    role VARCHAR(16) NOT NULL,            -- user/assistant/system/tool
    content TEXT DEFAULT '',
    tool_calls JSONB,                     -- 工具调用记录
    tool_results JSONB,                   -- 工具返回结果
    tokens_used INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agent 记忆表
CREATE TABLE agent_memories (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER REFERENCES agents(id),
    session_id INTEGER REFERENCES agent_sessions(id),
    memory_type VARCHAR(32) NOT NULL,     -- fact/preference/context/decision
    key VARCHAR(128) DEFAULT '',
    content TEXT NOT NULL,
    embedding VECTOR(1536),               -- 向量嵌入 (pgvector, 可选)
    metadata JSONB DEFAULT '{}',
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Skill 定义表
CREATE TABLE skills (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT DEFAULT '',
    category VARCHAR(32) DEFAULT '',      -- data/api/workflow/notification
    trigger_type VARCHAR(32) DEFAULT '',  -- manual/scheduled/event
    config JSONB DEFAULT '{}',            -- Skill 配置
    code TEXT DEFAULT '',                 -- 执行代码/工作流定义
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Skill 执行记录表
CREATE TABLE skill_executions (
    id SERIAL PRIMARY KEY,
    skill_id INTEGER REFERENCES skills(id),
    session_id INTEGER REFERENCES agent_sessions(id),
    input_data JSONB DEFAULT '{}',
    output_data JSONB DEFAULT '{}',
    status VARCHAR(16) DEFAULT 'pending', -- pending/running/success/failed
    error TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 3.6 后端新增 API 路由

在 pro-site 基础上新增 `app/routers/agents.py` 和 `app/routers/skills.py`：

```
POST   /api/agents/                    # 创建 Agent
GET    /api/agents/                    # Agent 列表
GET    /api/agents/{id}                # Agent 详情
PUT    /api/agents/{id}                # 更新 Agent
DELETE /api/agents/{id}                # 删除 Agent

POST   /api/agents/{id}/sessions       # 创建会话
GET    /api/agents/{id}/sessions       # 会话列表
GET    /api/sessions/{id}/messages     # 会话消息历史

POST   /api/agents/{id}/chat           # 发送消息 (SSE 流式响应)
POST   /api/agents/{id}/execute        # 直接执行 Agent 任务

GET    /api/agents/{id}/memories       # 获取记忆
POST   /api/agents/{id}/memories       # 保存记忆
DELETE /api/agents/{id}/memories/{mid} # 删除记忆

POST   /api/skills/                    # 创建 Skill
GET    /api/skills/                    # Skill 列表
GET    /api/skills/{id}                # Skill 详情
PUT    /api/skills/{id}                # 更新 Skill
DELETE /api/skills/{id}                # 删除 Skill
POST   /api/skills/{id}/execute        # 执行 Skill
GET    /api/skills/{id}/executions     # 执行记录
```

### 3.7 前端 CoWork 工作台 UI 设计

```
┌──────────────────────────────────────────────────────────────────┐
│ 顶栏: XIN CoWork Logo | 搜索 | 主题切换 | 用户头像                │
├──────────┬───────────────────────────────────┬───────────────────┤
│          │                                   │                   │
│  左侧    │           中间工作区               │    右侧面板       │
│  导航    │                                   │                   │
│          │  ┌─────────────────────────────┐  │  ┌─────────────┐  │
│ 工作台   │  │      Agent 对话区            │  │  │ Agent 信息  │  │
│ Agent   │  │                             │  │  ├─────────────┤  │
│ 管理    │  │  (流式消息, Markdown渲染)    │  │  │ 上下文面板  │  │
│ Skill   │  │                             │  │  ├─────────────┤  │
│ 管理    │  │                             │  │  │ 记忆面板    │  │
│ 会话    │  │                             │  │  ├─────────────┤  │
│ 历史    │  │                             │  │  │ 工具执行    │  │
│ 记忆    │  │                             │  │  │ 日志        │  │
│ 管理    │  ├─────────────────────────────┤  │  └─────────────┘  │
│          │  │      输入区                  │  │                   │
│ ────────│  │  [输入框] [发送] [工具按钮]  │  │                   │
│ 返回    │  └─────────────────────────────┘  │                   │
│ 首页    │                                   │                   │
└──────────┴───────────────────────────────────┴───────────────────┘
```

**左侧导航** (~240px): 工作台主页、Agent 管理、Skill 管理、会话历史、记忆管理、返回首页
**中间工作区** (弹性): Agent 对话界面、Agent 构建器、Skill 构建器
**右侧面板** (~320px): Agent 状态/配置、上下文数据、记忆摘要、工具执行日志

## 四、实施步骤

### Phase 1: 基础搭建 (复制 + 配置)

1. **复制 xin-site → xin-cowork**
   ```bash
   cp -r xin-site xin-cowork
   ```
   - 排除 `node_modules/` 和 `dist/`
   - 更新 `package.json` 的 name 为 `xin-cowork`

2. **修改 vite.config.js**
   - 端口改为 8090（避免与 xin-site 8087 冲突）
   - `rollupOptions.input` 新增 cowork 页面入口

3. **修改 docker-compose.yml**
   - 新增 `./xin-cowork:/app/xin-cowork` 卷挂载
   - 新增 `xin-ai-node-modules-cowork` 命名卷
   - 端口映射新增 `8090:8090`

4. **修改 docker-entrypoint.sh**
   - 新增启动 xin-cowork 的命令（端口 8090）

5. **修改 Dockerfile**
   - 新增 xin-cowork 的 node_modules 安装

### Phase 2: 数据库扩展

6. **pro-site 新增模型**
   - `app/models/agent.py`: Agent, AgentSession, AgentMessage, AgentMemory
   - `app/models/skill.py`: Skill, SkillExecution
   - 在 `app/models/__init__.py` 中注册

7. **pro-site 新增 Schema**
   - `app/schemas/agent.py`: AgentCreate, AgentUpdate, AgentOut, ChatRequest, ChatMessage
   - `app/schemas/skill.py`: SkillCreate, SkillUpdate, SkillOut, SkillExecutionOut

8. **pro-site 新增路由**
   - `app/routers/agents.py`: Agent CRUD + Chat (SSE) + Memory
   - `app/routers/skills.py`: Skill CRUD + Execute
   - 在 `app/main.py` 中注册路由

9. **pro-site 配置更新**
   - `app/config.py`: 新增 `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` 配置项
   - `requirements.txt`: 新增 `openai`, `sse-starlette`

### Phase 3: Agent 引擎实现

10. **Agent 运行时核心**
    - `app/services/agent_engine.py`: Agent 执行引擎
      - `AgentEngine` 类：管理 Agent 生命周期
      - `perceive()`: 调用 pro-site API 获取项目数据
      - `decide()`: 调用 LLM 生成决策
      - `execute()`: 执行 Tool/Function 调用
      - `remember()`: 保存/检索记忆
    - `app/services/agent_tools.py`: Agent 工具集
      - `get_progress_tasks()`: 获取进度任务
      - `create_progress_task()`: 创建任务
      - `update_task_status()`: 更新状态
      - `get_weekly_report()`: 获取周报
      - `save_weekly_report()`: 保存周报
      - `get_meetings()`: 获取会议
      - `create_meeting()`: 创建会议
      - `get_work_tasks()`: 获取工作任务
      - `create_work_task()`: 创建工作任务

11. **预置四大 Agent**
    - `app/services/agent_presets.py`: 四大智能体的 System Prompt 和配置
    - 每个 Agent 定义：名称、描述、系统提示词、可用工具、触发条件

### Phase 4: CoWork 前端实现

12. **新增 cowork.css**
    - 三栏布局样式
    - Agent 对话气泡样式
    - 侧边栏导航样式
    - 代码高亮、Markdown 渲染样式
    - 工具执行日志样式
    - 记忆面板样式

13. **新增 cowork.js（主控制器）**
    - CoWork 应用初始化
    - 路由注册（/cowork/workspace, /cowork/agents, /cowork/skills, /cowork/sessions, /cowork/memory）
    - 状态管理（当前 Agent、当前会话、面板切换）

14. **新增 agent-engine.js（前端 Agent 引擎）**
    - SSE 流式对话处理
    - 消息发送/接收
    - 工具执行状态追踪
    - Markdown 渲染（引入 marked.js）
    - 代码高亮（引入 highlight.js）

15. **新增 agent-ui.js（UI 组件）**
    - 对话消息组件（用户/助手/工具调用）
    - 输入框组件（支持多行、@提及、/命令）
    - Agent 卡片组件
    - 会话列表组件
    - 记忆面板组件
    - 工具执行日志组件

16. **新增 skill-builder.js（Skill 构建器）**
    - Skill 表单编辑
    - 触发器配置（手动/定时/事件）
    - 工具链编排
    - 测试运行

17. **新增 memory-store.js（记忆管理）**
    - 记忆列表展示
    - 记忆搜索/筛选
    - 记忆编辑/删除

18. **新增 agent-api.js（API 封装）**
    - Agent CRUD API
    - 对话 API（SSE）
    - Skill CRUD/Execute API
    - Memory API

19. **新增 cowork/ 页面**
    - `cowork/workspace/index.html`: AI 工作台主页（三栏布局，Agent 对话）
    - `cowork/agents/index.html`: Agent 列表页（卡片展示，创建/编辑入口）
    - `cowork/agents/builder.html`: Agent 构建器（可视化配置）
    - `cowork/agents/detail.html`: Agent 详情/调试页
    - `cowork/skills/index.html`: Skill 列表页
    - `cowork/skills/builder.html`: Skill 构建器
    - `cowork/skills/detail.html`: Skill 详情/测试页
    - `cowork/sessions/index.html`: 会话历史页
    - `cowork/memory/index.html`: 记忆管理页

20. **修改 app.js 注册新路由**
    - 新增 `/cowork/*` 路由规则
    - 导航栏新增 CoWork 入口

### Phase 5: 集成测试

21. **Docker 配置更新**
    - 验证 docker-compose 能同时运行 xin-site + xin-cowork + pro-site + abs-site
    - 端口不冲突：xin-site(8087), pro-site(8088), abs-site(8089), xin-cowork(8090)

22. **端到端测试**
    - Agent 对话流式响应
    - 工具调用执行（创建任务、更新状态等）
    - 记忆保存/检索
    - Skill 执行

## 五、关键文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 复制 | `xin-site/` → `xin-cowork/` | 完整复制，排除 node_modules/dist |
| 修改 | `xin-cowork/package.json` | name 改为 xin-cowork |
| 修改 | `xin-cowork/vite.config.js` | 端口 8090，新增 cowork 页面入口 |
| 新增 | `xin-cowork/assets/css/cowork.css` | CoWork 工作台样式 |
| 新增 | `xin-cowork/assets/js/cowork.js` | CoWork 主控制器 |
| 新增 | `xin-cowork/assets/js/agent-engine.js` | 前端 Agent 引擎 |
| 新增 | `xin-cowork/assets/js/agent-ui.js` | Agent UI 组件 |
| 新增 | `xin-cowork/assets/js/agent-api.js` | Agent API 封装 |
| 新增 | `xin-cowork/assets/js/skill-builder.js` | Skill 构建器 |
| 新增 | `xin-cowork/assets/js/skill-engine.js` | Skill 执行引擎 |
| 新增 | `xin-cowork/assets/js/memory-store.js` | 记忆管理 |
| 新增 | `xin-cowork/cowork/workspace/index.html` | AI 工作台主页 |
| 新增 | `xin-cowork/cowork/agents/*.html` | Agent 管理页面 |
| 新增 | `xin-cowork/cowork/skills/*.html` | Skill 管理页面 |
| 新增 | `xin-cowork/cowork/sessions/index.html` | 会话历史页 |
| 新增 | `xin-cowork/cowork/memory/index.html` | 记忆管理页 |
| 修改 | `xin-cowork/assets/js/app.js` | 注册 cowork 路由 |
| 新增 | `pro-site/app/models/agent.py` | Agent/Session/Message/Memory 模型 |
| 新增 | `pro-site/app/models/skill.py` | Skill/SkillExecution 模型 |
| 新增 | `pro-site/app/schemas/agent.py` | Agent Pydantic Schema |
| 新增 | `pro-site/app/schemas/skill.py` | Skill Pydantic Schema |
| 新增 | `pro-site/app/routers/agents.py` | Agent API 路由 |
| 新增 | `pro-site/app/routers/skills.py` | Skill API 路由 |
| 新增 | `pro-site/app/services/agent_engine.py` | Agent 执行引擎 |
| 新增 | `pro-site/app/services/agent_tools.py` | Agent 工具集 |
| 新增 | `pro-site/app/services/agent_presets.py` | 四大预置 Agent |
| 修改 | `pro-site/app/models/__init__.py` | 注册新模型 |
| 修改 | `pro-site/app/main.py` | 注册新路由 |
| 修改 | `pro-site/app/config.py` | 新增 LLM 配置 |
| 修改 | `pro-site/requirements.txt` | 新增 openai, sse-starlette |
| 修改 | `docker-compose.yml` | 新增 xin-cowork 卷/端口 |
| 修改 | `docker-entrypoint.sh` | 新增 xin-cowork 启动 |
| 修改 | `Dockerfile` | 新增 xin-cowork 依赖安装 |
| 修改 | `.docker.env.example` | 新增 LLM 配置模板 |

## 六、假设与决策

1. **前端不引入框架**: 保持 Vanilla JS，与 xin-site 一致，避免重写成本
2. **后端复用 pro-site**: 在 pro-site 基础上扩展 Agent/Skill 路由，不新建后端服务
3. **LLM 使用 OpenAI 兼容 API**: 通过环境变量配置 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`，支持多种模型
4. **流式对话使用 SSE**: 使用 `sse-starlette` 实现 Server-Sent Events，比 WebSocket 更简单
5. **记忆存储使用 PostgreSQL**: 不引入额外向量数据库（如需要向量检索可后续加 pgvector）
6. **UI 参考 Claude 三栏布局**: 左导航 + 中对话 + 右上下文，但保持 xin-site 的主题风格
7. **xin-cowork 端口 8090**: 与现有 8087/8088/8089 不冲突
8. **Agent 对话调用 pro-site API**: Agent 通过 HTTP 调用 pro-site 的现有 API 来执行操作，实现感知和执行能力

## 七、验证步骤

1. **Docker 启动验证**: `docker compose up -d` 后，4 个服务全部正常启动
2. **xin-site 不受影响**: 访问 http://localhost:8087 确认原站正常
3. **xin-cowork 首页**: 访问 http://localhost:8090 确认首页正常加载
4. **保留功能**: 文档、原型、术语表、路线图全部可访问
5. **CoWork 工作台**: 访问 http://localhost:8090/#/cowork/workspace 确认三栏布局正常
6. **Agent 对话**: 与进度管理 Agent 对话，验证流式响应
7. **工具调用**: 通过 Agent 创建任务，验证 pro-site API 调用成功
8. **记忆功能**: 验证 Agent 能记住上下文信息
9. **Skill 执行**: 创建并执行一个简单 Skill，验证执行记录
