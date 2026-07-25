# XIN 信 · 企业级智能体平台 · 静态文档与原型站点

> 企业级自主智能体平台 · 让 AI 成为每位员工的长期伙伴
>
> 名称由来：**XIN** = eXtreme INvestment Navigation；中文「信」既指信用、信赖，又取信使、信息之意。

本仓库为 **XIN 信**（项目代号 `automy-site`）企业级智能体平台的需求文档、技术架构设计文档与高保真产品原型静态网站，面向投资公司等对数据主权、合规审计有严格要求的组织内部使用。站点基于 Vite 构建，部署目标是 Cloudflare Pages（兼容 Cloudflare Workers Static Assets）。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [代码结构](#3-代码结构)
4. [核心机制](#4-核心机制)
5. [文档体系](#5-文档体系)
6. [产品原型](#6-产品原型)
7. [数据文件](#7-数据文件)
8. [构建与部署](#8-构建与部署)
9. [启动命令](#9-启动命令)
10. [开发指南](#10-开发指南)

---

## 1. 项目概述

| 项目 | 说明 |
| --- | --- |
| 项目名称 | XIN 信 · 企业级自主智能体平台（仓库代号 `automy-site`） |
| 仓库定位 | 需求文档 + 技术架构 + 高保真产品原型的静态网站 |
| 目标用户 | 投资公司内部员工（投研、法务、合规、销售、IT 管理员等） |
| 核心能力 | 长期记忆、技能市场、专家 Agent 市场、MCP 标准接入、知识库 RAG、全链路审计 |
| 部署目标 | Cloudflare Pages / Cloudflare Workers Static Assets |
| 站点端口 | 本地开发固定 **8087** |
| 仓库性质 | 纯静态站点，无后端运行时（HTML5 + CSS3 + 原生 JS） |

平台三大关键词：**安全 Security**（私有化部署、数据主权、全链路审计、等保三级）、**自主 Autonomy**（长期记忆、主动判断、IM 双向交互、自我演化）、**可演化 Evolvable**（技能/专家市场、模型后训练、灰度热更新）。

---

## 2. 技术栈

| 维度 | 选型 | 说明 |
| --- | --- | --- |
| 构建工具 | Vite ^5.4.0 | 仅做静态打包，无前端框架运行时（`package.json` 中 `type: "module"`） |
| 页面层 | 原生 HTML5 | 多入口 HTML，由 `vite.config.js` 的 `rollupOptions.input` 显式声明 |
| 样式层 | 原生 CSS3 | 通过 CSS 变量驱动设计令牌，支持浅色/深色主题切换 |
| 脚本层 | 原生 JavaScript (ES6+ Module) | 无打包框架，模块化通过 `<script type="module">` + `import/export` 实现 |
| 路由 | 自实现 Hash 路由（`router.js`） | 监听 `hashchange`，支持 `:param` 占位符与外部 HTML 懒加载 |
| 图表 | Mermaid.js 10 (CDN 引入) | `router.js` 中动态加载并手动 `mermaid.run()` 渲染 |
| 字体 | Inter / JetBrains Mono（Google Fonts CDN） | 由 `style.css` 顶部 `@import` 引入 |
| 部署平台 | Cloudflare Pages | 通过 `wrangler.jsonc` 配置静态资源根目录 |
| 部署产物 | `dist/` 目录（Vite 构建产物） 或 源码目录直发 | `wrangler.jsonc` 直接以 `.` 作为静态资源根目录 |

---

## 3. 代码结构

```text
xin-site/
├── index.html                  # 站点首页（Hero 区、产品定位、核心能力、价值场景、技术亮点、路线图预览、CTA、内联首页样式）
├── 404.html                    # 404 错误页（独立多页入口，含热门页面建议列表）
├── package.json                # 依赖与脚本（仅 vite 一个 devDependency）
├── package-lock.json           # 依赖版本锁定
├── vite.config.js              # Vite 配置：base='./'、多页 input、staticCopyPlugin、8087 端口
├── wrangler.jsonc              # Cloudflare Pages 部署配置（静态资源根为当前目录）
├── .gitignore                  # Git 忽略（node_modules / dist / .env / 编辑器配置等）
├── README.md                   # 本文档
│
├── shared/
│   └── components.html         # 通用组件库示例页（19 类组件 demo：按钮/卡片/表格/徽章/Alert/表单/折叠/代码块/Tabs/头像/Loading/Empty/Timeline/Chips/面包屑/分隔符/Toast/Modal）
│
├── assets/
│   ├── css/
│   │   ├── style.css           # 全局样式：设计令牌（浅/深主题）、基础重置、布局容器、网格、工具类、动画（522 行）
│   │   ├── components.css      # 通用组件样式：按钮/卡片/表格/徽章/Alert/折叠/代码块/表单/顶栏/侧边栏/面包屑/Tabs/头像/空状态/Loading/Modal/搜索弹窗/页脚/Toast/分页/Timeline/Tooltip/分隔符/Chips/进度条/响应式顶栏/工具类（1471 行）
│   │   └── prototype.css       # 原型专用样式：原型容器/对话区/快捷能力入口/Chat Composer/市场卡片/知识库列表/用户档案/管理后台统计卡/原型占位符/登录页/工作台仪表盘/MCP 卡片/代码编辑器占位/响应式（1472 行）
│   ├── js/
│   │   ├── app.js              # 应用主入口：初始化各模块、注入顶栏/页脚/搜索骨架、注册路由、加载文档/原型页面、文档侧边栏（420 行）
│   │   ├── router.js           # Hash 路由器：register 正则匹配、loadPage 外部 HTML 懒加载、Mermaid 重新渲染、顶栏导航高亮（201 行）
│   │   ├── search.js           # 搜索模块：Ctrl/Cmd+K 唤起、前端模糊检索 search-index.json、分组结果、键盘导航（298 行）
│   │   ├── theme.js            # 主题切换：浅色/深色、localStorage 持久化、系统主题跟随、FOUC 防闪烁（97 行）
│   │   └── prototype.js        # 原型交互：Tab/安装/侧边栏/Chat 流式输出/筛选/复制代码/Toast + 标注模式 annotationMode（470 行）
│   └── data/
│       ├── documents.json      # 知识库文档列表（投研/法务/合同/会议纪要）
│       ├── glossary.json       # 术语表（核心概念/技术框架/协议标准/技术方法）
│       ├── roadmap.json        # 产品路线图里程碑（Q1 2026 ~ 2027 H1）
│       ├── skills.json         # 技能市场列表（投研/法务/销售/通用）
│       ├── experts.json        # 专家 Agent 市场（投研/法务/合规等）
│       ├── models.json         # 模型网关配置（GPT-4o / Claude / GLM-4 / Qwen 等）
│       ├── mcp-services.json   # MCP 服务目录（CRM / ERP / Wind / 法律库等）
│       ├── memories.json       # 长期记忆条目（偏好/项目/会议决策）
│       ├── audit-logs.json     # 全链路审计日志（skill.invoke / mcp.call / memory.write 等）
│       └── search-index.json   # 前端搜索索引（页面/文档/原型/技能/专家/MCP 全量条目）
│
├── docs/                       # 文档体系（按 hash 路由懒加载到首页 SPA 容器）
│   ├── requirements/           # 需求文档（13 篇 + overview）
│   ├── architecture/           # 技术架构（13 章 + overview）
│   ├── glossary.html           # 术语表汇总页
│   └── roadmap.html            # 产品路线图汇总页
│
├── prototype/                  # 产品原型（按业务域分组的子页面）
│   ├── admin/                  # 管理后台（11 个子页面）
│   ├── auth/                   # 用户认证（登录页）
│   ├── expert-market/          # 专家 Agent 市场（3 个子页面）
│   ├── im-channels/            # IM 通道与主动提醒（3 个子页面）
│   ├── knowledge/              # 知识库（3 个子页面）
│   ├── mcp/                    # MCP 集成（3 个子页面）
│   ├── notifications/          # 通知中心
│   ├── profile/                # 用户中心
│   ├── skill-market/           # 技能市场（4 个子页面）
│   ├── workbuddy-demo/         # WorkBuddy 交互界面参考（4 张样例图）
│   └── workspace/              # 工作台（对话主界面）
│
└── images/                     # 原型配图
    ├── workbuddy_demo1.png     # WorkBuddy 主交互界面参考图 1
    ├── workbuddy_demo2.png     # WorkBuddy 参考图 2
    ├── workbuddy_demo3.png     # WorkBuddy 参考图 3
    ├── workbuddy_demo4.png     # WorkBuddy 参考图 4
    └── 样例.png                # 设计样例图
```

---

## 4. 核心机制

### 4.1 路由机制（`app.js` + `router.js`）

XIN 采用 **自实现的 Hash 路由**，而非 History API。所有子页面通过 `#/...` 形式访问，便于在静态托管环境下无需服务端 rewrite 规则。

**路由注册（`app.js#registerRoutes`）：**

```javascript
router.register('/', (params, path) => { this.showHome(); });        // 首页：直接显示 #home-page
router.register('/docs/requirements/:module', async (params) => {   // 需求文档
  await this.loadDocPage(`docs/requirements/${params.module}.html`, '需求文档', 'requirements', params.module);
});
router.register('/docs/architecture/:chapter', async (params) => {  // 技术架构
  await this.loadDocPage(`docs/architecture/${params.chapter}.html`, '技术架构', 'architecture', params.chapter);
});
router.register('/prototype/:section/:subsection', async (params) => {  // 原型子页面（如 skill-market/detail）
  await this.loadPrototypePage(`prototype/${params.section}/${params.subsection}.html`, `${params.section}/${params.subsection}`);
});
router.register('/prototype/:section', async (params) => {          // 原型主页
  await this.loadPrototypePage(`prototype/${params.section}/index.html`, params.section);
});
router.register('/roadmap', ...);                                    // 路线图
router.register('/glossary', ...);                                   // 术语表
router.notFound((path) => { this.showNotFound(path); });            // 404 兜底
```

**路由核心特性（`router.js`）：**

- **正则匹配**：将 `/docs/:type/:name` 编译为 `^\/docs\/([^/]+)\/([^/]+)$`，自动提取 `params`。
- **懒加载**：`loadPage(url, container)` 通过 `fetch(url)` 拉取独立 HTML 文件，正则提取 `<body>` 内容后注入容器，并重新执行 `<script>` 标签。
- **Mermaid 重渲染**：动态加载的 HTML 不会触发 `mermaid.startOnLoad`，`router._initMermaid()` 检测 `.mermaid` 未渲染块，从 CDN 动态加载 `mermaid@10` 后调用 `mermaid.run({ nodes })`。
- **导航高亮**：`updateNavActive(path)` 比对顶栏 `nav-item` 的 `href` 与当前 hash，命中则添加 `active` 类。
- **页面切换**：首页（`#home-page`）与 SPA 容器（`#app-content`）通过 `hidden` 类互斥显示；`showAppContent()` 隐藏首页并显示 SPA 容器。

**典型 URL：**

```text
http://localhost:8087/                            # 首页
http://localhost:8087/#/docs/requirements/overview
http://localhost:8087/#/docs/architecture/agent-runtime
http://localhost:8087/#/prototype/workspace
http://localhost:8087/#/prototype/skill-market/detail
http://localhost:8087/#/roadmap
http://localhost:8087/#/glossary
```

### 4.2 主题切换（`theme.js`）

| 配置项 | 值 |
| --- | --- |
| `localStorage` 键名 | `automy-theme` |
| 可选值 | `light`（默认）/ `dark` |
| 切换入口 | 顶栏 `.theme-toggle` 按钮、`shared/components.html` 顶栏按钮 |
| 切换原理 | 在 `<html>` 上设置 `data-theme="dark"` 属性，CSS 变量在 `style.css` 的 `[data-theme="dark"]` 选择器下被覆盖 |

**防 FOUC（闪烁）机制：** 每个 HTML 入口的 `<head>` 中都有一段内联 `<script>`，在 DOM 解析前先读取 `localStorage` 并立即应用 `data-theme`，避免主题切换闪烁；`theme.js` 末尾再次兜底执行。

**特性：**

- 监听 `prefers-color-scheme: dark` 系统主题变化（仅当用户未手动选择时跟随）。
- `updateToggleButtons()` 动态切换按钮图标（太阳/月亮 SVG）与 `aria-label`。

### 4.3 搜索机制（`search.js` + `search-index.json`）

**前端全量索引检索**，无后端依赖：

```javascript
const SEARCH_INDEX_URL = './assets/data/search-index.json';
```

**核心流程：**

1. **快捷键唤起**：监听 `Ctrl/Cmd + K`，调用 `search.open()`；按 `Esc` 关闭。
2. **触发按钮**：监听 `.search-trigger` / `[data-search-trigger]` 元素点击。
3. **弹窗动态创建**：若页面不存在 `#search-modal`，由 `createModal()` 动态构建（含输入框、结果容器）。
4. **索引懒加载**：首次打开时 `fetch(search-index.json)` 拉取全量索引；失败时回退到 `getFallbackIndex()`（5 条内置条目）。
5. **模糊检索**：对每条索引的 `title`、`desc`、`path`、`keywords` 字段做 `toLowerCase().includes(q)` 过滤，最多返回 12 条。
6. **分组渲染**：按 `category` 字段分组（页面 / 文档 / 原型 / 技能 / 专家 / MCP 服务 / 术语表 / 路线图）。
7. **键盘导航**：`↑/↓` 移动高亮，`Enter` 选中跳转（`router.go(item.path)` 或 `window.location.href`）。
8. **图标映射**：`getIconForType()` 根据 `type` 字段返回 emoji 图标（📄/📚/🎯/⚡/🤖/🔌/📖/🚀）。

### 4.4 原型交互（`prototype.js`）

`prototype.js` 导出两个对象：`prototype`（原型交互管理器）与 `annotationMode`（标注模式）。

**`prototype` 提供的通用交互能力（全部基于事件委托，动态加载内容自动生效）：**

| 绑定方法 | 触发元素 | 行为 |
| --- | --- | --- |
| `bindTabSwitch()` | `[data-tab]` | 切换 `[data-tabs]` 容器内的 `.tab-item.active` 与对应 `[data-tab-content]` |
| `bindInstallToggle()` | `.install-btn` | 切换 `data-installed` 状态，按钮文案与样式在「安装 / 安装中... / 已安装 / 已卸载」间切换，触发 Toast |
| `bindSidebarToggle()` | `[data-sidebar-toggle]` | 切换侧边栏 `active` 状态与 `[data-sidebar-panel]` 显示 |
| `bindChatDemo()` | `[data-chat-send]` | 模拟流式输出：用户消息入列 → typing 三点动画 → 逐字打字机效果输出助手回复 |
| `bindFilterChips()` | `[data-filter]` | 切换 `[data-filter-group]` 内 `active`，触发 `filterchange` 自定义事件 |
| `bindCopyCode()` | `.code-block__copy` | 复制 `.code-block` 内 `code/pre` 内容到剪贴板，Toast 反馈 |
| `showToast(msg, type)` | — | 动态创建 `.toast-container` 并追加 `.toast` 元素，2.4s 后渐隐移除 |

**`annotationMode` 标注模式（原型页 ↔ 需求条目联动）：**

- 入口：顶栏 `.annotation-toggle` 按钮（📌 图标）。
- 状态持久化：`localStorage` 键名 `automy-annotation`。
- 触发：`hashchange` 时重新渲染 `#annotation-panel` 浮窗。
- 数据：内置 `pageRequirements` 映射表（每个原型页 key 对应若干 `REQ-x.y` / `IM-x.y` / `SD-x.y` 需求编号）。
- 展示：右侧浮窗列出对应需求编号、需求标题（`getReqTitle`）、跳转链接（`getReqDocLink` 映射到具体需求文档页锚点）、设计说明（`getDesignNote`）。

### 4.5 组件复用（`shared/components.html`）

`shared/components.html` 是独立的组件示例页（多页入口之一），展示 XIN 全站统一的 19 类可复用组件：

| 组件类别 | 类别 |
| --- | --- |
| 按钮 Buttons | 卡片 Cards | 表格 Table |
| 徽章 Badges | 提示框 Alerts | 表单 Form |
| 折叠块 Collapse | 代码块 Code Block | 标签页 Tabs |
| 头像 Avatar | 加载 Loading | 空状态 Empty State |
| 时间线 Timeline | 标签 Chips | 面包屑 Breadcrumb |
| 分隔符 Divider | Toast 通知 | 模态弹窗 Modal |

所有组件样式定义在 `assets/css/components.css` 中，通过 CSS 变量驱动，自动适配深色/浅色主题。组件页本身引入 `theme.js` 与 `prototype.js`，并将 `prototype` 暴露到 `window.prototype` 供内联 `onclick` 调用。

---

## 5. 文档体系

`docs/` 目录下的文档页面通过 `app.js#loadDocPage` 懒加载到首页 SPA 容器，外层套用 `.docs-layout`（左侧边栏 + 主内容），主内容容器带 `.prose` 样式类。

### 5.1 需求文档（`docs/requirements/`，13 篇）

| 文件 | 文档标题 | 对应侧边栏模块 |
| --- | --- | --- |
| `overview.html` | 需求文档总览 | 📋 总览 |
| `companion.html` | 长期陪伴与记忆 | 🤝 长期陪伴与记忆 |
| `skill-market.html` | 技能市场 | ⚡ 技能市场 |
| `expert-market.html` | 专家 Agent 市场 | 🤖 专家 Agent 市场 |
| `mcp-integration.html` | MCP 服务集成 | 🔌 MCP 服务集成 |
| `workspace.html` | 工作台与会话 | 💼 工作台与会话 |
| `knowledge.html` | 知识库与 RAG | 📚 知识与文档库 |
| `security-audit.html` | 安全合规与审计 | 🛡 安全合规与审计 |
| `auth-rbac.html` | 身份与权限（用户与组织管理） | 🔐 身份与权限 |
| `admin.html` | 平台管理后台 | ⚙ 平台管理后台 |
| `profile.html` | 用户中心 | 👤 用户中心 |
| `integration.html` | 集成与扩展 | 🔗 第三方集成 |
| `im-notification.html` | IM 通道与主动提醒 | （新增模块） |
| `session-data.html` | 会话数据库设计 | （新增模块） |

### 5.2 技术架构（`docs/architecture/`，13 章）

| 文件 | 章节标题 |
| --- | --- |
| `architecture-goals.html` | 架构目标 |
| `overview.html` | 架构总览 |
| `system-design.html` | 系统设计与分层 |
| `agent-runtime.html` | 智能体运行时（Eino ADK） |
| `memory-system.html` | 记忆系统设计 |
| `skill-system.html` | 技能系统设计 |
| `mcp-protocol.html` | MCP 协议与接入 |
| `knowledge-base.html` | 知识库与 RAG |
| `session-store.html` | 会话数据库设计 |
| `im-channels.html` | IM 通道集成架构 |
| `security.html` | 安全与合规 |
| `data-model.html` | 数据模型与存储 |
| `deployment.html` | 部署与运维 |

### 5.3 术语表与路线图

| 文件 | 标题 | 路由 |
| --- | --- | --- |
| `docs/glossary.html` | 术语表 | `#/glossary` |
| `docs/roadmap.html` | 产品路线图 | `#/roadmap` |

---

## 6. 产品原型

`prototype/` 目录按业务域分组，每个子目录包含 `index.html`（主页）与若干子页面。原型页通过 `app.js#loadPrototypePage` 懒加载，外层套用 `.prototype-shell` 容器并显示「这是产品原型界面」横幅。

### 6.1 管理后台 admin（11 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `admin/index.html` | 管理后台首页 |
| `admin/users.html` | 用户与组织管理 |
| `admin/roles.html` | 角色与权限管理 |
| `admin/audit.html` | 审计日志 |
| `admin/models.html` | 模型网关配置 |
| `admin/market-review.html` | 市场审核 |
| `admin/mcp-services.html` | MCP 服务管理 |
| `admin/skills-experts.html` | 技能与专家管理 |
| `admin/security.html` | 安全策略配置 |
| `admin/billing.html` | 计费账单 |
| `admin/settings.html` | 系统配置 |

### 6.2 用户认证 auth（1 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `auth/index.html` | 登录页（SSO 入口 + 本地账号兜底） |

### 6.3 专家市场 expert-market（3 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `expert-market/index.html` | 专家市场首页 |
| `expert-market/detail.html` | 投研分析师 · 专家详情 |
| `expert-market/customize.html` | 专家个性化微调 |

### 6.4 IM 通道 im-channels（3 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `im-channels/index.html` | IM 通道配置（飞书/企微/钉钉接入） |
| `im-channels/template-editor.html` | 通知模板编辑器 |
| `im-channels/reminder-rules.html` | 主动提醒规则 |

### 6.5 知识库 knowledge（3 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `knowledge/index.html` | 知识库首页 |
| `knowledge/pipeline.html` | 文档处理流水线 |
| `knowledge/search-test.html` | 检索测试 |

### 6.6 MCP 集成 mcp（3 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `mcp/index.html` | MCP 集成管理 |
| `mcp/connections.html` | MCP 连接管理 |
| `mcp/service-detail.html` | Wind 金融数据 · MCP 服务详情 |

### 6.7 通知中心 notifications（1 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `notifications/index.html` | 通知中心（站内通知 + 未读统计 + 渠道筛选） |

### 6.8 个人资料 profile（1 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `profile/index.html` | 用户中心（画像 + 偏好 + 订阅 + 连接管理） |

### 6.9 技能市场 skill-market（4 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `skill-market/index.html` | 技能市场首页 |
| `skill-market/detail.html` | 财务报表解析 · 技能详情 |
| `skill-market/editor.html` | 技能编辑器（低代码可视化编排） |
| `skill-market/my-skills.html` | 我的技能 |

### 6.10 WorkBuddy 交互演示 workbuddy-demo（1 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `workbuddy-demo/index.html` | WorkBuddy 交互界面参考（4 张样例图：主交互界面、对话详情、任务卡片、工作流编排） |

### 6.11 工作区 workspace（1 个页面）

| 文件 | 页面标题 |
| --- | --- |
| `workspace/index.html` | 工作台（智能体对话主界面，左侧多会话列表 + 右侧主对话区 + 顶部工具栏） |

---

## 7. 数据文件

`assets/data/` 下的 10 个 JSON 文件作为前端 mock 数据源，被原型页面或文档页面静态引用（搜索索引由 `search.js` 显式 `fetch`，其他文件多用于原型页内联展示）。

| 文件 | 用途 | 关键字段 |
| --- | --- | --- |
| `documents.json` | 知识库文档列表（投研报告、法律意见书、合同、会议纪要） | `id`、`title`、`type`（pdf/docx）、`category`、`size`、`pages`、`uploadedBy`、`uploadedAt`、`projectId`、`projectName`、`tags`、`status`、`summary`、`accessLevel`、`url` |
| `glossary.json` | 平台术语表（核心概念、技术框架、协议标准、技术方法） | `term`、`termEn`、`category`、`definition`、`related`、`tags` |
| `roadmap.json` | 产品路线图里程碑（5 个季度：Q1 2026 ~ 2027 H1） | `id`、`quarter`、`title`、`status`（completed/in-progress/planned/vision）、`progress`、`releaseDate`、`description`、`features[]`（name/status/priority）、`deliverables[]` |
| `skills.json` | 技能市场列表（投研/法务/销售/通用） | `id`、`name`、`nameEn`、`category`、`description`、`icon`、`author`、`version`、`installs`、`rating`、`tags`、`tools[]`、`status`（published/beta）、`isOfficial`、`price`、`updateTime` |
| `experts.json` | 专家 Agent 市场（投研分析师/法务顾问/合规官等） | `id`、`name`、`nameEn`、`category`、`avatar`、`color`、`description`、`capabilities[]`、`skills[]`、`mcpServices[]`、`subscribers`、`rating`、`version`、`author`、`isOfficial`、`price`、`status`、`tags[]` |
| `models.json` | 模型网关配置（GPT-4o/Claude 3.5/GLM-4/Qwen Max 等） | `id`、`name`、`provider`、`category`（通用大模型/国产大模型）、`contextWindow`、`maxOutput`、`modalities[]`、`description`、`capabilities[]`、`pricing`（input/output/unit）、`latency`、`isLocal`、`status`、`defaultFor[]`、`icon` |
| `mcp-services.json` | MCP 服务目录（CRM/ERP/Wind/法律库等） | `id`、`name`、`nameEn`、`category`、`icon`、`description`、`vendor`、`version`、`status`（connected/disconnected）、`tools[]`（name/description）、`authType`、`permissions[]`、`connectionCount`、`isOfficial`、`lastUsed`、`configRequired[]` |
| `memories.json` | 长期记忆条目（用户偏好/项目记忆/会议决策） | `id`、`userId`、`userName`、`type`（preference/project/meeting）、`category`、`content`、`scope`（user/project）、`scopeId`、`source`（inferred/explicit/conversation/meeting_summary）、`confidence`、`createdAt`、`updatedAt`、`accessCount`、`tags[]` |
| `audit-logs.json` | 全链路审计日志（技能调用/MCP 调用/记忆写入/文档上传等） | `id`、`timestamp`、`userId`、`userName`、`userDept`、`action`（skill.invoke/mcp.call/memory.write/document.upload 等）、`resource`、`resourceName`、`details`、`ip`、`sessionId`、`result`、`duration`、`dataAccess[]` |
| `search-index.json` | 前端搜索索引（页面/文档/原型/技能/专家/MCP 全量条目） | `type`（page/doc/prototype/skill/expert/mcp/glossary/roadmap）、`category`、`title`、`desc`、`path`（hash 路径）、`keywords` |

---

## 8. 构建与部署

### 8.1 Vite 构建配置（`vite.config.js`）

```javascript
export default defineConfig({
  base: './',                       // 相对路径,支持子路径访问
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      input: {                     // 多页入口
        main: 'index.html',
        notFound: '404.html',
        components: 'shared/components.html'
      }
    }
  },
  plugins: [staticCopyPlugin()],    // 自定义插件:closeBundle 阶段复制动态加载资源
  server: {
    port: 8087,                    // 固定端口 8087
    host: '0.0.0.0',               // 监听所有网卡,便于容器访问
    open: false,
    appType: 'mpa'                 // 多页应用模式
  }
});
```

**`staticCopyPlugin` 自定义插件**：在 `closeBundle` 阶段递归复制以下目录到 `dist/`，确保 hash 路由动态加载的页面能正常工作：

- `docs/` → `dist/docs/`
- `prototype/` → `dist/prototype/`
- `assets/data/` → `dist/assets/data/`
- `images/` → `dist/images/`
- `assets/img/` → `dist/assets/img/`（若存在）

### 8.2 三大脚本命令

```bash
npm run dev      # 启动开发服务器（vite，端口 8087）
npm run build    # 构建生产版本到 dist/
npm run preview  # 预览构建产物（vite preview）
```

### 8.3 构建产物结构

```text
dist/
├── index.html              # 首页
├── 404.html                # 404 页
├── shared/
│   └── components.html     # 组件库示例页
├── assets/
│   ├── css/                # 合并/压缩后的 CSS
│   ├── js/                 # 打包后的 JS
│   ├── data/               # 由 staticCopyPlugin 复制的 JSON
│   └── img/                # 由 staticCopyPlugin 复制（若存在）
├── docs/                   # 由 staticCopyPlugin 复制
├── prototype/              # 由 staticCopyPlugin 复制
└── images/                 # 由 staticCopyPlugin 复制
```

### 8.4 Cloudflare Pages 部署

#### 方式 A：通过 Wrangler CLI 部署（推荐）

`wrangler.jsonc` 配置如下：

```jsonc
{
  "name": "automy-site",
  "compatibility_date": "2025-09-01",
  "assets": {
    "directory": ".",                  // 直接以源码目录作为静态资源根
    "not_found_handling": "404-page",  // 未命中静态文件时返回 404.html
    "exclude": [
      "wrangler.jsonc", "wrangler.toml", "vite.config.js",
      "package.json", "package-lock.json", "README.md", ".gitignore",
      "node_modules/**", "dist/**"
    ]
  }
}
```

部署命令（在 `xin-site/` 目录下执行）：

```bash
npx wrangler deploy
```

> 由于本项目为纯静态站点（HTML5 + CSS3 + 原生 JS + hash 路由），源码目录即可直接作为静态资源部署，**无需 Vite 构建产物**。

#### 方式 B：通过 Cloudflare Pages 控制台部署

| 配置项 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| Node 版本 | 18+ |

---

## 9. 启动命令

本地开发服务器端口**固定 8087**，已在 `vite.config.js` 中通过 `server.port: 8087` 与 `server.host: '0.0.0.0'` 配置。

### 9.1 安装依赖

```bash
cd xin-site
npm install
```

### 9.2 启动方式一：使用 npm script

```bash
npm run dev
```

`package.json` 中脚本定义为 `"dev": "vite"`，由于 `vite.config.js` 已配置 `server.port: 8087` 与 `server.host: '0.0.0.0'`，该命令会监听 `0.0.0.0:8087`。

### 9.3 启动方式二：直接通过 vite CLI 显式指定

```bash
npx vite --port 8087 --host 0.0.0.0
```

### 9.4 访问地址

| 入口 | URL |
| --- | --- |
| 首页 | http://localhost:8087/ |
| 需求文档总览 | http://localhost:8087/#/docs/requirements/overview |
| 技术架构总览 | http://localhost:8087/#/docs/architecture/overview |
| 工作台原型 | http://localhost:8087/#/prototype/workspace |
| 技能市场原型 | http://localhost:8087/#/prototype/skill-market |
| 专家市场原型 | http://localhost:8087/#/prototype/expert-market |
| 路线图 | http://localhost:8087/#/roadmap |
| 术语表 | http://localhost:8087/#/glossary |
| 组件库示例 | http://localhost:8087/shared/components.html |
| 全站搜索 | Ctrl/Cmd + K |

### 9.5 其他命令

```bash
npm run build     # 构建生产版本到 dist/
npm run preview   # 预览构建产物
```

---

## 10. 开发指南

### 10.1 新增文档页面

以新增一篇需求文档 `docs/requirements/foo.html` 为例：

1. **创建 HTML 文件**：在 `docs/requirements/` 下新建 `foo.html`，结构参考 `overview.html`：

   ```html
   <!DOCTYPE html>
   <html lang="zh-CN">
   <head>
     <meta charset="UTF-8" />
     <title>Foo · 需求文档 · XIN</title>
   </head>
   <body>
     <h1>Foo</h1>
     <!-- 文档正文:使用 .prose 样式类,支持 <h2>/<h3>/<table>/<pre><code>/.mermaid 等 -->
   </body>
   </html>
   ```

   > 仅需 `<body>` 内的正文内容会被注入；CSS 与顶栏由 `app.js` 自动接管。

2. **侧边栏注册**：编辑 `assets/js/app.js` 的 `getRequirementsSidebar()`，在 `modules` 数组中追加一项：

   ```javascript
   { id: 'foo', name: 'Foo 模块', icon: '🆕' }
   ```

3. **搜索索引注册**：在 `assets/data/search-index.json` 追加一行：

   ```json
   { "type": "doc", "category": "需求文档", "title": "Foo 模块", "desc": "Foo 模块说明",
     "path": "#/docs/requirements/foo", "keywords": "foo 关键词1 关键词2" }
   ```

4. **访问验证**：浏览器打开 `http://localhost:8087/#/docs/requirements/foo`，确认侧边栏高亮与正文渲染正常。

> 新增架构文档同理：在 `docs/architecture/` 下新建 HTML，编辑 `getArchitectureSidebar()` 的 `chapters` 数组，并更新 `search-index.json`。路由 `/docs/architecture/:chapter` 会自动匹配。

### 10.2 新增原型页面

以新增 `prototype/foo/index.html` 与 `prototype/foo/bar.html` 为例：

1. **创建原型 HTML**：在 `prototype/foo/` 下新建 `index.html`（与可选的 `bar.html`）：

   ```html
   <!DOCTYPE html>
   <html lang="zh-CN">
   <head>
     <meta charset="UTF-8" />
     <title>Foo · XIN</title>
   </head>
   <body>
     <div class="app-frame">
       <h1 class="app-frame__title">Foo 原型</h1>
       <!-- 原型正文:可使用 prototype.css 的 .app-frame / .app-frame__sidebar / .app-frame__main 等类 -->
     </div>
   </body>
   </html>
   ```

2. **路由自动匹配**：`app.js` 已注册 `/prototype/:section` 与 `/prototype/:section/:subsection` 两条路由，访问 `#/prototype/foo` 会自动加载 `prototype/foo/index.html`，访问 `#/prototype/foo/bar` 会加载 `prototype/foo/bar.html`。**无需修改路由代码。**

3. **搜索索引注册**：在 `assets/data/search-index.json` 追加：

   ```json
   { "type": "prototype", "category": "原型", "title": "Foo 原型", "desc": "Foo 原型说明",
     "path": "#/prototype/foo", "keywords": "foo 原型" }
   ```

4. **标注模式联动（可选）**：若希望该原型页在标注模式下显示对应需求条目，编辑 `assets/js/prototype.js` 中 `annotationMode.pageRequirements` 与 `getDesignNote()`：

   ```javascript
   pageRequirements: {
     // ...
     'prototype/foo': ['REQ-x.y'],
     'prototype/foo/bar': ['REQ-x.z']
   }
   // getDesignNote 中追加 'prototype/foo': '设计说明...'
   ```

5. **访问验证**：浏览器打开 `http://localhost:8087/#/prototype/foo` 与 `http://localhost:8087/#/prototype/foo/bar`。

> 若新增的原型页包含 Mermaid 图表，`router._initMermaid()` 会自动检测并渲染，无需额外处理。

### 10.3 新增数据文件

以新增 `assets/data/foo.json` 为例：

1. **创建 JSON 文件**：在 `assets/data/` 下新建 `foo.json`，遵循统一的数组结构（每条对象包含 `id` 主键）：

   ```json
   [
     { "id": "foo-001", "name": "示例", "desc": "说明" }
   ]
   ```

2. **构建产物自动复制**：`vite.config.js` 的 `staticCopyPlugin` 已配置复制 `assets/data/` 整个目录到 `dist/assets/data/`，**无需修改构建配置**。

3. **引用方式**：

   - **前端 fetch 加载**（如 `search.js` 加载 `search-index.json`）：

     ```javascript
     const res = await fetch('./assets/data/foo.json');
     const data = await res.json();
     ```

   - **原型页内联引用**：在原型 HTML 中直接写死结构化卡片，或将 JSON 数据嵌入 `<script>` 标签。

4. **搜索索引补充**：若希望该数据被全站搜索命中，将关键条目同步追加到 `assets/data/search-index.json`。

5. **Wrangler 部署**：由于 `wrangler.jsonc` 以源码目录为静态资源根，`assets/data/foo.json` 会被直接发布到 CDN，访问路径为 `/assets/data/foo.json`。

---

## 附：浏览器支持

- Chrome / Edge / Firefox / Safari 最新版
- 需要支持 ES2020+ 的浏览器（`import/export`、`async/await`、可选链等）
- 已通过 `prefers-reduced-motion` 媒体查询尊重无障碍偏好

---

## 附：相关链接

| 资源 | 链接 |
| --- | --- |
| Vite 官网 | https://vitejs.dev/ |
| Cloudflare Pages 文档 | https://developers.cloudflare.com/pages/ |
| Mermaid 文档 | https://mermaid.js.org/ |
| MCP 协议规范 | https://modelcontextprotocol.io/ |
