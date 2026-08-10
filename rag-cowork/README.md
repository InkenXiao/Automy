# XIN · rag-cowork 知识库平台（玄圃 · 智枢）

> 基于 FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL + Milvus（向量）+ Neo4j（图谱）+ MinIO（文件存储）的知识库平台。提供**公司 / 部门 / 项目 / 个人 / 外接**五级知识库体系、多模态文档解析入库（PDF/Office/音频/图片，扫描件经 MinerU 算力网关）、向量 + 图谱混合检索与 RAG 智能问答；并通过独立的 FastMCP streamable-HTTP 服务（端口 8093）对外提供知识库检索 MCP 工具。
>
> - **五级知识库体系**：company（全员可读）/ department（按 `sys_users.department` 匹配）/ project（继承 pro-cowork 项目成员）/ personal（仅创建者）/ external（仅显式授权）；任意级别可通过 `rag_kb_permissions` 附加 read/write/admin 授权。
> - **三库落数**：业务元数据入 PostgreSQL，向量入 Milvus（`ragcowork_*` 4 集合），实体/关系入 Neo4j，原始文件入 MinIO（`{kb_id}/{yyyymm}/{文件名}`）。
> - **解析流水线幂等**：重解析时先清除该文档旧的 chunks/entities/relations（PG + Milvus + Neo4j）再重新写入，可安全重复触发。
> - 与 pro-cowork **共用 XIN 数据库**，`sys_users` 共享用户表（启动时从 `sys_user_credentials` / `pro_project_members` 幂等导入，pro-cowork 已设密码的用户同密登录）。
> - Web 服务运行在 **8092** 端口，MCP 服务运行在 **8093** 端口（pro-cowork 为 8091，mcp-cowork 为 8094）。

---

## 一、项目概述

本工程是「XIN · rag-cowork 知识库平台」的后端服务，对外提供：

- **8092 端口**：`/api/*` RESTful 接口 + 根路径挂载 `web/` 前端静态页（玄圃 · 智枢：左知识库树 / 中文件列表 / 右 RAG 测试）；
- **8093 端口**：FastMCP streamable-HTTP 服务（端点 `http://localhost:8093/mcp`），独立进程运行，避免与 FastAPI lifespan 冲突，供 mcp-cowork 等 MCP 客户端接入。

其业务价值在于：

- 将「知识库 → 文档 → 分块/多模态资源 → 实体/关系」打通为多粒度可检索的知识资产；
- 向量检索（Milvus COSINE）与图谱邻域（Neo4j）混合召回，LLM 生成带引用来源的答案；
- 五级权限 + 显式授权实现人群隔离，项目级知识库直接继承 pro-cowork 项目成员关系。

---

## 二、技术栈

| 类别 | 选型 | 版本（来自 `requirements.txt`） |
|------|------|--------------------------------|
| Web 框架 | FastAPI | `>=0.110.0` |
| ASGI 服务器 | Uvicorn | `>=0.27.0` |
| ORM | SQLAlchemy (async) | `>=2.0.25` |
| PG 异步驱动 | asyncpg | `>=0.29.0` |
| 配置管理 | pydantic-settings | `>=2.1.0` |
| 数据库 | PostgreSQL | 通过 asyncpg 连接（与 pro-cowork 同一 `XIN` 库） |
| 向量库 | Milvus（pymilvus） | `>=2.4.0` |
| 图数据库 | Neo4j（neo4j driver） | `>=5.20.0` |
| 对象存储 | MinIO（minio SDK） | `>=7.2.0` |
| 模型调用 | openai / httpx（OpenAI 兼容协议） | `openai>=1.30.0` |
| 文档解析 | PyMuPDF / openpyxl / pydub | 见 `requirements.txt` |
| MCP 服务 | FastMCP（mcp 包） | `mcp>=1.8.0,<2.0.0` |
| 前端 | 原生 HTML/CSS/JS | 无构建工具 |

---

## 三、代码结构

```text
rag-cowork/
├── requirements.txt            # Python 依赖清单
├── .env                        # 环境变量配置 (含密码, 勿提交)
├── README.md                   # 本文件
├── app/                        # FastAPI 后端应用 + MCP 服务
│   ├── __init__.py
│   ├── main.py                 # FastAPI 入口 (8092): lifespan/CORS/路由注册/静态文件挂载
│   ├── config.py               # pydantic-settings 读取 .env (PG/模型网关/Milvus/Neo4j/MinIO/RAG 参数)
│   ├── database.py             # 异步引擎/会话工厂/Base/get_db/init_db (+ sys_users 种子)
│   ├── deps.py                 # X-User-Name 用户识别 + 五级知识库可见性/写权限判定
│   ├── mcp_server.py           # FastMCP streamable-HTTP 独立进程入口 (8093, /mcp)
│   ├── mcp_tools.py            # 9 个 MCP 工具实现 (复用 service/ORM 层, 不经 HTTP 自调)
│   ├── models/                 # SQLAlchemy ORM 模型
│   │   ├── base.py             # TimestampMixin (created_at/updated_at) + SoftDeleteMixin (is_delete)
│   │   ├── user.py             # sys_users 共享用户表 (rag/mcp/pro-cowork 三系统共用)
│   │   ├── knowledge.py        # rag_knowledge_bases / rag_kb_permissions + KB_LEVELS 五级常量
│   │   ├── document.py         # rag_documents / rag_chunks / rag_multimodal_resources
│   │   ├── graph.py            # rag_entities / rag_relations
│   │   └── sync.py             # rag_sync_events / rag_parse_tasks / rag_query_logs
│   ├── routers/                # API 路由 (统一前缀 /api)
│   │   ├── auth.py             # 姓名登录/会话恢复/设置密码/用户列表
│   │   ├── knowledge_bases.py  # 五级知识库 CRUD + 显式授权管理 + 项目下拉
│   │   ├── files.py            # 文件上传 (MinIO 归档+哈希去重)/列表/触发解析/进度轮询/删除/原文下载
│   │   ├── rag.py              # 纯检索 search / RAG 问答 query
│   │   └── stats.py            # 总览统计/检索日志/Milvus+Neo4j schema 初始化
│   └── services/               # 业务服务层
│       ├── llm_service.py      # MAIN/SMALL/VISION 三通道 LLM 封装 (OpenAI 兼容)
│       ├── embedding_service.py# 向量化 (OpenAI 兼容 embeddings + NaN 清洗/维度对齐)
│       ├── parsers.py          # 按扩展名路由解析: pdf/docx/pptx/xlsx/txt/音频(ASR)/图片(VLM)
│       ├── parse_pipeline.py   # ★解析入库流水线: MinIO 下载→解析→分块→向量化→抽取→三库写入 (幂等)
│       ├── graph_service.py    # 实体/关系抽取 (MAIN 模型, 含 few-shot 示例的 JSON 输出 prompt)
│       ├── milvus_store.py     # Milvus ragcowork_* 4 集合建/插/查/删 (kb_id 标量过滤)
│       ├── neo4j_store.py      # Neo4j 图谱读写 (RagEntity/RagDocument/RagKnowledgeBase 节点)
│       ├── minio_service.py    # MinIO 归档 ({kb_id}/{yyyymm}/{文件名}, 桶自动创建)
│       ├── rag_query.py        # 混合检索 + LLM 生成含引用答案, 写 rag_query_logs
│       └── snowflake.py        # 雪花 ID 生成器 (SNOWFLAKE_WORKER_ID=1)
└── web/                        # 前端静态资源 (由 FastAPI StaticFiles 挂载到 /)
    ├── index.html              # 玄圃 · 智枢 单页 (知识库树/文件列表/RAG 测试 + 授权弹窗)
    └── login.html              # 登录页 (姓名 + 可选密码)
```

---

## 四、核心业务模块

| 模块 | 路由/服务文件 | 模型 | 职责 |
|------|--------------|------|------|
| 身份确认 | `app/routers/auth.py` | `SysUser` | 姓名登录（未设密码直登；已设密码走 pbkdf2 加盐校验，与 pro-cowork 同规则）；`GET /users` 供授权下拉 |
| 知识库管理 | `app/routers/knowledge_bases.py` | `RagKnowledgeBase` / `RagKbPermission` | 五级知识库 CRUD（project 级校验 `pro_projects` 存在、department 级必传部门）；read/write/admin 显式授权；删除级联清理 Milvus/Neo4j |
| 知识库文件 | `app/routers/files.py` | `RagDocument` / `RagParseTask` | 上传（≤100MB，SHA-256 同库去重，MinIO 归档）、触发解析、任务进度轮询、逻辑删除（级联清理三库）、原文回源下载 |
| 解析流水线 | `app/services/parse_pipeline.py` + `parsers.py` | `RagChunk` / `RagMultimodalResource` / `RagEntity` / `RagRelation` / `RagSyncEvent` | 进程内 asyncio 后台执行；阶段进度写 `rag_parse_tasks`（parse/chunk/embed/extract/graph/done/failed），三库写入结果写 `rag_sync_events` 台账（失败可重试） |
| 检索问答 | `app/routers/rag.py` + `app/services/rag_query.py` | `RagQueryLog` | search（纯向量召回分块+实体）/ query（hybrid=向量+图谱，local=仅向量，global=仅图谱；LLM 生成含 `[来源: 文档名]` 引用的答案） |
| 统计管理 | `app/routers/stats.py` | — | 可见范围总览（KB/文档/分块/实体/关系/问答次数 + Neo4j 图谱统计）、本人检索日志、`schema/init` 幂等初始化 Milvus 集合与 Neo4j 约束 |
| MCP 服务 | `app/mcp_server.py` + `app/mcp_tools.py` | — | 8093 端口 FastMCP streamable-HTTP，9 个工具（见第七章），身份经 `X-User-Name` 头或 `user_name` 参数传递 |

**五级知识库可见性规则**（`app/deps.py` 的 `visible_kb_ids`）：

```text
company    : 全员可读
department : kb.department == sys_users.department
project    : 用户在 pro-cowork pro_project_members 中属于该项目 (同库直读)
personal   : 仅 owner 本人
external   : 仅 rag_kb_permissions 显式授权
另: 显式授权 (read/write/admin) 对任意级别附加可见
写权限: owner / admin|write 授权; department 与 project 级成员默认可写
```

**文档解析链路**（`parsers.py` 按扩展名路由）：

| 文件类型 | 解析通道 |
|----------|----------|
| PDF（电子版） | PyMuPDF 文本层直抽 |
| PDF（扫描件，文本层 <50 字符） | MinerU 算力网关（`MINERU_API_URL`，HTTP `/api/v1/parse/pdf`） |
| docx / pptx | zip + XML 文本抽取（无额外依赖） |
| xlsx / xlsm | openpyxl 逐 sheet 抽取 |
| txt / md / csv / json / log | 直接读取 |
| 音频（mp3/wav/m4a 等） | pydub 切片 + ASR 转写（带时间戳） |
| 图片（jpg/png 等） | VLM 视觉多模态模型生成内容描述 |

---

## 五、数据模型

### 5.1 PostgreSQL 表清单（11 张，全部含 `is_delete` 逻辑删除）

| 模型类 | 表名 | 文件 | 关键字段 |
|--------|------|------|----------|
| `SysUser` | `sys_users` | `app/models/user.py` | `user_id`(雪花 PK), `name`(unique), `password_hash`(salt$hash), `display_name`, `department`, `is_active` |
| `RagKnowledgeBase` | `rag_knowledge_bases` | `app/models/knowledge.py` | `kb_id`(PK), `name`, `level`(五级), `description`, `owner_user_id`, `project_id`(可空), `department`, `user_id` |
| `RagKbPermission` | `rag_kb_permissions` | `app/models/knowledge.py` | `id`(PK), `kb_id`, `user_id`, `perm`(read/write/admin) |
| `RagDocument` | `rag_documents` | `app/models/document.py` | `doc_id`(PK), `kb_id`, `file_name`, `file_ext`, `file_size`, `file_hash`(SHA-256 去重), `minio_bucket`, `minio_path`, `parse_status`(pending/parsing/done/failed), `parser_type`, `total_chunks/images/tables`, `error_msg`, `user_id` |
| `RagChunk` | `rag_chunks` | `app/models/document.py` | `chunk_id`(PK), `doc_id`, `kb_id`, `chunk_index`, `content`, `page_number`, `chunk_type`, `milvus_id`, `user_id` |
| `RagMultimodalResource` | `rag_multimodal_resources` | `app/models/document.py` | `resource_id`(PK), `doc_id`, `kb_id`, `chunk_id`(可空), `resource_type`(image/table/audio), `minio_path`, `content_desc`(AI 描述, 参与检索), `milvus_id` |
| `RagEntity` | `rag_entities` | `app/models/graph.py` | `entity_id`(PK), `kb_id`, `doc_id`, `entity_name`, `entity_type`, `description`, `weight`, `neo4j_node_id`, `milvus_id` |
| `RagRelation` | `rag_relations` | `app/models/graph.py` | `relation_id`(PK), `kb_id`, `doc_id`, `src_entity_id`, `tgt_entity_id`, `relation_type`, `description`, `keywords`, `neo4j_edge_id` |
| `RagSyncEvent` | `rag_sync_events` | `app/models/sync.py` | `event_id`(PK), `action`, `target_type`(chunk/entity/relation/resource), `target_id`, `doc_id`, `kb_id`, `payload`(JSONB), `status`(pending/completed/failed), `retry_count`, `error_msg` |
| `RagParseTask` | `rag_parse_tasks` | `app/models/sync.py` | `task_id`(PK), `doc_id`, `kb_id`, `stage`(parse/chunk/embed/extract/graph/done/failed), `status`, `progress`(0-100), `error_msg` |
| `RagQueryLog` | `rag_query_logs` | `app/models/sync.py` | `log_id`(PK), `user_id`, `kb_ids`(JSONB), `query`, `mode`, `answer_excerpt`, `hit_count`, `latency_ms` |

> 主键均为雪花 ID（`app/services/snowflake.py`，`SNOWFLAKE_WORKER_ID=1`）；建表由 `init_db()` 的 `create_all` 幂等完成。
> `sys_users` 种子：启动时合并 pro-cowork `sys_user_credentials`（继承 `password_hash`，同密登录）与 `pro_project_members` 姓名（无密码直登），幂等插入。

### 5.2 Milvus 集合（4 个，`app/services/milvus_store.py`）

| 集合 | 主键 | 内容字段 | 说明 |
|------|------|----------|------|
| `ragcowork_chunks` | `chunk_id` | `content` | 文本分块向量 |
| `ragcowork_resources` | `resource_id` | `description` | 多模态资源描述向量 |
| `ragcowork_entities` | `entity_id` | `name`, `description` | 实体向量 |
| `ragcowork_relations` | `relation_id` | `src`, `tgt`, `description` | 关系向量（预留） |

> 向量字段 `embedding` 维度 = `EMBEDDING_DIM`；索引 HNSW + COSINE，`kb_id` 建 STL_SORT 标量索引，检索统一以 `kb_id IN [...]` 做权限/范围过滤。集合由 `POST /api/stats/schema/init` 幂等创建。

### 5.3 Neo4j 图谱（`app/services/neo4j_store.py`）

```text
节点: RagEntity (entity_id 唯一约束) / RagDocument (doc_id) / RagKnowledgeBase (kb_id)
关系: (RagEntity)-[:RAG_RELATES {relation_type, kb_id, doc_id}]->(RagEntity)
      (RagEntity)-[:RAG_MENTIONED_IN]->(RagDocument)
      (RagDocument)-[:RAG_BELONGS_TO]->(RagKnowledgeBase)
所有查询带 kb_id 过滤, 保证知识库间数据隔离; 约束由 schema/init 幂等创建。
```

---

## 六、API 接口清单

所有接口统一前缀 `/api`（`app/main.py` 注册）；除 `/api/health` 与 `/api/auth/*` 外均需登录（`X-User-Name` 请求头，前端 `encodeURIComponent` 编码中文姓名）。

### 6.1 身份确认（`/api/auth`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 姓名登录；已设密码未带时返回 `need_password=true`，密码错误返回 401 |
| GET | `/api/auth/me` | 按 `X-User-Name` 恢复会话 |
| POST | `/api/auth/password` | 设置/修改本人密码（`new_password` 为空串则清除密码） |
| GET | `/api/auth/users` | 用户列表（知识库授权下拉用） |

### 6.2 知识库（`/api/knowledge-bases`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge-bases` | 当前用户可见知识库列表（含文档数与我的权限） |
| POST | `/api/knowledge-bases` | 创建知识库（project 级必传 `project_id`，department 级必传 `department`） |
| PUT | `/api/knowledge-bases/{kb_id}` | 编辑知识库（需写权限） |
| DELETE | `/api/knowledge-bases/{kb_id}` | 逻辑删除（仅创建者），级联软删文档并清理 Milvus/Neo4j |
| GET | `/api/knowledge-bases/{kb_id}/permissions` | 授权列表 |
| POST | `/api/knowledge-bases/{kb_id}/permissions` | 授权（body: `{user_id, perm}`，perm ∈ read/write/admin，已存在则更新） |
| DELETE | `/api/knowledge-bases/{kb_id}/permissions/{perm_id}` | 撤销授权 |
| GET | `/api/knowledge-bases/projects/options` | 项目下拉选项（同库直读 pro-cowork `pro_projects`） |

### 6.3 知识库文件（`/api/files`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/files/upload?kb_id=N` | 上传文件（multipart，≤100MB，SHA-256 同库去重，MinIO 归档 + 建档 pending） |
| GET | `/api/files?kb_id=N` | 文件列表（附最新解析任务进度） |
| POST | `/api/files/{doc_id}/parse` | 触发解析入库（异步流水线，返回 `task_id` 供轮询；幂等，重解析先清旧数据） |
| GET | `/api/files/{doc_id}/task` | 最新解析任务进度（stage/status/progress，前端轮询） |
| DELETE | `/api/files/{doc_id}` | 逻辑删除文档，级联软删 chunks/resources/entities/relations 并清理 Milvus/Neo4j/MinIO |
| GET | `/api/files/{doc_id}/raw` | 原文下载（MinIO 回源） |

### 6.4 RAG 检索（`/api/rag`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rag/search` | 纯检索（body: `{kb_ids, query, top_k}`）：向量召回分块 + 实体，不生成答案；`kb_ids` 自动与可见集合取交集 |
| POST | `/api/rag/query` | RAG 问答（body: `{kb_ids, query, mode, top_k}`）：hybrid/local/global 三模式，LLM 生成含引用答案，写 `rag_query_logs` |

### 6.5 统计（`/api/stats`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/overview` | 总览：可见 KB 数/文档数/分块数/实体数/关系数/本人问答次数 + Neo4j 图谱统计 |
| GET | `/api/stats/query-logs` | 本人最近 50 条检索日志 |
| POST | `/api/stats/schema/init` | 幂等初始化 Milvus 集合 + Neo4j 约束（首次部署或 `EMBEDDING_DIM` 变更时调用） |

### 6.6 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务存活探针 |

---

## 七、MCP 服务（端口 8093）

`app/mcp_server.py` 以独立进程运行 FastMCP streamable-HTTP 服务（端点 `/mcp`），工具实现直接复用本工程 service/ORM 层（不经 HTTP 自调 8092）。用户身份：优先请求头 `X-User-Name`（URL 编码中文姓名），其次工具参数 `user_name`。

9 个工具（`app/mcp_tools.py`）：

| 工具名 | 说明 |
|--------|------|
| `kb_create` | 创建知识库（level: company/department/project/personal/external；project 级需 `project_id`，department 级需 `department`） |
| `kb_list` | 列出当前用户可见知识库（可按 level 过滤） |
| `kb_file_upload` | 上传文件到知识库：MinIO 归档 + 建档 pending（内容 base64，≤100MB，哈希去重） |
| `kb_file_parse` | 触发文档解析入库流水线（异步，返回 `task_id`） |
| `kb_file_add` | 上传 + 解析一步到位（= kb_file_upload + kb_file_parse） |
| `kb_files` | 知识库文件列表（含解析状态） |
| `kb_file_delete` | 删除知识库文件（逻辑删除 + 清理 Milvus/Neo4j/MinIO） |
| `rag_search` | 纯检索：返回分块/实体命中，不生成答案（按用户权限过滤 `kb_ids`） |
| `rag_query` | RAG 问答：向量 + 图谱混合检索 → LLM 生成含引用答案（mode: hybrid/local/global） |

---

## 八、环境变量

配置由 `app/config.py` 通过 pydantic-settings 从 `rag-cowork/.env` 读取（容器内由 `.docker.env` 环境变量覆盖）。**下方仅列变量名与含义，不包含任何真实密码值**。

### 8.1 PostgreSQL

| 变量名 | 含义 |
|--------|------|
| `POSTGRES_HOST` / `POSTGRES_PORT` | PG 地址（`.env` 默认 `localhost:11000`，容器内为 `pg_db:5432`） |
| `POSTGRES_DB` | 数据库名（`XIN`，与 pro-cowork 共库） |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | 数据库账号（`.env` 填真实值，README 以 `<密码>` 占位） |

### 8.2 模型通道（OpenAI 兼容协议，经 model-api 网关按模型名路由）

| 通道前缀 | 用途 | 消费方 |
|----------|------|--------|
| `MAIN_API_URL/KEY/MODEL` | 主推理模型：实体/关系抽取、RAG 答案生成 | `graph_service.py` / `rag_query.py` |
| `SMALL_API_URL/KEY/MODEL` | 轻量快推模型（未配置时自动回退 MAIN） | `llm_service.chat_small()` |
| `EMBEDDING_API_URL/KEY/MODEL` | 向量抽取模型 | `embedding_service.py` |
| `RERANKER_API_URL/KEY/MODEL` | 结果重排模型（预留） | — |
| `VISION_API_URL/KEY/MODEL` | 视觉多模态模型：图片内容识别 | `parsers.py` 图片通道 |
| `ASR_API_URL/KEY/MODEL` + `ASR_CHUNK_MS` | 语音转写（音频文件解析，分片上传） | `parsers.py` 音频通道 |
| `MINERU_API_URL` | MinerU 算力网关（扫描件 PDF 深度解析；留空则扫描件报错提示） | `parsers.py` PDF 通道 |

> 当前部署经 new-api 网关（model-api 容器）按模型名路由：`LLM`→主推理、`VLM`→视觉、`EMBEDDING`/`RERANKER`→向量/重排；ASR 为直连 HTTP。

### 8.3 存储与 RAG 参数

| 变量名 | 含义 |
|--------|------|
| `MILVUS_HOST` / `MILVUS_PORT` / `MILVUS_DB_NAME` | Milvus 连接（默认 `localhost:19530`） |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | Neo4j 连接（默认 `bolt://localhost:7687`） |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_SECURE` / `MINIO_REGION` | MinIO 连接（默认 `localhost:9000`） |
| `RAG_MINIO_BUCKET` | 知识库文件归档桶（默认 `ragkb`，首次使用自动创建） |
| `EMBEDDING_DIM` | ★向量维度，**必须等于 EMBEDDING 通道模型原生维度 2560**（见 9.1 注意事项） |
| `SNOWFLAKE_WORKER_ID` | 雪花 ID 工作节点（默认 `1`，与 mcp-cowork 的 2 区分） |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 分块目标字符数 / 重叠字符数（默认 800 / 120，配置项，`.env` 可不写） |
| `DEBUG` / `LOG_LEVEL` | 调试模式（控制 SQLAlchemy echo）/ 日志级别 |

---

## 九、启动方式

### 9.1 Docker 容器部署（推荐，开发模式）

由仓库根目录 `docker-compose.yml` 统一编排（单一 `xin-ai` 容器，源码挂载，改代码无需 rebuild）：

```bash
cd /mnt/data0/ai_deployment/proj/src/xin-ai

docker compose up -d        # 一键启动
docker compose logs -f      # 查看日志
docker compose down         # 停止
```

容器内由 `docker-entrypoint.sh` 拉起两个进程：

- `rag-cowork`（8092）：`python -m uvicorn app.main:app --host 0.0.0.0 --port 8092 --reload --reload-dir app`
- `rag-cowork-mcp`（8093）：`python -m app.mcp_server`

启动成功后：

- 前端（玄圃 · 智枢）：`http://localhost:8092/`
- API 文档（Swagger）：`http://localhost:8092/docs`
- MCP 端点：`http://localhost:8093/mcp`

> 首次部署（或 `EMBEDDING_DIM` 变更）后，登录前端调用一次 `POST /api/stats/schema/init` 初始化 Milvus 集合与 Neo4j 约束。

### 9.2 本地调试

```bash
cd /mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork

# Web 服务 (8092, 自动重载)
python -m uvicorn app.main:app --port 8092 --reload

# MCP 服务 (8093, 另开一个终端)
python -m app.mcp_server
```

> 依赖安装：`pip install -r requirements.txt`（音频解析另需容器/宿主机具备 ffmpeg）。

---

## 十、关键实现要点（踩坑记录）

1. **`EMBEDDING_DIM` 必须等于网关 EMBEDDING 模型原生维度 2560**。它不是 BGE-M3 的 1024——网关 `EMBEDDING` 模型原生输出 2560 维。`embedding_service.clean_vector()` 对维度不一致的向量只做**静默零填充/截断**（仅打 warning），配错不会报错但检索质量严重劣化；且 Milvus 集合按建集合时的维度固化，改维度后需重建集合并重新解析文档。
2. **实体/关系抽取 prompt 必须包含 few-shot 示例**（`app/services/graph_service.py` 的 `_EXTRACT_SYSTEM` 内含完整 JSON 输出示例）。去掉示例后网关模型会返回空 JSON，导致抽取结果为空。
3. **文档重解析是幂等的**：`parse_pipeline` 在解析前（阶段 0.5）先删除该文档旧的 chunks/entities/relations（PG 物理删 + Milvus/Neo4j 按 `doc_id` 清理），再重新写入，可安全重复触发。
4. **实体抽取做分块采样**（`MAX_EXTRACT_CHUNKS=12`，首尾均匀采样）以控制 LLM 消耗；Milvus/Neo4j 写入失败仅落 `rag_sync_events` 台账不阻断主流程（Milvus 分块写入失败除外，直接判 failed）。
5. **删除全链路逻辑删除**：PG 侧软删 `is_delete=true`，Milvus/Neo4j/MinIO 侧尽力清理（异常吞掉），三库间以 `rag_sync_events` 台账兜底可追溯。
