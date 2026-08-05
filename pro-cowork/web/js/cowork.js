/* ==========================================================================
   XIN · CoWork 智能体工作平台前端
   视图: 任务 / 智能体列表 / 对话 / 构建器 / 技能 / 记忆
   依赖: API (api.js), App (app.js), cowork.css
   ========================================================================== */

/* ------------------------------------------------------------------
   任务视图 (工作台): 项目 × 文件 × 智能体 × 技能 组合执行
   ------------------------------------------------------------------ */
const TaskCenter = {
  projects: [],
  agents: [],
  skills: [],
  files: [],              // 当前项目已上传附件 [{name,size}]
  selectedFiles: new Set(),
  selectedSkills: new Set(),
  runs: [],
  running: false,
  currentRunId: null,     // 当前输出窗口对应的任务 id
  fcFiles: new Set(),     // 补充对话区已附加文件
  fcSkills: new Set(),    // 补充对话区已附加技能

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
            <div class="task-card__title">📋 新建任务</div>
            <div class="form-row">
              <div class="form-field">
                <label>项目</label>
                <select id="tc-project"></select>
              </div>
              <div class="form-field">
                <label>智能体</label>
                <select id="tc-agent"></select>
              </div>
            </div>
            <div class="form-field">
              <label>技能 (可多选, 智能体将按需调用)</label>
              <div class="chip-box" id="tc-skills"></div>
            </div>
            <div class="form-field">
              <label>文件 (点击选中作为任务上下文)</label>
              <div class="chip-box" id="tc-files"></div>
              <div style="margin-top:6px">
                <button class="cw-btn cw-btn--sm" id="tc-upload">📎 上传文件</button>
                <input type="file" id="tc-file-input" style="display:none">
              </div>
            </div>
            <div class="form-field">
              <label>任务描述</label>
              <textarea id="tc-input" rows="4" placeholder="描述要让智能体完成的任务, 如: 汇总本周进度并识别风险; 输入 / 引用会议/周报/里程碑/周任务记录, # 选择智能体/技能/工具"></textarea>
            </div>
            <button class="cw-btn cw-btn--primary" id="tc-run" style="width:100%">▶ 创建并执行</button>
          </div>
          <div class="task-card">
            <div class="task-card__title">🕘 历史任务</div>
            <div id="tc-history"></div>
          </div>
        </div>
        <div class="task-right">
          <div class="task-card task-output-card">
            <div class="task-card__title" id="tc-output-title">执行输出</div>
            <div class="task-output" id="tc-output">
              <div class="empty-state">选择项目 / 文件 / 智能体 / 技能, 创建并执行任务</div>
            </div>
          </div>
          <div class="task-card task-followup-card" id="tc-followup-card">
            <div class="fc-attachments" id="fc-attachments"></div>
            <div class="fc-picker" id="fc-picker" style="display:none"></div>
            <div class="fc-toolbar">
              <button class="cw-btn cw-btn--sm" id="fc-add-file" title="添加文件到本轮对话">📎 文件</button>
              <button class="cw-btn cw-btn--sm" id="fc-add-skill" title="添加技能到本轮对话">⚡ 技能</button>
            </div>
            <div class="fc-input-row">
              <textarea id="fc-input" rows="2" placeholder="补充任务内容, 继续让 AI 执行当前任务… (Enter 发送, Shift+Enter 换行)"></textarea>
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

    this.fillSelectors();
    document.getElementById('tc-project').onchange = () => {
      this.selectedFiles.clear();
      this.loadFiles();
    };
    document.getElementById('tc-upload').onclick = () => document.getElementById('tc-file-input').click();
    document.getElementById('tc-file-input').onchange = (e) => this.uploadFile(e);
    document.getElementById('tc-run').onclick = () => this.createAndRun();

    // 新任务窗口: 输入 / 引用当前所选项目的 会议/周报/里程碑/周任务 记录
    MentionBox.attach(document.getElementById('tc-input'), {
      getProjectId: () => this.currentProjectId(),
    });

    // 补充对话区事件
    document.getElementById('fc-send').onclick = () => this.sendFollowup();
    document.getElementById('fc-add-file').onclick = () => this.togglePicker('file');
    document.getElementById('fc-add-skill').onclick = () => this.togglePicker('skill');
    document.getElementById('fc-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendFollowup();
      }
    });
    this.renderFollowupChips();
    this.updateFollowupState();

    await this.loadFiles();
    await this.loadRuns();
  },

  currentProjectId() {
    const v = document.getElementById('tc-project')?.value;
    return v ? parseInt(v, 10) : null;
  },

  fillSelectors() {
    const projSel = document.getElementById('tc-project');
    projSel.innerHTML = this.projects.map(p =>
      `<option value="${p.id}">${App.escapeHtml(p.name)}${p.is_active ? ' ★' : ''}</option>`).join('');
    const active = this.projects.find(p => p.is_active);
    if (active) projSel.value = String(active.id);

    const agentSel = document.getElementById('tc-agent');
    agentSel.innerHTML = this.agents.map(a =>
      `<option value="${a.id}">${(a.config || {}).icon || '🤖'} ${App.escapeHtml(a.name)}</option>`).join('');

    // 技能多选 chips
    const skillBox = document.getElementById('tc-skills');
    skillBox.innerHTML = this.skills.map(s =>
      `<span class="chip" data-skill-id="${s.id}">${(s.config || {}).icon || '⚡'} ${App.escapeHtml(s.name)}</span>`).join('')
      || '<span style="font-size:12px;color:var(--color-text-tertiary)">暂无技能</span>';
    skillBox.querySelectorAll('.chip').forEach(chip => {
      chip.onclick = () => {
        const id = parseInt(chip.dataset.skillId, 10);
        if (this.selectedSkills.has(id)) {
          this.selectedSkills.delete(id);
          chip.classList.remove('chip--on');
        } else {
          this.selectedSkills.add(id);
          chip.classList.add('chip--on');
        }
      };
    });
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
        if (!confirm(`删除文件「${name}」?`)) return;
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
    const agentName = (id) => (this.agents.find(a => a.id === id) || {}).name || `Agent#${id}`;
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
        if (!confirm('删除该任务记录?')) return;
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

  /** 点击历史任务: 加载会话消息回放, 并设为当前对话任务 */
  async showRunResult(run) {
    this.currentRunId = run.id;
    this.fcFiles.clear();
    this.fcSkills.clear();
    this.renderFollowupChips();
    this.updateFollowupState();

    document.getElementById('tc-output-title').textContent = `执行结果 · ${run.title || ''}`;
    const out = document.getElementById('tc-output');
    out.innerHTML = '<div class="empty-state">加载对话记录…</div>';
    let messages = [];
    try {
      messages = await API.getTaskRunMessages(run.id);
    } catch (err) {
      App.showToast(`加载对话失败: ${err.message}`, 'error');
    }
    out.innerHTML = '';
    if (!messages.length) {
      out.innerHTML = '<div class="empty-state">该任务暂无对话记录</div>';
      return;
    }
    messages.forEach(m => {
      if (m.role === 'user') {
        this.appendChatMsg(out, 'user', App.escapeHtml(this.displayUserText(m.content)).replace(/\n/g, '<br>'));
      } else if (m.role === 'assistant' && m.content) {
        this.appendChatMsg(out, 'assistant', App.renderMarkdown(m.content));
      }
    });
  },

  /* ---------------- 补充对话区 ---------------- */

  /** 补充区启用状态: 有当前任务且未在执行中方可发送 */
  updateFollowupState() {
    const card = document.getElementById('tc-followup-card');
    if (!card) return;
    const enabled = !!this.currentRunId && !this.running;
    card.classList.toggle('fc-disabled', !enabled);
    document.getElementById('fc-send').disabled = !enabled;
    document.getElementById('fc-input').disabled = !enabled;
    document.getElementById('fc-add-file').disabled = !enabled;
    document.getElementById('fc-add-skill').disabled = !enabled;
    const hint = document.getElementById('fc-input');
    if (hint && !this.currentRunId) {
      hint.placeholder = '请先创建并执行任务, 或在左侧选择历史任务…';
    } else if (hint) {
      hint.placeholder = '补充任务内容, 继续让 AI 执行当前任务… (Enter 发送, Shift+Enter 换行)';
    }
  },

  /** 渲染补充区已附加的文件/技能 chips */
  renderFollowupChips() {
    const box = document.getElementById('fc-attachments');
    if (!box) return;
    const chips = [];
    this.fcFiles.forEach(name => {
      chips.push(`<span class="chip chip--on" data-fc-del-file="${App.escapeHtml(name)}">📄 ${App.escapeHtml(name)} <span class="chip__del">×</span></span>`);
    });
    this.fcSkills.forEach(id => {
      const s = this.skills.find(x => x.id === id);
      chips.push(`<span class="chip chip--on" data-fc-del-skill="${id}">⚡ ${App.escapeHtml(s ? s.name : `技能#${id}`)} <span class="chip__del">×</span></span>`);
    });
    box.innerHTML = chips.join('');
    box.style.display = chips.length ? '' : 'none';
    box.querySelectorAll('[data-fc-del-file]').forEach(c => {
      c.onclick = () => { this.fcFiles.delete(c.dataset.fcDelFile); this.renderFollowupChips(); };
    });
    box.querySelectorAll('[data-fc-del-skill]').forEach(c => {
      c.onclick = () => { this.fcSkills.delete(parseInt(c.dataset.fcDelSkill, 10)); this.renderFollowupChips(); };
    });
  },

  /** 展开/收起 文件或技能选择面板 */
  togglePicker(kind) {
    const picker = document.getElementById('fc-picker');
    if (!picker) return;
    if (picker.style.display !== 'none' && picker.dataset.kind === kind) {
      picker.style.display = 'none';
      return;
    }
    picker.dataset.kind = kind;
    if (kind === 'file') {
      picker.innerHTML = this.files.map(f =>
        `<span class="chip" data-pick-file="${App.escapeHtml(f.name)}">📄 ${App.escapeHtml(f.name)}</span>`).join('')
        || '<span style="font-size:12px;color:var(--color-text-tertiary)">当前项目暂无附件, 请先在左侧上传</span>';
      picker.querySelectorAll('[data-pick-file]').forEach(c => {
        c.onclick = () => { this.fcFiles.add(c.dataset.pickFile); this.renderFollowupChips(); };
      });
    } else {
      picker.innerHTML = this.skills.map(s =>
        `<span class="chip" data-pick-skill="${s.id}">${(s.config || {}).icon || '⚡'} ${App.escapeHtml(s.name)}</span>`).join('')
        || '<span style="font-size:12px;color:var(--color-text-tertiary)">暂无技能</span>';
      picker.querySelectorAll('[data-pick-skill]').forEach(c => {
        c.onclick = () => { this.fcSkills.add(parseInt(c.dataset.pickSkill, 10)); this.renderFollowupChips(); };
      });
    }
    picker.style.display = '';
  },

  /** 发送补充内容: 在当前任务会话中继续执行 */
  async sendFollowup() {
    if (this.running || !this.currentRunId) return;
    const inputEl = document.getElementById('fc-input');
    const text = inputEl.value.trim();
    if (!text && !this.fcFiles.size && !this.fcSkills.size) {
      App.showToast('请填写补充内容或添加文件/技能', 'warning');
      return;
    }

    this.running = true;
    this.updateFollowupState();
    const out = document.getElementById('tc-output');
    const placeholder = out.querySelector('.empty-state');
    if (placeholder) placeholder.remove();

    // 用户消息回显 (含附件/技能标注)
    let echo = App.escapeHtml(text || '(补充附件/技能)');
    const tags = [];
    this.fcFiles.forEach(n => tags.push(`📄${n}`));
    this.fcSkills.forEach(id => {
      const s = this.skills.find(x => x.id === id);
      tags.push(`⚡${s ? s.name : id}`);
    });
    if (tags.length) echo += `<div style="font-size:11px;opacity:0.85;margin-top:4px">${App.escapeHtml(tags.join(' · '))}</div>`;
    this.appendChatMsg(out, 'user', echo.replace(/\n/g, '<br>'));

    const replyDiv = this.appendChatMsg(out, 'assistant', '');
    const replyBody = replyDiv.querySelector('.chat-msg__body');

    // 本轮载荷快照, 发送后清空补充区
    const payload = {
      input_text: text,
      file_names: Array.from(this.fcFiles),
      skill_ids: Array.from(this.fcSkills),
    };
    inputEl.value = '';
    this.fcFiles.clear();
    this.fcSkills.clear();
    this.renderFollowupChips();
    const picker = document.getElementById('fc-picker');
    if (picker) picker.style.display = 'none';

    let replyText = '';
    let lastTrace = null;
    try {
      await API.stream(`/task-runs/${this.currentRunId}/continue`, payload, (event) => {
        if (event.type === 'content') {
          replyText += event.content;
          replyBody.innerHTML = App.renderMarkdown(replyText);
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'tool_call') {
          lastTrace = this.appendTrace(out, event.name, '执行中');
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
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'error') {
          replyText += `\n\n⚠️ ${event.content}`;
          replyBody.innerHTML = App.renderMarkdown(replyText);
        }
      });
    } catch (err) {
      this.appendChatMsg(out, 'assistant', `⚠️ 执行失败: ${App.escapeHtml(err.message)}`);
    } finally {
      this.running = false;
      this.updateFollowupState();
      this.loadRuns();
    }
  },

  async createAndRun() {
    if (this.running) return;
    const agentId = parseInt(document.getElementById('tc-agent').value, 10);
    const inputText = document.getElementById('tc-input').value.trim();
    if (!agentId) {
      App.showToast('请选择智能体', 'warning');
      return;
    }
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
    out.innerHTML = '';

    try {
      const run = await API.createTaskRun({
        project_id: this.currentProjectId(),
        agent_id: agentId,
        skill_ids: Array.from(this.selectedSkills),
        file_names: Array.from(this.selectedFiles),
        input_text: inputText,
      });

      // 绑定当前任务, 启用补充对话区
      this.currentRunId = run.id;
      this.fcFiles.clear();
      this.fcSkills.clear();
      this.renderFollowupChips();

      // 用户消息回显
      out.innerHTML = `<div class="chat-msg chat-msg--user"><div class="chat-msg__avatar">👤</div><div class="chat-msg__body">${App.escapeHtml(inputText || '(附件任务)')}</div></div>`;
      const replyDiv = document.createElement('div');
      replyDiv.className = 'chat-msg chat-msg--assistant';
      replyDiv.innerHTML = `<div class="chat-msg__avatar">🤖</div><div class="chat-msg__body"></div>`;
      out.appendChild(replyDiv);
      const replyBody = replyDiv.querySelector('.chat-msg__body');

      let replyText = '';
      let lastTrace = null;
      await API.stream(`/task-runs/${run.id}/run`, {}, (event) => {
        if (event.type === 'content') {
          replyText += event.content;
          replyBody.innerHTML = App.renderMarkdown(replyText);
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'tool_call') {
          lastTrace = this.appendTrace(out, event.name, '执行中');
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
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'error') {
          replyText += `\n\n⚠️ ${event.content}`;
          replyBody.innerHTML = App.renderMarkdown(replyText);
        }
      });
    } catch (err) {
      out.innerHTML += `<div class="empty-state">⚠️ 执行失败: ${App.escapeHtml(err.message)}</div>`;
    } finally {
      this.running = false;
      runBtn.disabled = false;
      runBtn.textContent = '▶ 创建并执行';
      this.updateFollowupState();
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
            <div class="cw-page__title">智能体</div>
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
      card.querySelector('[data-action="edit"]').onclick = (e) => {
        e.stopPropagation();
        CoworkBuilder.openEdit(agent);
      };
      card.querySelector('[data-action="delete"]').onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`确定删除智能体「${agent.name}」?`)) return;
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
  textarea: null,       // 当前绑定的 textarea
  popup: null,          // 浮层 DOM
  getProjectId: null,   // 回调: 获取当前项目 id (未 @ 选择时的默认项目)
  onPickProject: null,  // 回调: @ 选中项目后通知宿主
  projects: null,       // 项目缓存
  stage: null,          // 'project' | 'category' | 'record'
  triggerStart: -1,     // 触发字符 (@ 或 /) 在文本中的下标
  items: [],            // 当前浮层条目 [{title, sub, snippet|project|category}]
  activeIdx: 0,

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

  /** 绑定到输入框; opts: { getProjectId, onPickProject } */
  attach(textarea, opts = {}) {
    this.detach();
    this.textarea = textarea;
    this.getProjectId = opts.getProjectId || null;
    this.onPickProject = opts.onPickProject || null;
    // 输入框容器需要相对定位以承载浮层
    this.host = textarea.closest('.chat-input, .form-field') || textarea.parentElement;
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
    if (!message) return;
    if (!this.session) {
      App.showToast('请先点击左上角「+ 新会话」创建会话', 'warning');
      return;
    }

    textarea.value = '';
    this.appendMessage('user', message);
    const replyBody = this.appendMessage('assistant', '');
    let replyText = '';
    let lastTrace = null;
    this.sending = true;
    const sendBtn = document.getElementById('chat-send');
    if (sendBtn) sendBtn.disabled = true;

    try {
      await API.stream(`/agents/${this.agent.id}/chat`, {
        message, session_id: this.session.id,
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
  editing: null,   // 正在编辑的 agent, null=新建
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
    this._dirty = true;
    App.switchView('builder');
    this.renderForm({
      name: '', type: 'custom', description: '', system_prompt: '',
      tools: ['get_today', 'get_project_info', 'run_skill', 'save_memory'],
      config: { icon: '🤖', color: '#FF8C00' },
    });
  },

  openEdit(agent) {
    this.editing = agent;
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
              <input type="text" id="bf-icon" value="${App.escapeHtml(cfg.icon || '🤖')}">
            </div>
            <div class="form-field">
              <label>主题色</label>
              <input type="text" id="bf-color" value="${App.escapeHtml(cfg.color || '#FF8C00')}" placeholder="#FF8C00">
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
          <div class="builder-debug__title">🧪 调试面板 ${this.editing ? '' : '(保存后可用)'}</div>
          <div id="debug-output"></div>
          <div class="form-field" style="margin-top:auto">
            <textarea id="debug-input" rows="3" placeholder="输入测试消息, 如: 本周有哪些逾期任务?"></textarea>
          </div>
          <button class="cw-btn cw-btn--primary" id="debug-run" ${this.editing ? '' : 'disabled'}>▶ 运行调试</button>
        </div>
      </div>`;

    document.getElementById('bf-save').onclick = () => this.save();
    document.getElementById('bf-back').onclick = () => {
      this._dirty = false;
      App.switchView('agents');
    };
    document.getElementById('debug-run').onclick = () => this.runDebug();
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
      // 重新渲染以启用调试按钮
      this.renderForm(this.editing);
    } catch (err) {
      App.showToast(`保存失败: ${err.message}`, 'error');
    }
  },

  async runDebug() {
    if (!this.editing) return;
    const input = document.getElementById('debug-input');
    const output = document.getElementById('debug-output');
    const message = (input.value || '').trim();
    if (!message) return;

    const runBtn = document.getElementById('debug-run');
    runBtn.disabled = true;
    output.innerHTML = '<div style="font-size:12px;color:var(--color-text-tertiary)">执行中…</div>';

    try {
      const res = await API.debugAgent(this.editing.id, message);
      let html = `<div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:8px">模型: ${App.escapeHtml(res.model || '-')}</div>`;
      if (res.error) {
        html += `<div class="debug-reply" style="border-color:var(--color-danger-border);background:var(--color-danger-light)">⚠️ ${App.escapeHtml(res.error)}</div>`;
      }
      (res.trace || []).forEach(round => {
        html += `
          <div class="debug-trace-round">
            <div class="debug-trace-round__head">第 ${round.round} 轮 · ${App.escapeHtml(round.finish_reason || '')}</div>
            <div class="debug-trace-round__body">
              ${round.content ? `<pre>输出: ${App.escapeHtml(round.content)}</pre>` : ''}
              ${(round.tool_calls || []).map(tc => `
                <pre>🔧 ${App.escapeHtml(tc.name)}(${App.escapeHtml(JSON.stringify(tc.arguments))})\n→ ${App.escapeHtml(JSON.stringify(tc.result, null, 2).slice(0, 800))} [${tc.duration_ms}ms]</pre>
              `).join('')}
            </div>
          </div>`;
      });
      if (res.reply) {
        html += `<div class="debug-reply">${App.renderMarkdown(res.reply)}</div>`;
      }
      output.innerHTML = html;
    } catch (err) {
      output.innerHTML = `<div class="debug-reply" style="border-color:var(--color-danger-border);background:var(--color-danger-light)">请求失败: ${App.escapeHtml(err.message)}</div>`;
    } finally {
      runBtn.disabled = false;
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
      card.querySelector('[data-action="edit"]').onclick = () => SkillBuilder.openEdit(skill);
      card.querySelector('[data-action="delete"]').onclick = async () => {
        if (!confirm(`确定删除技能「${skill.name}」?`)) return;
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
  CATEGORIES: [['data', '数据查询'], ['api', 'API 调用'], ['workflow', '工作流'], ['notification', '通知']],

  init() {},

  onShow() {
    if (!this._dirty) this.openCreate();
  },

  openCreate() {
    this.editing = null;
    this._dirty = true;
    App.switchView('skill-builder');
    this.renderForm({
      name: '', description: '', category: 'workflow', trigger_type: 'manual',
      config: { icon: '⚡', color: '#8B5CF6' },
      code: JSON.stringify({ steps: [{ tool: 'get_today', arguments: {} }] }, null, 2),
    });
  },

  openEdit(skill) {
    this.editing = skill;
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
              <input type="text" id="sf-icon" value="${App.escapeHtml(cfg.icon || '⚡')}">
            </div>
            <div class="form-field">
              <label>主题色</label>
              <input type="text" id="sf-color" value="${App.escapeHtml(cfg.color || '#8B5CF6')}">
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
          <div class="builder-debug__title">🧪 测试执行 ${this.editing ? '' : '(保存后可用)'}</div>
          <div class="form-field">
            <label>输入参数 (JSON)</label>
            <textarea id="sf-test-input" class="code-editor" rows="4" placeholder='{}'></textarea>
          </div>
          <button class="cw-btn cw-btn--primary" id="sf-test-run" ${this.editing ? '' : 'disabled'}>▶ 执行测试</button>
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
      this.renderForm({ ...this.editing, code: codeRaw });
    } catch (err) {
      App.showToast(`保存失败: ${err.message}`, 'error');
    }
  },

  async testRun() {
    if (!this.editing) return;
    const raw = document.getElementById('sf-test-input').value.trim();
    let inputData = {};
    if (raw) {
      try { inputData = JSON.parse(raw); }
      catch (e) {
        App.showToast('输入参数不是有效 JSON', 'warning');
        return;
      }
    }
    const resultEl = document.getElementById('sf-test-result');
    resultEl.innerHTML = '<div style="font-size:12px;color:var(--color-text-tertiary)">执行中…</div>';
    try {
      const exec = await API.executeSkill(this.editing.id, inputData);
      const cls = exec.status === 'success' ? 'exec-status--success' : 'exec-status--failed';
      resultEl.innerHTML = `
        <div class="exec-item">
          <div class="exec-item__head">
            <span class="exec-status ${cls}">${App.escapeHtml(exec.status)}</span>
            <span>${exec.duration_ms}ms</span>
          </div>
          ${exec.error ? `<pre>错误: ${App.escapeHtml(exec.error)}</pre>` : ''}
          <pre>${App.escapeHtml(JSON.stringify(exec.output_data, null, 2).slice(0, 2500))}</pre>
        </div>`;
    } catch (err) {
      resultEl.innerHTML = `<div class="exec-item"><pre>请求失败: ${App.escapeHtml(err.message)}</pre></div>`;
    }
  }
};

/* ------------------------------------------------------------------
   记忆维护视图 (项目 × 智能体 双维度的记忆管理)
   ------------------------------------------------------------------ */
const CoworkMemories = {
  agents: [],
  projects: [],

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

    agentSel.onchange = () => this.renderList();
    projSel.onchange = () => this.renderList();
    document.getElementById('mem-type-filter').onchange = () => this.renderList();
    document.getElementById('mem-add-btn').onclick = () => this.addMemory();
    await this.renderList();
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
