# pro-site 功能增强计划

> 范围：`pro-site/`（项目管理工作台）。共 7 项需求，其中 #1、#4 经探索确认已实现，本次以验证+小补足为主；新增工作集中在 #2、#3、#5、#6、#7。

## 一、现状分析（基于 Phase 1 探索）

| 需求 | 现状 | 本次动作 |
|------|------|----------|
| 1. 进度计划可编辑+同步DB | 已实现：[progress-plan.js](file:///mnt/data0/ai_deployment/proj/src/Automy-master/pro-site/web/js/progress-plan.js) `editTask()` 模态框 + 勾选完成 + 后端 [progress_tasks.py](file:///mnt/data0/ai_deployment/proj/src/Automy-master/pro-site/app/routers/progress_tasks.py) 完整 CRUD | 验证即可，不改动 |
| 2. "今天"→日期简写(7/23) | "今天"硬编码在 [workbench.css:1879](file:///mnt/data0/ai_deployment/proj/src/Automy-master/pro-site/web/css/workbench.css#L1878-L1884) `content:'今天'`，CSS 无法动态 | 改 JS 渲染 `M/D` 标签，移除 CSS content |
| 3. 标题/基于文档/日期范围可编辑+多项目 | 三项硬编码在 `render()`；时间轴 `PROJECT_START/TOTAL_DAYS/MONTHS/BIWEEKS` 也硬编码为 2026-07-01~12-31 | 新增 `Project` 模型/路由；前端动态生成时间轴+可编辑头部+项目切换 |
| 4. 3阶段·12迭代·11里程碑·39项任务 动态计算 | 已动态：`phaseCount=App.state.phases.length`、`biweekCount=BIWEEKS.length`、`msCount/taskCount` 由 tasks 计算 | 不改；附带把统计栏硬编码的"26周"改为 `Math.round(TOTAL_DAYS/7)` |
| 5. 去掉"🔍点击任务查看详情"提示 | [progress-plan.js:140](file:///mnt/data0/ai_deployment/proj/src/Automy-master/pro-site/web/js/progress-plan.js#L139-L141) 一个 span | 删除该 span |
| 6. 会议纪要/议程简介支持富文本+MD | 右栏为纯 `contenteditable`+`escapeHtml`，无 MD 渲染（[meeting.js](file:///mnt/data0/ai_deployment/proj/src/Automy-master/pro-site/web/js/meeting.js) `selectMeeting`/`selectItem`） | 引入 marked.js，做"编辑(MD源码)/预览(渲染)"双模式 |
| 7. 每周任务卡片编辑+拖拽 | 编辑已实现（✏️ `editTask()` 模态框）；无拖拽 | 新增原生 HTML5 拖拽，跨列改状态、列内改 sort_order |

**架构约定**：FastAPI + SQLAlchemy 2.0 async + 原生 JS；模型用 `Mapped[]`；路由统一 `/api` 前缀；表由 `init_db()` 的 `create_all` 自动建；前端三栏（左导航/中工作区/右详情）。

## 二、设计决策

1. **#3 多项目**：新增 `projects` 表支持多项目；前端头部加项目下拉选择器 + "新建项目"入口；时间轴 `MONTHS/BIWEEKS/TOTAL_DAYS/PROJECT_START` 全部由当前项目 `start_date/end_date` 动态生成（替换硬编码数组）。`GET /projects/active` 在无项目时幂等创建默认项目（信投AI2.0），免去手动 seed。
2. **#6 富文本/MD**：采用"Markdown 源码编辑 + 渲染预览"双模式（非 WYSIWYG）。内容以 MD 原文存入既有 `Text` 字段；预览用 `marked.parse()` 渲染。匹配需求中的"MD格式"+"显示格式"。
3. **#7 拖拽**：用原生 HTML5 DnD（不引第三方库）。列状态映射：列 `data-status`（todo/in_progress/done）↔ 后端中文状态（待开始/进行中/已完成），复用现有 `updateStatus()`。
4. **不改动**：#1 任务编辑、#4 ⚡统计行（已动态）。

## 三、具体改动

### A. 后端 — 新增 Project 模型/路由（需求 #3）

**A1. 新建 `pro-site/app/models/project.py`**
```python
class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64))            # 项目名, 如 "信投AI2.0"
    title: Mapped[str] = mapped_column(String(256))          # 执行图标题
    based_doc: Mapped[str] = mapped_column(String(256), default="")  # 基于文档
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
```

**A2. 新建 `pro-site/app/schemas/project.py`** — `ProjectCreate`/`ProjectUpdate`/`ProjectOut`（`model_config = ConfigDict(from_attributes=True)`）。

**A3. 新建 `pro-site/app/routers/projects.py`** — prefix `/projects`：
- `GET /` 列表（按 sort_order）
- `GET /active` → 返回 `is_active=True` 的项目；**若无则幂等创建默认项目**（name="信投AI2.0", title="信投 AI 2.0 项目进度计划执行图", based_doc="20260710信投AI2.0项目进度计划V2.3", start=2026-07-01, end=2026-12-31, is_active=True）
- `GET /{id}`、`POST /`、`PUT /{id}`、`DELETE /{id}`
- `PATCH /{id}/activate` → 将该项目置为 active，其余置 false

**A4. 注册**：
- `pro-site/app/models/__init__.py` 导入 `Project`
- `pro-site/app/routers/__init__.py` 导入 `projects`
- `pro-site/app/main.py` 的 `include_router` 列表加入 `projects.router`

### B. 前端 — 进度计划页面（需求 #2/#3/#5）

**B1. `pro-site/web/index.html`** — 在 app.js 之前引入 marked.js：
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
```

**B2. `pro-site/web/js/api.js`** — 新增 project 方法：
`getProjects()`、`getActiveProject()`、`createProject(data)`、`updateProject(id,data)`、`deleteProject(id)`、`activateProject(id)`（PATCH）。

**B3. `pro-site/web/js/app.js`**：
- `App.state.project = null`（当前项目元信息）
- `App.loadActiveProject()` → `API.getActiveProject()` 存入 state；在 `init()` 中 `loadPhases()` 之后调用
- `App.renderMarkdown(md)` 工具：空则返回空串，否则 `marked.parse(md)`（try/catch 兜底返回原文）
- `App.formatShortDate(dateStr)` → `${m}/${d}`（如 7/23）

**B4. `pro-site/web/js/progress-plan.js`** — 改动重点：
1. **动态时间轴**：删除硬编码 `PROJECT_START/TOTAL_DAYS/MONTHS/BIWEEKS` 常量，改为 `this.project` 加载后由 `initTimeline()` 计算：
   - `PROJECT_START` = 项目 start_date 本地午夜
   - `TOTAL_DAYS` = ceil((end - start)/1d)+1
   - `buildMonths()` → 按月切分，首月名 `${y}年${m}月`、其余 `${m}月`，记录 start/end 偏移
   - `buildBiweeks()` → 从 start 起 14 天一段，label `迭代{n}\n${M/D}-${M/D}`
2. **头部可编辑+项目选择**（`render()`）：
   - `<h1>` → `<h1 contenteditable data-pfield="title">` 绑定 blur 保存 `API.updateProject(id,{title})`
   - 基于文档 span → contenteditable `data-pfield="based_doc"`
   - 日期范围 div → contenteditable `data-pfield="start_date"`/`end_date`（或点击弹日期选择；采用两个 `<input type="date">` 内嵌，blur 保存）
   - 头部右侧加项目下拉 `<select id="pp-project-select">` + "＋新建项目"按钮；切换调用 `switchProject(id)` → 重新加载项目+任务+重渲染
3. **#5 删除提示**：删除 `<span>🔍 点击任务查看详情, 勾选标记完成</span>`
4. **#4 附带**：统计栏"26周"卡片 → `Math.round(this.TOTAL_DAYS/7)`
5. **#2 今天线标签**：`renderTodayLine()` 中给 `#pp-today-line` 追加子元素 `<div class="pp-today-label">${App.formatShortDate(today)}</div>`（如 7/23）
6. **加载流程**：`onShow()` → 先 `await App.loadActiveProject()`（若已加载则跳过）→ `this.project = App.state.project` → `initTimeline()` → `loadTasks()`

**B5. `pro-site/web/css/workbench.css`**：
- `.pp-today-line::before { content:'今天' }` → 改为 `content:''`（或删除该规则），新增 `.pp-today-label` 样式（红字白底小标签，定位在线左侧）

### C. 前端 — 会议右栏富文本/MD（需求 #6）

**C1. `pro-site/web/js/meeting.js`**：
- 新增 `renderRichPanel({title, meta, placeholder, md, kind, id})` 返回右栏 HTML：
  - 顶部标题+meta
  - 工具条：`[编辑] [预览]` 两个切换按钮
  - 预览区 `<div class="rt-preview">` → `App.renderMarkdown(md)`（默认显示）
  - 编辑区 `<textarea class="rt-editor" hidden>` → md 原文
  - `[保存]` 按钮
- `selectMeeting(id)`：用 `renderRichPanel` 渲染 `description`；保存调用 `API.updateMeeting(meetingId,{description:md})`，更新本地 `m.description` 与列表缓存
- `selectItem(itemId)`：用 `renderRichPanel` 渲染议程项 `description`；保存调用 `API.updateMeetingItem(meetingId,itemId,{description:md})`
- 切换逻辑：点"编辑"→隐藏 preview、显示 textarea 聚焦；点"预览"→渲染 textarea 内容到 preview、隐藏 textarea；点"保存"或 textarea blur→保存并切回预览
- 调整既有 `handleBlur`：移除对右栏 `description` 字段的旧 contenteditable 处理（改为新编辑器自管），保留会议元信息（title/meet_date 等）与议程单元格的 contenteditable 保存逻辑

**C2. `pro-site/web/css/workbench.css`** — 新增 `.rt-toolbar/.rt-editor/.rt-preview` 样式（textarea 等宽、preview 内 `h1-h3/ul/ol/code` 基础排版）。

### D. 前端 — 每周任务拖拽（需求 #7）

**D1. `pro-site/web/js/work-tasks.js`**：
- `renderTaskCard(task)`：根 div 加 `draggable="true"`、`data-task-id`
- `bindKanbanEvents()`：
  - 卡片 `dragstart`：`e.dataTransfer.setData('text/plain', taskId)`、加 `.dragging` 类
  - 卡片 `dragend`：移除 `.dragging`
  - 列体 `.kanban__column-body`：`dragover` preventDefault + 加 `.drag-over`；`dragleave` 移除；`drop` → 读 taskId，按目标列 `data-status` 映射中文状态，调 `updateStatus(id, 中文状态)`；列内重排：按拖放位置计算新 sort_order，调 `API.updateWorkTask(id,{sort_order})` 后 `loadTasks` 刷新
- 状态映射：`todo→待开始`、`in_progress→进行中`、`done→已完成`（复用现有 `nextStatus`/`updateStatus` 中的中文约定）
- 编辑入口保留现有 ✏️ `editTask()`

**D2. `pro-site/web/css/workbench.css`** — 新增：
- `.task-item[draggable="true"] { cursor: grab; }`
- `.task-item.dragging { opacity: 0.5; }`
- `.kanban__column-body.drag-over { background: var(--color-primary-light); outline: 2px dashed var(--color-primary-border); }`

## 四、假设与决策

- #1 任务编辑已可用，不做重复开发（仅验证）。
- #4 ⚡统计行已动态，仅附带修正"26周"硬编码。
- #6 采用 MD 编辑+预览（非 WYSIWYG），内容存 MD 原文，预览端渲染。marked.js 走 CDN。
- #3 默认项目由 `GET /projects/active` 幂等创建，无需手动跑 seed 脚本。
- 拖拽用原生 DnD，不引第三方库。
- 不改动周报模块、不改动数据库连接配置。

## 五、验证步骤

1. 启动 `pro-site`（`python run.py`，端口见 .env），确认无启动错误、新表 `projects` 自动创建。
2. **进度计划页**：
   - 头部标题/基于文档/日期范围可编辑，修改后刷新仍在（已落库）。
   - "今天"线显示为 `7/23` 形式（当天日期）。
   - 无"🔍 点击任务查看详情"提示。
   - ⚡统计行数字随任务变化；"周数"随项目周期变化。
   - 项目下拉可切换/新建项目；切换后时间轴月份/双周随项目日期重建。
   - 任务勾选完成、新建/编辑任务模态框仍正常（#1 回归）。
3. **项目例会页**：单击会议→右栏会议纪要支持编辑(MD)/预览(渲染)；进入议程页点议程项→右栏简介同样支持；保存后刷新仍在。
4. **每周任务页**：卡片可拖拽到"进行中/已完成"列，状态自动更新；列内拖拽改顺序；✏️ 编辑仍可用。
5. 浏览器 Console 无 JS 报错；各页 PDF 导出仍正常。
