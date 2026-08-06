# Pro-CoWork 六项功能升级计划

## 概要

1. **会议纪要生成 Skill**: 上传录音 → ASR 转文字(参照 demo/transcribe.py, 参数走 .env) → LLM 生成纪要 → 文字与纪要输出到前端, 可保存到指定会议记录
2. **长任务后台执行**: 任务脱离 HTTP 连接在后台 asyncio 任务中执行, 执行过程(含工具调用)持久化到 DB, 页面切换/关闭不影响; 点击历史任务可回放完整过程(录音文字+纪要)
3. **项目关联默认记忆**: 为 4 个预置智能体 × 每个项目播种高级 PM/开发经理默认记忆(全局旧记忆保留共存), 对话/任务自动注入
4. **工坊增强**: 智能体/技能支持复制、修改、测试; 调试面板输出每步入参/出参; 调试支持上下文记忆(持久调试会话); 记忆维护页支持记忆效果测试; 调试输入框支持 @/#
5. **Emoji/主题色鼠标选择**: 构建器表单图标与颜色改为可视化选择器
6. **新任务发送框 @/#**: 补充对话输入框支持 @/#, 移除 📎文件/⚡技能按钮

## 用户已确认决策

- ASR 依赖: **热安装**(当前容器 pip/apt 安装) **+ 更新 requirements.txt/Dockerfile**(持久化, 未来重建自动包含)
- 旧全局默认记忆: **全局+项目共存**(保留全局 19 条, 再按项目播种)
- 纪要保存: 弹窗内 **覆盖/追加两种都支持**; 且**智能体更新会议记录时, 目标会议已有内容需提醒用户选择覆盖还是追加, 无内容直接更新**

## 现状分析(基于代码探索)

| 模块 | 现状 | 文件 |
|---|---|---|
| ASR 示例 | demo/transcribe.py: pydub 切片(120s) + requests POST paraformer-large, verbose_json 带 segments | [transcribe.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/demo/transcribe.py) |
| 配置 | pydantic-settings 读 pro-cowork/.env; 已有 OPENAI_* | [config.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/config.py), [.env](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/.env) |
| 技能引擎 | SkillEngine.execute: JSON steps 工具链, 支持 {{input.xxx}}/{{results.N.result.xxx}}; 无步骤级入参/耗时记录 | [skill_engine.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/skill_engine.py) |
| 任务执行 | POST /{run_id}/run SSE 在请求生成器内执行 engine.chat, **客户端断开即中断**; 仅落 user/assistant 消息, 工具事件不落库 | [task_runs.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/task_runs.py) |
| 文件上传 | data/task_files/<pid>/<name>, 限 5MB, _read_file 按文本注入提示词 | 同上 L19-L43 |
| AgentEngine | chat() SSE 事件 content/tool_call/tool_result; chat_with_trace() 非流式含每轮 arguments/result/duration | [agent_engine.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/agent_engine.py) |
| 调试端点 | POST /agents/{id}/debug: **history=[] 无上下文, 不落库** | [agents.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/agents.py#L255-L281) |
| 调试面板 | CoworkBuilder.runDebug 每次覆盖输出; SkillBuilder.testRun 仅显示最终 output_data | [cowork.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/cowork.js#L1505-L1543) |
| 记忆 | seed_preset_memories 播种全局(project_id=NULL); 对话/任务按 (pid OR NULL) 注入; 记忆维护页已有项目/类型筛选 | [agent_presets.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/agent_presets.py), [cowork.js](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/web/js/cowork.js#L1902-L2001) |
| 会议接口 | PUT /meetings/{id} 已存在; update_meeting 工具仅覆盖式更新 | [meetings.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/routers/meetings.py), [agent_tools.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/services/agent_tools.py) |
| 容器 | 无 ffmpeg/pydub/httpx; venv 为命名卷(xin-ai-venv); 源码挂载热重载 | [Dockerfile](file:///mnt/data0/ai_deployment/proj/src/xin-ai/Dockerfile), [docker-compose.yml](file:///mnt/data0/ai_deployment/proj/src/xin-ai/docker-compose.yml) |
| 建表 | init_db 用 Base.metadata.create_all, 新模型自动建表 | [database.py](file:///mnt/data0/ai_deployment/proj/src/xin-ai/pro-cowork/app/database.py#L47-L57) |

## 变更明细

### 需求 1: 会议纪要生成 Skill

**后端**

1. **`.env` / `config.py`** — 新增 ASR 配置:
   ```
   ASR_API_URL=http://192.168.1.13:18888/v1/audio/transcriptions
   ASR_API_KEY=SII#gemr#2026!!
   ASR_MODEL=paraformer-large
   ASR_CHUNK_MS=120000
   ```
   config.py Settings 增加对应 4 个字段。

2. **依赖**:
   - `pro-cowork/requirements.txt` += `pydub`, `httpx`
   - `Dockerfile` apt 行 += `ffmpeg`
   - 当前容器热安装: `docker exec xin-ai /app/venv/bin/pip install pydub httpx` + `docker exec xin-ai apt-get update && apt-get install -y ffmpeg`

3. **新建 `app/services/asr_service.py`**: `async transcribe_audio(file_path) -> dict {text, segments}`
   - 参照 transcribe.py: pydub 加载 → 按 ASR_CHUNK_MS 切片 → 导出 wav 到 /tmp → httpx.AsyncClient POST (model, response_format=verbose_json) → 合并 segments, 全局时间戳偏移 → 返回带 `[mm:ss]` 时间戳的完整文本
   - 单片段失败重试 1 次, 失败则抛出带片段号的错误

4. **新建 `app/services/minutes_service.py`**: `async generate_minutes(transcript) -> str`
   - 复用 settings.OPENAI_* 的 AsyncOpenAI; 提示词: 高级项目经理视角, 输出 会议主题/时间/参会人(如可辨识) + 三段式(会议结论/行动项(负责人+截止时间)/风险与遗留问题)

5. **`skill_engine.py` 扩展**:
   - 步骤新增 `builtin` 类型: `{"builtin": "meeting_minutes", "arguments": {...}}`; BUILTIN_REGISTRY = {"meeting_minutes": fn}
   - `meeting_minutes(db, args)`: 入参 {file_name, project_id} → 定位 data/task_files/<pid>/<file> → transcribe_audio → generate_minutes → 返回 {file, transcript, minutes}
   - 每步记录 `arguments`(解析后) 与 `duration_ms`, 附在 context["results"] 各条目上 (供需求 4 调试面板展示入参/出参)

6. **`skill_presets.py`**: 新预置技能「会议纪要生成」(icon 📑, category workflow):
   ```json
   {"steps":[{"builtin":"meeting_minutes","arguments":{"file_name":"{{input.file_name}}","project_id":"{{input.project_id}}"}}]}
   ```

7. **`task_runs.py` 上传放宽**: MAX_FILE_SIZE → 200MB; 音频扩展名(.mp3/.wav/.m4a/.ogg/.flac/.aac) _read_file 返回 ""; _build_prompt 对音频文件注入 `【录音文件】<name> (音频, 请通过「会议纪要生成」技能处理, file_name=<name>)`

**前端** (cowork.js/api.js)

8. 执行输出窗口: tool_result 事件渲染时, 若 result 含 transcript/minutes 字段, 分两个折叠区块展示(🗣 录音文字 / 📑 会议纪要)
9. 输出卡片标题栏加「📥 保存到会议记录」按钮(任务完成后可用): 弹窗列出该 run 项目的会议(下拉) + 取最近一条 assistant 纪要内容 + 「覆盖纪要」「追加到纪要」两按钮 → PUT /meetings/{id} {description: 新内容 或 旧内容+"\n\n---\n"+新内容}

### 需求 2: 长任务后台执行 + 过程持久化 + 回放

**后端**

1. **新建模型 `app/models/task_run.py` 增加 `TaskRunEvent`**: id, run_id(FK cascade), seq(int), type(content/tool_call/tool_result/error/done), name(工具名,可空), payload(JSONB), created_at; models/__init__ 注册 → create_all 自动建表

2. **新建 `app/services/task_runner.py` — 后台执行管理器**:
   ```python
   class TaskRunner:
       _tasks: dict[int, asyncio.Task]   # run_id -> 后台任务
       async def start(self, run_id, mode, payload=None)  # mode: run|continue
   ```
   - 用独立 `AsyncSessionLocal()` 执行(请求会话随响应关闭)
   - 逐事件写 TaskRunEvent (content 按 LLM 段落聚合, tool_call/tool_result 单条), 每事件 commit
   - user/assistant 消息照旧写 AgentMessage; 结束更新 run.status/result_text
   - run.status=='running' 时重复启动返回 409
   - 内存队列 `dict[run_id, list[asyncio.Queue]]` 供 SSE 实时订阅

3. **`task_runs.py` 改造**:
   - POST /{run_id}/run 与 /{run_id}/continue: 校验+准备(建会话/写 user 消息)后 `await task_runner.start(...)`, 立即返回 {ok, run_id, status:"running"}
   - 新 GET `/{run_id}/events?after_seq=0` (SSE): 先按 seq 重放 DB 事件, 若 run 仍 running 则订阅内存队列 tail 新事件, 直到 done/failed 事件后关闭; 支持断线重连(EventSource 自动重连带 after_seq)

**前端**

4. `api.js`: `startTaskRun(id)`(POST run) / `continueTaskRun(id, payload)`(POST continue) / `streamTaskEvents(id, afterSeq, handlers)`(EventSource)
5. `cowork.js` TaskCenter:
   - createAndRun/sendFollowup: POST 启动 → 打开 events SSE 渲染
   - showRunResult: GET /{run_id}/events(普通 GET 全量或 SSE after_seq=0) 渲染完整过程(user 消息 + tool_call/tool_result 折叠 trace + content 气泡); 若 run.status=='running' 继续 tail
   - 页面重新打开后点击历史任务即可看到录音文字与纪要(来自持久化事件)

### 需求 3: 项目关联默认记忆

1. `agent_presets.py` `seed_preset_memories` 改造:
   - 保留现有全局播种(project_id=NULL)逻辑
   - 新增: 对每个 Project × 每个预置 Agent 播种同套 DEFAULT_MEMORIES(project_id=项目ID), 幂等键 (agent_id, project_id, key), 已存在则同步内容
2. `projects.py` create_project: 新项目 flush 后调用单项目播种函数 `seed_project_memories(db, project_id)`
3. 对话(agents.py L208-L221)/任务(task_runs.py _load_memories)已按 (pid OR NULL) 注入 → 无需改动, 自动生效
4. 记忆维护页已支持项目筛选查看

### 需求 4: 工坊 复制/修改/测试 + 调试上下文 + 详细步骤 + 记忆测试 + @/#

**后端**

1. `agents.py` 调试端点改造(上下文记忆):
   - POST `/{agent_id}/debug`: 查找/创建该 Agent 的调试会话(AgentSession, status="debug", title="调试会话"), 加载其历史消息(最近20条)调用 chat_with_trace; 每轮 debug 将 user+assistant 消息落库到调试会话 → 下次调试自带上下文(如先"创建会议"后"保存纪要"会更新同一会议)
   - 响应增加 `memories_used`(注入的记忆 [{type,key,content}]) 与 `debug_session_id`
   - 新 POST `/{agent_id}/debug/reset`: 归档调试会话(上下文清零)
   - 会话列表接口 `GET /{agent_id}/sessions` 排除 status="debug" 的会话(不污染正式会话列表)
2. `agent_tools.py` update_meeting 增强(用户补充决策):
   - 增加可选参数 `mode`: "overwrite"(默认) | "append"(description 追加到现有内容后)
   - 会议管理助手 preset 提示词补充: "更新会议记录前先用 get_meeting_detail 检查现有纪要; 已有内容时必须询问用户选择覆盖还是追加, 用户确认后调用 update_meeting(mode=...); 无内容则直接更新"
3. `skills.py` + `skill_engine.py`(技能测试详细步骤):
   - SkillEngine.execute 每步记录 resolved arguments + duration_ms(见需求1.5)
   - POST `/skills/{id}/test`: 不落 SkillExecution 库, 入参 {input_data, prior_results?}; prior_results 合并进 context["results"] 头部(支持 {{results.N}} 引用上一次输出 → 技能调试上下文); 返回 {status, duration_ms, steps:[{step,tool|builtin,arguments,result,duration_ms}], output}

**前端**

4. 复制功能(纯前端, 无需后端):
   - CoworkAgents 列表卡片加「复制」按钮: 取该 agent 数据 → CoworkBuilder.openCreate 预填(name+" 副本") → 保存即新建
   - CoworkSkills 列表卡片同样 → SkillBuilder.openCreate 预填
5. 智能体调试面板(CoworkBuilder):
   - 输出改为**累积模式**(每轮调试结果 append, 顶部显示 #N 轮次), 不再覆盖
   - 每轮展示: 模型/耗时、注入记忆明细(可展开, 来自 memories_used)、每轮 LLM content、每个工具调用 入参 arguments + 出参 result + duration_ms
   - 头部加「🗑 清空上下文」按钮 → POST debug/reset → 清空输出区
   - debug-input 绑定 MentionBox(@ 项目 / # 智能体·技能·工具 / / 记录)
6. 技能测试面板(SkillBuilder):
   - testRun 改调 /skills/{id}/test; 展示每步 tool/builtin + 入参 + 出参 + 耗时
   - 自动携带上一次执行的 results 作为 prior_results(面板上显示"已附带上次结果"标识 + 清除按钮)
7. 记忆维护页(CoworkMemories)新增「🧪 记忆测试」区:
   - 输入消息 → POST /agents/{当前筛选agent}/debug → 展示 memories_used(哪些记忆被注入) + reply + trace
   - 输入框绑定 MentionBox

### 需求 5: Emoji/主题色鼠标选择

1. cowork.js 新增两个通用小组件(供 CoworkBuilder 与 SkillBuilder 共用):
   - EmojiPicker: 图标输入框右侧「😀 选择」按钮 → 弹出网格(~48 个常用 emoji: 🤖📊📋📝📅⚡⏰📑🔧📁✅★🎯🚀…) 点击填入输入框
   - ColorPicker: 颜色输入框改为「色板(12 预设色块) + <input type=color> 自定义」组合, 点击色块填入
2. bf-icon/bf-color(CoworkBuilder.renderForm) 与 sf-icon/sf-color(SkillBuilder.renderForm) 接入
3. cowork.css: .emoji-pop/.color-pop 弹层网格样式(复用 mention-popup 风格)

### 需求 6: 新任务发送框 @/# + 移除文件/技能按钮

1. cowork.js TaskCenter.render:
   - 移除 fc-toolbar(📎文件/⚡技能按钮)与 fc-picker 相关 DOM/逻辑(togglePicker、renderFollowupChips 中技能/文件 chips 区)
   - fc-input 绑定 MentionBox(getProjectId: () => this.currentProjectId()) → 支持 @/ / #
   - sendFollowup 不再携带 file_names/skill_ids(后端 TaskRunContinue 字段保留不动)
   - updateFollowupState 中相关按钮引用清理
2. cowork.css: 清理 .fc-toolbar/.fc-picker 样式(可选保留无影响)

## 假设与决策

- 「文件和激励按钮」= 补充对话区的 📎文件 / ⚡技能 按钮(# 已涵盖技能引用, 文件在任务创建时上传)
- 任务事件用新表 task_run_events, init_db create_all 自动建表, 无需迁移脚本
- 后台任务为单进程 asyncio 方案(当前单 uvicorn worker, 满足开发/单机部署); 服务重启时 running 任务启动后一次性巡检置为 failed("服务重启中断")
- 调试会话 status="debug" 复用现有字段, 不动表结构
- ASR 服务 192.168.1.13:18888 需容器网络可达; 不可达时技能返回明确错误信息(转录失败: 连接异常)
- 音频文件不注入提示词文本, 仅注入文件名提示, 由技能读取文件处理
- 会议纪要的"保存到会议记录"入口放在任务输出卡片, 取最近一条 assistant 输出

## 验证步骤

1. **ASR 依赖**: 容器内 `ffmpeg -version` 与 `pip show pydub httpx` 可用
2. **会议纪要 Skill**: 上传测试音频 → 新任务(会议管理助手+会议纪要生成技能)执行 → events 中出现 transcript+minutes → 前端两个折叠区展示 → 「保存到会议记录」分别验证覆盖/追加 → GET /meetings/{id} 确认
3. **后台执行**: 启动任务后立即关闭 SSE(kill curl) → 轮询 GET /task-runs/{id} 直至 status=done → GET events 完整; 浏览器执行任务中切换视图/刷新页面 → 回来点历史任务看到全过程
4. **项目记忆**: 服务重载后 GET /agents/{1..4}/memories?project_id={各项目} 均有默认记忆; 新建项目后自动有; debug 回复体现记忆内容(如提及"里程碑必须有验收标准")
5. **调试上下文**: 会议管理助手调试面板输入"创建一个明天9点的项目例会"→运行; 再输入"把纪要保存到刚才的会议"→运行 → 验证更新的是同一会议(非随机记录); 已有纪要时 agent 询问覆盖/追加; 清空上下文后不再记得
6. **技能测试**: 延期任务扫描连续两次测试, 第二次引用 {{results.0}} 生效; 每步入参/出参/耗时可见
7. **复制/选择器**: 复制智能体生成"xx 副本"; emoji/颜色点击选择生效并保存
8. **发送框**: fc-input 输入 @/# 弹层正常; 文件/技能按钮已移除
9. **回归**: 智能体对话、新会话/删除会话、/ 记录引用、任务创建执行 原有功能正常
