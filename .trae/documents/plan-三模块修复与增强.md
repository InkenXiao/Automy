# 三模块修复与增强计划 (rag-cowork / mcp-cowork / pro-cowork)

## 一、需求与根因分析

### A. rag-cowork

| # | 现象 | 根因 (已定位) |
|---|------|--------------|
| A1 | 上传失败: 知识库不存在 | **JS 大整数精度丢失**: `kb_id` 为雪花 ID (18-19 位, > 2^53)，前端 `JSON.parse` 后精度被截断 ([web/index.html](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/web/index.html) `api()` L265)，用错误的 kb_id 调 `/files/upload` → [deps.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/deps.py#L89-L91) `db.get` 未命中 → 404 "知识库不存在" |
| A2 | 检索测试: 无可见知识库或知识库越权 | 同上：请求体 `kb_ids` 精度丢失后被 `_filter_kb_ids` 全部过滤 ([rag.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/routers/rag.py#L29-L43)) |
| A3 | 授权弹窗没有可选知识库 | A1+A4 叠加：可见知识库列表为空或 kb_id 错乱；另 `openPermModal` 中 `Number(perm-user.value)` 对雪花 `user_id` 同样精度丢失 |
| A4 | 新建部门/外接知识库不可见 | [deps.py visible_kb_ids](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/deps.py#L67-L80) 无 owner 兜底规则：department 级要求 `user.department == kb.department`（sys_users.department 为空则创建者也不可见）；external 级仅显式授权可见，但创建时从未写授权 |
| A5 | rag_kb_permissions 无数据 | [knowledge_bases.py create_kb](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/routers/knowledge_bases.py#L112-L120) 创建知识库时未写入创建者 admin 授权 |
| A6 | sys_files 需回写知识库构建状态 | sys_files 无 `kb_indexed` 字段；[parse_pipeline.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/services/parse_pipeline.py) 终态不回写 |
| A7 | excel 解析测试 | [parsers.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/services/parsers.py#L133-L150) 已支持 xlsx (openpyxl 已在 requirements)；**但不支持 .html**（demo/files/test6.html 会报"暂不支持的文件类型"） |

### B. mcp-cowork

| # | 现象 | 根因 |
|---|------|------|
| B1 | 健康检查: 离线: unhandled errors in a TaskGroup | anyio TaskGroup 抛出 `ExceptionGroup`，[servers.py health](file:///mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork/app/routers/servers.py#L99-L107) `str(e)` 只显示外层文案，真实子异常 (如连接拒绝/406/超时) 被掩盖 |
| B2 | 同步工具同上 | [servers.py sync](file:///mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork/app/routers/servers.py#L110-L120) 同样问题 |
| B3 | 列表需支持测试 + 查看详细调用记录 | 服务卡片仅 健康检查/同步/编辑/删除；测试台需先点卡片再选工具，无直达；调用记录仅右栏"最近调用"([stats.py /logs](file:///mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork/app/routers/stats.py#L65) 无 server_id 过滤、无 params 详情) |

mcp-cowork 同样存在雪花 ID 精度问题（server_id/log_id/case_id，epoch 2025 → ~18 位）：前端 `Number(card.dataset.id)` (web/index.html L262) 会再次截断，需一并修复。

### C. pro-cowork

| # | 现象 | 根因 |
|---|------|------|
| C1 | 对话页发送需先小模型意图识别 + 技能解析 + 语音实时转写 | [agents.py chat](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/agents.py#L174-L284) 无意图识别、无附件预处理，仅靠提示词指引主模型自行调 run_skill；`emit_run_event` 的 emitter 只在 TaskRunner 注册，聊天页 ASR 分段事件被丢弃 |
| C2 | 长任务会议纪要无实时转写输出 | 链路已存在 (skill_engine→emit_run_event→task_runner→SSE→cowork.js L577-600)，但是否触发依赖主模型"自愿"调 run_skill；改为**确定性附件预处理**可根治 (执行期 E2E 复核链路) |
| C3 | excel 文件解析报错 | [file_prompt.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/file_prompt.py) 将 xlsx 归为 text → 二进制按 utf-8 内联成乱码；若走"文档解析"技能，[doc_parse_service.parse_pdf](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/doc_parse_service.py) 对 xlsx 抛 "PDF 打开失败" |
| C4 | 个人周报列宽 + 项目名称默认值 | [personal-report.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/personal-report.js) `addWorkRow` 无默认项目逻辑；表格无 `table-layout: fixed`，列 min-width 累加超宽出横向滚动条 |
| C5 | 非项目经理保存周报 500 | create 用 [resolve_project_id](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/personal_reports.py#L173)（激活项目）而列表用 `resolve_visible_project_id`（用户归属项目）：非 PM 归属项目≠激活项目时上下文错配；500 精确堆栈执行期查容器日志确认后修复 |
| C6 | 操作记录详情为空 | [middleware.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/middleware.py) 调 `record_operation` 未传 `detail`（log_service 已支持 detail 参数，OperationLog.detail 字段已存在） |
| C7 | 缺少首页看板 | 无 dashboard 路由/视图；默认视图 `tasks` ([app.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/app.js) L13) |

## 二、变更清单

### 1. rag-cowork

**1.1 大整数精度修复（A1/A2/A3 根因）**
- 新增 `app/utils/json_response.py`：`BigIntSafeJSONResponse(JSONResponse)`，render 前递归将 `abs(v) > 2**53-1` 的 int 转 str（bool 需先判）。 
- [app/main.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/main.py) L29: `FastAPI(..., default_response_class=BigIntSafeJSONResponse)`。
- 前端 [web/index.html](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/web/index.html)：移除授权处 `Number(...)`（L555 `const uid = Number(...)` → 直接取字符串；kb_id/doc_id 全程以字符串使用，URL 拼接与 JSON body 均兼容，后端 pydantic 自动 str→int 强转）。

**1.2 可见性兜底（A4）**
- [app/deps.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/deps.py) `visible_kb_ids` 循环首条加：`if kb.owner_user_id == user.user_id: ids.append(...); continue`（owner 对任意级别可见）。

**1.3 创建即授权（A5/A3）**
- [app/routers/knowledge_bases.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/routers/knowledge_bases.py) `create_kb`：`db.add(kb)` 后追加 `RagKbPermission(id=generate_id(), kb_id=kb.kb_id, user_id=user.user_id, perm="admin")`（先查重防重复）。
- 存量数据修复 SQL（执行期对 XIN 库执行一次）：为所有现存知识库补 owner 的 admin 授权行（INSERT ... SELECT ... WHERE NOT EXISTS）。

**1.4 sys_files.kb_indexed（A6）**
- [pro-cowork/app/models/sys_file.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/models/sys_file.py)：新增 `kb_indexed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", comment="是否已构建到知识库 (rag 解析入库成功后回写)")`。（已核实：sys_files 仅 pro-cowork 有 ORM 模型；rag-cowork 无 sys_file.py，minio_service 用裸 SQL 登记）
- [pro-cowork/app/database.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/database.py) init_db 增加 `_ensure_sys_file_kb_indexed_column(conn)`（参照现有 `_ensure_*` 模式）：`ALTER TABLE sys_files ADD COLUMN IF NOT EXISTS kb_indexed BOOLEAN DEFAULT FALSE NOT NULL`。（已核实：_ensure 模式在 pro-cowork/database.py L55-65；rag-cowork/database.py 无该模式，不要加在那里）
- [parse_pipeline.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/services/parse_pipeline.py) `_pipeline` 终态 done 后：`UPDATE sys_files SET kb_indexed=true, updated_at=now() WHERE bucket=:bk AND object_key=:key`（bk=settings.RAG_MINIO_BUCKET, key=doc.minio_path；裸 SQL，异常仅告警）；失败分支 `_set_doc_status(..., "failed")` 处置 false（重解析幂等）。
- 重新生成并应用 `scripts/db_comments.sql`（容器内跑现有生成脚本）。

**1.5 html 解析支持（A7/四）**
- [parsers.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/rag-cowork/app/services/parsers.py) `TEXT_EXTS` 增加 `"html", "htm"`（直接按文本读取入库即可，保持简单）。

### 2. mcp-cowork

**2.1 ExceptionGroup 解包（B1/B2）**
- [app/services/mcp_client.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork/app/services/mcp_client.py) 新增 `flatten_exc(e: BaseException) -> str`：递归展开 `BaseExceptionGroup.exceptions`，拼接叶节点 `类型: 信息`（去重，截断 300 字）。
- [servers.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork/app/routers/servers.py) health/sync、`testing.py _do_call` 的 `except` 分支统一改用 `flatten_exc(e)` 生成错误文案。

**2.2 测试直达 + 调用记录（B3）**
- [app/routers/stats.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork/app/routers/stats.py) `/logs`（已核实 L65-L84：无 server_id 过滤、无 params 字段）：增加可选 `server_id` 过滤与 `limit`（默认 100），返回字段补 `params`、`result_excerpt`、`user_name`、`server_name`。
- [web/index.html](file:///mnt/data0/ai_deployment/proj/src/xin-ai/mcp-cowork/web/index.html)：
  - 服务卡片新增「测试」按钮（= 选中该服务并展开测试台，复用 `selectServer`）与「调用记录」按钮（打开新弹窗）。
  - 新增调用记录弹窗：表格列 时间/工具/参数/结果摘录/状态/耗时，数据取 `/stats/logs?server_id=<id>`。
  - 修复精度：`Number(card.dataset.id)` 等改为字符串比较（配合 2.3）。

**2.3 大整数精度修复**
- mcp-cowork `app/main.py` 同 1.1 挂 `BigIntSafeJSONResponse`（复制同一份工具模块）。

### 3. pro-cowork

**3.1 附件确定性预处理共享服务（C1/C2/C3 核心）**
- [app/services/file_prompt.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/file_prompt.py) 扩展：
  - `file_kind` 增加 `excel`(.xlsx/.xlsm/.csv)、`word`(.docx)、`ppt`(.pptx) 类别（html/txt/md 仍 text）。
  - 新增 `async parse_attachments(project_id, file_names, emit=None) -> list[dict]`：
    - audio → `asr_service.transcribe_audio(path, on_segment=lambda seg: emit("asr_segment", seg))`，前后 emit `asr_start`/`asr_done`；产出带时间戳转写全文。
    - image → `vision_service.recognize_image`，emit `vision_start`/`vision_done`。
    - pdf → `doc_parse_service.parse_pdf`，emit `doc_parse_start`/`doc_parse_done`。
    - excel → 新增 `_parse_excel`（openpyxl 逐 sheet 抽 " | " 连接文本，移植 rag-cowork `_parse_xlsx` 精简版）。
    - word/ppt → zip+XML 抽取（移植 rag-cowork `_parse_docx`/`_parse_pptx`）。
    - text/html → 直接读文本（截断 MAX_FILE_CONTENT_CHARS）。
    - 单文件失败不阻断：产出 `{"file", "kind", "text", "error"}`；emit 为 None 时静默（非流式场景）。
  - 新增 `build_parsed_prompt(parts) -> str`：把解析结果包装为 `【附件 xxx 解析内容】...` 段。

**3.2 对话页接入（C1）**
- [app/routers/agents.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/agents.py) `chat` 的 `event_stream` 内、`engine.chat` 前：
  1. yield `intent` 事件（start）→ 调 `intent_service.recognize_intent(db, message, file_names, active_pid)`（小模型）→ yield `intent`（done，含 reason/命中技能名）；识别失败静默继续。
  2. 有附件时：`parse_attachments(active_pid, file_names, emit=异步回调直接 yield SSE)`，事件类型 `asr_start/asr_segment/asr_done/vision_start/vision_done/doc_parse_start/doc_parse_done`；解析文本经 `build_parsed_prompt` 并入 `full_message`（替代原技能指引，指引仅作解析失败兜底）。
  3. 之后走原 `engine.chat` 主流模型输出。
- [web/js/cowork.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/cowork.js) `AgentChat.send`（L1831-1859）：新增事件渲染——`intent`（意图轨迹块）、`asr_start/asr_segment/asr_done`（实时转写块，参照工作台 L577-599 的聚合方式用 `appendTrace`/独立块）、`doc_parse_*`/`vision_*`（解析进度块）。

**3.3 长任务接入（C2）**
- [app/services/task_runner.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/task_runner.py) `_execute`：`register_run_emitter` 之后、`engine.chat` 之前，若 `run.file_names` 非空则调 `parse_attachments(run.project_id, run.file_names, emit=向任务事件流直发)`，解析结果附加到送入引擎的 `message` 尾部（落库的用户消息保持不变）。ASR 分段由此**确定性**实时进入事件流，不再依赖模型调 run_skill。

**3.4 个人周报（C4/C5）**
- [web/js/personal-report.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/personal-report.js)：
  - `loadPage` 存 `this.activeProjectId`；`addWorkRow(item)` 默认项目 = item.project_id || 上一工作行已选项目 || this.activeProjectId || 成员唯一归属项目；`addPlanRow` 同理（默认 = 上一计划行 || 激活项目）。
  - 列宽：本周工作表改为 `table-layout:fixed; width:100%`，列宽按 项目名称/周几/工作内容/参与人员/交付物/工时 分配百分比（工作内容自适应剩余），`td` 内控件 `width:100%`，`.pr-table-wrap` 去横向滚动；下周计划表同样 fixed 布局（项目名称固定宽、计划内容自适应）。样式落在 [web/css/cowork.css](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/css/cowork.css)（`.pr-table` 系列），表头 th 的内联 min-width 同步移除。
- [app/routers/personal_reports.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/personal_reports.py) `create_personal_report`：`data["project_id"]` 改为 `resolve_visible_project_id(db, name, data.get("project_id"))`；为 None 时 400 "无所属项目, 不能填写周报"。执行期先用非 PM 账号复现并抓取 500 堆栈（容器日志），按堆栈修剩余根因。
- 已核实排除项：get_db 成功自动 commit（[database.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/database.py#L34-L44)）；子表 project_id 可空、week_start/week_end 为 Date（[models/personal_report.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/models/personal_report.py)），均非 500 根因。

**3.5 操作日志详情（C6）**
- [app/middleware.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/middleware.py)：对 JSON 写请求读取 body（`await request.body()` 后以新 receive 重建 request，保证下游可读），剔除 `password` 等敏感键（值替换 `***`），紧凑序列化截断 1000 字符作为 `detail` 传入 `record_operation`；multipart/流式请求跳过。

**3.6 首页看板（C7）**
- 已核实数据源字段：`pro_weekly_work_tasks`(owner/week_start/status 待开始·进行中·已完成)、`task_runs`(file_names JSONB/status/result_text/updated_at)、`pro_progress_tasks`(owner/end_date/status)、`agents`(is_active)；[web/index.html](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/index.html) 导航与视图容器齐全、当前无 dashboard（L21-L101）。
- 新增 [app/routers/dashboard.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/dashboard.py)：`GET /api/dashboard`（X-User-Name 识别本人），返回：
  - `todos`：本人待办 — `pro_weekly_work_tasks` owner=我 且 status∈(待开始,进行中)，按 week_start 倒序限 10（含项目名）。
  - `recent_runs`：最新长任务 — `task_runs` 按 updated_at 倒序限 5（title/status/result_text 摘要 300 字/时间）。
  - `week_tasks`：当前激活项目本周任务（week_start=本周一）限 10。
  - `delayed`：延误进度 — `pro_progress_tasks` end_date<今天 且 status∉(done,deleted)（含项目名、责任人、逾期天数）限 10。
  - `agents`：常用数字分身 — active agents 简表（id/name/icon/description）。
- [web/index.html](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/index.html)：导航首位加 `<a class="nav-item" data-view="dashboard">` + `<div id="view-dashboard" class="view">`；引入 `js/dashboard.js`。
- 新增 [web/js/dashboard.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/dashboard.js)：渲染上述 5 个 widget 卡片（代办任务默认首位、最新长任务结果次位）；「自定义」按钮弹出勾选面板控制各 widget 显隐，配置存 `localStorage['dashboard_widgets']`（免新表）。
- [web/js/app.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/app.js)：`currentView` 默认 `'dashboard'`；[web/js/api.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/api.js) 加 `getDashboard()`。

### 4. 数据库/脚本
- sys_files 加列（见 1.4）；重生成 `scripts/db_comments.sql` 并在 pg_db 应用。
- 存量 rag 知识库 owner admin 授权回填 SQL（见 1.3）。

## 三、测试验证（四：全部使用 demo/files 6 个文件）

执行环境：代码 volume 挂载 + uvicorn --reload，改完 `docker compose up -d` 即可；前端静态页刷新生效。

1. **rag-cowork E2E**：登录 → 新建部门级+外接知识库（创建者立即可见）→ 授权弹窗可选用户/授权成功 → 依次上传 test1.pdf / test2.xlsx / test3.docx / test4.m4a / test5.pptx / test6.html → 解析全部成功（excel 无报错、html 可入库）→ sys_files 对应行 `kb_indexed=true` → 检索测试与 RAG 问答正常（不再报越权）。
2. **mcp-cowork E2E**：健康检查/同步工具在 rag-cowork MCP 端点 (8093) 上成功；对错误地址验证显示真实子异常文案；服务卡片「测试」直达测试台调用工具；「调用记录」弹窗显示该服务参数/结果摘录。
3. **pro-cowork E2E**：
   - 数字分身对话：携带 test4.m4a 发送 → 先出意图识别块 → 实时逐段出转写文字 → 主模型基于转写输出；携带 test2.xlsx 不报错且内容被正确解析；test1.pdf/test3.docx/test5.pptx/test6.html 同样验证。
   - 新建长任务：test4.m4a 生成会议纪要 → 执行窗口实时出转写分段 + 纪要流式增量。
   - 个人周报：非项目经理选本周填写保存成功（先复现原 500 并附修复证据）；表格无横向滚动条；新增行项目名称默认激活项目/上行项目。
   - 使用日志：填写周报后操作记录详情含具体提交内容（密码类字段脱敏）。
   - 首页：登录默认进 dashboard，显示本人待办与最新长任务结果；自定义面板可开关 widget 且刷新后保持。
4. 回归：8087/8088/8090/8091/8092/8094 全部 200；容器日志无新增异常。

## 四、假设与决策

1. 大整数修复采用**后端响应字符串化**（自定义 JSONResponse）而非前端引入 json-bigint：无构建链、一次性覆盖全部端点；前端仅需移除 `Number()` 强转。
2. 附件解析改为**发送前确定性预处理**（替代"提示词指引模型调技能"）：这是 C1/C2 的根治方案；技能指引保留为解析失败时的兜底。
3. 意图识别复用现有 `intent_service.recognize_intent`（小模型通道 llm.small_client）；对话页无附件时也调用（满足"先意图识别"要求），失败静默不阻断主流程。
4. dashboard 自定义配置存 localStorage（按浏览器/用户区分），不新增数据表。
5. 个人周报 500 的精确堆栈在执行期先复现取证再修；已确认的设计错配（激活项目 vs 可见项目）先行修复。
6. html 文件按纯文本读取入库（不引入 bs4 等新依赖）。
7. 不改动 docker-compose / Dockerfile / .docker.env（无新依赖：openpyxl 已在两个 requirements）。
