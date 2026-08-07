# 项目驾驶舱增强：按天个人周报、权限体系、登录与使用日志看板、Excel 导出

## Summary

在 pro-cowork（FastAPI + 原生 JS，容器内 8091 端口运行）上实现 9 项需求：
1. 个人周报工作项改为「每行一天」：项目名称 | 周几(选择) | 工作内容 | 参与人员 | 交付物 | 工时
2. 项目周报列表点击/切换时自动在右栏加载显示周报概括；拉长概括编辑框
3. 个人周报工作内容输入框输入 `/` 可选择当前项目当前周的每周工作任务
4. 项目成员状态改为 全职/临时/退出（在职→全职、已退出→退出迁移），退出成员不能填该项目周报
5. 维护权限：非项目经理只读「里程碑+项目周报」；非全职(临时/退出)只读「项目会议+周计划」
6. 身份确认页：姓名直登（无密码），按姓名加载所属项目列表；无效姓名进入后无任何项目数据
7. 登录日志 + 操作日志（中间件自动记录全部写操作）+ 使用日志看板（当月/当周/当天统计，两级下钻）
8. 所有业务表 is_delete（现状已满足，新表同样加 SoftDeleteMixin）
9. 项目周报页「周报概括」后新增「导出Excel」（仅项目经理），按 demo/20260807_数字智能项目工作周报_肖立军.xlsx 格式导出该经理全部项目

用户已确认决策：①旧 7 列数据自动拆行迁移；②姓名直登、无效姓名进入后为空；③中间件自动记录全部写操作。

## Current State Analysis

- **模型**：`app/models/` 24 个类全部已含 SoftDeleteMixin（需求 8 基线已满足）。`PersonalReportWorkItem` 现为 mon~sun 7 列 Text + participants/deliverable/hours（personal_report.py:41-68）
- **迁移机制**：`app/database.py` init_db 用 `create_all` + `_ensure_*` 幂等 ALTER TABLE（模式成熟，照此扩展）
- **LLM 调用点**（3 处流式）：`agent_engine.py:70`（chat.completions.create stream=True）、`digest_service.py:81`、`minutes_service.py`（纪要流式）。当前均未解析 token usage；vLLM 支持 `stream_options={"include_usage": True}` 在最后一个 chunk 返回 usage
- **认证**：无任何登录/会话机制；API 无用户头。`main.py` 仅 CORSMiddleware
- **周报概括**：`weekly-report.js:305 generateWeekDigest` / `:343 showDigestPanel`（textarea rows=8，右栏 detail-panel）；`WeeklyReport.week_digest` Text 字段已存在
- **每周工作任务**：`WeeklyWorkTask`(work_task.py) 有 name/owner/week_start/project_id；`GET /work-tasks/?week_start=` 目前仅按激活项目过滤，需加可选 project_id 参数
- **导出参照 Excel 结构**（已解析 demo 文件）：Sheet 名 `pm{经理名}`；每项目 13 行区块（标题行 A1:G1 合并微软雅黑16加粗 → 项目名称/经理/周期行 → 项目状态/总工时(公式)/总体进度行 → 表头深蓝 FF1F4E78 白字 12pt（序号|项目成员|项目角色|本周具体工作任务|交付物/产出|本周工时(h)|下周计划安排）→ 5 个成员槽位行 10pt → 本周问题汇总（FFD9E1F2)→ 项目总体概况（FFD9E1F2)→ 空行）；周期显示周一~周五（2026/08/03 - 2026/08/07）；工作任务列为「周一：xxx；\n周二：xxx」聚合格式；列宽 A8.7/B14.7/D64.5/E19.7/F16.5/G56.5
- **requirements.txt** 无 openpyxl（需新增并装入容器）
- **前端模块**：index.html 导航 + view 容器 + script 注册；app.js viewModuleMap；cowork.js 含 MentionBox(L949) 可参照实现 `/` 弹层

## Proposed Changes

### 后端

**1. `app/models/personal_report.py`（需求 1）**
- `PersonalReportWorkItem`：移除 mon~sun 7 列，新增 `day_of_week: Mapped[int] = mapped_column(Integer, default=1)`（1=周一~7=周日）与 `content: Mapped[str] = mapped_column(Text, default="")`；保留 project_id/participants/deliverable/hours/sort_order
- `app/schemas/personal_report.py`：`PersonalReportWorkItemIn` 同步改为 day_of_week+content

**2. `app/database.py` 新增迁移（需求 1/4）**
- `_migrate_pr_work_items_to_daily(conn)`：若表存在旧列 mon，逐条取 is_delete=false 旧行，把 mon~sun 非空文本拆为新行（day_of_week=i, content=文本, project_id 同行；hours/participants/deliverable 仅挂到当天序号最小的一行，其余行 hours=0、participants/deliverable 复制首行），随后旧行置 is_delete=true。幂等（无符合条件旧行即跳过）
- `_migrate_member_status(conn)`：`UPDATE project_members SET status='全职' WHERE status='在职'`；`已退出`→`退出`
- 新建表 login_logs / operation_logs 由 create_all 自动建

**3. `app/models/usage_log.py`（新文件，需求 7）**
- `LoginLog(Base, TimestampMixin, SoftDeleteMixin)`：id, user_name(64, index), is_valid(bool), ip(64), user_agent(256)
- `OperationLog(Base, TimestampMixin, SoftDeleteMixin)`：id, user_name(64, index), method(8), path(256), entity_type(32, index), entity_id(int, nullable), action(16, index)（create/update/delete/login/llm_call/export）, detail(Text), tokens(int, default 0)
- `app/models/__init__.py` 注册

**4. `app/middleware.py`（新文件，需求 7）**
- `OperationLogMiddleware`：拦截 `/api/` 下 POST/PUT/PATCH/DELETE（排除 `/api/usage-logs/`、`/api/auth/`），从 `X-User-Name` 头取操作人，按 path 段映射 entity_type（如 meetings→会议、weekly-reports→项目周报、progress-tasks→里程碑、work-tasks→周计划、personal-reports→个人周报、agents→数字分身、skills→技能…）与 action（POST=create/PUT=update/PATCH=update/DELETE=delete），从 path 尾段尽力解析 entity_id，写 OperationLog。独立会话写库，异常静默不影响主请求
- `main.py` 注册中间件

**5. `app/services/log_service.py`（新文件，需求 7）**
- `record_llm_usage(db_or_none, user_name, source, tokens)`：供 LLM 调用点写 OperationLog(action='llm_call', entity_type=source[数字分身/技能/周报概括/会议纪要], tokens=usage.total_tokens)
- 改造 3 处流式调用（agent_engine.py、digest_service.py、minutes_service.py）：请求加 `stream_options={"include_usage": True}`，流结束后从尾 chunk 取 `chunk.usage` 累计并落库（user 名经参数传递，默认 "system"）

**6. `app/routers/auth.py`（新文件，需求 6/7）**
- `POST /api/auth/login` {name}：查 project_members（未删除）distinct name；命中→is_valid=true 写 LoginLog 并返回 {ok:true, name, projects:[{id,name,role,status,manager}…该成员所属项目]}；未命中→is_valid=false 写 LoginLog 返回 {ok:false, name, projects:[]}（前端允许进入但无数据）
- `GET /api/auth/me?name=`：按姓名返回同上项目归属（供刷新后恢复）

**7. `app/deps.py`（新文件，需求 5/6）**
- `get_user_name(request) -> str`：读 `X-User-Name`，空串返回 ""（视为匿名）
- `get_memberships(db, name)`：返回该用户在全部项目的 member 记录
- `require_project_manager(db, project_id, name)`：project.manager==name 否则 403
- `require_fulltime(db, project_id, name)`：成员 status=='全职' 或 project.manager==name，否则 403

**8. 现有路由接入权限与身份（需求 4/5/6）**
- `projects.py` GET `/`：按 X-User-Name 过滤为该用户所属项目（匿名/无效姓名→空列表）；GET `/active`：若该用户无所属项目返回 403
- `progress_tasks.py`、`weekly_reports.py` 全部写端点：`require_project_manager`
- `meetings.py`、`work_tasks.py` 全部写端点：`require_fulltime`
- `personal_reports.py` POST/PUT：校验 member_name 在该项目存在且 status != '退出'，否则 403
- `work_tasks.py` GET list：增加可选 `project_id` 查询参数（需求 3 用）
- 读端点不加限制（只读页面依赖），仅 projects 列表按归属过滤

**9. `app/routers/usage_logs.py`（新文件，需求 7）**
- `GET /api/usage-logs/stats?period=day|week|month`：{login_count（人次）, login_users（人数 distinct）, writes:[{entity_type, action, count}], llm:[{entity_type, calls, tokens}]}
- `GET /api/usage-logs/details?period=&entity_type=`：按 entity_id+action 聚合的明细行（count、最近时间）
- `GET /api/usage-logs/operations?period=&entity_type=&entity_id=`：操作记录列表，created_at 倒序（限制 200 条）

**10. `app/services/excel_export.py` + `weekly_reports.py` 导出端点（需求 9）**
- `GET /api/weekly-reports/export-excel?week_start=YYYY-MM-DD`：X-User-Name 必须是≥1 个项目的 manager（否则 403）；导出其 manager 的全部未删除项目
- 每项目区块严格复刻参照文件：标题/信息行/深蓝表头/5 个固定成员槽位/问题汇总/总体概况；样式参数（微软雅黑、FF1F4E78、FFD9E1F2、thin 边框、合并、列宽、行高）按解析结果硬编码
- 数据装配：成员行 = 该项目该周 personal_reports 展开（姓名、member.role、按天聚合「周一：内容（参与人员）；」文本、deliverable 去重拼接、hours 合计、plan_items 拼接）；本周问题汇总 = 该周 WeeklyReport.risks 拼接；项目总体概况 = WeeklyReport.week_digest；项目状态 = project.status；总体进度 = progress_tasks 完成率（已完成数/总数）；总工时 = 公式 `=SUM(F{首行}:F{末行})`；周期显示 `周一 - 周五`（week_start+4）
- StreamingResponse 输出 xlsx，文件名 `{YYYYMMDD}_数字智能项目工作周报_{经理}.xlsx`
- `requirements.txt` 加 `openpyxl>=3.1.0`（并装入运行容器）

### 前端

**11. `web/js/auth.js`（新文件，需求 6）+ `index.html`/`app.js` 接线**
- localStorage `cowork_user` 存姓名；`Auth.ensure()`：未登录→全屏登录覆盖层（姓名输入+确认），POST /auth/login 后无论 ok 与否都进入（无效姓名看不到项目数据）；侧边栏底部加当前用户+「退出登录」
- `API.request` 统一注入 `X-User-Name` 头
- `App.init` 改为：先 Auth.ensure()，通过后再 loadModules/各模块 init
- 登录后按返回 projects 重设可选项目上下文

**12. `web/js/personal-report.js` 重构（需求 1/3/4）**
- 表格列改为：项目名称(select) | 周几(select 周一~周日) | 工作内容(textarea) | 参与人员 | 交付物 | 工时(H) | 删除；保存/收集逻辑同步改 day_of_week+content
- 人员选择器仅列当前项目 status!=‘退出’ 成员
- 工作内容 textarea 监听输入 `/`：弹层列出该行所选项目+当前周的 weekly_work_tasks（API.getWorkTasks 带 project_id），键盘/点击选择后把任务名插入文本（参照 cowork.js MentionBox 定位与交互）

**13. `web/js/weekly-report.js`（需求 2/9）**
- `loadReport` 渲染详情后自动调用 `showDigestPanel(report, report.week_digest)`；无概括时面板显示「尚未生成概括」+「生成概括」按钮（不自动消耗 token）
- `showDigestPanel` textarea rows 8→22，detail-panel body 用 flex 撑满高度（「拉长提示框」）
- 顶栏「周报概括」按钮后新增「📊 导出Excel」：仅当当前用户是当前项目 manager 时渲染；点击 `window.open('/api/weekly-reports/export-excel?week_start=...')`（带 fetch blob 下载更稳，用 a[download]）

**14. 只读权限接入（需求 5）**
- `App.can.pm()` = 当前用户是当前项目 manager；`App.can.fulltime()` = 当前用户当前项目 status=='全职' 或 pm
- progress-plan.js / weekly-report.js：非 pm 隐藏新建/编辑/删除/关联等维护按钮（渲染时判断）
- meeting.js / work-tasks.js：非 fulltime 隐藏维护按钮
- project-team.js：成员状态选项改为 全职/临时/退出，徽章配色更新（全职=success、临时=warning、退出=gray）

**15. `web/js/usage-logs.js`（新文件，需求 7）+ 导航「使用日志」**
- 顶部三卡片：当天/当周/当月（登录人次·登录人数·写操作总数·LLM 调用·token 总数）
- 中部分类汇总表（entity_type × action 计数 + token）
- 点击汇总行→下钻明细（entity 维度列表）；点击明细行→操作记录（日期倒序，含操作人/动作/路径/tokens/时间）
- index.html 导航分组「项目驾驶舱」后新增「系统」分组（使用日志），app.js 注册 UsageLogs

### 涉及文件清单（后端 12 + 前端 8）
新增：`app/models/usage_log.py`、`app/middleware.py`、`app/services/log_service.py`、`app/services/excel_export.py`、`app/routers/auth.py`、`app/routers/usage_logs.py`、`app/deps.py`、`web/js/auth.js`、`web/js/usage-logs.js`
修改：`app/models/personal_report.py`、`app/schemas/personal_report.py`、`app/database.py`、`app/models/__init__.py`、`app/main.py`、`app/routers/projects.py`、`app/routers/progress_tasks.py`、`app/routers/weekly_reports.py`、`app/routers/meetings.py`、`app/routers/work_tasks.py`、`app/routers/personal_reports.py`、`app/services/agent_engine.py`、`app/services/digest_service.py`、`app/services/minutes_service.py`、`requirements.txt`、`web/index.html`、`web/js/app.js`、`web/js/api.js`、`web/js/personal-report.js`、`web/js/weekly-report.js`、`web/js/project-team.js`、`web/js/meeting.js`、`web/js/work-tasks.js`、`web/js/progress-plan.js`、`web/css/workbench.css`

## Assumptions & Decisions

1. 旧 7 列数据拆行迁移：hours/participants/deliverable 挂到首个有内容的天，其余天 hours=0（用户已确认自动拆行）
2. 成员状态映射：在职→全职、已退出→退出；数据库直接 UPDATE
3. 「项目经理」判定 = projects.manager 字符串等于登录姓名
4. 权限矩阵：里程碑/项目周报仅 PM 可维护；会议/周计划 PM 或全职可维护；临时/退出对这四类只读；个人周报退出不可填（前端过滤+后端 403）；读接口不限制（登录后无效姓名因 projects 为空自然无数据）
5. 登录无密码、会话存 localStorage；API 身份经 `X-User-Name` 头传递
6. token 统计：三处 LLM 流式调用加 `include_usage`；若 vLLM 不返回 usage 则 tokens 记 0（看板仍显示调用次数），验证阶段实测确认
7. Excel 导出周期显示周一~周五（严格按参照文件），总体进度按 progress_tasks 完成率自动计算，成员槽位固定 5 行
8. 操作日志中间件失败静默，不阻塞业务；日志查询接口本身不记录
9. 项目成员页/技能库/数字分身等其他视图不加维护权限（需求未提及）
10. 需求 8 已由 SoftDeleteMixin 全覆盖，新建两张日志表同样继承

## Verification

1. 容器内安装 openpyxl（docker exec … pip install，或重建镜像），重启/热重载 8091 服务，确认迁移日志无报错：旧个人周报行拆为天行、成员状态变为 全职/退出、新表 login_logs/operation_logs 建好
2. API 冒烟：
   - POST /auth/login 有效/无效姓名
   - 无效姓名 GET /projects/ → []
   - 非 PM PUT /weekly-reports/{id} → 403；临时成员 POST /meetings/ → 403；退出成员 POST /personal-reports/ → 403
   - GET /work-tasks/?week_start=&project_id= 过滤生效
   - 导出：PM 身份 GET export-excel 下载 xlsx，openpyxl 回读校验区块结构/合并/公式；非 PM → 403
   - 调用一次技能后查 operation_logs 有 llm_call 且 tokens>0
3. 浏览器 E2E（browser_use）：
   - 登录页：无效姓名进入→导航在但无项目数据；有效姓名→项目列表正确
   - 个人周报：新列布局、动态行、实时总工时、`/` 选择工作任务插入、退出成员不可选
   - 项目周报：点击列表行右栏自动显示概括；编辑框已拉长；PM 可见导出Excel 按钮并成功下载
   - 权限：用非 PM 账号验证里程碑/周报无维护按钮；临时成员验证会议/周计划只读
   - 使用日志看板：三档统计、两级下钻、操作记录倒序
4. 清理测试数据，`git add` 指定文件提交并推送 origin/main
