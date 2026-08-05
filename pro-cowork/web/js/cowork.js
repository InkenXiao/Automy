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
              <textarea id="tc-input" rows="4" placeholder="描述要让智能体完成的任务, 如: 汇总本周进度并识别风险"></textarea>
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
   智能体对话视图 (SSE 流式 + 工具轨迹 + 记忆面板)
   ------------------------------------------------------------------ */
const AgentChat = {
  agent: null,
  session: null,
  sessions: [],
  sending: false,

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
    await this.renderLayout();
    if (el) el.dataset.agentId = String(this.agent.id);
    await this.loadSessions();
    await this.newSession(false);
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
            <textarea id="chat-textarea" rows="2" placeholder="输入消息, Enter 发送, Shift+Enter 换行"></textarea>
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
  },

  async loadSessions() {
    const list = document.getElementById('chat-sessions-list');
    try {
      this.sessions = await API.getAgentSessions(this.agent.id);
    } catch (err) {
      this.sessions = [];
    }
    if (!list) return;
    list.innerHTML = this.sessions.map(s => `
      <div class="chat-session-item" data-session-id="${s.id}">
        <span class="chat-session-item__title">${App.escapeHtml(s.title || '未命名会话')}</span>
        <span class="chat-session-item__del" data-del="${s.id}" title="归档">×</span>
      </div>`).join('') || '<div style="padding:8px;font-size:12px;color:var(--color-text-tertiary)">暂无历史会话</div>';

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
        try {
          await API.archiveSession(sid);
          App.showToast('会话已归档', 'success');
          await this.loadSessions();
          if (this.session && this.session.id === sid) await this.newSession(false);
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
    if (!message || !this.session) return;

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
  ALL_TOOLS: [
    'get_today', 'get_project_info', 'get_progress_tasks', 'create_progress_task',
    'update_progress_task', 'get_phases', 'get_modules', 'get_weekly_reports',
    'get_weekly_report_detail', 'create_weekly_report', 'get_meetings',
    'create_meeting', 'get_work_tasks', 'create_work_task', 'update_work_task',
    'run_skill', 'save_memory',
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
              ${this.ALL_TOOLS.map(t => `
                <label class="tool-check">
                  <input type="checkbox" value="${t}" ${tools.includes(t) ? 'checked' : ''}> ${t}
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
