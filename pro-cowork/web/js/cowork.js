/* ==========================================================================
   XIN · CoWork 智能体工作平台前端
   视图: 任务 / 智能体列表 / 对话 / 构建器 / 技能 / 记忆
   依赖: API (api.js), App (app.js), cowork.css
   ========================================================================== */

/* ------------------------------------------------------------------
   对话附件公共组件 (ChatAttach)
   为任意对话输入框提供: ＋上传文件 / Ctrl+V 黏贴图片或文件
   图片→图像识别技能, PDF→文档解析技能, 录音→会议纪要技能 (后端按扩展名指引)
   ------------------------------------------------------------------ */
const ChatAttach = {
  /**
   * 挂载附件能力到输入框所在行
   * @param {HTMLTextAreaElement} textarea 目标输入框
   * @param {Object} opts { getProjectId: () => number|null }
   * @returns {{names(): string[], clear(): void, count(): number}}
   */
  attach(textarea, opts = {}) {
    if (!textarea) return { names: () => [], clear: () => {}, count: () => 0 };
    const row = textarea.parentElement;
    const files = new Set(); // 已上传的文件名

    // 附件 chips 展示区 (插入到输入行之前)
    const chipBox = document.createElement('div');
    chipBox.className = 'attach-chips';
    chipBox.style.display = 'none';
    row.parentElement.insertBefore(chipBox, row);

    // ＋ 按钮与隐藏文件框
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cw-btn cw-btn--sm attach-btn';
    btn.title = '上传附件 (支持 Ctrl+V 黏贴图片/文件)';
    btn.textContent = '＋';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    row.insertBefore(btn, textarea);
    row.appendChild(fileInput);

    const iconOf = (name) => {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return '🖼';
      if (ext === 'pdf') return '📄';
      if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return '🎙';
      return '📎';
    };

    const render = () => {
      chipBox.style.display = files.size ? '' : 'none';
      chipBox.innerHTML = Array.from(files).map(name => `
        <span class="chip chip--file">${iconOf(name)} ${App.escapeHtml(name)}
          <span class="chip__del" data-attach-del="${App.escapeHtml(name)}" title="移除附件">×</span>
        </span>`).join('');
      chipBox.querySelectorAll('[data-attach-del]').forEach(del => {
        del.onclick = () => { files.delete(del.dataset.attachDel); render(); };
      });
    };

    const upload = async (file) => {
      // 黏贴截图等无名文件: 生成唯一文件名 (保留扩展名)
      let name = (file.name || '').split(/[\\/]/).pop();
      if (!name || name === 'image.png' || files.has(name)) {
        const ext = (name.split('.').pop() || 'png').toLowerCase();
        const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        name = `paste_${ts}.${ext}`;
      }
      btn.classList.add('attach-btn--uploading');
      try {
        const pid = opts.getProjectId ? opts.getProjectId() : null;
        const res = await API.uploadTaskFile(new File([file], name, { type: file.type }), pid);
        files.add(res.name || name);
        render();
      } catch (err) {
        App.showToast(`附件上传失败: ${err.message}`, 'error');
      } finally {
        btn.classList.remove('attach-btn--uploading');
      }
    };

    btn.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      for (const f of e.target.files) await upload(f);
      fileInput.value = '';
    };
    textarea.addEventListener('paste', (e) => {
      const pasted = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (!pasted.length) return;
      e.preventDefault();
      pasted.forEach(f => upload(f));
    });

    return {
      names: () => Array.from(files),
      clear: () => { files.clear(); render(); },
      count: () => files.size,
    };
  },
};

/* ------------------------------------------------------------------
   任务视图 (工作台): 项目 × 文件 × 智能体 × 技能 组合执行
   ------------------------------------------------------------------ */
const TaskCenter = {
  projects: [],
  agents: [],
  skills: [],
  files: [],              // 当前项目已上传附件 [{name,size}]
  selectedFiles: new Set(),
  runs: [],
  running: false,
  currentRunId: null,     // 当前输出窗口对应的任务 id
  currentRun: null,       // 当前任务对象 (项目 id 供 / 引用)
  _eventsAbort: null,     // 事件流中止控制器 (切换任务时断开旧流)
  _lastMinutes: '',       // 最近一次工具产出的会议纪要 (优先保存对象)
  _lastReply: '',         // 最近一条助手完整回复 (纪要保存兜底)
  _lastTranscript: '',    // 最近一次工具产出的录音转写原文 (随纪要一并保存)
  _lastAudioFile: '',     // 最近一次处理的原始录音文件名 (随纪要一并保存)

  init() {},

  async onShow() {
    await this.render();
  },

  async render() {
    const el = document.getElementById('view-tasks');
    if (!el) return;
    el.innerHTML = `
      <div class="task-layout">
        <div class="task-left">
          <div class="task-card">
            <div class="task-card__title">📋 新建长任务</div>
            <div class="form-field">
              <label>任务附件</label>
              <div class="chip-box" id="tc-files"></div>
              <div style="margin-top:6px">
                <button class="cw-btn cw-btn--sm tc-plus" id="tc-upload" title="上传文件">＋ 上传文件</button>
                <input type="file" id="tc-file-input" style="display:none">
              </div>
            </div>
            <div class="form-field">
              <label>任务描述</label>
              <textarea id="tc-input" rows="5" placeholder="描述要让智能体完成的任务, 如: 生成 xxx 会议的纪要; 汇总本周进度并识别风险。项目 / 数字分身 / 技能将按描述自动识别, 识别不了会在执行窗口请你选择; 输入 / 引用会议/周报/里程碑/周任务记录, # 选择智能体/技能/工具"></textarea>
            </div>
            <button class="cw-btn cw-btn--primary" id="tc-run" style="width:100%">▶ 创建并执行长任务</button>
          </div>
          <div class="task-card">
            <div class="task-card__title">🕘 历史任务</div>
            <div id="tc-history"></div>
          </div>
        </div>
        <div class="task-right">
          <div class="task-card task-output-card">
            <div class="task-card__title task-output-head">
              <span id="tc-output-title">执行输出</span>
              <button class="cw-btn cw-btn--sm" id="tc-save-minutes" style="display:none"
                title="将生成的会议纪要保存到当前任务的会议记录 (支持覆盖/追加)">📥 保存到会议记录</button>
            </div>
            <div class="task-output" id="tc-output">
              <div class="empty-state">填写任务描述 (可上传附件), 创建并执行任务</div>
            </div>
          </div>
          <div class="task-card task-followup-card" id="tc-followup-card">
            <div class="fc-input-row">
              <textarea id="fc-input" rows="2" placeholder="补充任务内容, 继续让 AI 执行当前任务… 支持 @ 项目 / 记录 # 资源 (Enter 发送, Shift+Enter 换行)"></textarea>
              <button class="cw-btn cw-btn--primary" id="fc-send">发送</button>
            </div>
          </div>
        </div>
      </div>`;

    try {
      [this.projects, this.agents, this.skills] = await Promise.all([
        API.getProjects(), API.getAgents(), API.getSkills(),
      ]);
    } catch (err) {
      App.showToast(`加载基础数据失败: ${err.message}`, 'error');
    }

    document.getElementById('tc-upload').onclick = () => document.getElementById('tc-file-input').click();
    document.getElementById('tc-file-input').onchange = (e) => this.uploadFile(e);
    document.getElementById('tc-run').onclick = () => this.createAndRun();

    // 新任务窗口: 输入 / 引用当前激活项目的 会议/周报/里程碑/周任务 记录
    MentionBox.attach(document.getElementById('tc-input'), {
      getProjectId: () => this.currentProjectId(),
    });

    // 补充对话区: Enter 发送; 支持 @ / # 引用 (项目上下文取当前任务项目)
    document.getElementById('fc-send').onclick = () => this.sendFollowup();
    document.getElementById('tc-save-minutes').onclick = () => this.openSaveMinutes();
    const fcInput = document.getElementById('fc-input');
    fcInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendFollowup();
      }
    });
    MentionBox.attach(fcInput, {
      getProjectId: () => (this.currentRun && this.currentRun.project_id) || this.currentProjectId(),
    });
    // 补充区附件: ＋上传 / Ctrl+V 黏贴 (图片/PDF/录音按类型走对应技能)
    this.fcAttach = ChatAttach.attach(fcInput, {
      getProjectId: () => (this.currentRun && this.currentRun.project_id) || this.currentProjectId(),
    });
    this.updateFollowupState();

    // 重新打开页面: 默认清空历史任务附件 (有任务执行中时跳过, 避免删到其在用文件)
    if (!this.running) {
      this.selectedFiles.clear();
      try { await API.clearTaskFiles(this.currentProjectId()); } catch (err) { /* 忽略 */ }
    }
    await this.loadFiles();
    await this.loadRuns();
  },

  /** 当前项目: 激活项目 (任务项目可由意图识别调整) */
  currentProjectId() {
    const active = this.projects.find(p => p.is_active);
    if (active) return active.id;
    return this.projects.length ? this.projects[0].id : null;
  },

  async loadFiles() {
    const box = document.getElementById('tc-files');
    if (!box) return;
    try {
      this.files = await API.getTaskFiles(this.currentProjectId());
    } catch (err) {
      this.files = [];
    }
    box.innerHTML = this.files.map(f => `
      <span class="chip chip--file ${this.selectedFiles.has(f.name) ? 'chip--on' : ''}" data-file="${App.escapeHtml(f.name)}">
        📄 ${App.escapeHtml(f.name)}
        <span class="chip__del" data-del-file="${App.escapeHtml(f.name)}" title="删除文件">×</span>
      </span>`).join('')
      || '<span style="font-size:12px;color:var(--color-text-tertiary)">暂无附件, 点击下方上传</span>';

    box.querySelectorAll('.chip--file').forEach(chip => {
      chip.onclick = (e) => {
        if (e.target.hasAttribute('data-del-file')) return;
        const name = chip.dataset.file;
        if (this.selectedFiles.has(name)) {
          this.selectedFiles.delete(name);
          chip.classList.remove('chip--on');
        } else {
          this.selectedFiles.add(name);
          chip.classList.add('chip--on');
        }
      };
    });
    box.querySelectorAll('[data-del-file]').forEach(del => {
      del.onclick = async (e) => {
        e.stopPropagation();
        const name = del.dataset.delFile;
        try {
          await API.deleteTaskFile(name, this.currentProjectId());
          this.selectedFiles.delete(name);
          this.loadFiles();
        } catch (err) {
          App.showToast(`删除失败: ${err.message}`, 'error');
        }
      };
    });
  },

  async uploadFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await API.uploadTaskFile(file, this.currentProjectId());
      this.selectedFiles.add(res.name);
      App.showToast(`已上传: ${res.name}`, 'success');
      this.loadFiles();
    } catch (err) {
      App.showToast(`上传失败: ${err.message}`, 'error');
    }
  },

  async loadRuns() {
    const box = document.getElementById('tc-history');
    if (!box) return;
    try {
      this.runs = await API.getTaskRuns({});
    } catch (err) {
      this.runs = [];
    }
    const statusMap = {
      draft: ['待执行', 'badge--gray'],
      running: ['执行中', 'badge--warning'],
      done: ['已完成', 'badge--success'],
      failed: ['失败', 'badge--danger'],
    };
    const agentName = (id) => id == null
      ? '自动识别'
      : ((this.agents.find(a => a.id === id) || {}).name || `Agent#${id}`);
    const projName = (id) => (this.projects.find(p => p.id === id) || {}).name || '—';
    box.innerHTML = this.runs.map(r => {
      const [label, cls] = statusMap[r.status] || [r.status, 'badge--gray'];
      return `
        <div class="task-run-item" data-run-id="${r.id}">
          <div class="task-run-item__main">
            <div class="task-run-item__title">${App.escapeHtml(r.title || '未命名任务')}</div>
            <div class="task-run-item__meta">
              ${App.escapeHtml(projName(r.project_id))} · ${App.escapeHtml(agentName(r.agent_id))}
              · ${App.escapeHtml((r.created_at || '').slice(5, 16).replace('T', ' '))}
            </div>
          </div>
          <span class="badge ${cls}">${label}</span>
          <span class="task-run-item__del" data-del-run="${r.id}" title="删除">×</span>
        </div>`;
    }).join('') || '<div class="empty-state">暂无任务记录</div>';

    box.querySelectorAll('.task-run-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.hasAttribute('data-del-run')) return;
        const run = this.runs.find(r => r.id === parseInt(item.dataset.runId, 10));
        if (run) this.showRunResult(run);
      };
    });
    box.querySelectorAll('[data-del-run]').forEach(del => {
      del.onclick = async (e) => {
        e.stopPropagation();
        try {
          await API.deleteTaskRun(parseInt(del.dataset.delRun, 10));
          this.loadRuns();
        } catch (err) {
          App.showToast(`删除失败: ${err.message}`, 'error');
        }
      };
    });
  },

  /** 用户消息显示文本: 组装消息含【附件】【指定技能】段, 截取首段并标注 */
  displayUserText(content) {
    if (!content) return '(附件任务)';
    const idx = content.indexOf('\n\n【');
    if (idx === -1) return content;
    const head = content.slice(0, idx) || '(附件任务)';
    const extras = [];
    const fileMatch = content.match(/【附件 ([^】]+)】/g);
    if (fileMatch) extras.push(fileMatch.map(t => t.replace(/【附件 |】/g, '📄')).join(' '));
    if (content.includes('【指定技能】')) extras.push('⚡ 已指定技能');
    return extras.length ? `${head}\n(${extras.join(' · ')})` : head;
  },

  /** 追加一条对话气泡到输出窗口 */
  appendChatMsg(out, role, html) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg--${role}`;
    div.innerHTML = `<div class="chat-msg__avatar">${role === 'user' ? '👤' : '🤖'}</div><div class="chat-msg__body">${html}</div>`;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
    return div;
  },

  /** 点击历史任务: 回放执行过程事件 (含实时 tail), 并设为当前对话任务 */
  async showRunResult(run) {
    this.currentRunId = run.id;
    this.currentRun = run;
    this.renderRunEvents(run);
  },

  /** 停止当前事件流订阅 (切换任务/补充对话重渲染前调用) */
  stopEvents() {
    if (this._eventsAbort) {
      this._eventsAbort.abort();
      this._eventsAbort = null;
    }
  },

  /**
   * 渲染任务执行事件流: 先重放持久化事件, 任务执行中则实时 tail
   * 页面切换/关闭不影响后台执行; 重进点击历史任务即可看到完整过程
   * (含录音转写文字与生成的会议纪要), 并可继续对话 (如保存纪要到指定会议)
   */
  async renderRunEvents(run) {
    this.stopEvents();
    this.currentRunId = run.id;
    this.currentRun = run;
    this.running = run.status === 'running';
    this._lastMinutes = '';
    this._lastReply = '';
    this._lastTranscript = '';
    this._lastAudioFile = '';
    this.updateFollowupState();
    this.updateSaveBtn();

    document.getElementById('tc-output-title').textContent =
      `执行输出 · ${run.title || ''}${this.running ? ' (执行中…)' : ''}`;
    const out = document.getElementById('tc-output');
    out.innerHTML = '<div class="empty-state">加载执行过程…</div>';

    const ctrl = new AbortController();
    this._eventsAbort = ctrl;

    // 渲染状态: 连续 content 事件聚合到同一个回复气泡
    let started = false;
    let replyBody = null;
    let replyText = '';
    let lastTrace = null;
    let asrBlock = null;      // 实时转写块 (asr_segment 事件聚合)
    let minutesBlock = null;  // 流式纪要块 (minutes_delta 事件聚合)
    let digestBlock = null;   // 流式周工作小结块 (digest_delta 事件聚合)
    let intentTrace = null;   // 意图识别块 (start/done 合并更新)

    const ensureReply = () => {
      if (!replyBody) {
        const div = this.appendChatMsg(out, 'assistant', '');
        replyBody = div.querySelector('.chat-msg__body');
      }
      return replyBody;
    };

    try {
      await API.streamGet(`/task-runs/${run.id}/events`, (event) => {
        if (!started) { out.innerHTML = ''; started = true; }
        if (event.type === 'user') {
          if (replyText) this._lastReply = replyText; // 新一轮开始前冻结上一条完整回复
          replyBody = null; replyText = ''; lastTrace = null;
          asrBlock = null; minutesBlock = null; digestBlock = null; intentTrace = null;
          this.appendChatMsg(out, 'user',
            App.escapeHtml(this.displayUserText(event.payload.content)).replace(/\n/g, '<br>'));
        } else if (event.type === 'intent') {
          // 意图识别过程: 项目/数字分身/技能 自动识别结果 (start/done 合并为同一块)
          replyBody = null; replyText = ''; lastTrace = null;
          const p = event.payload;
          if (p.stage === 'start') {
            intentTrace = this.appendTrace(out, '意图识别', '进行中');
            intentTrace.querySelector('.chat-trace__head span:first-child').textContent = '🧭';
            intentTrace.classList.add('open');
            intentTrace.querySelector('.chat-trace__body').innerHTML =
              `<div class="intent-line">${App.escapeHtml(p.content || '')}</div>`;
          } else if (p.stage === 'done') {
            const projName = (this.projects.find(x => x.id === p.project_id) || {}).name
              || (p.project_id ? `项目#${p.project_id}` : '未识别');
            const agentName = p.agent_id != null
              ? ((this.agents.find(a => a.id === p.agent_id) || {}).name || `Agent#${p.agent_id}`)
              : '未识别 (请在下方选择)';
            const skillNames = (p.skill_ids || [])
              .map(id => (this.skills.find(s => s.id === id) || {}).name || `技能#${id}`);
            const trace = intentTrace || this.appendTrace(out, '意图识别', '');
            intentTrace = trace;
            trace.querySelector('.chat-trace__head span:first-child').textContent = '🧭';
            trace.classList.add('open');
            const badge = trace.querySelector('.chat-trace__badge');
            badge.textContent = p.agent_id != null ? '完成' : '未命中';
            trace.querySelector('.chat-trace__body').innerHTML = `
              <div class="intent-line">📁 项目: ${App.escapeHtml(projName)}</div>
              <div class="intent-line">🤖 数字分身: ${App.escapeHtml(agentName)}</div>
              <div class="intent-line">⚡ 技能: ${skillNames.length ? App.escapeHtml(skillNames.join('、')) : '未指定'}</div>
              ${p.reason ? `<div class="intent-line intent-line--reason">识别依据: ${App.escapeHtml(p.reason)}</div>` : ''}`;
          }
        } else if (event.type === 'choice_request') {
          // 意图识别未命中: 渲染分身/技能选择面板, 等待用户选择
          replyBody = null; replyText = ''; lastTrace = null;
          this.renderChoicePanel(out, run, event.payload);
        } else if (event.type === 'choice_done') {
          // 用户选择完成: 冻结选择面板并展示结果
          const p = event.payload;
          const panel = out.querySelector('.choice-panel');
          if (panel) {
            panel.classList.add('choice-panel--done');
            const btn = panel.querySelector('.choice-submit');
            if (btn) btn.style.display = 'none';
          }
          const skillNames = (p.skill_ids || [])
            .map(id => (this.skills.find(s => s.id === id) || {}).name || `技能#${id}`);
          const trace = this.appendTrace(out, '用户选择', '已确认');
          trace.querySelector('.chat-trace__head span:first-child').textContent = '✅';
          trace.classList.add('open');
          trace.querySelector('.chat-trace__body').innerHTML = `
            <div class="intent-line">🤖 数字分身: ${App.escapeHtml(p.agent_name || '')}${skillNames.length ? ` · ⚡ 技能: ${App.escapeHtml(skillNames.join('、'))}` : ''}</div>
            <div class="intent-line intent-line--reason">选择结果已记入该分身长期记忆, 后续同类任务将自动分流</div>`;
        } else if (event.type === 'model') {
          // 模型调用简要过程 (每轮一行)
          const p = event.payload;
          if (p.stage === 'end') {
            const line = document.createElement('div');
            line.className = 'chat-model-line';
            line.textContent = `🧮 模型调用 第${p.round}轮 · ${p.duration_ms}ms`
              + (p.tool_calls ? ` · 发起 ${p.tool_calls} 个工具调用` : ` · 生成回复 ${p.chars || 0} 字`);
            out.appendChild(line);
            out.scrollTop = out.scrollHeight;
          }
        } else if (event.type === 'asr_start') {
          // 录音转写开始: 创建实时转写块 (属于 run_skill 工具内部过程, 不影响工具轨迹状态)
          replyBody = null; replyText = '';
          asrBlock = this.appendOutputBlock(out, '🗣', `录音转写文字 · ${event.payload.file || ''} (实时)`, '');
        } else if (event.type === 'asr_segment') {
          // 每段转写文字实时追加 (内部 pre 与外层窗口同步滚到底部, 聚焦最新文字)
          const seg = event.payload;
          if (!asrBlock) asrBlock = this.appendOutputBlock(out, '🗣', '录音转写文字 (实时)', '');
          const pre = asrBlock.querySelector('pre');
          pre.textContent += `${seg.ts} ${seg.text}\n`;
          this._lastTranscript += `${seg.ts} ${seg.text}\n`;
          const badge = asrBlock.querySelector('.chat-trace__badge');
          if (badge) badge.textContent = `${seg.index} 段 · 切片 ${seg.chunk}/${seg.chunks}`;
          pre.scrollTop = pre.scrollHeight;
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'asr_done') {
          // 转写完成
          if (asrBlock) {
            const head = asrBlock.querySelector('.chat-trace__head span:nth-child(2)');
            if (head) head.textContent = head.textContent.replace(' (实时)', '');
            const badge = asrBlock.querySelector('.chat-trace__badge');
            if (badge) badge.textContent = `转写完成 · ${event.payload.segments} 段 · ${event.payload.chars} 字`;
          }
        } else if (event.type === 'minutes_delta') {
          // 会议纪要流式增量输出 (不影响工具轨迹状态)
          if (!minutesBlock) {
            replyBody = null; replyText = '';
            minutesBlock = this.appendOutputBlock(out, '📑', '会议纪要 (生成中…)', '');
          }
          minutesBlock.querySelector('pre').textContent += event.payload.content;
          this._lastMinutes += event.payload.content;
          const badge = minutesBlock.querySelector('.chat-trace__badge');
          if (badge) badge.textContent = `${this._lastMinutes.length} 字`;
          const mPre = minutesBlock.querySelector('pre');
          mPre.scrollTop = mPre.scrollHeight;
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'digest_start') {
          // 周工作小结生成开始: 创建实时概括块
          replyBody = null; replyText = '';
          digestBlock = this.appendOutputBlock(out, '📣', `周工作小结 · ${event.payload.title || ''} (生成中…)`, '');
        } else if (event.type === 'digest_delta') {
          // 周工作小结流式增量输出 (内部 pre 与外层窗口同步滚到底部)
          if (!digestBlock) {
            replyBody = null; replyText = '';
            digestBlock = this.appendOutputBlock(out, '📣', '周工作小结 (生成中…)', '');
          }
          const dPre = digestBlock.querySelector('pre');
          dPre.textContent += event.payload.content;
          const dBadge = digestBlock.querySelector('.chat-trace__badge');
          if (dBadge) dBadge.textContent = `${dPre.textContent.length} 字`;
          dPre.scrollTop = dPre.scrollHeight;
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'content') {
          replyText += event.payload.content || '';
          ensureReply().innerHTML = App.renderMarkdown(replyText);
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'tool_call') {
          replyBody = null; replyText = '';
          lastTrace = this.appendTrace(out, event.name, '执行中');
          if (lastTrace) {
            lastTrace.querySelector('.chat-trace__body').innerHTML =
              `<pre>入参: ${App.escapeHtml(JSON.stringify(event.payload.arguments, null, 2))}</pre>`;
          }
        } else if (event.type === 'tool_result') {
          // 会议纪要技能产物: 录音文字 / 会议纪要 分区块展示
          let resObj = event.payload.result;
          if (typeof resObj === 'string') { try { resObj = JSON.parse(resObj); } catch (e) { /* 非 JSON */ } }
          // run_skill 产物嵌套在 output.results[].result, 向下提取含转写/纪要的步骤结果
          if (resObj && typeof resObj === 'object' && !resObj.transcript && !resObj.minutes
              && resObj.output && Array.isArray(resObj.output.results)) {
            const inner = resObj.output.results
              .map(r => r && r.result)
              .find(r => r && typeof r === 'object' && (r.transcript || r.minutes));
            if (inner) resObj = inner;
          }
          const hasMinutes = resObj && typeof resObj === 'object' && (resObj.transcript || resObj.minutes);
          if (lastTrace) {
            const badge = lastTrace.querySelector('.chat-trace__badge');
            badge.textContent = `完成 ${event.payload.duration_ms}ms`;
            badge.classList.add('chat-trace__badge--ok');
            lastTrace.querySelector('.chat-trace__body').innerHTML +=
              `<pre>结果: ${App.escapeHtml(JSON.stringify(event.payload.result, null, 2).slice(0, 4000))}</pre>`;
          } else {
            // 历史回放时 tool_call 可能缺失 (异常中断), 保底展示结果
            lastTrace = this.appendTrace(out, event.name || 'tool', `完成 ${event.payload.duration_ms}ms`);
            lastTrace.querySelector('.chat-trace__body').innerHTML =
              `<pre>结果: ${App.escapeHtml(JSON.stringify(event.payload.result, null, 2).slice(0, 4000))}</pre>`;
          }
          if (hasMinutes) {
            // 完整产物回写 (权威版本); 实时块已存在时仅更新徽标, 不重复建块
            if (resObj.file) this._lastAudioFile = resObj.file;
            if (resObj.transcript) {
              this._lastTranscript = resObj.transcript;
              if (asrBlock) {
                const badge = asrBlock.querySelector('.chat-trace__badge');
                if (badge) badge.textContent = `${resObj.transcript.length} 字`;
              } else {
                asrBlock = this.appendOutputBlock(out, '🗣', '录音转写文字', resObj.transcript);
              }
            }
            if (resObj.minutes) {
              this._lastMinutes = resObj.minutes;
              if (minutesBlock) {
                const head = minutesBlock.querySelector('.chat-trace__head span:nth-child(2)');
                if (head) head.textContent = '会议纪要';
                const badge = minutesBlock.querySelector('.chat-trace__badge');
                if (badge) badge.textContent = `${resObj.minutes.length} 字`;
              } else {
                minutesBlock = this.appendOutputBlock(out, '📑', '会议纪要', resObj.minutes);
              }
            }
          }
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'error') {
          replyText += `\n\n⚠️ ${event.payload.content}`;
          ensureReply().innerHTML = App.renderMarkdown(replyText);
        } else if (event.type === 'done') {
          if (replyText) this._lastReply = replyText;
          this.running = false;
          this.updateFollowupState();
          this.updateSaveBtn();
          document.getElementById('tc-output-title').textContent = `执行输出 · ${run.title || ''}`;
        }
      }, ctrl.signal);
    } catch (err) {
      if (err.name === 'AbortError') return; // 主动切换任务
      if (!started) out.innerHTML = '';
      this.appendChatMsg(out, 'assistant', `⚠️ 加载执行过程失败: ${App.escapeHtml(err.message)}`);
    } finally {
      // 已被新事件流取代 (abort) 时不干预新流的状态
      if (this._eventsAbort === ctrl) {
        this._eventsAbort = null;
        if (!started) {
          out.innerHTML = '<div class="empty-state">该任务暂无执行记录</div>';
        }
        // 流结束 (done 或历史任务回放完毕): 刷新任务列表状态
        this.running = false;
        this.updateFollowupState();
        this.updateSaveBtn();
        this.loadRuns();
      }
    }
  },

  /** 会议纪要/录音文字折叠区块 (默认展开, 点击标题折叠) */
  appendOutputBlock(out, icon, title, text) {
    const div = document.createElement('div');
    div.className = 'chat-trace output-block open';
    div.innerHTML = `
      <div class="chat-trace__head">
        <span>${icon}</span><span>${App.escapeHtml(title)}</span>
        <span class="chat-trace__badge chat-trace__badge--ok">${(text || '').length} 字</span>
      </div>
      <div class="chat-trace__body"><pre>${App.escapeHtml(text || '')}</pre></div>`;
    div.querySelector('.chat-trace__head').onclick = () => div.classList.toggle('open');
    out.appendChild(div);
    // 建块后同步滚动: 内部 pre 定位到末尾 (回放长文本时聚焦最新), 外层窗口滚到底部
    const pre = div.querySelector('pre');
    if (pre) pre.scrollTop = pre.scrollHeight;
    out.scrollTop = out.scrollHeight;
    return div;
  },

  /** 保存按钮可见性: 任务已结束且有纪要/回复内容 */
  updateSaveBtn() {
    const btn = document.getElementById('tc-save-minutes');
    if (!btn) return;
    const hasContent = !!(this._lastMinutes || this._lastReply);
    btn.style.display = (this.currentRun && !this.running && hasContent) ? '' : 'none';
  },

  /** 保存纪要到会议记录: 选会议 → 覆盖 / 追加 */
  async openSaveMinutes() {
    if (!this.currentRun) return;
    const content = this._lastMinutes || this._lastReply;
    if (!content) {
      App.showToast('暂无可保存的纪要内容', 'warning');
      return;
    }
    let meetings = [];
    try {
      meetings = await API.get(`/meetings/?project_id=${this.currentRun.project_id}`);
    } catch (err) {
      App.showToast(`加载会议失败: ${err.message}`, 'error');
      return;
    }
    if (!meetings.length) {
      App.showToast('当前任务项目暂无会议记录, 请先创建会议', 'warning');
      return;
    }
    const modal = App.openModal({
      title: '保存纪要到会议记录',
      size: 'lg',
      bodyHtml: `
        <div class="form-field">
          <label>选择会议</label>
          <select id="sm-meeting">
            ${meetings.map(m => `<option value="${m.id}">${App.escapeHtml(m.title)} (${m.meet_date || '未定日期'})</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>该会议现有纪要</label>
          <div id="sm-existing" class="sm-existing"></div>
        </div>
        <div class="form-field">
          <label>待保存内容 (保存前可编辑)</label>
          <textarea id="sm-content" rows="10">${App.escapeHtml(content)}</textarea>
        </div>
        ${(this._lastTranscript || this._lastAudioFile) ? `
        <div class="sm-attach-hint">📎 将随纪要一并保存到会议: ${[
          this._lastAudioFile ? `原始录音「${App.escapeHtml(this._lastAudioFile)}」` : '',
          this._lastTranscript ? `录音转写完整文字 (${this._lastTranscript.length} 字)` : '',
        ].filter(Boolean).join(' + ')}</div>` : ''}`,
      footerHtml: `
        <button class="cw-btn" data-modal-close>取消</button>
        <button class="cw-btn" id="sm-append">追加到纪要</button>
        <button class="cw-btn cw-btn--primary" id="sm-overwrite">覆盖纪要</button>`,
    });
    const sel = modal.querySelector('#sm-meeting');
    const showExisting = () => {
      const m = meetings.find(x => String(x.id) === sel.value);
      const desc = (m && m.description) || '';
      modal.querySelector('#sm-existing').textContent =
        desc ? desc.slice(0, 600) : '(当前会议暂无纪要内容, 保存将直接写入)';
    };
    sel.onchange = showExisting;
    showExisting();

    const save = async (mode) => {
      const m = meetings.find(x => String(x.id) === sel.value);
      const newText = modal.querySelector('#sm-content').value.trim();
      if (!newText) {
        App.showToast('保存内容为空', 'warning');
        return;
      }
      // 追加: 接到现有纪要之后; 覆盖或原纪要为空: 直接写入
      const description = (mode === 'append' && m.description)
        ? `${m.description}\n\n---\n\n${newText}` : newText;
      try {
        // 需求: 纪要保存时, 原始录音文件与完整转写文字一并入库并与会议关联
        const payload = { description };
        if (this._lastTranscript) payload.transcript = this._lastTranscript;
        if (this._lastAudioFile) payload.audio_file = this._lastAudioFile;
        await API.updateMeeting(m.id, payload);
        App.closeModal(modal);
        App.showToast(`已${mode === 'append' ? '追加到' : '覆盖保存到'}「${m.title}」`, 'success');
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    };
    modal.querySelector('#sm-overwrite').onclick = () => save('overwrite');
    modal.querySelector('#sm-append').onclick = () => save('append');
  },

  /* ---------------- 补充对话区 ---------------- */

  /** 补充区启用状态: 有当前任务且未在执行中方可发送 */
  updateFollowupState() {
    const card = document.getElementById('tc-followup-card');
    if (!card) return;
    const enabled = !!this.currentRunId && !this.running;
    card.classList.toggle('fc-disabled', !enabled);
    document.getElementById('fc-send').disabled = !enabled;
    const hint = document.getElementById('fc-input');
    hint.disabled = !enabled;
    if (hint && !this.currentRunId) {
      hint.placeholder = '请先创建并执行任务, 或在左侧选择历史任务…';
    } else if (hint) {
      hint.placeholder = '补充任务内容, 继续让 AI 执行当前任务… 支持 ＋上传 / Ctrl+V 黏贴附件, @ 项目 / 记录 # 资源 (Enter 发送)';
    }
  },

  /** 发送补充内容: 在当前任务会话中继续后台执行, 并重放事件流 */
  async sendFollowup() {
    if (this.running || !this.currentRunId) return;
    const inputEl = document.getElementById('fc-input');
    const text = inputEl.value.trim();
    const fileNames = this.fcAttach ? this.fcAttach.names() : [];
    if (!text && !fileNames.length) {
      App.showToast('请填写补充内容或添加附件', 'warning');
      return;
    }

    this.running = true;
    this.updateFollowupState();
    inputEl.value = '';

    try {
      await API.continueTaskRun(this.currentRunId, {
        input_text: text,
        file_names: fileNames,
        skill_ids: [],
      });
      if (this.fcAttach) this.fcAttach.clear();
      // 后台已启动: 重放事件流 (含历史轮次与本轮实时事件)
      const run = await API.getTaskRun(this.currentRunId);
      this.renderRunEvents(run);
    } catch (err) {
      App.showToast(`执行失败: ${err.message}`, 'error');
      this.running = false;
      this.updateFollowupState();
    }
  },

  async createAndRun() {
    if (this.running) return;
    const inputText = document.getElementById('tc-input').value.trim();
    if (!inputText && !this.selectedFiles.size) {
      App.showToast('请填写任务描述或选择文件', 'warning');
      return;
    }

    this.running = true;
    const runBtn = document.getElementById('tc-run');
    runBtn.disabled = true;
    runBtn.textContent = '执行中…';

    // 重置输出区
    document.getElementById('tc-output-title').textContent = '执行输出';
    const out = document.getElementById('tc-output');
    out.innerHTML = '<div class="empty-state">任务已创建, 正在启动后台执行…</div>';

    try {
      // 不指定项目/分身/技能: 由后端意图识别自动选择, 识别不了在执行窗口由用户选择
      const run = await API.createTaskRun({
        project_id: this.currentProjectId(),
        agent_id: null,
        skill_ids: [],
        file_names: Array.from(this.selectedFiles),
        input_text: inputText,
      });

      // 启动后台执行 (立即返回), 随后经事件流渲染过程
      await API.runTaskRun(run.id);
      this.renderRunEvents({ ...run, status: 'running' });
    } catch (err) {
      out.innerHTML = `<div class="empty-state">⚠️ 执行失败: ${App.escapeHtml(err.message)}</div>`;
      this.running = false;
      this.updateFollowupState();
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '▶ 创建并执行长任务';
      this.loadRuns();
    }
  },

  /** 追加可折叠工具轨迹块 (与 AgentChat 一致) */
  appendTrace(box, name, statusText) {
    const div = document.createElement('div');
    div.className = 'chat-trace';
    div.innerHTML = `
      <div class="chat-trace__head">
        <span>🔧</span><span>${App.escapeHtml(name)}</span>
        <span class="chat-trace__badge">${App.escapeHtml(statusText)}</span>
      </div>
      <div class="chat-trace__body"></div>`;
    div.querySelector('.chat-trace__head').onclick = () => div.classList.toggle('open');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  },

  /**
   * 意图识别未命中时的分身/技能选择面板
   * 任务执行中: 可交互, 确认后提交 /task-runs/{id}/choose 继续执行
   * 历史回放: 只读展示 (配合 choice_done 事件呈现选择结果)
   */
  renderChoicePanel(out, run, payload) {
    const div = document.createElement('div');
    div.className = 'chat-trace output-block open choice-panel';
    div.innerHTML = `
      <div class="chat-trace__head">
        <span>🙋</span><span>需要你的选择</span>
        <span class="chat-trace__badge">意图识别未命中</span>
      </div>
      <div class="chat-trace__body">
        <div class="choice-reason">${App.escapeHtml(payload.reason || '未能自动识别合适的数字分身')}</div>
        <div class="choice-sec-title">选择数字分身 (必选)</div>
        <div class="choice-agents">
          ${(payload.agents || []).map(a => `
            <div class="choice-agent" data-agent-id="${a.id}">
              <span class="choice-agent__icon">${App.escapeHtml(a.icon || '🤖')}</span>
              <span class="choice-agent__main">
                <span class="choice-agent__name">${App.escapeHtml(a.name)}</span>
                <span class="choice-agent__desc">${App.escapeHtml(a.description || '')}</span>
              </span>
            </div>`).join('')}
        </div>
        <div class="choice-sec-title">附加技能 (可选, 多选)</div>
        <div class="chip-box choice-skills">
          ${(payload.skills || []).map(s => `
            <span class="chip" data-skill-id="${s.id}">${App.escapeHtml(s.icon || '⚡')} ${App.escapeHtml(s.name)}</span>`).join('')
          || '<span style="font-size:12px;color:var(--color-text-tertiary)">暂无可用技能</span>'}
        </div>
        <div class="choice-actions">
          <button class="cw-btn cw-btn--primary choice-submit" disabled>确认选择并继续执行</button>
          <span class="choice-hint">选择结果将记入该分身长期记忆, 后续同类任务自动分流</span>
        </div>
      </div>`;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;

    const submitBtn = div.querySelector('.choice-submit');
    const interactive = run.status === 'running';
    if (!interactive) {
      // 历史回放: 只读展示
      div.classList.add('choice-panel--done');
      submitBtn.style.display = 'none';
      div.querySelector('.choice-hint').textContent = '历史任务回放 (选择结果见下方记录)';
      return;
    }

    let agentId = null;
    const skillIds = new Set();
    div.querySelectorAll('.choice-agent').forEach(el => {
      el.onclick = () => {
        div.querySelectorAll('.choice-agent').forEach(x => x.classList.remove('choice-agent--on'));
        el.classList.add('choice-agent--on');
        agentId = parseInt(el.dataset.agentId, 10);
        submitBtn.disabled = false;
      };
    });
    div.querySelectorAll('.choice-skills .chip').forEach(chip => {
      chip.onclick = () => {
        const id = parseInt(chip.dataset.skillId, 10);
        if (skillIds.has(id)) {
          skillIds.delete(id);
          chip.classList.remove('chip--on');
        } else {
          skillIds.add(id);
          chip.classList.add('chip--on');
        }
      };
    });
    submitBtn.onclick = async () => {
      if (!agentId) return;
      submitBtn.disabled = true;
      submitBtn.textContent = '已提交, 任务继续执行…';
      div.querySelectorAll('.choice-agent, .choice-skills .chip')
        .forEach(el => { el.style.pointerEvents = 'none'; });
      try {
        await API.chooseTaskRun(run.id, { agent_id: agentId, skill_ids: [...skillIds] });
      } catch (err) {
        App.showToast(`提交选择失败: ${err.message}`, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '确认选择并继续执行';
        div.querySelectorAll('.choice-agent, .choice-skills .chip')
          .forEach(el => { el.style.pointerEvents = ''; });
      }
    };
  },
};

/* ------------------------------------------------------------------
   智能体列表视图
   ------------------------------------------------------------------ */
const CoworkAgents = {
  agents: [],

  init() {},

  async onShow() {
    await this.render();
  },

  async render() {
    const el = document.getElementById('view-agents');
    if (!el) return;
    el.innerHTML = `
      <div class="cw-page">
        <div class="cw-page__header">
          <div>
            <div class="cw-page__title">数字分身</div>
            <div class="cw-page__subtitle">具备感知、记忆、决策、交互、执行五大能力的项目管理智能体</div>
          </div>
          <button class="cw-btn cw-btn--primary" id="agent-create-btn">+ 新建智能体</button>
        </div>
        <div class="agent-grid" id="agent-grid"><div class="empty-state">加载中…</div></div>
      </div>`;

    document.getElementById('agent-create-btn').onclick = () => {
      CoworkBuilder.openCreate();
    };

    try {
      this.agents = await API.getAgents();
    } catch (err) {
      App.showToast(`加载智能体失败: ${err.message}`, 'error');
      this.agents = [];
    }

    const grid = document.getElementById('agent-grid');
    if (!this.agents.length) {
      grid.innerHTML = '<div class="empty-state">暂无智能体, 点击右上角新建</div>';
      return;
    }

    grid.innerHTML = this.agents.map(a => {
      const cfg = a.config || {};
      const icon = cfg.icon || '🤖';
      const color = cfg.color || '#FF8C00';
      const toolCount = (a.tools || []).length;
      return `
        <div class="agent-card" data-agent-id="${a.id}">
          <div class="agent-card__head">
            <div class="agent-card__avatar" style="background:${App.escapeHtml(color)}">${icon}</div>
            <div>
              <div class="agent-card__name">${App.escapeHtml(a.name)}</div>
              <span class="agent-card__type">${App.escapeHtml(a.type)}</span>
            </div>
          </div>
          <div class="agent-card__desc">${App.escapeHtml(a.description || '暂无描述')}</div>
          <div class="agent-card__caps">
            <span class="agent-cap">感知</span><span class="agent-cap">记忆</span>
            <span class="agent-cap">决策</span><span class="agent-cap">交互</span>
            <span class="agent-cap">执行</span>
            <span class="agent-cap" title="可用工具数">🔧 ${toolCount}</span>
          </div>
          <div class="agent-card__footer">
            <button class="cw-btn cw-btn--primary cw-btn--sm" data-action="chat">💬 对话</button>
            <button class="cw-btn cw-btn--sm" data-action="copy">📋 复制</button>
            <button class="cw-btn cw-btn--sm" data-action="edit">✏️ 编辑</button>
            <button class="cw-btn cw-btn--sm cw-btn--danger" data-action="delete">🗑</button>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.agent-card').forEach(card => {
      const id = parseInt(card.dataset.agentId, 10);
      const agent = this.agents.find(a => a.id === id);
      card.querySelector('[data-action="chat"]').onclick = (e) => {
        e.stopPropagation();
        AgentChat.open(agent);
      };
      card.querySelector('[data-action="copy"]').onclick = (e) => {
        e.stopPropagation();
        CoworkBuilder.openCopy(agent);
      };
      card.querySelector('[data-action="edit"]').onclick = (e) => {
        e.stopPropagation();
        CoworkBuilder.openEdit(agent);
      };
      card.querySelector('[data-action="delete"]').onclick = async (e) => {
        e.stopPropagation();
        try {
          await API.deleteAgent(id);
          App.showToast('已删除', 'success');
          this.render();
        } catch (err) {
          App.showToast(`删除失败: ${err.message}`, 'error');
        }
      };
      card.onclick = () => AgentChat.open(agent);
    });
  }
};

/* ------------------------------------------------------------------
   输入联想组件: 对话/任务输入框的 @项目 与 /记录 引用
   - 输入 @ : 弹出系统项目列表, 选择后插入 @项目名 并作为后续 / 引用的项目上下文
   - 输入 / : 弹出 会议/周报/里程碑/周任务 四类选项, 选定类别后进一步列出
              当前所选项目下的对应记录, 选中记录将其关键信息插入输入框
   ------------------------------------------------------------------ */
const MentionBox = {
  // 实例状态在 attach 中初始化 (以下注释仅为结构说明)
  // textarea / host / popup / getProjectId / onPickProject / projects / stage / triggerStart / items / activeIdx

  CATEGORIES: [
    { key: 'meeting',   label: '会议',   icon: '📅' },
    { key: 'report',    label: '周报',   icon: '📝' },
    { key: 'milestone', label: '里程碑', icon: '★' },
    { key: 'worktask',  label: '周任务', icon: '✅' },
  ],

  // # 触发的资源类别
  RES_KINDS: [
    { key: 'agent', label: '智能体', icon: '🤖' },
    { key: 'skill', label: '技能',   icon: '⚡' },
    { key: 'tool',  label: '工具',   icon: '🔧' },
  ],

  /** 工厂: 为输入框创建独立联想实例 (支持同页多个输入框) */
  attach(textarea, opts = {}) {
    const inst = Object.create(MentionBox);
    inst.textarea = null;
    inst.host = null;
    inst.popup = null;
    inst.getProjectId = null;
    inst.onPickProject = null;
    inst.projects = null;
    inst.stage = null;
    inst.triggerStart = -1;
    inst.items = [];
    inst.activeIdx = 0;
    inst._bind(textarea, opts);
    return inst;
  },

  /** 绑定到输入框; opts: { getProjectId, onPickProject } */
  _bind(textarea, opts = {}) {
    this.textarea = textarea;
    this.getProjectId = opts.getProjectId || null;
    this.onPickProject = opts.onPickProject || null;
    // 输入框容器需要相对定位以承载浮层
    this.host = textarea.closest('.chat-input, .form-field, .fc-input-row, .debug-input-row') || textarea.parentElement;
    if (this.host) this.host.style.position = 'relative';

    this._onInput = () => this.handleInput();
    this._onKeydown = (e) => this.handleKeydown(e);
    this._onDocDown = (e) => {
      if (this.popup && !this.popup.contains(e.target) && e.target !== this.textarea) this.close();
    };
    textarea.addEventListener('input', this._onInput);
    textarea.addEventListener('keydown', this._onKeydown, true); // 捕获阶段, 先于发送逻辑
    document.addEventListener('mousedown', this._onDocDown);
  },

  detach() {
    if (this.textarea) {
      this.textarea.removeEventListener('input', this._onInput);
      this.textarea.removeEventListener('keydown', this._onKeydown, true);
    }
    if (this._onDocDown) document.removeEventListener('mousedown', this._onDocDown);
    this.close();
    this.textarea = null;
  },

  isOpen() { return !!this.popup; },

  /** 解析光标前的触发词: @xx 或 /xx 或 #xx (前面需为行首/空白) */
  handleInput() {
    const ta = this.textarea;
    if (!ta) return;
    // 记录选择阶段: 继续输入则关闭浮层
    if (this.stage === 'record' || this.stage === 'resource') { this.close(); return; }
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const m = before.match(/(^|[\s\n])([@/#])([^\s@/#]*)$/);
    if (!m) { this.close(); return; }
    this.triggerStart = pos - m[3].length - 1;
    if (m[2] === '@') this.showProjects(m[3]);
    else if (m[2] === '#') this.showResKinds(m[3]);
    else this.showCategories(m[3]);
  },

  async ensureProjects() {
    if (!this.projects) {
      try { this.projects = await API.getProjects(); } catch (e) { this.projects = []; }
    }
    return this.projects;
  },

  /** 当前项目 id: 优先宿主回调 (@选中或任务页下拉框), 其次激活项目 */
  async currentProjectId() {
    if (this.getProjectId) {
      const id = this.getProjectId();
      if (id) return id;
    }
    const projects = await this.ensureProjects();
    const active = projects.find(p => p.is_active);
    return active ? active.id : (projects[0] ? projects[0].id : null);
  },

  async showProjects(keyword) {
    this.stage = 'project';
    const projects = (await this.ensureProjects())
      .filter(p => !keyword || p.name.includes(keyword));
    this.items = projects.map(p => ({
      title: p.name, sub: p.is_active ? '当前激活' : '', project: p,
    }));
    this.renderPopup('@ 选择项目');
  },

  showCategories(keyword) {
    this.stage = 'category';
    this.items = this.CATEGORIES
      .filter(c => !keyword || c.label.includes(keyword))
      .map(c => ({ title: c.label, sub: '引用项目记录', icon: c.icon, category: c }));
    this.renderPopup('/ 选择记录类型');
  },

  /** # 触发: 展示资源类别 (智能体/技能/工具) */
  showResKinds(keyword) {
    this.stage = 'reskind';
    this.items = this.RES_KINDS
      .filter(k => !keyword || k.label.includes(keyword))
      .map(k => ({ title: k.label, sub: '引用系统资源', icon: k.icon, reskind: k }));
    this.renderPopup('# 选择资源类型');
  },

  /** 选定资源类别后: 加载对应资源列表 */
  async showResources(kind) {
    this.stage = 'resource';
    this.renderPopup(`${kind.icon} ${kind.label} · 加载中…`, true);
    let records = [];
    try {
      records = await this.loadResources(kind.key);
    } catch (e) { records = []; }
    if (this.stage !== 'resource') return; // 期间被关闭
    this.items = records;
    this.renderPopup(`${kind.icon} ${kind.label} · 选择资源插入`);
  },

  /** 按资源类别拉取智能体/技能/工具并格式化为可插入片段 */
  async loadResources(key) {
    if (key === 'agent') {
      const list = await API.getAgents();
      return list.map(a => ({
        title: `${(a.config || {}).icon || '🤖'} ${a.name}`,
        sub: (a.description || '').slice(0, 40),
        snippet: `【智能体#${a.id}】${a.name} | ${a.description || ''} | 可用工具: ${(a.tools || []).join(', ')}\n`,
      }));
    }
    if (key === 'skill') {
      const list = await API.getSkills();
      return list.map(s => ({
        title: `${(s.config || {}).icon || '⚡'} ${s.name}`,
        sub: (s.description || '').slice(0, 40),
        snippet: `【技能#${s.id}】${s.name} | ${s.description || ''}\n`,
      }));
    }
    // tool: 与后端 TOOL_DEFINITIONS 一致的中文注释清单
    return CoworkBuilder.ALL_TOOLS.map(([name, zh]) => ({
      title: name,
      sub: zh,
      icon: '🔧',
      snippet: `【工具】${name} | ${zh}\n`,
    }));
  },

  /** 选定类别后: 加载当前项目下的记录列表 */
  async showRecords(category) {
    this.stage = 'record';
    this.renderPopup(`${category.icon} ${category.label} · 加载中…`, true);
    const pid = await this.currentProjectId();
    let records = [];
    try {
      records = await this.loadRecords(category.key, pid);
    } catch (e) { records = []; }
    if (this.stage !== 'record') return; // 期间被关闭
    this.items = records;
    this.renderPopup(`${category.icon} ${category.label} · 选择记录插入`);
  },

  /** 按类别拉取记录并格式化为可插入片段 */
  async loadRecords(key, pid) {
    if (!pid) return [];
    if (key === 'meeting') {
      const list = await API.get(`/meetings/?project_id=${pid}`);
      return list.map(m => ({
        title: m.title,
        sub: `${m.meet_date || ''} ${m.meet_time || ''} ${m.host ? '主持:' + m.host : ''}`.trim(),
        snippet: `【会议#${m.id}】${m.title} | ${m.meet_date || ''} ${m.meet_time || ''} | ${m.place || ''} | 主持:${m.host || '待定'} | 参会:${m.attendees || '待定'}${m.description ? '\n纪要: ' + m.description : ''}\n`,
      }));
    }
    if (key === 'report') {
      const list = await API.get(`/weekly-reports/?project_id=${pid}`);
      return list.map(r => ({
        title: r.title,
        sub: `${r.week_range || ''} ${r.status === 'submitted' ? '已提交' : '草稿'}`.trim(),
        snippet: `【周报#${r.id}】${r.title} (${r.week_range || ''})${r.overview_summary ? '\n概览: ' + r.overview_summary : ''}\n`,
      }));
    }
    if (key === 'milestone') {
      const list = await API.getProgressTasks({ project_id: pid });
      return list.filter(t => t.is_milestone).map(t => ({
        title: `${t.task_uid} ${t.name}`,
        sub: `${t.start_date || ''}~${t.end_date || ''} ${t.status}`,
        snippet: `【里程碑#${t.id}】${t.task_uid} ${t.name} | ${t.start_date || ''}~${t.end_date || ''} | 状态:${t.status} | 负责人:${t.owner || '待定'}\n`,
      }));
    }
    // worktask
    const list = await API.get(`/work-tasks/?project_id=${pid}`);
    return list.map(t => ({
      title: t.name,
      sub: `${t.owner || ''} ${t.status || ''}`.trim(),
      snippet: `【周任务#${t.id}】${t.name} | 负责人:${t.owner || '待定'} | 状态:${t.status || ''} | 优先级:${t.priority || ''} | 计划工时:${t.planned_hours || 0}h\n`,
    }));
  },

  renderPopup(head, loading = false) {
    // 仅移除旧浮层 DOM, 不重置 stage/items (close 会做完整清理)
    if (this.popup) { this.popup.remove(); this.popup = null; }
    if (!this.host) return;
    this.activeIdx = 0;
    const popup = document.createElement('div');
    popup.className = 'mention-popup';
    let html = `<div class="mention-head">${App.escapeHtml(head)}</div>`;
    if (loading) {
      html += '<div class="mention-item mention-item--none">加载中…</div>';
    } else if (!this.items.length) {
      html += '<div class="mention-item mention-item--none">无匹配记录</div>';
    } else {
      html += this.items.slice(0, 30).map((it, i) => `
        <div class="mention-item${i === 0 ? ' active' : ''}" data-idx="${i}">
          <span class="mention-item__title">${it.icon ? it.icon + ' ' : ''}${App.escapeHtml(it.title)}</span>
          ${it.sub ? `<span class="mention-item__sub">${App.escapeHtml(it.sub)}</span>` : ''}
        </div>`).join('');
    }
    popup.innerHTML = html;
    popup.querySelectorAll('.mention-item[data-idx]').forEach(el => {
      // mousedown 抢在 blur 前触发, 保持输入框焦点
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.pick(parseInt(el.dataset.idx, 10));
      });
      el.addEventListener('mouseenter', () => this.setActive(parseInt(el.dataset.idx, 10)));
    });
    this.host.appendChild(popup);
    this.popup = popup;
  },

  setActive(i) {
    this.activeIdx = i;
    if (!this.popup) return;
    this.popup.querySelectorAll('.mention-item[data-idx]').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.idx, 10) === i);
    });
  },

  handleKeydown(e) {
    if (!this.popup) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      this.close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      this.setActive(Math.min(this.activeIdx + 1, this.items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      this.setActive(Math.max(this.activeIdx - 1, 0));
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      if (this.items.length) this.pick(this.activeIdx);
    }
  },

  /** 选中条目: 项目→插入@名并回调; 类别→进入记录列表; 资源类别→进入资源列表; 记录/资源→插入片段 */
  pick(i) {
    const item = this.items[i];
    if (!item) return;
    if (item.project) {
      this.replaceTrigger(`@${item.project.name} `);
      if (this.onPickProject) this.onPickProject(item.project);
      this.close();
    } else if (item.category) {
      // 清掉已输入的 /xx, 再展开记录列表
      this.replaceTrigger('');
      this.showRecords(item.category);
    } else if (item.reskind) {
      // 清掉已输入的 #xx, 再展开资源列表
      this.replaceTrigger('');
      this.showResources(item.reskind);
    } else if (item.snippet) {
      this.replaceTrigger(item.snippet);
      this.close();
    }
  },

  /** 用 text 替换触发词区间 (triggerStart 到光标) */
  replaceTrigger(text) {
    const ta = this.textarea;
    if (!ta) return;
    const start = this.triggerStart >= 0 ? this.triggerStart : ta.selectionStart;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(ta.selectionStart);
    ta.value = before + text + after;
    const pos = (before + text).length;
    ta.selectionStart = ta.selectionEnd = pos;
    ta.focus();
  },

  close() {
    if (this.popup) this.popup.remove();
    this.popup = null;
    this.stage = null;
    this.items = [];
    this.triggerStart = -1;
  },
};

/* ------------------------------------------------------------------
   可视化选择器: Emoji 与主题色 (供智能体/技能构建器共用)
   - 点击 😀 按钮弹出常用 Emoji 网格, 点选填入输入框
   - 点击色块按钮弹出 12 预设色板 + 原生取色器, 点选填入输入框
   ------------------------------------------------------------------ */
const Pickers = {
  EMOJIS: [
    '🤖', '👤', '🧑‍💼', '🧑‍💻', '🎭', '🧠', '📊', '📈', '📋', '📝', '📑', '📅',
    '🗓️', '⏰', '⚡', '🔧', '⚙️', '🛠️', '🧩', '🔍', '💡', '🚀', '🎯', '🏁',
    '🚩', '⭐', '🌟', '🔥', '💬', '📢', '🎙️', '📁', '🗂️', '📦', '📌', '📎',
    '🔔', '🔑', '🧭', '🗒️', '✅', '🤝', '👥', '🧪', '🕸️', '💼', '📞', '🎧',
  ],
  COLORS: [
    '#FF8C00', '#F97316', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6',
    '#6366F1', '#3B82F6', '#06B6D4', '#10B981', '#84CC16', '#64748B',
  ],

  /** 绑定容器内所有 [data-pick-emoji] / [data-pick-color] 按钮 */
  bind(root) {
    root.querySelectorAll('[data-pick-emoji]').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        const input = root.querySelector(btn.dataset.pickEmoji);
        if (input) this.toggleEmoji(btn, input);
      };
    });
    root.querySelectorAll('[data-pick-color]').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        const input = root.querySelector(btn.dataset.pickColor);
        if (input) this.toggleColor(btn, input);
      };
    });
  },

  /** 浮层开关: 同一按钮重复点击为关闭; 打开新浮层前清掉旧的 */
  _mount(btn, pop) {
    const wasOpen = !!btn.parentElement.querySelector('.pick-pop');
    this.closeAll();
    if (wasOpen) return;
    pop.classList.add('pick-pop');
    btn.parentElement.appendChild(pop);
  },

  toggleEmoji(btn, input) {
    const pop = document.createElement('div');
    pop.className = 'emoji-pop';
    pop.innerHTML = this.EMOJIS.map(e =>
      `<button type="button" class="emoji-pop__item">${e}</button>`).join('');
    pop.querySelectorAll('.emoji-pop__item').forEach(item => {
      item.onclick = () => {
        input.value = item.textContent;
        this.closeAll();
        input.focus();
      };
    });
    this._mount(btn, pop);
  },

  toggleColor(btn, input) {
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    const current = (input.value || '').trim() || '#FF8C00';
    pop.innerHTML = `
      <div class="color-pop__grid">
        ${this.COLORS.map(c => `
          <button type="button" class="color-pop__swatch${c.toLowerCase() === current.toLowerCase() ? ' active' : ''}"
            data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
      </div>
      <label class="color-pop__custom">自定义 <input type="color" value="${App.escapeHtml(current)}"></label>`;
    const apply = (color) => {
      input.value = color;
      const dot = btn.querySelector('.pick-color-dot');
      if (dot) dot.style.background = color;
      pop.querySelectorAll('.color-pop__swatch').forEach(sw =>
        sw.classList.toggle('active', sw.dataset.color.toLowerCase() === color.toLowerCase()));
    };
    pop.querySelectorAll('.color-pop__swatch').forEach(sw => {
      sw.onclick = () => { apply(sw.dataset.color); this.closeAll(); input.focus(); };
    });
    pop.querySelector('input[type="color"]').oninput = (e) => apply(e.target.value);
    this._mount(btn, pop);
  },

  closeAll() {
    document.querySelectorAll('.pick-pop').forEach(p => p.remove());
  },
};

// 点击选择器浮层与触发按钮以外的位置时关闭浮层
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.pick-pop') && !e.target.closest('.pick-btn')) Pickers.closeAll();
});

/* ------------------------------------------------------------------
   智能体对话视图 (SSE 流式 + 工具轨迹 + 记忆面板)
   ------------------------------------------------------------------ */
const AgentChat = {
  agent: null,
  session: null,
  sessions: [],
  sending: false,
  mentionProjectId: null,   // @ 选择的项目 id (作为 / 引用的项目上下文)

  init() {},

  /** 从智能体卡片进入对话 */
  async open(agent) {
    this.agent = agent;
    App.switchView('agent-chat');
  },

  async onShow() {
    if (!this.agent) {
      // 直接点导航进入: 默认取第一个智能体
      try {
        const agents = await API.getAgents();
        if (!agents.length) {
          App.showToast('暂无可用智能体', 'warning');
          App.switchView('agents');
          return;
        }
        this.agent = agents[0];
      } catch (err) {
        App.showToast(`加载失败: ${err.message}`, 'error');
        return;
      }
    }
    // 同一智能体且已有会话: 保留当前对话状态, 不重建
    const el = document.getElementById('view-agent-chat');
    if (el && el.dataset.agentId === String(this.agent.id) && this.session) {
      return;
    }
    this.session = null;
    this.mentionProjectId = null;
    await this.renderLayout();
    if (el) el.dataset.agentId = String(this.agent.id);
    await this.loadSessions();
    // 不自动创建新会话: 有历史会话则默认加载最近一次, 否则展示空状态
    if (this.sessions.length) {
      await this.openSession(this.sessions[0].id);
    } else {
      this.renderMessages([]);
      this.appendSystemHint(`点击左上角「+ 新会话」开始与「${this.agent.name}」对话`);
      this.loadMemories();
    }
  },

  async renderLayout() {
    const el = document.getElementById('view-agent-chat');
    if (!el) return;
    const cfg = this.agent.config || {};
    el.innerHTML = `
      <div class="chat-layout">
        <div class="chat-sessions">
          <div class="chat-sessions__head">
            <button class="cw-btn cw-btn--primary cw-btn--sm" id="chat-new-session" style="width:100%">+ 新会话</button>
          </div>
          <div class="chat-sessions__list" id="chat-sessions-list"></div>
        </div>
        <div class="chat-main">
          <div class="chat-main__header">
            <span style="font-size:20px">${cfg.icon || '🤖'}</span>
            <div class="chat-main__title">${App.escapeHtml(this.agent.name)}</div>
            <button class="cw-btn cw-btn--sm" id="chat-memory-toggle">🧠 记忆</button>
          </div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input">
            <textarea id="chat-textarea" rows="2" placeholder="输入消息, Enter 发送; @ 选择项目, / 引用会议/周报/里程碑/周任务, # 选择智能体/技能/工具"></textarea>
            <button class="cw-btn cw-btn--primary" id="chat-send">发送</button>
          </div>
        </div>
        <div class="chat-memory" id="chat-memory-panel">
          <div class="chat-memory__title">🧠 长期记忆</div>
          <div id="chat-memory-list"></div>
        </div>
      </div>`;

    document.getElementById('chat-new-session').onclick = () => this.newSession(true);
    document.getElementById('chat-send').onclick = () => this.send();
    document.getElementById('chat-memory-toggle').onclick = () => this.toggleMemory();

    const textarea = document.getElementById('chat-textarea');
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    // 接入 @项目 / /记录 输入联想
    MentionBox.attach(textarea, {
      getProjectId: () => this.mentionProjectId,
      onPickProject: (p) => {
        this.mentionProjectId = p.id;
        App.showToast(`已选择项目「${p.name}」, / 可引用其会议/周报/里程碑/周任务`, 'success');
      },
    });
    // 对话附件: ＋上传 / Ctrl+V 黏贴 (未 @项目 时落到当前激活项目附件目录)
    this.chatAttach = ChatAttach.attach(textarea, {
      getProjectId: () => this.mentionProjectId,
    });
  },

  async loadSessions() {
    const list = document.getElementById('chat-sessions-list');
    try {
      this.sessions = await API.getAgentSessions(this.agent.id);
    } catch (err) {
      this.sessions = [];
    }
    if (!list) return;
    list.innerHTML = this.sessions.map(s => {
      const time = (s.created_at || '').slice(5, 16).replace('T', ' ');
      return `
      <div class="chat-session-item" data-session-id="${s.id}">
        <span class="chat-session-item__title" title="${App.escapeHtml(s.title || '未命名会话')}">${time ? `<span class="chat-session-item__time">${time}</span>` : ''}${App.escapeHtml(s.title || '未命名会话')}</span>
        <span class="chat-session-item__del" data-del="${s.id}" title="归档">×</span>
      </div>`;
    }).join('') || '<div style="padding:8px;font-size:12px;color:var(--color-text-tertiary)">暂无历史会话</div>';

    list.querySelectorAll('.chat-session-item').forEach(item => {
      const sid = parseInt(item.dataset.sessionId, 10);
      item.onclick = (e) => {
        if (e.target.hasAttribute('data-del')) return;
        this.openSession(sid);
      };
    });
    list.querySelectorAll('[data-del]').forEach(del => {
      del.onclick = async (e) => {
        e.stopPropagation();
        const sid = parseInt(del.dataset.del, 10);
        // 记录被删会话位置, 删除后默认加载其下一条会话
        const idx = this.sessions.findIndex(s => s.id === sid);
        try {
          await API.archiveSession(sid);
          App.showToast('会话已归档', 'success');
          const wasCurrent = this.session && this.session.id === sid;
          await this.loadSessions();
          if (wasCurrent) {
            const next = this.sessions[Math.min(idx, this.sessions.length - 1)];
            if (next) {
              await this.openSession(next.id);
            } else {
              // 无剩余会话: 清空为空白状态, 不自动创建新会话
              this.session = null;
              this.renderMessages([]);
              this.appendSystemHint('会话已删除, 点击左上角「+ 新会话」开始新对话');
            }
          }
        } catch (err) {
          App.showToast(`归档失败: ${err.message}`, 'error');
        }
      };
    });
    // 列表重渲染后恢复当前会话高亮 (删除/发消息等触发的刷新会重置 DOM)
    this.markActiveSession();
  },

  async newSession(focus = true) {
    try {
      this.session = await API.createAgentSession(this.agent.id, {});
    } catch (err) {
      App.showToast(`创建会话失败: ${err.message}`, 'error');
      return;
    }
    await this.loadSessions();
    this.markActiveSession();
    this.renderMessages([]);
    this.appendSystemHint(`已开始与「${this.agent.name}」的新会话, 直接输入你的问题吧`);
    if (focus) document.getElementById('chat-textarea')?.focus();
    this.loadMemories();
  },

  async openSession(sessionId) {
    this.session = this.sessions.find(s => s.id === sessionId) || { id: sessionId };
    this.markActiveSession();
    try {
      const msgs = await API.getSessionMessages(sessionId);
      this.renderMessages(msgs);
    } catch (err) {
      App.showToast(`加载消息失败: ${err.message}`, 'error');
    }
    this.loadMemories();
  },

  markActiveSession() {
    document.querySelectorAll('.chat-session-item').forEach(item => {
      item.classList.toggle('active', this.session && parseInt(item.dataset.sessionId, 10) === this.session.id);
    });
  },

  renderMessages(msgs) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = '';
    msgs.filter(m => m.role === 'user' || m.role === 'assistant').forEach(m => {
      this.appendMessage(m.role, m.content);
    });
  },

  appendMessage(role, content) {
    const box = document.getElementById('chat-messages');
    if (!box) return null;
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg--${role === 'user' ? 'user' : 'assistant'}`;
    const icon = role === 'user' ? '👤' : ((this.agent.config || {}).icon || '🤖');
    const body = role === 'assistant' ? App.renderMarkdown(content) : App.escapeHtml(content);
    div.innerHTML = `
      <div class="chat-msg__avatar">${icon}</div>
      <div class="chat-msg__body">${body}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div.querySelector('.chat-msg__body');
  },

  appendSystemHint(text) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;font-size:12px;color:var(--color-text-tertiary)';
    div.textContent = text;
    box.appendChild(div);
  },

  /** 追加可折叠工具轨迹块 */
  appendTrace(name, statusText) {
    const box = document.getElementById('chat-messages');
    if (!box) return null;
    const div = document.createElement('div');
    div.className = 'chat-trace';
    div.innerHTML = `
      <div class="chat-trace__head">
        <span>🔧</span><span>${App.escapeHtml(name)}</span>
        <span class="chat-trace__badge">${App.escapeHtml(statusText)}</span>
      </div>
      <div class="chat-trace__body"></div>`;
    div.querySelector('.chat-trace__head').onclick = () => div.classList.toggle('open');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  },

  async send() {
    if (this.sending) return;
    const textarea = document.getElementById('chat-textarea');
    const message = (textarea.value || '').trim();
    const fileNames = this.chatAttach ? this.chatAttach.names() : [];
    if (!message && !fileNames.length) return;
    if (!this.session) {
      App.showToast('请先点击左上角「+ 新会话」创建会话', 'warning');
      return;
    }

    textarea.value = '';
    const marks = fileNames.map(f => `【附件 ${f}】`).join(' ');
    this.appendMessage('user', message + (marks ? `\n\n${marks}` : ''));
    const replyBody = this.appendMessage('assistant', '');
    let replyText = '';
    let lastTrace = null;
    this.sending = true;
    const sendBtn = document.getElementById('chat-send');
    if (sendBtn) sendBtn.disabled = true;

    try {
      await API.stream(`/agents/${this.agent.id}/chat`, {
        message, session_id: this.session.id, file_names: fileNames,
      }, (event) => {
        if (event.type === 'content') {
          replyText += event.content;
          replyBody.innerHTML = App.renderMarkdown(replyText);
          this.scrollBottom();
        } else if (event.type === 'tool_call') {
          lastTrace = this.appendTrace(event.name, '执行中');
          if (lastTrace) {
            lastTrace.querySelector('.chat-trace__body').innerHTML =
              `<pre>入参: ${App.escapeHtml(JSON.stringify(event.arguments, null, 2))}</pre>`;
          }
        } else if (event.type === 'tool_result') {
          if (lastTrace) {
            const badge = lastTrace.querySelector('.chat-trace__badge');
            badge.textContent = `完成 ${event.duration_ms}ms`;
            badge.classList.add('chat-trace__badge--ok');
            lastTrace.querySelector('.chat-trace__body').innerHTML +=
              `<pre>结果: ${App.escapeHtml(JSON.stringify(event.result, null, 2).slice(0, 2000))}</pre>`;
          }
          this.scrollBottom();
        } else if (event.type === 'done') {
          if (event.session_id && this.session) this.session.id = event.session_id;
        } else if (event.type === 'error') {
          replyText += `\n\n⚠️ ${event.content}`;
          replyBody.innerHTML = App.renderMarkdown(replyText);
        }
      });
      if (this.chatAttach) this.chatAttach.clear();
    } catch (err) {
      replyText += `\n\n⚠️ 请求失败: ${err.message}`;
      replyBody.innerHTML = App.renderMarkdown(replyText);
    } finally {
      this.sending = false;
      if (sendBtn) sendBtn.disabled = false;
      this.loadSessions();
      this.loadMemories();
    }
  },

  scrollBottom() {
    const box = document.getElementById('chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
  },

  async toggleMemory() {
    const panel = document.getElementById('chat-memory-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) this.loadMemories();
  },

  async loadMemories() {
    const panel = document.getElementById('chat-memory-panel');
    const list = document.getElementById('chat-memory-list');
    if (!panel || !panel.classList.contains('open') || !list || !this.agent) return;
    let memories = [];
    try {
      memories = await API.getAgentMemories(this.agent.id);
    } catch (err) { /* 忽略 */ }
    list.innerHTML = memories.map(m => `
      <div class="memory-item">
        <div class="memory-item__head">
          <span class="memory-item__type">${App.escapeHtml(m.memory_type)}</span>
          <span class="memory-item__key">${App.escapeHtml(m.key || '')}</span>
          <span class="memory-item__del" data-mem-id="${m.id}">×</span>
        </div>
        <div class="memory-item__content">${App.escapeHtml(m.content)}</div>
      </div>`).join('') || '<div style="font-size:12px;color:var(--color-text-tertiary)">暂无记忆</div>';

    list.querySelectorAll('[data-mem-id]').forEach(del => {
      del.onclick = async () => {
        try {
          await API.deleteAgentMemory(this.agent.id, parseInt(del.dataset.memId, 10));
          this.loadMemories();
        } catch (err) {
          App.showToast(`删除失败: ${err.message}`, 'error');
        }
      };
    });
  }
};

/* ------------------------------------------------------------------
   智能体构建器 (左表单 + 右调试)
   ------------------------------------------------------------------ */
const CoworkBuilder = {
  editing: null,        // 正在编辑的 agent, null=新建
  debugSessionId: null, // 调试上下文会话 id (多轮调试共享上下文记忆)
  debugging: false,
  /* 全部可用工具: [工具名, 中文注释] —— 与后端 TOOL_DEFINITIONS 保持一致 */
  ALL_TOOLS: [
    ['get_today', '获取当前日期与本周起止 (感知时间)'],
    ['get_project_info', '获取当前激活项目信息'],
    ['get_progress_tasks', '查询进度计划任务列表'],
    ['create_progress_task', '创建进度任务/里程碑'],
    ['update_progress_task', '更新进度任务 (状态/日期/负责人等)'],
    ['get_phases', '查询项目阶段列表'],
    ['get_modules', '查询项目模块列表'],
    ['get_weekly_reports', '查询周报列表 (最近10份)'],
    ['get_weekly_report_detail', '查询周报详情 (KPI/进展/下周任务/风险)'],
    ['create_weekly_report', '创建本周周报 (自动复制上周草稿)'],
    ['get_meetings', '查询会议列表 (最近10个)'],
    ['get_meeting_detail', '查询会议详情 (含议程项)'],
    ['create_meeting', '创建会议'],
    ['update_meeting', '更新会议记录到数据库 (主题/纪要/参会人等)'],
    ['add_meeting_item', '添加会议议程项/纪要条目'],
    ['get_work_tasks', '查询每周工作任务'],
    ['create_work_task', '创建每周工作任务'],
    ['update_work_task', '更新每周工作任务 (状态/工时/优先级)'],
    ['run_skill', '执行技能 (按名称或ID调用技能工作流)'],
    ['save_memory', '保存长期记忆 (事实/偏好/决策)'],
  ],
  AGENT_TYPES: [
    ['progress', '进度管理'], ['meeting', '会议管理'],
    ['weekly_report', '周报编写'], ['work_plan', '工作计划'], ['custom', '自定义'],
  ],

  init() {},

  onShow() {
    if (!this._dirty) this.openCreate();
  },

  openCreate() {
    this.editing = null;
    this.debugSessionId = null;
    this._dirty = true;
    App.switchView('builder');
    this.renderForm({
      name: '', type: 'custom', description: '', system_prompt: '',
      tools: ['get_today', 'get_project_info', 'run_skill', 'save_memory'],
      config: { icon: '🤖', color: '#FF8C00' },
    });
  },

  /** 复制已有智能体: 预填配置, 名称加副本后缀, 保存后生成新分身 */
  openCopy(agent) {
    this.editing = null;
    this.debugSessionId = null;
    this._dirty = true;
    App.switchView('builder');
    this.renderForm({
      name: `${agent.name} 副本`,
      type: agent.type || 'custom',
      description: agent.description || '',
      system_prompt: agent.system_prompt || '',
      tools: [...(agent.tools || [])],
      config: { ...(agent.config || { icon: '🤖', color: '#FF8C00' }) },
    });
    App.showToast(`已复制「${agent.name}」配置, 保存后生成新分身`, 'success');
  },

  openEdit(agent) {
    this.editing = agent;
    this.debugSessionId = null;  // 切换编辑对象时重置调试上下文
    this._dirty = true;
    App.switchView('builder');
    this.renderForm(agent);
  },

  renderForm(agent) {
    const el = document.getElementById('view-builder');
    if (!el) return;
    const cfg = agent.config || {};
    const tools = agent.tools || [];

    el.innerHTML = `
      <div class="builder-layout">
        <div class="builder-form">
          <div class="builder-form__title">${this.editing ? '编辑智能体' : '新建智能体'}</div>
          <div class="form-row">
            <div class="form-field">
              <label>名称 *</label>
              <input type="text" id="bf-name" value="${App.escapeHtml(agent.name)}" placeholder="如: 进度管理助手">
            </div>
            <div class="form-field">
              <label>类型</label>
              <select id="bf-type">
                ${this.AGENT_TYPES.map(([v, l]) =>
                  `<option value="${v}" ${agent.type === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-field">
            <label>描述</label>
            <input type="text" id="bf-desc" value="${App.escapeHtml(agent.description || '')}" placeholder="一句话说明智能体职责">
          </div>
          <div class="form-row">
            <div class="form-field">
              <label>图标 Emoji</label>
              <div class="pick-field">
                <input type="text" id="bf-icon" value="${App.escapeHtml(cfg.icon || '🤖')}">
                <button type="button" class="cw-btn cw-btn--sm pick-btn" data-pick-emoji="#bf-icon" title="选择 Emoji">😀</button>
              </div>
            </div>
            <div class="form-field">
              <label>主题色</label>
              <div class="pick-field">
                <input type="text" id="bf-color" value="${App.escapeHtml(cfg.color || '#FF8C00')}" placeholder="#FF8C00">
                <button type="button" class="cw-btn cw-btn--sm pick-btn" data-pick-color="#bf-color" title="选择颜色">
                  <span class="pick-color-dot" style="background:${App.escapeHtml(cfg.color || '#FF8C00')}"></span>
                </button>
              </div>
            </div>
          </div>
          <div class="form-field">
            <label>系统提示词 (角色定义 + 行为准则)</label>
            <textarea id="bf-prompt" rows="10" placeholder="你是…">${App.escapeHtml(agent.system_prompt || '')}</textarea>
          </div>
          <div class="form-field">
            <label>可用工具 (决策与执行能力)</label>
            <div class="tool-checks">
              ${this.ALL_TOOLS.map(([t, zh]) => `
                <label class="tool-check" title="${t}">
                  <input type="checkbox" value="${t}" ${tools.includes(t) ? 'checked' : ''}>
                  <span class="tool-check__zh">${zh}</span>
                  <span class="tool-check__en">${t}</span>
                </label>`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="cw-btn cw-btn--primary" id="bf-save">💾 保存</button>
            <button class="cw-btn" id="bf-back">返回列表</button>
          </div>
        </div>
        <div class="builder-debug">
          <div class="builder-debug__title">
            🧪 调试面板 ${this.editing ? '' : '(保存后可用)'}
            <span class="debug-ctx-badge" id="debug-ctx-badge" title="多轮调试共享上下文记忆, 如先创建会议再保存纪要"></span>
          </div>
          <div id="debug-output"></div>
          <div class="form-field debug-input-row" style="margin-top:auto">
            <textarea id="debug-input" rows="3" placeholder="输入测试消息, 支持 @ 项目 / 记录 # 资源; 多轮调试自动携带上下文"></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button class="cw-btn cw-btn--primary" id="debug-run" ${this.editing ? '' : 'disabled'} style="flex:1">▶ 运行调试</button>
            <button class="cw-btn" id="debug-clear" title="清空调试输出并重置上下文记忆">🔄 重置</button>
          </div>
        </div>
      </div>`;

    document.getElementById('bf-save').onclick = () => this.save();
    document.getElementById('bf-back').onclick = () => {
      this._dirty = false;
      App.switchView('agents');
    };
    document.getElementById('debug-run').onclick = () => this.runDebug();
    document.getElementById('debug-clear').onclick = () => this.clearDebug();
    const debugInput = document.getElementById('debug-input');
    debugInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.runDebug();
      }
    });
    // 调试输入框: @ 项目 / 记录 # 资源
    MentionBox.attach(debugInput, {});
    // 调试附件: ＋上传 / Ctrl+V 黏贴
    this.debugAttach = ChatAttach.attach(debugInput, {});
    // Emoji / 主题色选择器
    Pickers.bind(el);
    this.updateCtxBadge();
  },

  /** 更新调试上下文徽章 */
  updateCtxBadge() {
    const badge = document.getElementById('debug-ctx-badge');
    if (!badge) return;
    badge.textContent = this.debugSessionId ? `上下文 #${this.debugSessionId}` : '无上下文';
    badge.classList.toggle('debug-ctx-badge--on', !!this.debugSessionId);
  },

  /** 清空调试输出并重置上下文记忆 (下轮调试开启新会话) */
  clearDebug() {
    this.debugSessionId = null;
    const output = document.getElementById('debug-output');
    if (output) output.innerHTML = '<div style="font-size:12px;color:var(--color-text-tertiary)">已重置, 下轮调试将开启新的上下文</div>';
    this.updateCtxBadge();
  },

  async save() {
    const payload = {
      name: document.getElementById('bf-name').value.trim(),
      type: document.getElementById('bf-type').value,
      description: document.getElementById('bf-desc').value.trim(),
      system_prompt: document.getElementById('bf-prompt').value,
      tools: Array.from(document.querySelectorAll('.tool-check input:checked')).map(i => i.value),
      config: {
        icon: document.getElementById('bf-icon').value.trim() || '🤖',
        color: document.getElementById('bf-color').value.trim() || '#FF8C00',
      },
    };
    if (!payload.name) {
      App.showToast('请填写智能体名称', 'warning');
      return;
    }
    try {
      if (this.editing) {
        this.editing = await API.updateAgent(this.editing.id, payload);
        App.showToast('已保存', 'success');
      } else {
        this.editing = await API.createAgent(payload);
        App.showToast('已创建, 现在可以调试了', 'success');
      }
      // 保存后开启全新调试上下文; 重新渲染以启用调试按钮
      this.debugSessionId = null;
      this.renderForm(this.editing);
    } catch (err) {
      App.showToast(`保存失败: ${err.message}`, 'error');
    }
  },

  /** 运行调试: 多轮共享上下文会话, 累积展示每轮详情 (入参/出参/注入记忆) */
  async runDebug() {
    if (!this.editing || this.debugging) return;
    const input = document.getElementById('debug-input');
    const output = document.getElementById('debug-output');
    const message = (input.value || '').trim();
    const fileNames = this.debugAttach ? this.debugAttach.names() : [];
    if (!message && !fileNames.length) return;

    this.debugging = true;
    const runBtn = document.getElementById('debug-run');
    runBtn.disabled = true;
    input.value = '';

    // 清除占位提示, 追加本轮用户输入块
    const placeholder = output.querySelector('.debug-hint');
    if (placeholder) placeholder.remove();
    const marks = fileNames.map(f => `【附件 ${f}】`).join(' ');
    const roundDiv = document.createElement('div');
    roundDiv.className = 'debug-round';
    roundDiv.innerHTML = `
      <div class="debug-round__user">${App.escapeHtml(message + (marks ? `\n${marks}` : ''))}</div>
      <div class="debug-round__body"><div style="font-size:12px;color:var(--color-text-tertiary)">执行中…</div></div>`;
    output.appendChild(roundDiv);
    output.scrollTop = output.scrollHeight;
    const body = roundDiv.querySelector('.debug-round__body');

    try {
      const res = await API.debugAgent(this.editing.id, message, this.debugSessionId, fileNames);
      if (this.debugAttach) this.debugAttach.clear();
      if (res.session_id) {
        this.debugSessionId = res.session_id;
        this.updateCtxBadge();
      }
      let html = `<div class="debug-meta">模型: ${App.escapeHtml(res.model || '-')}</div>`;
      // 注入记忆 (记忆效果测试: 与正式对话一致的记忆注入)
      if (res.memories && res.memories.length) {
        html += `
          <details class="debug-mem">
            <summary>🧠 本次注入记忆 ${res.memories.length} 条 (含项目关联与通用记忆)</summary>
            ${res.memories.map(m => `
              <div class="debug-mem__item">
                <span class="memory-item__type">${App.escapeHtml(m.memory_type)}</span>
                <b>${App.escapeHtml(m.key || '')}</b>${m.project_id ? ` <span class="memory-item__project">项目#${m.project_id}</span>` : ' <span class="memory-item__project">通用</span>'}
                <div>${App.escapeHtml(m.content)}</div>
              </div>`).join('')}
          </details>`;
      } else {
        html += '<div class="debug-meta">🧠 本次未注入任何记忆</div>';
      }
      if (res.error) {
        html += `<div class="debug-reply debug-reply--error">⚠️ ${App.escapeHtml(res.error)}</div>`;
      }
      // 每轮执行轨迹: 输出 + 工具入参/出参/耗时
      (res.trace || []).forEach(round => {
        html += `
          <div class="debug-trace-round">
            <div class="debug-trace-round__head">第 ${round.round} 轮 · ${App.escapeHtml(round.finish_reason || '')}</div>
            <div class="debug-trace-round__body">
              ${round.content ? `<pre>输出: ${App.escapeHtml(round.content)}</pre>` : ''}
              ${(round.tool_calls || []).map(tc => `
                <pre>🔧 ${App.escapeHtml(tc.name)}\n入参: ${App.escapeHtml(JSON.stringify(tc.arguments, null, 2))}\n出参: ${App.escapeHtml(JSON.stringify(tc.result, null, 2).slice(0, 1500))}\n耗时: ${tc.duration_ms}ms</pre>
              `).join('')}
            </div>
          </div>`;
      });
      if (res.reply) {
        html += `<div class="debug-reply">${App.renderMarkdown(res.reply)}</div>`;
      }
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<div class="debug-reply debug-reply--error">请求失败: ${App.escapeHtml(err.message)}</div>`;
    } finally {
      this.debugging = false;
      runBtn.disabled = false;
      output.scrollTop = output.scrollHeight;
    }
  }
};

/* ------------------------------------------------------------------
   技能列表视图
   ------------------------------------------------------------------ */
const CoworkSkills = {
  skills: [],

  init() {},

  async onShow() {
    await this.render();
  },

  async render() {
    const el = document.getElementById('view-skills');
    if (!el) return;
    el.innerHTML = `
      <div class="cw-page">
        <div class="cw-page__header">
          <div>
            <div class="cw-page__title">技能</div>
            <div class="cw-page__subtitle">JSON 工作流工具链, 可被智能体通过 run_skill 调用</div>
          </div>
          <button class="cw-btn cw-btn--primary" id="skill-create-btn">+ 新建技能</button>
        </div>
        <div class="skill-grid" id="skill-grid"><div class="empty-state">加载中…</div></div>
      </div>`;

    document.getElementById('skill-create-btn').onclick = () => SkillBuilder.openCreate();

    try {
      this.skills = await API.getSkills();
    } catch (err) {
      App.showToast(`加载技能失败: ${err.message}`, 'error');
      this.skills = [];
    }

    const grid = document.getElementById('skill-grid');
    if (!this.skills.length) {
      grid.innerHTML = '<div class="empty-state">暂无技能</div>';
      return;
    }

    grid.innerHTML = this.skills.map(s => {
      const cfg = s.config || {};
      let stepCount = 0;
      try { stepCount = (JSON.parse(s.code || '{}').steps || []).length; } catch (e) { /* 忽略 */ }
      return `
        <div class="skill-card" data-skill-id="${s.id}">
          <div class="skill-card__head">
            <div class="skill-card__icon" style="background:${App.escapeHtml(cfg.color || '#8B5CF6')}">${cfg.icon || '⚡'}</div>
            <div>
              <div class="skill-card__name">${App.escapeHtml(s.name)}</div>
              <div class="skill-card__meta">
                <span class="skill-tag">${App.escapeHtml(s.category || 'general')}</span>
                <span class="skill-tag">${App.escapeHtml(s.trigger_type)}</span>
                <span class="skill-tag">${stepCount} 步</span>
              </div>
            </div>
          </div>
          <div class="skill-card__desc">${App.escapeHtml(s.description || '暂无描述')}</div>
          <div class="skill-card__footer">
            <button class="cw-btn cw-btn--primary cw-btn--sm" data-action="run">▶ 执行</button>
            <button class="cw-btn cw-btn--sm" data-action="history">📜 记录</button>
            <button class="cw-btn cw-btn--sm" data-action="copy">📋 复制</button>
            <button class="cw-btn cw-btn--sm" data-action="edit">✏️</button>
            <button class="cw-btn cw-btn--sm cw-btn--danger" data-action="delete">🗑</button>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.skill-card').forEach(card => {
      const id = parseInt(card.dataset.skillId, 10);
      const skill = this.skills.find(s => s.id === id);
      card.querySelector('[data-action="run"]').onclick = () => this.runSkill(skill);
      card.querySelector('[data-action="history"]').onclick = () => this.showHistory(skill);
      card.querySelector('[data-action="copy"]').onclick = () => SkillBuilder.openCopy(skill);
      card.querySelector('[data-action="edit"]').onclick = () => SkillBuilder.openEdit(skill);
      card.querySelector('[data-action="delete"]').onclick = async () => {
        try {
          await API.deleteSkill(id);
          App.showToast('已删除', 'success');
          this.render();
        } catch (err) {
          App.showToast(`删除失败: ${err.message}`, 'error');
        }
      };
    });
  },

  /** 执行技能: 弹窗输入 JSON 参数, 展示结果 */
  runSkill(skill) {
    const modal = App.openModal({
      title: `执行技能: ${skill.name}`,
      size: 'lg',
      bodyHtml: `
        <div class="form-field">
          <label>输入参数 (JSON, 可留空)</label>
          <textarea id="skill-run-input" class="code-editor" rows="4" placeholder='{"key": "value"}'></textarea>
        </div>
        <div id="skill-run-result"></div>`,
      footerHtml: `
        <button class="cw-btn" data-modal-close>关闭</button>
        <button class="cw-btn cw-btn--primary" id="skill-run-go">▶ 执行</button>`,
    });

    modal.querySelector('#skill-run-go').onclick = async () => {
      const raw = modal.querySelector('#skill-run-input').value.trim();
      let inputData = {};
      if (raw) {
        try { inputData = JSON.parse(raw); }
        catch (e) {
          App.showToast('输入参数不是有效 JSON', 'warning');
          return;
        }
      }
      const resultEl = modal.querySelector('#skill-run-result');
      resultEl.innerHTML = '<div style="font-size:12px;color:var(--color-text-tertiary)">执行中…</div>';
      try {
        const exec = await API.executeSkill(skill.id, inputData);
        const statusCls = exec.status === 'success' ? 'exec-status--success' : 'exec-status--failed';
        resultEl.innerHTML = `
          <div class="exec-item">
            <div class="exec-item__head">
              <span class="exec-status ${statusCls}">${App.escapeHtml(exec.status)}</span>
              <span>${exec.duration_ms}ms</span>
            </div>
            ${exec.error ? `<pre>错误: ${App.escapeHtml(exec.error)}</pre>` : ''}
            <pre>${App.escapeHtml(JSON.stringify(exec.output_data, null, 2).slice(0, 3000))}</pre>
          </div>`;
      } catch (err) {
        resultEl.innerHTML = `<div class="exec-item"><pre>请求失败: ${App.escapeHtml(err.message)}</pre></div>`;
      }
    };
  },

  /** 查看执行记录 */
  async showHistory(skill) {
    let execs = [];
    try {
      execs = await API.getSkillExecutions(skill.id);
    } catch (err) {
      App.showToast(`加载记录失败: ${err.message}`, 'error');
      return;
    }
    const body = execs.length ? execs.map(e => {
      const cls = e.status === 'success' ? 'exec-status--success'
        : e.status === 'failed' ? 'exec-status--failed' : 'exec-status--running';
      return `
        <div class="exec-item">
          <div class="exec-item__head">
            <span class="exec-status ${cls}">${App.escapeHtml(e.status)}</span>
            <span>#${e.id}</span>
            <span>${App.escapeHtml((e.created_at || '').slice(0, 19).replace('T', ' '))}</span>
            <span>${e.duration_ms}ms</span>
          </div>
          ${e.error ? `<pre>错误: ${App.escapeHtml(e.error)}</pre>` : ''}
          <pre>${App.escapeHtml(JSON.stringify(e.output_data, null, 2).slice(0, 1200))}</pre>
        </div>`;
    }).join('') : '<div class="empty-state">暂无执行记录</div>';

    App.openModal({
      title: `执行记录: ${skill.name}`,
      size: 'lg',
      bodyHtml: body,
      footerHtml: '<button class="cw-btn" data-modal-close>关闭</button>',
    });
  }
};

/* ------------------------------------------------------------------
   技能构建器 (表单 + JSON 工作流编辑器 + 测试)
   ------------------------------------------------------------------ */
const SkillBuilder = {
  editing: null,
  _dirty: false,
  testPriorResults: [],  // 调试上下文: 前几轮测试的 steps 结果 (供 {{results.N}} 引用)
  testing: false,
  CATEGORIES: [['data', '数据查询'], ['api', 'API 调用'], ['workflow', '工作流'], ['notification', '通知']],

  init() {},

  onShow() {
    if (!this._dirty) this.openCreate();
  },

  openCreate() {
    this.editing = null;
    this.testPriorResults = [];
    this._dirty = true;
    App.switchView('skill-builder');
    this.renderForm({
      name: '', description: '', category: 'workflow', trigger_type: 'manual',
      config: { icon: '⚡', color: '#8B5CF6' },
      code: JSON.stringify({ steps: [{ tool: 'get_today', arguments: {} }] }, null, 2),
    });
  },

  /** 复制已有技能: 预填配置, 名称加副本后缀, 保存后生成新技能 */
  openCopy(skill) {
    this.editing = null;
    this.testPriorResults = [];
    this._dirty = true;
    App.switchView('skill-builder');
    let code = skill.code || '';
    try { code = JSON.stringify(JSON.parse(code), null, 2); } catch (e) { /* 保持原样 */ }
    this.renderForm({
      name: `${skill.name} 副本`,
      description: skill.description || '',
      category: skill.category || 'workflow',
      trigger_type: skill.trigger_type || 'manual',
      config: { ...(skill.config || { icon: '⚡', color: '#8B5CF6' }) },
      code,
    });
    App.showToast(`已复制「${skill.name}」配置, 保存后生成新技能`, 'success');
  },

  openEdit(skill) {
    this.editing = skill;
    this.testPriorResults = [];
    this._dirty = true;
    App.switchView('skill-builder');
    let code = skill.code || '';
    try { code = JSON.stringify(JSON.parse(code), null, 2); } catch (e) { /* 保持原样 */ }
    this.renderForm({ ...skill, code });
  },

  renderForm(skill) {
    const el = document.getElementById('view-skill-builder');
    if (!el) return;
    const cfg = skill.config || {};

    el.innerHTML = `
      <div class="builder-layout">
        <div class="builder-form">
          <div class="builder-form__title">${this.editing ? '编辑技能' : '新建技能'}</div>
          <div class="form-row">
            <div class="form-field">
              <label>名称 *</label>
              <input type="text" id="sf-name" value="${App.escapeHtml(skill.name)}" placeholder="如: 延期任务扫描">
            </div>
            <div class="form-field">
              <label>分类</label>
              <select id="sf-category">
                ${this.CATEGORIES.map(([v, l]) =>
                  `<option value="${v}" ${skill.category === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-field">
            <label>描述</label>
            <input type="text" id="sf-desc" value="${App.escapeHtml(skill.description || '')}" placeholder="一句话说明技能用途">
          </div>
          <div class="form-row">
            <div class="form-field">
              <label>图标 Emoji</label>
              <div class="pick-field">
                <input type="text" id="sf-icon" value="${App.escapeHtml(cfg.icon || '⚡')}">
                <button type="button" class="cw-btn cw-btn--sm pick-btn" data-pick-emoji="#sf-icon" title="选择 Emoji">😀</button>
              </div>
            </div>
            <div class="form-field">
              <label>主题色</label>
              <div class="pick-field">
                <input type="text" id="sf-color" value="${App.escapeHtml(cfg.color || '#8B5CF6')}">
                <button type="button" class="cw-btn cw-btn--sm pick-btn" data-pick-color="#sf-color" title="选择颜色">
                  <span class="pick-color-dot" style="background:${App.escapeHtml(cfg.color || '#8B5CF6')}"></span>
                </button>
              </div>
            </div>
            <div class="form-field">
              <label>触发方式</label>
              <select id="sf-trigger">
                <option value="manual" ${skill.trigger_type === 'manual' ? 'selected' : ''}>手动</option>
                <option value="scheduled" ${skill.trigger_type === 'scheduled' ? 'selected' : ''}>定时</option>
                <option value="event" ${skill.trigger_type === 'event' ? 'selected' : ''}>事件</option>
              </select>
            </div>
          </div>
          <div class="form-field">
            <label>工作流定义 (JSON: steps 工具链, 参数支持 {{input.xxx}} / {{results.0.result.xxx}})</label>
            <textarea id="sf-code" class="code-editor" rows="14">${App.escapeHtml(skill.code || '')}</textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="cw-btn cw-btn--primary" id="sf-save">💾 保存</button>
            <button class="cw-btn" id="sf-validate">✓ 校验 JSON</button>
            <button class="cw-btn" id="sf-back">返回列表</button>
          </div>
        </div>
        <div class="builder-debug">
          <div class="builder-debug__title">
            🧪 测试执行 ${this.editing ? '' : '(保存后可用)'}
            <span class="debug-ctx-badge" id="sf-ctx-badge" title="多轮测试共享上下文: 本轮可用 {{results.N}} 引用前几轮产物"></span>
          </div>
          <div class="form-field">
            <label>输入参数 (JSON)</label>
            <textarea id="sf-test-input" class="code-editor" rows="4" placeholder='{}'></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button class="cw-btn cw-btn--primary" id="sf-test-run" ${this.editing ? '' : 'disabled'} style="flex:1">▶ 执行测试</button>
            <button class="cw-btn" id="sf-test-clear" title="清空测试输出并重置上下文">🔄 重置</button>
          </div>
          <div id="sf-test-result" style="margin-top:12px"></div>
        </div>
      </div>`;

    document.getElementById('sf-save').onclick = () => this.save();
    document.getElementById('sf-validate').onclick = () => {
      try {
        JSON.parse(document.getElementById('sf-code').value);
        App.showToast('JSON 格式正确', 'success');
      } catch (e) {
        App.showToast(`JSON 格式错误: ${e.message}`, 'error');
      }
    };
    document.getElementById('sf-back').onclick = () => {
      this._dirty = false;
      App.switchView('skills');
    };
    const testBtn = document.getElementById('sf-test-run');
    if (testBtn) testBtn.onclick = () => this.testRun();
    document.getElementById('sf-test-clear').onclick = () => {
      this.testPriorResults = [];
      const resultEl = document.getElementById('sf-test-result');
      if (resultEl) resultEl.innerHTML = '<div style="font-size:12px;color:var(--color-text-tertiary)">已重置, 下轮测试将开启新的上下文</div>';
      this.updateCtxBadge();
    };
    // Emoji / 主题色选择器
    Pickers.bind(el);
    this.updateCtxBadge();
  },

  /** 更新测试上下文徽章 */
  updateCtxBadge() {
    const badge = document.getElementById('sf-ctx-badge');
    if (!badge) return;
    const n = this.testPriorResults.length;
    badge.textContent = n ? `上下文 ${n} 步` : '无上下文';
    badge.classList.toggle('debug-ctx-badge--on', n > 0);
  },

  async save() {
    const codeRaw = document.getElementById('sf-code').value.trim();
    if (codeRaw) {
      try { JSON.parse(codeRaw); }
      catch (e) {
        App.showToast(`工作流 JSON 格式错误: ${e.message}`, 'error');
        return;
      }
    }
    const payload = {
      name: document.getElementById('sf-name').value.trim(),
      description: document.getElementById('sf-desc').value.trim(),
      category: document.getElementById('sf-category').value,
      trigger_type: document.getElementById('sf-trigger').value,
      config: {
        icon: document.getElementById('sf-icon').value.trim() || '⚡',
        color: document.getElementById('sf-color').value.trim() || '#8B5CF6',
      },
      code: codeRaw,
    };
    if (!payload.name) {
      App.showToast('请填写技能名称', 'warning');
      return;
    }
    try {
      if (this.editing) {
        this.editing = await API.updateSkill(this.editing.id, payload);
        App.showToast('已保存', 'success');
      } else {
        this.editing = await API.createSkill(payload);
        App.showToast('已创建, 现在可以测试了', 'success');
      }
      this.testPriorResults = [];
      this.renderForm({ ...this.editing, code: codeRaw });
    } catch (err) {
      App.showToast(`保存失败: ${err.message}`, 'error');
    }
  },

  /** 执行测试: 携带上下文 prior_results, 累积展示每步入参/出参/耗时 */
  async testRun() {
    if (!this.editing || this.testing) return;
    const raw = document.getElementById('sf-test-input').value.trim();
    let inputData = {};
    if (raw) {
      try { inputData = JSON.parse(raw); }
      catch (e) {
        App.showToast('输入参数不是有效 JSON', 'warning');
        return;
      }
    }
    this.testing = true;
    const testBtn = document.getElementById('sf-test-run');
    testBtn.disabled = true;

    const resultEl = document.getElementById('sf-test-result');
    const placeholder = resultEl.querySelector('.debug-hint');
    if (placeholder) placeholder.remove();
    const roundDiv = document.createElement('div');
    roundDiv.className = 'debug-round';
    roundDiv.innerHTML = `
      <div class="debug-round__user">输入: ${App.escapeHtml(JSON.stringify(inputData))}</div>
      <div class="debug-round__body"><div style="font-size:12px;color:var(--color-text-tertiary)">执行中…</div></div>`;
    resultEl.appendChild(roundDiv);
    const body = roundDiv.querySelector('.debug-round__body');

    try {
      const res = await API.testSkill(this.editing.id, inputData, this.testPriorResults);
      // 上下文记忆: 完整 results 供下轮 {{results.N}} 引用
      this.testPriorResults = res.results || [];
      this.updateCtxBadge();

      const cls = res.status === 'success' ? 'exec-status--success' : 'exec-status--failed';
      let html = `
        <div class="exec-item__head">
          <span class="exec-status ${cls}">${App.escapeHtml(res.status)}</span>
          <span>${res.duration_ms}ms</span>
        </div>`;
      if (res.error) {
        html += `<pre>错误: ${App.escapeHtml(res.error)}</pre>`;
      }
      // 每步详情: 工具/内置能力 + 入参 + 出参 + 耗时
      (res.steps || []).forEach(step => {
        html += `
          <div class="debug-trace-round">
            <div class="debug-trace-round__head">步骤 ${(step.step ?? 0) + 1} · ${App.escapeHtml(step.tool || '-')}</div>
            <div class="debug-trace-round__body">
              <pre>入参: ${App.escapeHtml(JSON.stringify(step.arguments, null, 2))}\n出参: ${App.escapeHtml(JSON.stringify(step.result, null, 2).slice(0, 1500))}\n耗时: ${step.duration_ms}ms</pre>
            </div>
          </div>`;
      });
      if (!(res.steps || []).length && !res.error) {
        html += '<pre>无执行步骤</pre>';
      }
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<div class="debug-reply debug-reply--error">请求失败: ${App.escapeHtml(err.message)}</div>`;
    } finally {
      this.testing = false;
      testBtn.disabled = false;
    }
  }
};

/* ------------------------------------------------------------------
   记忆维护视图 (项目 × 智能体 双维度的记忆管理)
   ------------------------------------------------------------------ */
const CoworkMemories = {
  agents: [],
  projects: [],
  testSessionId: null,  // 记忆测试调试会话 (多轮测试共享上下文)
  testing: false,

  init() {},

  async onShow() {
    const el = document.getElementById('view-memories');
    if (!el) return;
    el.innerHTML = `
      <div class="cw-page">
        <div class="cw-page__header">
          <div>
            <div class="cw-page__title">记忆维护</div>
            <div class="cw-page__subtitle">每个项目拥有独立记忆空间: 事实 / 偏好 / 上下文 / 决策</div>
          </div>
        </div>
        <div class="memories-toolbar">
          <select id="mem-project-filter"><option value="">全部项目(通用)</option></select>
          <select id="mem-agent-filter"><option value="">选择智能体…</option></select>
          <select id="mem-type-filter">
            <option value="">全部类型</option>
            <option value="fact">事实 fact</option>
            <option value="preference">偏好 preference</option>
            <option value="context">上下文 context</option>
            <option value="decision">决策 decision</option>
          </select>
          <button class="cw-btn cw-btn--primary cw-btn--sm" id="mem-add-btn">+ 新增记忆</button>
        </div>
        <div class="memories-list" id="memories-list"><div class="empty-state">请先选择智能体</div></div>
        <div class="mem-test">
          <div class="mem-test__title">
            🧪 记忆测试
            <span class="debug-ctx-badge" id="mem-test-badge" title="多轮测试共享调试会话上下文"></span>
          </div>
          <div class="mem-test__hint">对当前所选智能体发送测试消息, 验证已维护记忆 (含项目关联记忆) 在生成中的注入与表现</div>
          <div id="mem-test-output"><div class="debug-hint">输入测试消息, 查看哪些记忆被注入以及回复效果</div></div>
          <div class="form-field debug-input-row">
            <textarea id="mem-test-input" rows="2" placeholder="输入测试消息… 支持 @ 项目 / 记录 # 资源 (Enter 运行, Shift+Enter 换行)"></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button class="cw-btn cw-btn--primary cw-btn--sm" id="mem-test-run" style="flex:1">▶ 运行测试</button>
            <button class="cw-btn cw-btn--sm" id="mem-test-clear" title="清空输出并重置测试上下文">🔄 重置</button>
          </div>
        </div>
      </div>`;

    try {
      [this.agents, this.projects] = await Promise.all([API.getAgents(), API.getProjects()]);
    } catch (err) {
      this.agents = [];
    }
    const agentSel = document.getElementById('mem-agent-filter');
    agentSel.innerHTML = '<option value="">选择智能体…</option>' +
      this.agents.map(a => `<option value="${a.id}">${App.escapeHtml(a.name)}</option>`).join('');
    if (this.agents.length) agentSel.value = String(this.agents[0].id);

    const projSel = document.getElementById('mem-project-filter');
    projSel.innerHTML = '<option value="">全部项目(通用)</option>' +
      this.projects.map(p => `<option value="${p.id}">${App.escapeHtml(p.name)}${p.is_active ? ' ★' : ''}</option>`).join('');
    // 默认选中激活项目
    const active = this.projects.find(p => p.is_active);
    if (active) projSel.value = String(active.id);

    agentSel.onchange = () => {
      // 切换智能体: 测试上下文随之失效
      this.testSessionId = null;
      this.updateTestBadge();
      this.renderList();
    };
    projSel.onchange = () => this.renderList();
    document.getElementById('mem-type-filter').onchange = () => this.renderList();
    document.getElementById('mem-add-btn').onclick = () => this.addMemory();

    // 记忆测试: 运行/重置
    this.testSessionId = null;
    document.getElementById('mem-test-run').onclick = () => this.runTest();
    document.getElementById('mem-test-clear').onclick = () => {
      this.testSessionId = null;
      this.updateTestBadge();
      const output = document.getElementById('mem-test-output');
      if (output) output.innerHTML = '<div class="debug-hint">已重置, 下轮测试将开启新的上下文</div>';
    };
    const testInput = document.getElementById('mem-test-input');
    testInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.runTest();
      }
    });
    MentionBox.attach(testInput, {});
    // 测试附件: ＋上传 / Ctrl+V 黏贴
    this.testAttach = ChatAttach.attach(testInput, {});
    this.updateTestBadge();
    await this.renderList();
  },

  /** 更新记忆测试上下文徽章 */
  updateTestBadge() {
    const badge = document.getElementById('mem-test-badge');
    if (!badge) return;
    badge.textContent = this.testSessionId ? `上下文 #${this.testSessionId}` : '无上下文';
    badge.classList.toggle('debug-ctx-badge--on', !!this.testSessionId);
  },

  /** 记忆测试: 对当前智能体运行调试, 展示注入记忆/执行轨迹/回复 */
  async runTest() {
    if (this.testing) return;
    const agentId = parseInt(document.getElementById('mem-agent-filter').value, 10);
    if (!agentId) {
      App.showToast('请先选择智能体', 'warning');
      return;
    }
    const input = document.getElementById('mem-test-input');
    const output = document.getElementById('mem-test-output');
    const message = (input.value || '').trim();
    const fileNames = this.testAttach ? this.testAttach.names() : [];
    if (!message && !fileNames.length) return;

    this.testing = true;
    const runBtn = document.getElementById('mem-test-run');
    runBtn.disabled = true;
    input.value = '';

    const placeholder = output.querySelector('.debug-hint');
    if (placeholder) placeholder.remove();
    const marks = fileNames.map(f => `【附件 ${f}】`).join(' ');
    const roundDiv = document.createElement('div');
    roundDiv.className = 'debug-round';
    roundDiv.innerHTML = `
      <div class="debug-round__user">${App.escapeHtml(message + (marks ? `\n${marks}` : ''))}</div>
      <div class="debug-round__body"><div style="font-size:12px;color:var(--color-text-tertiary)">执行中…</div></div>`;
    output.appendChild(roundDiv);
    const body = roundDiv.querySelector('.debug-round__body');

    try {
      const res = await API.debugAgent(agentId, message, this.testSessionId, fileNames);
      if (this.testAttach) this.testAttach.clear();
      if (res.session_id) {
        this.testSessionId = res.session_id;
        this.updateTestBadge();
      }
      let html = '';
      // 注入的记忆 (验证记忆维护效果的核心)
      if (res.memories && res.memories.length) {
        html += `
          <details class="debug-mem" open>
            <summary>🧠 本次注入记忆 ${res.memories.length} 条</summary>
            ${res.memories.map(m => `
              <div class="debug-mem__item">
                <span class="memory-item__type">${App.escapeHtml(m.memory_type)}</span>
                <b>${App.escapeHtml(m.key || '')}</b>${m.project_id ? ` <span class="memory-item__project">项目#${m.project_id}</span>` : ' <span class="memory-item__project">通用</span>'}
                <div>${App.escapeHtml(m.content)}</div>
              </div>`).join('')}
          </details>`;
      } else {
        html += '<div class="debug-meta">🧠 本次未注入任何记忆</div>';
      }
      (res.trace || []).forEach(round => {
        html += `
          <div class="debug-trace-round">
            <div class="debug-trace-round__head">第 ${round.round} 轮 · ${App.escapeHtml(round.finish_reason || '')}</div>
            <div class="debug-trace-round__body">
              ${round.content ? `<pre>输出: ${App.escapeHtml(round.content)}</pre>` : ''}
              ${(round.tool_calls || []).map(tc => `
                <pre>🔧 ${App.escapeHtml(tc.name)}\n入参: ${App.escapeHtml(JSON.stringify(tc.arguments, null, 2))}\n出参: ${App.escapeHtml(JSON.stringify(tc.result, null, 2).slice(0, 1500))}\n耗时: ${tc.duration_ms}ms</pre>
              `).join('')}
            </div>
          </div>`;
      });
      if (res.error) {
        html += `<div class="debug-reply debug-reply--error">⚠️ ${App.escapeHtml(res.error)}</div>`;
      }
      if (res.reply) {
        html += `<div class="debug-reply">${App.renderMarkdown(res.reply)}</div>`;
      }
      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<div class="debug-reply debug-reply--error">请求失败: ${App.escapeHtml(err.message)}</div>`;
    } finally {
      this.testing = false;
      runBtn.disabled = false;
    }
  },

  async renderList() {
    const list = document.getElementById('memories-list');
    const agentId = document.getElementById('mem-agent-filter').value;
    const projectId = document.getElementById('mem-project-filter').value;
    const memType = document.getElementById('mem-type-filter').value;
    if (!agentId) {
      list.innerHTML = '<div class="empty-state">请先选择智能体</div>';
      return;
    }
    let memories = [];
    try {
      memories = await API.getAgentMemories(parseInt(agentId, 10), memType || undefined, projectId || undefined);
    } catch (err) {
      App.showToast(`加载记忆失败: ${err.message}`, 'error');
    }
    this._memories = memories;
    const projName = (pid) => {
      const p = this.projects.find(x => x.id === pid);
      return p ? p.name : (pid ? `项目#${pid}` : '通用');
    };
    list.innerHTML = memories.map(m => `
      <div class="memory-item">
        <div class="memory-item__head">
          <span class="memory-item__type">${App.escapeHtml(m.memory_type)}</span>
          <span class="memory-item__project">${App.escapeHtml(projName(m.project_id))}</span>
          <span class="memory-item__key">${App.escapeHtml(m.key || '')}</span>
          <span class="memory-item__edit" data-edit-id="${m.id}" title="编辑记忆">✏️</span>
          <span class="memory-item__del" data-mem-id="${m.id}">×</span>
        </div>
        <div class="memory-item__content">${App.escapeHtml(m.content)}</div>
        <div style="font-size:10.5px;color:var(--color-text-tertiary);margin-top:4px">
          ${App.escapeHtml((m.created_at || '').slice(0, 19).replace('T', ' '))}${m.session_id ? ` · 会话#${m.session_id}` : ''}
        </div>
      </div>`).join('') || '<div class="empty-state">暂无记忆</div>';

    list.querySelectorAll('[data-mem-id]').forEach(del => {
      del.onclick = async () => {
        try {
          await API.deleteAgentMemory(parseInt(agentId, 10), parseInt(del.dataset.memId, 10));
          this.renderList();
        } catch (err) {
          App.showToast(`删除失败: ${err.message}`, 'error');
        }
      };
    });
    list.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.onclick = () => {
        const m = (this._memories || []).find(x => String(x.id) === btn.dataset.editId);
        if (m) this.editMemory(m);
      };
    });
  },

  /** 编辑已有记忆: 类型/键名/内容/所属项目 (保存走 PUT memories/{id}) */
  editMemory(m) {
    const projectOptions = '<option value="">通用(不关联项目)</option>' +
      this.projects.map(p => `<option value="${p.id}">${App.escapeHtml(p.name)}</option>`).join('');
    const modal = App.openModal({
      title: '编辑记忆',
      bodyHtml: `
        <div class="form-field">
          <label>所属项目</label>
          <select id="mem-edit-project">${projectOptions}</select>
        </div>
        <div class="form-field">
          <label>类型</label>
          <select id="mem-edit-type">
            <option value="fact">事实 fact</option>
            <option value="preference">偏好 preference</option>
            <option value="context">上下文 context</option>
            <option value="decision">决策 decision</option>
          </select>
        </div>
        <div class="form-field">
          <label>键名 (简短概括)</label>
          <input type="text" id="mem-edit-key" value="${App.escapeHtml(m.key || '')}">
        </div>
        <div class="form-field">
          <label>内容 *</label>
          <textarea id="mem-edit-content" rows="5">${App.escapeHtml(m.content || '')}</textarea>
        </div>`,
      footerHtml: `
        <button class="cw-btn" data-modal-close>取消</button>
        <button class="cw-btn cw-btn--primary" id="mem-edit-save">保存修改</button>`,
    });
    modal.querySelector('#mem-edit-type').value = m.memory_type || 'fact';
    modal.querySelector('#mem-edit-project').value = m.project_id || '';
    modal.querySelector('#mem-edit-save').onclick = async () => {
      const content = modal.querySelector('#mem-edit-content').value.trim();
      if (!content) {
        App.showToast('记忆内容不能为空', 'warning');
        return;
      }
      try {
        await API.updateAgentMemory(m.agent_id, m.id, {
          memory_type: modal.querySelector('#mem-edit-type').value,
          key: modal.querySelector('#mem-edit-key').value.trim(),
          content,
          project_id: modal.querySelector('#mem-edit-project').value || null,
        });
        App.closeModal(modal);
        App.showToast('已保存修改', 'success');
        this.renderList();
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    };
  },

  addMemory() {
    const agentId = document.getElementById('mem-agent-filter').value;
    if (!agentId) {
      App.showToast('请先选择智能体', 'warning');
      return;
    }
    const projectOptions = '<option value="">通用(不关联项目)</option>' +
      this.projects.map(p => `<option value="${p.id}">${App.escapeHtml(p.name)}</option>`).join('');
    const currentProject = document.getElementById('mem-project-filter').value;
    const modal = App.openModal({
      title: '新增记忆',
      bodyHtml: `
        <div class="form-field">
          <label>所属项目</label>
          <select id="mem-new-project">${projectOptions}</select>
        </div>
        <div class="form-field">
          <label>类型</label>
          <select id="mem-new-type">
            <option value="fact">事实 fact</option>
            <option value="preference">偏好 preference</option>
            <option value="context">上下文 context</option>
            <option value="decision">决策 decision</option>
          </select>
        </div>
        <div class="form-field">
          <label>键名 (简短概括)</label>
          <input type="text" id="mem-new-key" placeholder="如: 用户偏好-周报格式">
        </div>
        <div class="form-field">
          <label>内容 *</label>
          <textarea id="mem-new-content" rows="4" placeholder="记忆内容"></textarea>
        </div>`,
      footerHtml: `
        <button class="cw-btn" data-modal-close>取消</button>
        <button class="cw-btn cw-btn--primary" id="mem-new-save">保存</button>`,
    });
    if (currentProject) modal.querySelector('#mem-new-project').value = currentProject;
    modal.querySelector('#mem-new-save').onclick = async () => {
      const content = modal.querySelector('#mem-new-content').value.trim();
      if (!content) {
        App.showToast('请填写记忆内容', 'warning');
        return;
      }
      try {
        await API.createAgentMemory(parseInt(agentId, 10), {
          memory_type: modal.querySelector('#mem-new-type').value,
          key: modal.querySelector('#mem-new-key').value.trim(),
          content,
          project_id: modal.querySelector('#mem-new-project').value || null,
        });
        App.closeModal(modal);
        App.showToast('已保存', 'success');
        this.renderList();
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    };
  }
};
