# Tasks

- [x] Task 1: 初始化项目骨架
  - [x] SubTask 1.1: 创建 `run.py`、`app/__init__.py`、`app/config.py`、`app/database.py`（复用 pro-site 架构，端口 8089）
  - [x] SubTask 1.2: 创建 `app/main.py`（FastAPI 应用 + lifespan + 静态文件挂载 + CORS）
  - [x] SubTask 1.3: 创建 `.env`（复用 pro-site 的 PostgreSQL 连接，端口 11000）
  - [x] SubTask 1.4: 创建 `web/index.html` 骨架（三栏布局：侧导航 / 主工作区 / 右栏详情）
  - [x] SubTask 1.5: 创建 `web/css/style.css`（设计令牌 + 基础组件样式，参照 pro-site 风格）
  - [x] SubTask 1.6: 创建 `web/js/app.js`（应用入口 + 路由 + 通用工具函数）

- [x] Task 2: 数据模型与 Schema
  - [x] SubTask 2.1: 创建 `app/models/word.py` — Word 模型（id, english, phonetic, definition, example, unit_id, sort_order, status[new/learning/mastered], consecutive_passes, created_at）
  - [x] SubTask 2.2: 创建 `app/models/unit.py` — Unit 模型（id, name, description, sort_order, created_at）+ relationship to words
  - [x] SubTask 2.3: 创建 `app/models/review.py` — ReviewSchedule 模型（id, word_id, unit_id, interval_index[0-7], scheduled_at, completed_at, mark[pass/struggle/fail], status[pending/done/skipped]）
  - [x] SubTask 2.4: 创建 `app/models/__init__.py` 注册所有模型
  - [x] SubTask 2.5: 创建 `app/schemas/` 下 word.py、unit.py、review.py（Create/Update/Out schemas）

- [x] Task 3: API 路由 — 单词与单元管理
  - [x] SubTask 3.1: 创建 `app/routers/words.py` — GET 列表、GET 详情、POST 创建、PUT 更新、DELETE 删除、POST 批量导入
  - [x] SubTask 3.2: 创建 `app/routers/units.py` — GET 列表（含单词）、POST 创建、PUT 更新、DELETE 删除
  - [x] SubTask 3.3: 在 `app/main.py` 注册路由

- [x] Task 4: API 路由 — 复习引擎
  - [x] SubTask 4.1: 创建 `app/routers/review.py` — POST start-learning（触发 8 点计划生成）
  - [x] SubTask 4.2: GET today-reviews（获取今日到期复习 + 补测项，按到期时间排序）
  - [x] SubTask 4.3: POST mark-review（标记 ✓/△/★，自动调整后续计划）
  - [x] SubTask 4.4: GET review-stats（仪表盘统计数据）
  - [x] SubTask 4.5: GET stubborn-words（顽固词本列表）

- [x] Task 5: 前端 — 仪表盘页面
  - [x] SubTask 5.1: 创建 `web/js/dashboard.js` — 统计卡片（今日待复习 / 今日新学 / 已掌握 / 顽固词）
  - [x] SubTask 5.2: 7 日复习趋势（用 CSS 柱状图，不引入图表库）
  - [x] SubTask 5.3: 快捷入口按钮（开始复习 / 学习新词）

- [x] Task 6: 前端 — 单词库管理页面
  - [x] SubTask 6.1: 创建 `web/js/words.js` — 单词列表（表格 + 搜索 + 筛选状态）
  - [x] SubTask 6.2: 单词 CRUD（contenteditable 行内编辑 + 弹窗新建）
  - [x] SubTask 6.3: 批量导入弹窗（粘贴文本解析预览）
  - [x] SubTask 6.4: 单元管理（创建单元、关联单词、排序）

- [x] Task 7: 前端 — 复习页面（核心交互）
  - [x] SubTask 7.1: 创建 `web/js/review.js` — 复习卡片界面（先隐藏释义，点击显示后出标记按钮）
  - [x] SubTask 7.2: 三轮模式切换（晨间 / 午间 / 睡前），每轮展示不同内容
  - [x] SubTask 7.3: 标记交互（✓/△/★ 按钮 → 调用 API → 自动切到下一张卡）
  - [x] SubTask 7.4: 复习优先级提示（有到期复习时阻止新词学习入口）
  - [x] SubTask 7.5: 复习完成总结页（本次复习数 / 通过率 / 顽固词数）

- [x] Task 8: 前端 — 新词学习页面
  - [x] SubTask 8.1: 创建 `web/js/learn.js` — 选择单元 → 按 10 词分页学习
  - [x] SubTask 8.2: 学习卡片（英文 + 音标 + 释义 + 例句），背完一页遮释义回忆
  - [x] SubTask 8.3: 学习完成 → 触发 start-learning API 生成 8 点复习计划

- [x] Task 9: 前端 — 顽固词本页面
  - [x] SubTask 9.1: 创建 `web/js/stubborn.js` — 顽固词列表（标 ★ 的单词）
  - [x] SubTask 9.2: 快速复习入口（只复习顽固词）

- [x] Task 10: 断更恢复与边界处理
  - [x] SubTask 10.1: 后端 today-reviews 自动合并过期节点到今日
  - [x] SubTask 10.2: 前端展示补测提示「你有 N 个补测项」
  - [x] SubTask 10.3: 连续 3 周期通过 → 自动标记 mastered

- [x] Task 11: PDF 导出与收尾
  - [x] SubTask 11.1: 引入 html2pdf.js CDN
  - [x] SubTask 11.2: 今日复习清单导出 PDF
  - [x] SubTask 11.3: 单元单词表导出 PDF
  - [x] SubTask 11.4: 端到端验证全部功能

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 2]
- [Task 5] depends on [Task 1]
- [Task 6] depends on [Task 1, Task 3]
- [Task 7] depends on [Task 1, Task 4]
- [Task 8] depends on [Task 1, Task 3, Task 4]
- [Task 9] depends on [Task 1, Task 4]
- [Task 10] depends on [Task 4, Task 7]
- [Task 11] depends on [Task 5, Task 6, Task 7, Task 8, Task 9]
- 可并行: Task 3 与 Task 4（都依赖 Task 2）; Task 5/6/7/8/9 在 Task 1 完成后可部分并行
