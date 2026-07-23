# 《有机系统》任务清单

> Change-ID: `enterprise-agent-platform`
> 原则：小步可验证、依赖清晰、可并行任务标注。

---

## M1 平台基座（认证 / 组织 / 对话 / 模型网关 / 基础记忆）

- [ ] Task 1: 搭建项目工程骨架与基础设施
  - [ ] SubTask 1.1: 初始化 monorepo（前端 Web / Electron / 后端 / MCP adapters / 部署脚本）
  - [ ] SubTask 1.2: 编写 Docker Compose 本地开发栈（PostgreSQL / Redis / MinIO / Milvus / Keycloak）
  - [ ] SubTask 1.3: 搭建 CI（lint / test / build）与代码规范

- [ ] Task 2: 实现用户与组织管理服务
  - [ ] SubTask 2.1: 接入 Keycloak，完成 OIDC/SSO 登录与本地兜底账号
  - [ ] SubTask 2.2: 组织架构同步（LDAP/SCIM 适配）与角色（employee/skill-author/admin/auditor）
  - [ ] SubTask 2.3: RBAC + ABAC 权限中间件与部门隔离策略

- [ ] Task 3: 实现模型网关
  - [ ] SubTask 3.1: 多模型路由抽象（自部署 Qwen/DeepSeek/GLM + 商用 API）
  - [ ] SubTask 3.2: 限流、配额、成本统计、调用日志
  - [ ] SubTask 3.3: 健康检查与降级策略

- [ ] Task 4: 实现对话服务与短期记忆
  - [ ] SubTask 4.1: 对话 API（多会话、流式输出 SSE/WebSocket）
  - [ ] SubTask 4.2: 短期记忆（滑动窗口 + 摘要压缩，Redis）
  - [ ] SubTask 4.3: 中断、追问、回滚某一步重试

- [ ] Task 5: 实现 Agent 编排引擎基座
  - [ ] SubTask 5.1: 任务规划（Plan→Act→Observe→Reflect）状态机
  - [ ] SubTask 5.2: 工具调用（Function Calling / ReAct）
  - [ ] SubTask 5.3: Agent 执行 trace 记录（OpenTelemetry）

## M2 技能系统 + 企业内技能市场

- [ ] Task 6: 实现技能定义与存储模型
  - [ ] SubTask 6.1: 技能数据模型（元数据/提示词/参数 Schema/工具/工作流/权限范围）
  - [ ] SubTask 6.2: 技能 CRUD 与版本管理（SemVer）

- [ ] Task 7: 实现低代码技能编辑器
  - [ ] SubTask 7.1: 可视化拖拽工作流 + 提示词模板编辑
  - [ ] SubTask 7.2: 在线调试（样本输入输出）与版本回滚

- [ ] Task 8: 实现技能运行时与沙箱
  - [ ] SubTask 8.1: 技能执行引擎（绑定工具调用）
  - [ ] SubTask 8.2: 代码类步骤隔离沙箱（限制文件/网络/内存）

- [ ] Task 9: 实现企业内技能市场
  - [ ] SubTask 9.1: 发布/审核/下架流程（admin 审核 + 自动安全扫描：提示词注入/恶意代码）
  - [ ] SubTask 9.2: 浏览/检索（分类、关键词+语义搜索、评分、使用量）
  - [ ] SubTask 9.3: 一键安装 + 依赖 MCP 授权提示 + 安装审计

## M3 专家 Agent 市场 + 预置专家

- [ ] Task 10: 实现专家 Agent 模型与运行时
  - [ ] SubTask 10.1: 专家 = Persona + 技能集 + MCP + 知识库 + 记忆策略
  - [ ] SubTask 10.2: 专家订阅、独立长期记忆、个性化微调（语气/私有知识）

- [ ] Task 11: 实现专家市场
  - [ ] SubTask 11.1: 市场浏览/详情/订阅/评论
  - [ ] SubTask 11.2: 运营后台（上下架、推荐位）

- [ ] Task 12: 开发预置专家 Agent（首期 6 个）
  - [ ] SubTask 12.1: 投资分析专家
  - [ ] SubTask 12.2: 法务顾问
  - [ ] SubTask 12.3: HR 助理
  - [ ] SubTask 12.4: 会议纪要专家
  - [ ] SubTask 12.5: 文档摘要专家
  - [ ] SubTask 12.6: 数据查询专家

## M4 MCP 集成层 + 首批企业系统接入

- [ ] Task 13: 实现 MCP Adapter 框架与 SDK
  - [ ] SubTask 13.1: Adapter 模板（暴露 tools/resources/prompts）
  - [ ] SubTask 13.2: 内网纯离线部署支持

- [ ] Task 14: 实现 MCP 网关与服务目录
  - [ ] SubTask 14.1: 服务目录（能力清单、所需权限、数据范围）
  - [ ] SubTask 14.2: 用户主动勾选连接 + 授权范围（只读/读写/数据标签）+ 随时撤销
  - [ ] SubTask 14.3: 统一鉴权、脱敏、审计、限流、配额；写操作二次确认/审批

- [ ] Task 15: 接入首批企业系统 MCP Adapter（各可并行）
  - [ ] SubTask 15.1: OA 系统 Adapter（流程/审批）
  - [ ] SubTask 15.2: CRM Adapter（客户/商机，只读优先）
  - [ ] SubTask 15.3: 文档中心 Adapter（检索/读取）
  - [ ] SubTask 15.4: 数据中台 Adapter（自然语言转 SQL/API）
  - [ ] SubTask 15.5: 邮件/日历 Adapter（读取/日程）

## M5 知识库与 RAG

- [ ] Task 16: 实现文档接入与处理流水线
  - [ ] SubTask 16.1: 多源接入（本地/文档系统 MCP/邮件附件/网页白名单）
  - [ ] SubTask 16.2: 解析（PDF/Word/Excel/PPT/Markdown/OCR）+ 语义分块（保留层级与页码）
  - [ ] SubTask 16.3: 向量化（多 embedding 模型可热切换）+ 元数据标注（部门/密级/来源/时间）

- [ ] Task 17: 实现检索与引用
  - [ ] SubTask 17.1: 混合检索（语义 + 关键词 + 元数据过滤）
  - [ ] SubTask 17.2: 来源引用（文件名+页码，可跳转原文）+ 未命中兜底

## M6 长期记忆与画像强化

- [ ] Task 18: 实现长期记忆库
  - [ ] SubTask 18.1: 事实/偏好/事件三类记忆存储（PG + 向量库）
  - [ ] SubTask 18.2: 记忆写入流水线（LLM 提取→冲突检测→合并/覆盖）
  - [ ] SubTask 18.3: 时间衰减 + 显式纠正 + 主动遗忘 + 读写审计

- [ ] Task 19: 实现用户画像服务与主页
  - [ ] SubTask 19.1: 画像聚合（事实/偏好/事件、来源、可信度）
  - [ ] SubTask 19.2: 画像可视化、手动编辑、导出、删除

## M7 安全合规加固 + 审计

- [ ] Task 20: 数据加密与密钥管理
  - [ ] SubTask 20.1: 传输 TLS1.3 / 存储 TDE+SSE / 向量库加密
  - [ ] SubTask 20.2: 企业自管 KMS（支持 HSM）

- [ ] Task 21: 审计与合规
  - [ ] SubTask 21.1: 全链路审计日志（登录/记忆/技能/MCP/Agent/数据访问）
  - [ ] SubTask 21.2: 审计检索/导出/告警；脱敏规则；数据驻留策略

- [ ] Task 22: 提示词与调用安全
  - [ ] SubTask 22.1: 提示词注入检测、越权调用检测、输出内容安全过滤

## M8 Electron 桌面客户端

- [ ] Task 23: Electron 桌面端
  - [ ] SubTask 23.1: 复用 Web 资源 + 账号/状态同步
  - [ ] SubTask 23.2: 全局快捷键、系统托盘、离线缓存

## M9 前端工作台与管理后台（贯穿各阶段，可与后端并行）

- [ ] Task 24: Web 前端工作台
  - [ ] SubTask 24.1: 对话工作台（多会话、侧边栏：记忆/技能/专家/连接）
  - [ ] SubTask 24.2: 技能市场与专家市场页面
  - [ ] SubTask 24.3: 我的管理台（画像/技能/连接/订阅）
  - [ ] SubTask 24.4: 知识库管理页面

- [ ] Task 25: 管理后台
  - [ ] SubTask 25.1: 用户/组织/角色管理
  - [ ] SubTask 25.2: 审计查看、模型配置、市场审核

## M10 上线与运营

- [ ] Task 26: 部署与运维
  - [ ] SubTask 26.1: K8s 生产部署（高可用 PG/Milvus/MinIO）
  - [ ] SubTask 26.2: 监控（Prometheus/Grafana/Loki）+ 告警
  - [ ] SubTask 26.3: 公共技能/专家市场离线镜像导入

- [ ] Task 27: 验收测试与上线
  - [ ] SubTask 27.1: 性能压测（500 并发会话、首 token P95<1.5s）
  - [ ] SubTask 27.2: 安全渗透测试与修复
  - [ ] SubTask 27.3: 灰度上线与回滚预案

---

# Task Dependencies（依赖关系）

- Task 2（用户/组织）→ 依赖 Task 1（工程骨架）
- Task 3（模型网关）、Task 4（对话）、Task 5（编排引擎）→ 依赖 Task 2、Task 3
- Task 6~9（技能）→ 依赖 Task 5（编排引擎，技能需在引擎上执行）
- Task 10~12（专家）→ 依赖 Task 6（技能模型）、Task 14（MCP 网关）
- Task 13~15（MCP）→ 依赖 Task 2（鉴权）、Task 5（工具调用）
- Task 16~17（知识库/RAG）→ 依赖 Task 3（embedding 经网关）
- Task 18~19（长期记忆/画像）→ 依赖 Task 4（对话，记忆从对话提取）
- Task 20~22（安全合规）→ 可与各阶段并行，但 Task 22 依赖 Task 5、Task 8、Task 14
- Task 23（Electron）→ 依赖 Task 24（Web 前端）
- Task 24~25（前端）→ 与对应后端任务并行开发
- Task 26~27（上线）→ 依赖前述全部完成

# 可并行任务组
- M4 的 Task 15 各子任务（不同系统 Adapter）可并行
- M3 的 Task 12 各专家 Agent 可并行
- M7 与 M2~M6 可并行推进安全基线
