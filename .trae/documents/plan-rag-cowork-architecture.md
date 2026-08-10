# rag-cowork / mcp-cowork 知识库平台重构计划

> 版本: v1.0  日期: 2026-08-09  状态: 待评审
> 基于对 `demo/RAG-Anything`（ragsync + raganything）的完整分析，在与 pro-cowork 平行的位置新建 **rag-cowork**（知识库平台，含 MCP 服务）与 **mcp-cowork**（MCP 接口维护/测试/统计平台），并在 xin-site 增加三系统统一入口页。

---

## 一、demo 代码分析结论（重构依据）

### 1.1 demo/RAG-Anything 构成

| 模块 | 路径 | 功能 | 技术栈 |
|---|---|---|---|
| raganything | `demo/RAG-Anything/raganything/` | LightRAG 式多模态 RAG 库：文档解析编排（parser/batch_parser）、模态处理（modalprocessors：图片/表格/公式→VLM 描述）、实体/关系抽取（prompt + processor）、检索（query）、产物落盘 rag_storage（kv_store_*.json / vdb_*.json / graphml） | Python、OpenAI 兼容 LLM/VLM/Embedding 客户端、MinerU 解析 |
| ragsync | `demo/RAG-Anything/ragsync/`（另有 `demo/ragsync/` 含 workers/ 的更新版） | 数据回写服务：读取 rag_storage 产物 → 雪花 ID → 写 PG → 写 Milvus → 写 Neo4j → Redis Streams 事件 → worker 消费兜底，保证 PG/Milvus/Neo4j 最终一致 | FastAPI、asyncpg、pymilvus、neo4j、redis、aiohttp |
| ragsync 存储层 | `ragsync/storage/{postgres,milvus_store,neo4j_store,minio_store}.py` | 四类存储的类型安全 CRUD 封装，**可直接改造复用** | — |
| ragsync 服务层 | `ragsync/services/{document_processor,qwen_vl,embedding,rag_storage_loader,sync_service}.py` | document_processor 为总编排（MinIO 下载→解析→VLM→向量化→多库写入）；qwen_vl 做图片/表格认知；embedding 走 OpenAI 兼容接口 | — |
| ragsync 基础设施 | `ragsync/core/{config,snowflake}.py`、`ragsync/message_queue/redis_streams.py`、`ragsync/sql/init.sql` | 全 env 注入配置、雪花 ID 生成器、Redis Streams 发布/消费、6 张表 DDL（documents/chunks/multimodal_resources/entities/relations/sync_events） | — |
| ragsync API | `ragsync/main.py` + `pipeline.py` | `/api/v2/schema/init`、`/api/v2/ragsync`（同步）、`/api/v2/raganything`（MinIO 文件解析） | FastAPI |

### 1.2 关键业务逻辑（rag-cowork 继承的流水线）

```
文件(MinIO/本地上传)
  → 解析（电子 PDF 走 PyMuPDF 快速通道；扫描件走 mineru 网关；Office/图片/音频分别走对应解析）
  → 多模态认知（VLM 为图片/表格生成描述文本）
  → 文本分块 chunks
  → Embedding 向量化
  → 实体/关系抽取（MAIN LLM，LightRAG 提示词）
  → 三库联动写入：PG（元数据/全文） + Milvus（4 集合向量） + Neo4j（图谱）
  → 事件台账记录同步状态，失败可重试
```

- **Milvus 4 集合**：rag_text_chunks / rag_images / rag_entities / rag_relations，HNSW + COSINE，主键 INT64。
- **雪花 ID**：`core/snowflake.py`，worker_id 可配，替代 UUID 提升索引/插入性能。
- **向量解码容错**：base64 float32 解码 + NaN/Inf 清洗 + 维度对齐（零填充/截断），`document_processor._decode_vector` 已实现，直接复用。
- **demo 依赖清单**（`ragsync/requirements.txt`）：fastapi、uvicorn、asyncpg、minio、pymilvus>=2.4、neo4j>=5.20、redis、aiohttp、PyMuPDF、openai。

### 1.3 复用/裁剪决策

| demo 组件 | rag-cowork 处置 |
|---|---|
| storage 四件套 + snowflake + embedding + qwen_vl | **改造复用**：集合名改 `ragcowork_*` 并增加 `kb_id` 字段；配置改走 pydantic-settings |
| document_processor 编排逻辑 | **重构**为 kb 感知的 parse_pipeline（保留向量清洗/LightRAG 产物兼容逻辑） |
| Redis Streams + worker 进程 | **v1 裁剪**：改用 FastAPI 进程内 asyncio 后台任务流水线，同步状态落 `rag_sync_events` 台账表（失败可重试），不引入 worker 进程与 redis 依赖 |
| raganything 整库 | **不整体引入**：抽取其实体/关系提示词思路，用 MAIN 模型通道自行实现轻量抽取（避免引入 LightRAG 全依赖） |
| MinerU | 沿用现有 `MINERU_API_URL` 网关（容器内 `http://mineru:8000`），扫描件 PDF 深度解析 |

---

## 二、目标架构

### 2.1 项目布局（与 pro-cowork 平行）

```
xin-ai/
├── pro-cowork/          # 既有：项目管理智能体平台 (8091) — 本期仅微调
├── rag-cowork/          # 新建：知识库平台
│   ├── requirements.txt
│   ├── .env             # 宿主机开发配置（localhost 端点）
│   ├── app/
│   │   ├── main.py            # FastAPI 入口 (8092)：REST API + 静态前端
│   │   ├── mcp_server.py      # MCP 服务独立进程 (8093)：FastMCP streamable-HTTP
│   │   ├── config.py          # pydantic-settings（复用八路模型 + MinIO + Milvus/Neo4j）
│   │   ├── database.py        # SQLAlchemy async engine（同 XIN 库）
│   │   ├── deps.py            # X-User-Id / X-User-Name 头识别 + KB 权限校验
│   │   ├── models/            # sys_users + rag_* ORM（base.py 复用时间戳/软删混入）
│   │   ├── schemas/           # Pydantic 请求/响应
│   │   ├── routers/           # auth / knowledge_bases / files / parse / rag / permissions / stats
│   │   ├── services/
│   │   │   ├── minio_service.py      # 改造自 pro-cowork 同名服务
│   │   │   ├── parse_pipeline.py     # 编排：解析→认知→分块→向量化→抽取→三库写入
│   │   │   ├── parsers.py            # pdf(PyMuPDF/mineru)/office(openpyxl等)/audio(ASR)/image(VLM)
│   │   │   ├── embedding_service.py  # 复用 demo embedding + 向量清洗
│   │   │   ├── graph_service.py      # 实体/关系抽取（MAIN LLM）+ Neo4j 写入
│   │   │   ├── milvus_store.py       # 复用改造（kb_id 标量过滤）
│   │   │   ├── neo4j_store.py        # 复用改造（kb_id 属性隔离）
│   │   │   ├── rag_query.py          # hybrid 检索：Milvus 向量 + Neo4j 图谱 + LLM 生成（含引用）
│   │   │   └── snowflake.py          # 复用 demo
│   │   └── mcp_tools.py       # MCP 工具实现（供 mcp_server.py 注册）
│   └── web/                   # 静态前端（无框架，同 pro-cowork 风格）
│       ├── login.html         # 独立登录页
│       └── index.html         # KB 维护界面（树/列表/上传/解析状态/RAG 测试/权限）
├── mcp-cowork/          # 新建：MCP 接口维护/测试/统计平台
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py            # FastAPI (8094)
│   │   ├── config.py / database.py / deps.py / models/ / schemas/ / routers/
│   │   └── services/
│   │       ├── mcp_client.py       # mcp SDK streamable-HTTP 客户端：list_tools / call_tool
│   │       └── stats_service.py    # 调用统计聚合
│   └── web/                   # login.html + index.html（注册/工具清单/在线测试台/统计图表）
└── xin-site/cowork.html # 新建：三系统统一酷炫入口页（8087）
```

### 2.2 端口与部署（沿用四合一容器模式）

| 服务 | 端口 | 启动方式 |
|---|---|---|
| pro-cowork | 8091 | 既有 |
| **rag-cowork** | **8092** | `uvicorn app.main:app --reload` |
| **rag-cowork-mcp** | **8093** | `python -m app.mcp_server`（FastMCP streamable-HTTP 独立进程，避免 FastAPI 子挂载 lifespan 冲突，且重负载解析不阻塞 MCP） |
| **mcp-cowork** | **8094** | `uvicorn app.main:app --reload` |

- Dockerfile：`COPY rag-cowork/requirements.txt`、`mcp-cowork/requirements.txt` 装入共享 `/app/venv`；`EXPOSE 8092 8093 8094`。
- docker-compose.yml：ports 增加 8092/8093/8094；volumes 增加 `./rag-cowork:/app/rag-cowork`、`./mcp-cowork:/app/mcp-cowork`。
- docker-entrypoint.sh：增加 3 个 start_service（含日志文件 rag-cowork.log / rag-cowork-mcp.log / mcp-cowork.log）。
- .docker.env 追加（.docker.env.example 同步占位符）：
  ```
  MILVUS_HOST=milvus
  MILVUS_PORT=19530
  MILVUS_DB_NAME=default
  NEO4J_URI=bolt://neo4j:7687
  NEO4J_USER=neo4j
  NEO4J_PASSWORD=<按实际>
  EMBEDDING_DIM=1024
  SNOWFLAKE_WORKER_ID=1
  RAG_MINIO_BUCKET=ragkb
  ```
- 依赖变更需重建镜像：`docker compose down -v && docker compose up -d --build`（项目既有约定）。

---

## 三、数据库设计（同一 PG `XIN` 库）

**统一规则**：新表全部含 `is_delete BOOLEAN DEFAULT false`、`created_at/updated_at`；业务表含 `user_id BIGINT`（关联 sys_users）；主键 BIGINT 雪花 ID。

### 3.1 共享用户表（三系统共用）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `sys_users` | user_id PK, name UNIQUE, password_hash, department, display_name, is_active, is_delete | 三系统登录页各自渲染、同一套校验（pbkdf2 逻辑移植自 pro-cowork auth.py）。**种子数据**：从既有 `user_credentials` + `project_members.name` 去重导入 |

### 3.2 rag_* 表

| 表 | 关键字段 | 说明 |
|---|---|---|
| `rag_knowledge_bases` | kb_id PK, name, level(company/department/project/personal/external), description, owner_user_id→sys_users, project_id(可空, 关联既有 projects.id), department(可空), is_delete, user_id | 五级知识库；project 级凭 project_id 继承项目成员权限，department 级按 sys_users.department 匹配 |
| `rag_kb_permissions` | id PK, kb_id FK, user_id, perm(read/write/admin), is_delete | 显式授权（external 级仅靠此表） |
| `rag_documents` | doc_id PK, kb_id FK, file_name, file_ext, file_size, file_hash UNIQUE, minio_bucket, minio_path, parse_status(pending/parsing/done/failed), parser_type, total_chunks/images/tables, error_msg, user_id, is_delete | 对应 demo documents + kb_id + MinIO 归档路径 |
| `rag_chunks` | chunk_id PK, doc_id FK, kb_id, chunk_index, content, page_number, chunk_type, milvus_id, prev/next_chunk_id, user_id, is_delete | 对应 demo chunks + kb_id |
| `rag_multimodal_resources` | resource_id PK, doc_id FK, kb_id, resource_type(image/table/audio), minio_path, content_desc, milvus_id, user_id, is_delete | 对应 demo multimodal_resources（裁剪公式字段） |
| `rag_entities` | entity_id PK, kb_id, doc_id FK, entity_name, entity_type, description, weight, neo4j_node_id, milvus_id, user_id, is_delete | 对应 demo entities + kb_id |
| `rag_relations` | relation_id PK, kb_id, doc_id FK, src_entity_id, tgt_entity_id, relation_type, keywords, neo4j_edge_id, user_id, is_delete | 对应 demo relations + kb_id |
| `rag_sync_events` | event_id PK, action, target_type, target_id, doc_id, kb_id, payload JSONB, status, retry_count, error_msg, user_id, is_delete | 三库写入台账（替代 Redis Streams 的补偿依据） |
| `rag_parse_tasks` | task_id PK, doc_id FK, kb_id, stage(parse/chunk/embed/extract/graph/done), status, progress, error_msg, user_id, is_delete | 前端轮询解析进度 |
| `rag_query_logs` | log_id PK, user_id, kb_ids JSONB, query, mode, answer_excerpt, hit_count, latency_ms, is_delete | 检索日志，供统计 |

### 3.3 mcp_* 表

| 表 | 关键字段 | 说明 |
|---|---|---|
| `mcp_servers` | server_id PK, name, base_url, transport(streamable_http), description, status(online/offline/unknown), user_id, is_delete | MCP 服务注册表；预置 rag-cowork（容器内 `http://localhost:8093/mcp`） |
| `mcp_tools` | tool_id PK, server_id FK, tool_name, description, input_schema JSONB, synced_at, is_delete | `tools/list` 同步快照 |
| `mcp_test_cases` | case_id PK, server_id FK, tool_name, case_name, params JSONB, last_result JSONB, last_status, user_id, is_delete | 在线测试台保存的用例 |
| `mcp_call_logs` | log_id PK, server_id, tool_name, params JSONB, result_excerpt, latency_ms, status(success/error), user_id, is_delete | 全量调用日志 → 统计页聚合（次数/成功率/延迟/按工具分布） |

### 3.4 关于 pro_ 前缀的偏差说明（决策）

用户规则要求 pro-cowork 表以 `pro_` 开头，但**现有 27 张表（projects/agents/task_runs 等）均无此前缀**且含生产数据。本期**不对既有表做重命名迁移**（风险高、收益低）；新规则仅约束本期新建表（rag_/mcp_/sys_）。若后续确需统一，另立迁移专项（pg rename + 全代码引用替换）。

---

## 四、MCP 服务接口清单（rag-cowork，端口 8093）

FastMCP（`mcp` Python SDK，streamable-HTTP，端点 `/mcp`），工具实现内部直接调 rag-cowork service 层（同进程代码复用，不经 HTTP 自调）：

| 工具 | 入参 | 功能 |
|---|---|---|
| `kb_create` | name, level, description?, project_id?, department? | 创建知识库（写 rag_knowledge_bases，user_id 取调用头） |
| `kb_list` | level? | 列出当前用户可见知识库（权限过滤） |
| `kb_file_upload` | kb_id, file_name, content_base64 | 文件保存到 MinIO（`{kb_id}/{yyyymm}/{filename}`）+ 建 rag_documents(pending) |
| `kb_file_parse` | doc_id | 触发解析入库流水线（异步入 rag_parse_tasks） |
| `kb_file_add` | kb_id, file_name, content_base64 | 上传+解析一步到位（= upload + parse） |
| `kb_files` | kb_id | 知识库文件列表（含解析状态） |
| `kb_file_delete` | doc_id | 逻辑删除 + 清理 Milvus/Neo4j 关联数据 |
| `rag_search` | kb_ids[], query, top_k? | 纯检索：返回 chunks/entities（不生成答案） |
| `rag_query` | kb_ids[], query, mode(hybrid/local/global)? | RAG 问答：向量+图谱混合检索 → LLM 生成（含引用来源） |

MCP 调用的用户身份：请求头 `X-User-Name`（与 REST 一致）；mcp-cowork 测试台调用时可指定。

---

## 五、权限模型

`deps.py` 实现 `resolve_visible_kb_ids(db, user)`：

| level | 可见/可写判定 |
|---|---|
| company | 全部登录用户可读；admin 授权可写 |
| department | sys_users.department 匹配者可读写 |
| project | 既有 `project_members` 含该用户姓名者可读写（同库直读 projects/project_members，不跨服务 HTTP） |
| personal | 仅 owner + rag_kb_permissions 显式授权 |
| external | 仅 rag_kb_permissions 显式授权 |

所有 REST/MCP 查询先求 visible_kb_ids，再作为 Milvus 标量过滤（`kb_id in [...]`）与 Neo4j WHERE 条件，保证越权数据不出库。

---

## 六、前端页面

1. **xin-site/cowork.html（统一入口）**：深色科技风单页，三张发光卡片（pro-cowork :8091 / rag-cowork :8092 / mcp-cowork :8094），悬停动效 + 点击进入；注册进 vite.config.js rollupOptions.input（保持 MPA 构建一致）。
2. **rag-cowork/web/login.html + index.html**：左侧五级 KB 树（创建/编辑/授权弹窗）、中部文件列表（拖拽上传：语音/图片/PDF/Office；解析进度轮询 rag_parse_tasks）、右侧 RAG 测试面板（提问→答案+引用）。零弹窗确认（项目硬约束：删除走行内二次确认按钮）。
3. **mcp-cowork/web/login.html + index.html**：服务注册卡片（健康检查按钮）、工具清单（同步 tools/list）、在线测试台（选工具→JSON 参数→调用→结果/延迟展示→存为用例）、统计页（调用量/成功率/平均延迟/工具分布，基于 mcp_call_logs，纯 CSS 柱状图）。

前端技术：无框架静态 HTML+原生 JS+fetch，与 pro-cowork/web 一致；静态文件禁缓存（NoCacheStaticFiles 模式复制）。

---

## 七、pro-cowork 微调（最小侵入）

- `web/index.html` 登录区无改动；仅在入口页层面互联（pro-cowork 自身不动）。
- pro-cowork 认证暂维持姓名制；`sys_users` 建立后，pro-cowork 的 `user_credentials` 保持不变（其登录逻辑不动），三系统共享体系仅约束 rag/mcp 两新系统（姓名唯一锚点一致，后续可平滑切换）。

---

## 八、实施步骤（执行顺序）

1. **基础设施**：Dockerfile（2 个 requirements + EXPOSE）、docker-compose（端口+卷）、docker-entrypoint.sh（3 个服务）、.docker.env/.docker.env.example（Milvus/Neo4j/EMBEDDING_DIM 等）。
2. **rag-cowork 骨架**：config/database/base/models（sys_users + 10 张 rag_ 表）+ `/api/schema/init` 幂等建表 + sys_users 种子（从 user_credentials/project_members 导入）。
3. **存储与服务层**：移植改造 snowflake/milvus_store/neo4j_store/minio_service/embedding_service（kb_id 过滤）；parsers（PyMuPDF/mineru/office/ASR/VLM）；graph_service 抽取；parse_pipeline 编排 + rag_sync_events 台账。
4. **REST API**：auth（sys_users 校验）、knowledge_bases CRUD+权限、files 上传/列表/删除（MinIO 归档 `{kb_id}/{yyyymm}/`）、parse 触发/进度、rag search/query、stats。
5. **rag-cowork 前端**：login.html + index.html。
6. **MCP 服务**：mcp_tools.py（9 个工具）+ mcp_server.py（8093）。
7. **mcp-cowork 全套**：models（4 表）+ mcp_client + routers（servers/tools/test/stats）+ 前端 + 预置 rag-cowork 服务注册。
8. **统一入口页**：xin-site/cowork.html + vite.config.js input 注册。
9. **重建验证**：`docker compose down -v && up -d --build`，按第九节日测。

---

## 九、验证方案

1. 容器健康：5 端口（8087/8091/8092/8093/8094）均可访问，日志无异常。
2. rag-cowork：登录（种子用户）→ 建 company/project/personal 三级 KB → project KB 关联既有项目 → 上传电子 PDF（PyMuPDF 通道）与扫描 PDF（mineru 通道）各一 → 解析进度到 done → PG 有 chunks/entities、Milvus 集合有向量、Neo4j 有节点关系 → RAG 提问返回答案+引用。
3. 权限：A 用户 personal KB 对 B 用户不可见（REST 与 rag_query 均过滤）。
4. MCP：mcp-cowork 注册 rag-cowork 服务 → 同步 9 个工具 → 测试台依次调 kb_file_add / rag_query 成功 → 统计页出现调用记录与延迟数据。
5. 入口页：:8087/cowork.html 三卡片跳转正确。
6. 回归：pro-cowork 既有功能（登录/项目/任务）不受影响。

---

## 十、假设与决策汇总

| # | 决策 | 理由 |
|---|---|---|
| 1 | RAG 采用完整 RAG-Anything 流水线（实体/关系入 Neo4j） | 用户已确认 |
| 2 | 三系统共享 `sys_users` 统一用户表（userid 雪花 ID + 姓名唯一） | 用户已确认 |
| 3 | mcp-cowork 本期一并实现 | 用户已确认 |
| 4 | MCP 服务独立进程 8093，不挂载进 FastAPI 主应用 | 避免子应用 lifespan 冲突；重负载隔离；进程级独立重启 |
| 5 | v1 不引入 Redis Streams/worker，进程内 asyncio 流水线 + rag_sync_events 台账补偿 | 减少移动部件；满足单容器部署；失败可通过台账重试 |
| 6 | 既有 pro-cowork 27 表不改名，前缀规则仅约束新表 | 避免生产数据迁移风险（见 3.4） |
| 7 | Milvus 新建 `ragcowork_*` 4 集合（含 kb_id 字段），不复用 demo 集合 | 避免与 demo 实验数据/schema 冲突 |
| 8 | 统一入口页放 xin-site（8087/cowork.html） | 零新增服务/端口；xin-site 本就是项目门户 |
| 9 | project 级权限同库直读 projects/project_members | 同一 PG 库，无需跨服务 HTTP，逻辑最简 |
| 10 | EMBEDDING_DIM 默认 1024 可配，建集合前须与 model-api EMBEDDING 通道实际维度对齐 | demo 已有维度不对齐的教训（_decode_vector 零填充逻辑保留兜底） |
