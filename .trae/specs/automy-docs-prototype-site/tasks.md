# Automy 文档与产品原型静态网站 · 任务清单

> Change-ID: `automy-docs-prototype-site`
> 原则：小步可验证、文档与原型分离、组件复用、依赖清晰。

---

## M1 站点骨架与视觉规范

- [x] Task 1: 搭建静态站点工程骨架
  - [x] SubTask 1.1: 初始化目录结构（index.html / assets / docs / prototype / shared / 404.html）
  - [x] SubTask 1.2: 配置 Vite 开发服务器（仅静态打包，不引入框架运行时）
  - [x] SubTask 1.3: 配置 Cloudflare Pages 部署（wrangler.toml + 部署脚本）
  - [x] SubTask 1.4: 编写本地预览与部署说明 README

- [x] Task 2: 建立全局视觉规范与基础组件
  - [x] SubTask 2.1: 品牌视觉（Automy 奥托迈 文字 Logo、主色、字体栈、深浅色 CSS 变量）
  - [x] SubTask 2.2: 顶栏 + 侧边导航 + 面包屑组件
  - [x] SubTask 2.3: 通用组件：按钮、卡片、表格、标签、提示框、折叠块、代码块、Mermaid 容器
  - [x] SubTask 2.4: Hash 路由与主题切换（localStorage 持久化）

- [x] Task 3: 实现首页
  - [x] SubTask 3.1: Hero 区（品牌、一句话定位、CTA 进入文档/原型）
  - [x] SubTask 3.2: 核心能力卡片（长期陪伴 / 技能市场 / 专家市场 / MCP / 安全合规）
  - [x] SubTask 3.3: 价值主张与场景区（投资公司典型场景）

## M2 需求文档区（全 12 模块）

- [x] Task 4: 建立需求文档框架与条目化模板
  - [x] SubTask 4.1: 左侧可折叠目录 + 右侧正文 + 顶部需求条目卡组件
  - [x] SubTask 4.2: 需求条目模板（编号 / 标题 / 正文 / 场景 / 优先级 / 关联原型 / 关联架构 链接）
  - [x] SubTask 4.3: 锚点与"一键复制链接"

- [x] Task 5: 撰写需求文档各模块（可并行）
  - [x] SubTask 5.1: 概述与目标
  - [x] SubTask 5.2: 用户与组织管理（REQ-1.x）
  - [x] SubTask 5.3: 长期记忆与用户画像（REQ-2.x）
  - [x] SubTask 5.4: 智能体编排引擎 Eino ADK（REQ-3.x）
  - [x] SubTask 5.5: 技能系统（REQ-4.x）
  - [x] SubTask 5.6: 技能公共市场（REQ-5.x）
  - [x] SubTask 5.7: 专家 Agent 市场（REQ-6.x）
  - [x] SubTask 5.8: MCP 服务集成层（REQ-7.x）
  - [x] SubTask 5.9: 知识库与 RAG（REQ-8.x）
  - [x] SubTask 5.10: 安全与合规（REQ-9.x）
  - [x] SubTask 5.11: 前端与多端入口（REQ-10.x）
  - [x] SubTask 5.12: 非功能性需求

## M3 技术架构文档区（含 Eino ADK 专题）

- [x] Task 6: 建立架构文档框架
  - [x] SubTask 6.1: 章节目录 + 图表容器（Mermaid）+ 代码块高亮
  - [x] SubTask 6.2: 章节内锚点与跨链（与需求条目互链）

- [x] Task 7: 撰写架构文档各章节（可并行）
  - [x] SubTask 7.1: 总体架构（分层图、部署形态）
  - [x] SubTask 7.2: 技术栈选型表（更新为 Eino ADK）
  - [x] SubTask 7.3: 智能体编排引擎设计 Eino ADK 专题（角色、组件、与技能/专家/MCP/记忆集成、与模型网关对接、选型对比）
  - [x] SubTask 7.4: 模型网关设计
  - [x] SubTask 7.5: 长期记忆与画像存储设计
  - [x] SubTask 7.6: 知识库与 RAG 设计
  - [x] SubTask 7.7: MCP 集成层设计（Adapter 框架、网关、服务目录）
  - [x] SubTask 7.8: 安全合规架构
  - [x] SubTask 7.9: 部署架构（私有化 / K8s / 离线镜像）
  - [x] SubTask 7.10: 可观测性设计

- [x] Task 8: 绘制架构图表（Mermaid）
  - [x] SubTask 8.1: 分层总体架构图
  - [x] SubTask 8.2: Agent 编排时序图（Eino ADK 视角）
  - [x] SubTask 8.3: MCP 调用流程图
  - [x] SubTask 8.4: 记忆写入流水线图
  - [x] SubTask 8.5: 部署拓扑图

## M4 原型 A/B：登录引导 + 对话工作台及侧边栏

- [x] Task 9: 登录与引导原型
  - [x] SubTask 9.1: SSO 登录页（企业账号 + 本地兜底）
  - [x] SubTask 9.2: 首次进入引导页（连接 MCP / 订阅专家 / 安装技能）

- [x] Task 10: 对话工作台主界面
  - [x] SubTask 10.1: 多会话侧边栏 + 顶部栏 + 主对话区
  - [x] SubTask 10.2: 流式输出样式（消息气泡、工具调用展开、思考链可折叠）
  - [x] SubTask 10.3: 输入框 + 发送 + 中断/追问/回滚按钮（Mock 交互）
  - [x] SubTask 10.4: 预录流式输出动画（点击发送触发）

- [x] Task 11: 工作台侧边栏面板
  - [x] SubTask 11.1: 长期记忆面板（事实/偏好/事件三类，编辑/删除）
  - [x] SubTask 11.2: 我的技能面板（已安装列表、一键启用/停用）
  - [x] SubTask 11.3: 我的专家面板（已订阅专家、切换上下文）
  - [x] SubTask 11.4: 我的连接面板（已连接 MCP、范围、撤销）

## M5 原型 C/D：技能市场 + 专家市场

- [x] Task 12: 技能市场原型
  - [x] SubTask 12.1: 市场首页（分类导航、搜索、卡片瀑布、评分、使用量）
  - [x] SubTask 12.2: 技能详情页（描述、示例输入输出、依赖权限、更新日志、安装按钮）
  - [x] SubTask 12.3: 安装交互（点击安装→状态变为已安装，刷新可重置）

- [x] Task 13: 技能编辑器原型
  - [x] SubTask 13.1: 拖拽节点画布 + 节点属性面板
  - [x] SubTask 13.2: 提示词模板编辑 + 参数 Schema 表单
  - [x] SubTask 13.3: 在线调试面板（样本输入输出）+ 版本回滚

- [x] Task 14: 我的技能管理页
  - [x] SubTask 14.1: 私有/共享/部门共享列表、版本、A/B 测试

- [x] Task 15: 专家市场原型
  - [x] SubTask 15.1: 专家市场首页（专家卡片、领域分类、推荐位）
  - [x] SubTask 15.2: 专家详情页（Persona、绑定技能/MCP/知识库、订阅、评论）
  - [x] SubTask 15.3: 专家个性化微调页（语气调整、追加私有知识）

## M6 原型 E/F：MCP + 知识库

- [x] Task 16: MCP 集成层原型
  - [x] SubTask 16.1: MCP 服务目录页（企业服务列表、能力清单、所需权限）
  - [x] SubTask 16.2: MCP 连接管理页（已连接、授权范围、调用记录、撤销）
  - [x] SubTask 16.3: 单个 MCP 服务详情页（tools/resources/prompts 清单、调用示例、限流配额）

- [x] Task 17: 知识库原型
  - [x] SubTask 17.1: 知识库管理页（文档列表、上传、来源、状态）
  - [x] SubTask 17.2: 文档处理流水线详情页（解析/分块/向量化进度、元数据）
  - [x] SubTask 17.3: 检索测试页（输入查询、结果带来源引用、未命中兜底）

## M7 原型 G/H：用户画像 + 管理后台

- [x] Task 18: 用户画像原型
  - [x] SubTask 18.1: 画像主页（事实/偏好/事件、来源、可信度、编辑/导出/删除）

- [x] Task 19: 管理后台原型
  - [x] SubTask 19.1: 用户与组织管理页
  - [x] SubTask 19.2: 角色与权限管理页
  - [x] SubTask 19.3: 审计日志页（全链路筛选、导出）
  - [x] SubTask 19.4: 模型网关配置页（路由、限流、配额、成本统计）
  - [x] SubTask 19.5: 市场审核页（技能/专家审核、安全扫描结果、下架）
  - [x] SubTask 19.6: 系统配置页（KMS、数据驻留、脱敏规则）

## M8 路线图、术语表、搜索、标注模式

- [x] Task 20: 路线图页面
  - [x] SubTask 20.1: M1~M9 里程碑卡片 + 时间轴/Mermaid 甘特图

- [x] Task 21: 术语表页面
  - [x] SubTask 21.1: 术语 + 中英文 + 定义 + 关联链接 + 字母/分类筛选

- [x] Task 22: 全站搜索
  - [x] SubTask 22.1: 构建期生成索引 JSON（标题+摘要+锚点）
  - [x] SubTask 22.2: 搜索弹窗（Ctrl+K 唤起，前端检索，结果分类）

- [x] Task 23: 原型标注模式
  - [x] SubTask 23.1: 全局开关 + 页面右侧需求条目清单与设计说明
  - [x] SubTask 23.2: 需求条目↔原型页面双向跳转链接

## M9 部署上线

- [x] Task 24: 部署与验收
  - [x] SubTask 24.1: 本地预览通过（vite dev / serve）
  - [~] SubTask 24.2: 部署 Cloudflare Pages 成功
  - [x] SubTask 24.3: 跨浏览器兼容性检查（Chrome/Edge/Safari/Firefox）
  - [x] SubTask 24.4: 响应式适配检查（1280/1440/1920）
  - [x] SubTask 24.5: 性能检查（LCP<2s，JS<50KB）

## M10 IM 通道与会话数据库（本次新增）

- [x] Task 25: 需求文档新增「IM 通道与主动提醒」模块
  - [x] SubTask 25.1: 撰写 docs/requirements/im-notification.html，含 REQ-6.1~6.6（IM 接入/统一通知/主动提醒/模板/双向交互/权限隐私）
  - [x] SubTask 25.2: 在需求总览 overview.html 增补该模块导航条目

- [x] Task 26: 需求文档新增「会话数据库设计」模块
  - [x] SubTask 26.1: 撰写 docs/requirements/session-data.html，含 REQ-7.1~7.4（数据模型/跨端续接/检索归档/数据架构文档要求）

- [x] Task 27: 架构文档新增「会话数据库设计」章节
  - [x] SubTask 27.1: 撰写 docs/architecture/session-store.html，含 ER 图（Session/Message/SessionEvent/SessionParticipant/PushRecord）、存储分布、索引策略、与记忆系统关系、归档冷存
  - [x] SubTask 27.2: 在架构总览 overview.html 增补章节链接

- [x] Task 28: 架构文档新增「IM 通道集成架构」章节
  - [x] SubTask 28.1: 撰写 docs/architecture/im-channels.html，含通道接入架构图、统一通知服务、主动提醒引擎时序、双向交互回调流程、降级与节流、安全审计（Mermaid 至少 3 图）

- [x] Task 29: 原型新增「通知中心与 IM 通道」模块
  - [x] SubTask 29.1: prototype/notifications/index.html 通知中心（站内通知列表、未读、分类、跳转会话）
  - [x] SubTask 29.2: prototype/im-channels/index.html IM 通道配置（企业微信/飞书/钉钉 接入状态、授权、试发）
  - [x] SubTask 29.3: prototype/im-channels/template-editor.html 通知模板编辑器（触发条件/渠道/变量插值/试发预览）
  - [x] SubTask 29.4: prototype/im-channels/reminder-rules.html 主动提醒规则编排页（场景/触发/节流/渠道）
  - [x] SubTask 29.5: 在应用侧边栏导航增加"通知中心"与"IM 通道"入口，工作台会话列表支持显示来源渠道（Web/飞书/企微）

- [x] Task 30: 更新搜索索引与标注模式
  - [x] SubTask 30.1: search-index.json 增补新增 8 个页面与新增 REQ-6.x/7.x 条目
  - [x] SubTask 30.2: prototype.js 标注模式 pageRequirements 增补新增原型页与需求映射

---

# Task Dependencies（依赖关系）

- Task 1（工程骨架）→ 所有后续任务前置
- Task 2（视觉规范与组件）→ 所有原型与文档页面前置
- Task 3（首页）→ 依赖 Task 2
- Task 4（需求文档框架）→ 依赖 Task 2；Task 5 各模块依赖 Task 4
- Task 6（架构文档框架）→ 依赖 Task 2；Task 7 各章节依赖 Task 6；Task 8（图表）依赖 Task 7
- Task 9~19（原型各模块）→ 依赖 Task 2；可按 M 分组并行
- Task 23（标注模式）→ 依赖 Task 4（需求条目编号）与原型页面完成
- Task 22（搜索）→ 依赖文档与原型内容基本完成
- Task 24（部署）→ 依赖前述全部完成

# 可并行任务组
- M2 Task 5 各需求模块子任务可并行
- M3 Task 7 各架构章节子任务可并行
- M4~M7 各原型模块之间无强依赖，可多组并行推进
- Task 8 架构图可与 Task 7 章节并行
