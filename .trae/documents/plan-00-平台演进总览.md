# XIN-AI 平台演进总览（plan 汇总索引）

> 用途：汇总 `.trae/documents/` 下 8 份历史计划文档（2026-07-21 ~ 2026-08-09），梳理平台从 pro-site 单模块工作台到「玄圃·智创」三子系统协同平台的完整演进脉络，便于后续快速理解现状与决策依据。
> 阅读方式：先看「一、平台现状快照」建立整体认知，再按「二、演进时间线」定位各阶段，需要细节时跳转到对应原 plan 文档。

---

## 一、平台现状快照（2026-08-10 校准）

### 1.1 服务矩阵（单容器 xin-ai 承载）

| 服务 | 端口 | 职责 | 前端 |
|------|------|------|------|
| xin-site | 8087 | 项目门户（vite 构建 MPA） | — |
| pro-site | 8088 | 老项目管理工作台（保留运行，与 8091 共库互通） | 原生 JS |
| cowork-site | 8090 | 「玄圃·智创」统一入口静态页（3 卡片跳转 8091/8092/8094） | 纯静态 http.server |
| pro-cowork | 8091 | 项目管理智能体工作平台（主力）：项目协同 + Agent/Skill 平台 | 原生 JS |
| rag-cowork | 8092 | 知识工坊：知识库构建与 RAG 问答 | 原生 JS |
| rag-cowork-mcp | 8093 | rag-cowork 的 MCP 服务（FastMCP streamable-HTTP 独立进程） | — |
| mcp-cowork | 8094 | 技链工坊：MCP 服务注册/在线测试/调用统计 | 原生 JS |

### 1.2 数据库（共用 PG `XIN` 库，43 张表）

- **pro-cowork 28 张**：12 张 pro-site 业务表（`pro_projects`/`pro_modules`/`pro_phases`/`pro_progress_tasks`/`pro_meetings`(+items)/`pro_weekly_reports`(+kpis/progress_items/plan_tasks/risks)/`pro_weekly_work_tasks`）+ 智能体平台 8 张（`agents`/`agent_sessions`/`agent_messages`/`agent_memories`/`skills`/`skill_executions`/`task_runs`/`task_run_events`）+ 协同扩展 4 张（`pro_project_members`/`pro_personal_reports`+2 子表）+ 认证日志 3 张（`sys_user_credentials`/`sys_login_logs`/`sys_operation_logs`）+ 文件登记 `sys_files`
- **rag-cowork 11 张**：`rag_knowledge_bases`/`rag_kb_permissions`/`rag_documents`/`rag_chunks`/`rag_multimodal_resources`/`rag_entities`/`rag_relations`/`rag_sync_events`/`rag_parse_tasks`/`rag_query_logs`/`sys_users`（三系统共享）
- **mcp-cowork 4 张**：`mcp_servers`/`mcp_tools`/`mcp_test_cases`/`mcp_call_logs`
- 全部表/字段含中文 COMMENT（`scripts/db_comments.sql`，由三工程 ORM 元数据自动生成，514 条）
- 表名规范：项目管理表 `pro_` 前缀、系统表 `sys_` 前缀、知识库 `rag_` 前缀、MCP `mcp_` 前缀；智能体平台表（agents/skills/task_runs 等）无前缀

### 1.3 部署约定

- 单容器 + 源码卷挂载热重载；依赖（venv/node_modules）放命名卷；仅 requirements/Dockerfile/entrypoint 变更才需 rebuild
- 容器加入外部 `ai_network` 静态 IP；PG 连接用容器名 `pg_db`；启动前须停宿主机 8087/8088/8090 占用
- `docker compose restart` 不重读 env_file，改环境变量须 `docker compose up -d` 重建容器

---

## 二、演进时间线

| # | 时间 | 文档 | 主题 | 产出 |
|---|------|------|------|------|
| 1 | 2026-07-21 | [项目管理工作台设计计划](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/项目管理工作台设计计划.md) | pro-site 从零奠基 | FastAPI+PG 三模块工作台（周报/进度计划/每周任务） |
| 2 | 2026-07-28 | [pro-site-enhance-progress-meeting-worktasks](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/pro-site-enhance-progress-meeting-worktasks.md) | pro-site 体验增强 | 多项目 projects 表、MD 编辑预览、看板拖拽 |
| 3 | 2026-08-04 | [pro-cowork-upgrade-plan](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/pro-cowork-upgrade-plan.md) | pro-site → pro-cowork 升级 | 智能体平台（Agent/Skill 构建调试执行）、四大分身、五能力 |
| 4 | 2026-08-06 | [pro-cowork-minutes-bg-debug-plan](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/pro-cowork-minutes-bg-debug-plan.md) | pro-cowork 六项升级 | 会议纪要技能、长任务后台执行与回放、项目记忆、工坊调试增强 |
| 5 | 2026-08-08 | [plan-dashboard-auth-usage-excel](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/plan-dashboard-auth-usage-excel.md) | 驾驶舱增强 | 按天个人周报、权限体系、登录+操作日志看板、Excel 导出 |
| 6 | 2026-08-09 | [plan-rag-cowork-architecture](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/plan-rag-cowork-architecture.md) | rag-cowork/mcp-cowork 新建 | 知识库平台（8092/8093）+ MCP 管理平台（8094）+ sys_users 共享 |
| 7 | 2026-08-09 | [plan-table-rename-pro-prefix](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/plan-table-rename-pro-prefix.md) | 表名规范化 | 18 张表 RENAME（pro_/sys_ 前缀）、sys_users 双写同步 |
| 8 | 2026-08-09 | [plan-三模块修复与增强](file:///mnt/data0/ai_deployment/proj/src/xin-ai/.trae/documents/plan-三模块修复与增强.md) | 三模块集中修复 | 雪花 ID 精度、KB 可见性兜底、附件确定性预处理、首页看板等 |

---

## 三、各 plan 精要

### Plan 1 · 项目管理工作台设计计划（pro-site 奠基，07-21）

**目标**：把两个纯前端 HTML 工具（周报工具、进度计划执行图）升级为 FastAPI + PostgreSQL 全栈工作台，并新增「每周工作任务安排」模块。

**核心设计**：
- 数据模型 9 张表：modules / phases / progress_tasks / weekly_reports + 4 子表（kpis/progress_items/plan_tasks/risks）/ weekly_work_tasks
- **核心关联链路**：`Phase → ProgressTask → WeeklyPlanTask(周报下周任务) → WeeklyWorkTask(每周工作任务)`，两级可空外键实现"可选关联"——周报下周任务可关联进度计划任务，每周任务默认从周报下周任务批量生成（is_temporary 标记临时任务）
- 技术选型：FastAPI + SQLAlchemy 2.0 async + asyncpg + 原生 JS 三栏布局（橙色系，参照 automy-site）；`create_all` 自动建表不引 Alembic；单用户免认证
- 种子脚本从既有 HTML 提取 6 模块 + 3 阶段 + 40+ 任务

**意义**：确立了沿用至今的技术栈与"计划→周报→执行"追溯链路。

### Plan 2 · pro-site 功能增强（07-28）

**7 项需求**（#1/#4 已实现仅验证）：
- 新增 `projects` 表支持**多项目**：头部项目切换/新建，`GET /projects/active` 无项目时幂等创建默认项目；时间轴（月/双周/总天数）由项目起止日期动态生成，替换硬编码
- "今天"标签改 JS 动态渲染 `M/D`；删除多余提示 span；统计栏周数动态化
- 会议纪要/议程简介改 **Markdown 编辑+预览双模式**（marked.js CDN，MD 原文存 Text 字段）
- 每周任务卡片**原生 HTML5 拖拽**：跨列改状态（列 data-status ↔ 中文状态映射）、列内改 sort_order

**意义**：引入多项目概念，为后续多项目隔离（project_id 字段迁移 `scripts/add_project_id.sql`）与权限体系埋下基础。

### Plan 3 · pro-site → pro-cowork 升级（08-04）

**目标**：复制 pro-site 为 pro-cowork（端口 8091，pro-site 完全不动、共用 XIN 库零变更），修复既有智能体骨架 bug，补全「构建、调试、执行 Agent/Skill」平台能力。

**关键内容**：
- **修复 agent_tools.py 骨架 9 处字段错配**（Module.tag/title、Meeting.meet_date、缺 project_id 注入、async 懒加载 MissingGreenlet 须 selectinload、Date 类型转换等）
- **五大能力模型**（此后所有智能体的能力框架）：感知（agent_context.py 项目快照注入）/ 记忆（agent_memories + save_memory 主动沉淀）/ 决策（function calling 循环 ≤5 轮 + SSE 结构化 tool_call/tool_result 事件）/ 交互（SSE 流式 + 会话管理）/ 执行（业务工具 + run_skill 打通 Agent→Skill）
- 新增工具：run_skill / create_weekly_report / update_work_task / save_memory / get_today
- 四大预置智能体：进度管理/会议管理/周报编写/工作计划；四个预置技能（skill_presets.py 幂等播种）
- 前端 Workbuddy 风格重构（参照 xin-cowork 原型）：agents/agent-builder/skills/skill-builder/memories 五视图 + `POST /agents/{id}/debug` 结构化 Trace
- 部署接入：docker-compose/entrypoint/Dockerfile 增加 8091

**意义**：pro-cowork 诞生，确立 Agent 五能力框架与 SSE 事件协议。

### Plan 4 · pro-cowork 六项功能升级（08-06）

1. **会议纪要生成技能**：八通道模型配置中的 ASR 通道（paraformer-large，分片转写带时间戳）→ MAIN 模型三段式纪要；skill_engine 新增 `builtin` 步骤类型；输出卡片支持「保存到会议记录」（覆盖/追加）
2. **长任务后台执行 + 回放**：新增 `task_run_events` 表 + `task_runner.py` 后台执行器（独立会话、逐事件持久化、内存队列供 SSE tail）；`GET /task-runs/{id}/events?after_seq=N` 支持断线重放续看——**任务脱离 HTTP 连接生命周期**
3. **项目关联默认记忆**：agent_memories 加 project_id，预置分身 × 每项目播种默认记忆，注入规则「当前项目记忆 + 全局记忆（project_id NULL）」
4. **工坊增强**：分身/技能复制；调试会话持久化（status="debug"，带上下文，可 reset）；调试面板累积模式展示每轮入参/出参/耗时/注入记忆；update_meeting 加 mode=overwrite/append（已有纪要须先询问）
5. **Emoji/颜色可视化选择器**（构建器共用组件）
6. **任务补充框支持 @/#**，移除 📎/⚡ 按钮

**意义**：多模态附件处理链路与任务事件持久化机制成型；记忆按项目隔离。

### Plan 5 · 驾驶舱增强：个人周报/权限/登录日志/Excel（08-08）

**9 项需求**：
- 个人周报工作项改「每行一天」（day_of_week + content 替代 mon~sun 7 列；旧数据自动拆行迁移，hours 挂首行）
- 成员状态体系：全职/临时/退出（在职→全职、已退出→退出 自动迁移）
- **权限矩阵**：里程碑+项目周报仅项目经理（project.manager==姓名）可维护；会议+周计划 PM 或全职可维护；退出成员不可填个人周报；读接口不限（无效姓名因 projects 为空自然无数据）
- **登录认证**：姓名直登（localStorage 会话，X-User-Name 头传递）；新增 sys_login_logs / sys_operation_logs 两表；**中间件自动记录全部写操作**（按 path 映射 entity_type/action）
- LLM token 统计：三处流式调用加 `stream_options={"include_usage": True}` 尾 chunk 取 usage 落库
- 使用日志看板：当天/当周/当月三档统计 + 两级下钻
- 工作内容输入 `/` 选择当前周工作任务插入（参照 MentionBox）
- **Excel 导出**（仅 PM）：严格复刻参照格式（微软雅黑/FF1F4E78 深蓝表头/5 成员槽位/公式合计），openpyxl 实现，新增依赖

**意义**：平台从"工具"升级为"多用户系统"，引入身份、权限与可观测性。

### Plan 6 · rag-cowork / mcp-cowork 架构（08-09 上午）

**目标**：基于 demo/RAG-Anything 分析，新建知识库平台与 MCP 管理平台。

**架构决策**：
- **rag-cowork（8092 REST + 8093 MCP 独立进程）**：继承 RAG-Anything 流水线（解析→VLM 认知→分块→Embedding→实体/关系抽取→PG+Milvus+Neo4j 三库联动）；Milvus 4 集合 `ragcowork_*`（HNSW+COSINE，含 kb_id 标量过滤）；雪花 ID（worker_id rag=1/mcp=2，后 pro-cowork=3）
- **裁剪决策**：不引入 Redis Streams/worker（进程内 asyncio 流水线 + rag_sync_events 台账补偿）；不整体引入 raganything 库（抽取提示词思路自实现轻量抽取）
- **sys_users 三系统共享用户表**（姓名唯一锚点，pbkdf2 哈希与 pro-cowork 一致；种子从 user_credentials + project_members 导入）
- **五级知识库可见性**：company 全员可读 / department 按 sys_users.department / project 继承 pro_project_members / personal 仅 owner+授权 / external 仅显式授权（rag_kb_permissions）
- **9 个 MCP 工具**：kb_create/kb_list/kb_file_upload/kb_file_parse/kb_file_add/kb_files/kb_file_delete/rag_search/rag_query，身份经 X-User-Name 透传
- **mcp-cowork（8094）**：mcp_servers/mcp_tools/mcp_test_cases/mcp_call_logs 四表，注册→同步工具→在线测试台（存用例/回放）→统计看板
- 统一入口页（后由 xin-site/cowork.html 演化为独立 cowork-site:8090）
- EMBEDDING_DIM 必须与网关 EMBEDDING 模型原生维度对齐的教训（后实测为 2560 而非 BGE-M3 的 1024）

**意义**：平台从单系统扩展为三子系统协同格局，确立共享用户、五级权限与 MCP 互通协议。

### Plan 7 · 表名前缀规范化（pro_/sys_）与 sys_users 同步（08-09 下午）

**背景**：Plan 6 决策"既有 27 表不改名"被推翻，用户要求统一前缀。

**内容**：
- **18 张表 RENAME**：16 张项目管理表加 `pro_` 前缀（projects→pro_projects 等）、2 张日志表加 `sys_` 前缀（login_logs→sys_login_logs 等）；智能体平台 9 表（agents/skills/task_runs/user_credentials 等）不动
- PG `ALTER TABLE RENAME` 使 FK/序列/默认值自动跟随，零数据丢失；约束/索引名保留旧名不强制改
- 四工程引用点全量替换（pro-cowork 16 tablename+25 FK、pro-site 12+19、rag/mcp 裸 SQL 数处、scripts 全量更新）
- **sys_users 同步方案**：pro-cowork 双写（新增成员/改密码时 upsert sys_users，雪花 worker_id=3）+ rag/mcp 启动种子改 `ON CONFLICT (name) DO UPDATE` 兜底；删除成员不同步删 sys_users
- 执行顺序关键：备份→停容器→改代码→RENAME→启动→重生成 db_comments.sql→验证（避免 uvicorn --reload 在窗口期建新空表）

**意义**：确立至今的表名规范；三系统账号数据实时一致。

### Plan 8 · 三模块修复与增强（08-09 深夜）

** rag-cowork（A 组）**：
- **雪花 ID 精度丢失根治**：前端 JSON.parse 截断 18-19 位 ID → 后端挂 `BigIntSafeJSONResponse`（abs(v)>2^53-1 的 int 递归转 str），前端移除 Number() 强转——一次性覆盖全部端点（mcp-cowork 同款修复）
- KB 可见性 owner 兜底（创建者对任意级别可见）；创建知识库时写入创建者 admin 授权（含存量回填 SQL）
- sys_files 增加 `kb_indexed` 字段，解析终态回写；parsers 支持 html/htm 按文本入库

**mcp-cowork（B 组）**：
- anyio `ExceptionGroup` 解包 `flatten_exc()`：健康检查/同步/调用显示真实子异常而非 "unhandled errors in a TaskGroup"
- 服务卡片新增「测试」「记录」按钮 + 调用记录弹窗（/stats/logs 支持 server_id 过滤与参数详情）

**pro-cowork（C 组）**：
- **附件确定性预处理**（`parse_attachments` 共享服务）：audio→ASR 实时分段事件、image→VISION、pdf→文档解析、excel→openpyxl、word/ppt→zip+XML——发送前解析并入提示词，替代"提示词指引模型自愿调技能"（根治会议纪要无实时转写问题）；技能指引仅作解析失败兜底
- 对话页接入小模型意图识别（先于主模型输出意图事件）
- 个人周报修复：非 PM 保存 500（create 改用 resolve_visible_project_id）、表格 fixed 布局列宽、新增行默认项目
- 操作日志中间件读取请求体记 detail（剔除 password 等敏感键，截断 1000 字符）
- **首页看板 dashboard**：5 个 widget（我的待办/长任务结果/本周任务/延误进度/常用数字分身），自定义配置存 localStorage 按登录人隔离（后落地为 home.js，view 名 "home"）

**意义**：三模块质量收尾，确立 BigInt 安全、确定性预处理等横切范式。

---

## 四、Plan 之后的追加变更（2026-08-10，未单独成文）

以下来自实施会话记录，已落地但未形成独立 plan 文档：

1. **个人周报 AI 概括**：`pro_personal_reports` 加 `summary` 列；`personal_summary_service.py`（SMALL 模型生成 2-3 段：本周工作+下周计划）；`POST /api/personal-reports/summary`；前端右栏「周报概括」面板（✨ AI 生成 / 💾 保存，随周报归档）
2. **第五预置分身「知识库管理助手」**：8 个 kb_* 工具经 MCP 协议调 rag-cowork（`KB_MCP_URL`，`app/services/mcp_client.py`，X-User-Name 透传权限）；预置 5 条操作规范记忆
3. **周报编写助手增强**：新增 4 个个人周报工具（list/get/save/generate_summary），工具总数达 32；「个人周报填报口径」预置记忆；支持催报统计与代填
4. **技能库更新**：「周报草稿生成」增加个人周报填报情况步骤；新增「个人周报填报扫描」技能（预置技能达 9 个）
5. **缺陷修复**：新个人周报 MissingGreenlet（空集合初始化）、kb_rag_query top_k 幻觉参数过滤、debug 端点多轮 404（显式 commit）、前端编辑弹窗同步 ALL_TOOLS/AGENT_TYPES
6. **@/# 弹层定位修复**：边界检测考虑全部 overflow 非可见祖先，解决顶部 16px 裁剪
7. **cowork.html 迁移**：统一入口页从 xin-site 迁出为独立 cowork-site（8090，python -m http.server 纯静态）
8. **文档同步**：pro-cowork/README.md 与 cowork-site/操作手册.md 已按上述现状更新（2026-08-10）

---

## 五、跨 plan 关键决策沉淀

| # | 决策 | 出处 | 影响 |
|---|------|------|------|
| 1 | 多工程共用 XIN 库，表按前缀分治（pro_/sys_/rag_/mcp_） | Plan 6/7 | 新增表须遵循前缀规范；跨工程逻辑关联用裸 ID 不建物理 FK |
| 2 | create_all 自动建表 + scripts/*.sql 幂等脚本 + ORM comment 生成 db_comments.sql | Plan 1/6/7 | 不引 Alembic；改注释须改 ORM 后重生成脚本 |
| 3 | 原生 HTML/JS 无构建链（pro-cowork/rag/mcp） | Plan 1/3/6 | 前端改动刷新即生效；禁引入框架 |
| 4 | Agent 五能力框架（感知/记忆/决策/交互/执行） | Plan 3 | 所有分身与工具扩展的基准模型 |
| 5 | 任务事件持久化（task_run_events）+ SSE 重放 | Plan 4 | 长任务后台化与断线续看的统一机制 |
| 6 | 姓名制登录 + X-User-Name 头透传（三系统统一，sys_users 共享） | Plan 5/6/7 | 无 session/token；权限判定全部基于姓名 |
| 7 | 权限矩阵：PM 管里程碑/周报/成员，全职管会议/周计划，退出只读 | Plan 5 | 写端点鉴权基准 |
| 8 | 五级知识库可见性 + 创建即授权 + owner 兜底 | Plan 6/8 | rag 侧权限判定三段式 |
| 9 | 雪花 ID 全链路字符串化（BigIntSafeJSONResponse） | Plan 8 | 任何返回大整数的端点不得裸 JSONResponse |
| 10 | 附件发送前确定性预处理，技能指引仅兜底 | Plan 8 | 新增附件类型只改 parse_attachments |
| 11 | 八通道模型配置（MAIN/SMALL/CODER/EMBEDDING/RERANKER/VISION/ASR/TTS） | Plan 4 起 | 新能力按用途选通道，未配置降级不阻断 |
| 12 | 零弹窗确认（删除走行内二次确认） | Plan 6 | 全前端交互硬约束 |
| 13 | MCP 服务独立进程（8093），工具内取请求头用 request_ctx（mcp SDK ≥1.29） | Plan 6/实施 | mcp SDK 破坏性变更已适配：read_timeout_seconds 须 timedelta |
| 14 | 配置一律走 .env（pydantic-settings），敏感文件入 .gitignore | 全程 | 用户硬性约定 |

---

## 六、维护指引

- **改表结构**：改 ORM 模型 → 依赖 init_db create_all/_ensure 迁移 → 同步更新 scripts/*.sql → 重生成并应用 db_comments.sql（容器内分项目进程跑，避免 app 包名冲突）
- **改注释**：只改 ORM `comment=`，重生成 db_comments.sql，不手改 SQL 文件
- **新增分身/工具**：agent_presets.py + agent_tools.py（schema+handler）+ 前端 cowork.js 的 ALL_TOOLS/AGENT_TYPES 三处同步
- **新增知识库能力**：rag-cowork mcp_tools.py 实现 → pro-cowork kb_* 工具包装 → mcp-cowork 同步即可见
- **排障入口**：容器日志 `docker compose logs -f`；各服务 `/docs`；mcp 异常先看 flatten_exc 后的真实子异常
