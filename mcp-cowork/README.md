# XIN · mcp-cowork MCP 接口平台（玄圃 · 智链）

> 基于 FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL 的 MCP 接口维护/测试/统计平台。提供 MCP 服务注册、工具同步（经 MCP 协议 `tools/list` 拉取工具清单入库）、在线测试台（调用 MCP 工具并记录调用日志）与调用统计看板。
>
> - **MCP 协议客户端**：`app/services/mcp_client.py` 基于官方 `mcp` SDK 的 streamable-HTTP 客户端，封装 `list_tools` / `call_tool`，并透传 `X-User-Name` 用户身份头（与 rag-cowork 约定一致）。
> - **预置服务**：启动时按全用户幂等注册 rag-cowork 知识库 MCP 服务（`http://localhost:8093/mcp`）。
> - 与 pro-cowork / rag-cowork **共用 XIN 数据库**，`sys_users` 共享用户表（启动时从 `sys_user_credentials` / `pro_project_members` 幂等导入，pro-cowork 已设密码的用户同密登录）。
> - 本服务运行在 **8094** 端口（rag-cowork Web 为 8092、rag-cowork MCP 为 8093）。

---

## 一、项目概述

本工程是「XIN · mcp-cowork MCP 接口平台」的后端服务，运行在 **8094** 端口，对外提供 `/api/*` RESTful 接口，并在根路径挂载 `web/` 前端静态页（玄圃 · 智链：左服务注册 / 中工具 + 测试台 / 右统计）。其业务价值在于：

- 将分散的 MCP 服务统一登记造册，健康检查与工具清单一键同步；
- 在线测试台免写代码即可调参调用 MCP 工具，常用参数可保存为用例反复回放；
- 全量调用日志落库，按服务/工具维度聚合成功率与延迟，支撑看板统计。

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
| MCP 客户端 | mcp（官方 SDK, streamable-HTTP） | `mcp>=1.8.0,<2.0.0` |
| 前端 | 原生 HTML/CSS/JS | 无构建工具 |

---

## 三、代码结构

```text
mcp-cowork/
├── requirements.txt            # Python 依赖清单
├── .env                        # 环境变量配置 (含密码, 勿提交)
├── README.md                   # 本文件
├── app/                        # FastAPI 后端应用
│   ├── __init__.py
│   ├── main.py                 # FastAPI 入口 (8094): lifespan/路由注册/静态挂载 + 预置 MCP 服务种子
│   ├── config.py               # pydantic-settings 读取 .env (PG/雪花节点/MCP 超时)
│   ├── database.py             # 异步引擎/会话工厂/Base/get_db/init_db (+ sys_users 种子)
│   ├── deps.py                 # X-User-Name 用户识别 (与 rag-cowork 同一 sys_users 体系)
│   ├── models.py               # ★单文件 ORM: sys_users 共享映射 + mcp_ 前缀 4 表
│   ├── routers/                # API 路由 (统一前缀 /api)
│   │   ├── auth.py             # 姓名登录/会话恢复/设置密码
│   │   ├── servers.py          # MCP 服务注册/健康检查/工具同步/工具清单
│   │   ├── testing.py          # 在线测试台: 工具调用 + 用例保存/回放/删除
│   │   └── stats.py            # 调用统计: 总览/按工具分布/调用日志
│   └── services/
│       ├── mcp_client.py       # MCP streamable-HTTP 客户端 (list_tools/call_tool, X-User-Name 透传)
│       └── snowflake.py        # 雪花 ID 生成器 (SNOWFLAKE_WORKER_ID=2, 与 rag-cowork 区分)
└── web/                        # 前端静态资源 (由 FastAPI StaticFiles 挂载到 /)
    ├── index.html              # 玄圃 · 智链 单页 (服务注册/工具+测试台/统计 + 注册编辑弹窗)
    └── login.html              # 登录页 (姓名 + 可选密码)
```

---

## 四、核心业务模块

| 模块 | 路由文件 | 模型 | 职责 |
|------|----------|------|------|
| 身份确认 | `app/routers/auth.py` | `SysUser` | 姓名登录（未设密码直登；已设密码走 pbkdf2 加盐校验，与 pro-cowork 同规则） |
| 服务管理 | `app/routers/servers.py` | `McpServer` / `McpTool` | MCP 服务 CRUD（仅注册人可操作）；`health` 健康检查（尝试 list_tools 置 online/offline）；`sync` 经 MCP 协议拉取 `tools/list` 全量重建 `mcp_tools` 快照（旧快照逻辑删除） |
| 在线测试台 | `app/routers/testing.py` | `McpTestCase` / `McpCallLog` | `call` 在线调用工具（自动写调用日志：参数/结果摘要/延迟/状态）；用例保存、回放（结果回写用例）、删除 |
| 调用统计 | `app/routers/stats.py` | `McpCallLog` | 总览（服务数/调用量/成功率/平均延迟）、按工具 Top20 分布、最近 100 条调用日志 |

**调用身份链路**：前端登录后将中文姓名经 `encodeURIComponent` 放入 `X-User-Name` 请求头 → mcp-cowork 识别当前用户 → 调用 MCP 服务时 `mcp_client` 再以同名请求头透传给下游（rag-cowork MCP 据此做知识库五级权限过滤）。

**预置服务种子**：`app/main.py` 的 `PRESET_SERVERS` 定义 rag-cowork（`http://localhost:8093/mcp`），lifespan 启动时对每个活跃用户按 `base_url` 幂等补注册。

---

## 五、数据模型

### 5.1 表清单（`app/models.py` 单文件，5 张）

| 模型类 | 表名 | 关键字段 |
|--------|------|----------|
| `SysUser` | `sys_users` | `user_id`(雪花 PK), `name`(unique), `password_hash`, `display_name`, `department`, `is_active`（共享表映射，与 rag-cowork 同表） |
| `McpServer` | `mcp_servers` | `server_id`(PK), `name`, `base_url`, `transport`(默认 streamable_http), `description`, `status`(unknown/online/offline), `user_id`(注册人) |
| `McpTool` | `mcp_tools` | `tool_id`(PK), `server_id`, `tool_name`, `description`, `input_schema`(JSONB), `synced_at`, `user_id` |
| `McpTestCase` | `mcp_test_cases` | `case_id`(PK), `server_id`, `tool_name`, `case_name`, `params`(JSONB), `last_result`(JSONB), `last_status`, `user_id` |
| `McpCallLog` | `mcp_call_logs` | `log_id`(PK), `server_id`, `tool_name`, `params`(JSONB), `result_excerpt`(≤1000 字), `latency_ms`, `status`(success/error), `user_id` |

> 全部表混入 `TimestampMixin`（created_at/updated_at）与 `SoftDeleteMixin`（is_delete）；主键为雪花 ID（纪元 2025-01-01，`SNOWFLAKE_WORKER_ID=2` 与 rag-cowork 的 1 区分，避免同库主键冲突）。
> 建表由 `init_db()` 的 `create_all` 幂等完成；`sys_users` 种子逻辑与 rag-cowork 一致（合并 `sys_user_credentials` 密码与 `pro_project_members` 姓名）。
> 注意：`get_db()` 仅提供会话，**写操作由路由显式 `await db.commit()`**。

### 5.2 表间关系

```text
SysUser 1──N McpServer 1──N McpTool      (工具快照, sync 时全量重建)
                     └──N McpTestCase    (测试用例, 可回放)
                     └──N McpCallLog     (全量调用日志, 统计聚合依据)
```

---

## 六、API 接口清单

所有接口统一前缀 `/api`（`app/main.py` 注册）；除 `/api/health` 与 `/api/auth/*` 外均需登录（`X-User-Name` 请求头）。

### 6.1 身份确认（`/api/auth`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 姓名登录；已设密码未带时返回 `need_password=true`，密码错误返回 401 |
| GET | `/api/auth/me` | 按 `X-User-Name` 恢复会话 |
| POST | `/api/auth/password` | 设置/修改本人密码（`new_password` 为空串则清除密码） |

### 6.2 MCP 服务（`/api/servers`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/servers` | 本人注册的服务列表（含工具计数） |
| POST | `/api/servers` | 注册服务（body: `{name, base_url, description}`） |
| PUT | `/api/servers/{server_id}` | 更新服务（仅注册人） |
| DELETE | `/api/servers/{server_id}` | 逻辑删除服务（仅注册人） |
| POST | `/api/servers/{server_id}/health` | 健康检查：尝试 `list_tools`，成功置 online 并返回工具数，失败置 offline |
| POST | `/api/servers/{server_id}/sync` | 同步工具清单：拉取 `tools/list` 全量重建 `mcp_tools` 快照；失败返回 502 并置 offline |
| GET | `/api/servers/{server_id}/tools` | 已同步的工具清单（含 `input_schema`） |

### 6.3 在线测试（`/api/testing`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/testing/call` | 在线调用工具（body: `{server_id, tool_name, params}`），返回 `{is_error, text, data, status, latency_ms}` 并写 `mcp_call_logs` |
| GET | `/api/testing/cases?server_id=N` | 本人保存的用例列表 |
| POST | `/api/testing/cases` | 保存用例（body: `{server_id, tool_name, case_name, params}`） |
| POST | `/api/testing/cases/{case_id}/run` | 回放用例（结果回写用例 `last_status`/`last_result`） |
| DELETE | `/api/testing/cases/{case_id}` | 删除用例（逻辑删除） |

### 6.4 统计（`/api/stats`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/overview` | 总览：服务数/调用量/成功率/平均延迟 |
| GET | `/api/stats/by-tool` | 按工具分布 Top20：调用次数/成功率/平均延迟 |
| GET | `/api/stats/logs` | 最近 100 条调用日志（关联服务名） |

### 6.5 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务存活探针 |

---

## 七、环境变量

配置由 `app/config.py` 通过 pydantic-settings 从 `mcp-cowork/.env` 读取（容器内由 `.docker.env` 环境变量覆盖）。**下方仅列变量名与含义，不包含任何真实密码值**。

| 变量名 | 含义 |
|--------|------|
| `POSTGRES_HOST` / `POSTGRES_PORT` | PG 地址（`.env` 默认 `localhost:11000`，容器内为 `pg_db:5432`） |
| `POSTGRES_DB` | 数据库名（`XIN`，与 pro-cowork 共库） |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | 数据库账号（`.env` 填真实值，README 以 `<密码>` 占位） |
| `DEBUG` / `LOG_LEVEL` | 调试模式（控制 SQLAlchemy echo）/ 日志级别 |
| `SNOWFLAKE_WORKER_ID` | 雪花 ID 工作节点（默认 `2`，与 rag-cowork 的 1 区分） |
| `MCP_CONNECT_TIMEOUT_S` | MCP 连接超时秒数（默认 10） |
| `MCP_READ_TIMEOUT_S` | MCP 读取超时秒数（默认 300，rag 解析类工具耗时长，给足余量） |

---

## 八、启动方式

### 8.1 Docker 容器部署（推荐，开发模式）

由仓库根目录 `docker-compose.yml` 统一编排（单一 `xin-ai` 容器，源码挂载，改代码无需 rebuild）：

```bash
cd /mnt/data0/ai_deployment/proj/src/xin-ai

docker compose up -d        # 一键启动
docker compose logs -f      # 查看日志
docker compose down         # 停止
```

容器内由 `docker-entrypoint.sh` 以 `uvicorn --reload` 模式拉起：

```text
python -m uvicorn app.main:app --host 0.0.0.0 --port 8094 --reload --reload-dir app
```

启动成功后：

- 前端（玄圃 · 智链）：`http://localhost:8094/`
- API 文档（Swagger）：`http://localhost:8094/docs`

### 8.2 本地调试

```bash
cd /mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork

python -m uvicorn app.main:app --port 8094 --reload
```

> 依赖安装：`pip install -r requirements.txt`。
