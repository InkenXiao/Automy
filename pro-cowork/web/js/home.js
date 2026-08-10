/* ==========================================================================
   首页看板 Home (登录后的默认视图)
   - 问候头: 时段问候 + 日期周次 + 当前激活项目
   - 小部件 (均可自定义显示/排序):
     todo    我的待办     (本周指派给我的未完成工作任务)
     runs    长任务结果   (最新执行的长任务及结果摘要)
     week    本周任务     (当前项目本周进行中的工作任务)
     delayed 延误进度     (已延期或超期未完成的进度计划任务)
     agents  常用数字分身 (自定义收藏, 点击直接进入对话)
   - 自定义配置存 localStorage (按登录人隔离): home.cfg.v1.<name>
   ========================================================================== */

const Home = {
  WIDGETS: [
    { key: 'todo',    title: '我的待办',     icon: '📌' },
    { key: 'runs',    title: '长任务结果',   icon: '🧾' },
    { key: 'week',    title: '本周任务',     icon: '🎯' },
    { key: 'delayed', title: '延误进度',     icon: '⚠️' },
    { key: 'agents',  title: '常用数字分身', icon: '👤✨' },
  ],

  // 运行时数据
  me: '',
  weekStart: '',      // 本周周一 YYYY-MM-DD
  cfg: null,          // {order:[], hidden:[], pinnedAgents:[]}
  _agents: [],        // 全部分身 (自定义面板用)

  DONE_STATUSES: ['已完成', '已取消', 'done', 'completed', 'cancelled'],

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {},

  onShow() {
    this.me = Auth.user();
    this.weekStart = this._mondayOf(new Date());
    this.cfg = this._loadCfg();
    this.render();
  },

  /* ------------------------------------------------------------------
   * 工具
   * ---------------------------------------------------------------- */
  _mondayOf(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - (day - 1));
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  },

  _today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  _loadCfg() {
    const def = { order: this.WIDGETS.map(w => w.key), hidden: [], pinnedAgents: [] };
    try {
      const raw = localStorage.getItem(`home.cfg.v1.${this.me || 'anonymous'}`);
      if (!raw) return def;
      const cfg = JSON.parse(raw);
      // 合并新增 widget (默认追加到末尾且可见)
      const known = this.WIDGETS.map(w => w.key);
      cfg.order = (cfg.order || []).filter(k => known.includes(k));
      known.forEach(k => { if (!cfg.order.includes(k)) cfg.order.push(k); });
      cfg.hidden = (cfg.hidden || []).filter(k => known.includes(k));
      cfg.pinnedAgents = cfg.pinnedAgents || [];
      return cfg;
    } catch (e) {
      return def;
    }
  },

  _saveCfg() {
    try {
      localStorage.setItem(`home.cfg.v1.${this.me || 'anonymous'}`, JSON.stringify(this.cfg));
    } catch (e) { /* 忽略 */ }
  },

  /** 相对时间 (如 3小时前) */
  _timeAgo(dtStr) {
    if (!dtStr) return '';
    const t = new Date(dtStr).getTime();
    if (isNaN(t)) return '';
    const diff = Math.max(0, Date.now() - t);
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m}分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}小时前`;
    const d = Math.floor(h / 24);
    return `${d}天前`;
  },

  /** 问候语 */
  _greeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  },

  /* ------------------------------------------------------------------
   * 页面骨架
   * ---------------------------------------------------------------- */
  render() {
    const view = document.getElementById('view-home');
    if (!view) return;
    const project = App.state.project;
    const now = new Date();
    const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    const weekLabel = App.weekRange(App.state.currentWeek).label || '';
    const isPm = Auth.isPm();
    const roleLabel = project ? (isPm ? '项目经理' : '项目成员') : '';

    view.innerHTML = `
      <div class="home-hero">
        <div class="home-hero__main">
          <div class="home-hero__greet">${this._greeting()}, ${App.escapeHtml(this.me || '访客')}</div>
          <div class="home-hero__meta">
            <span>${dateLabel}</span>
            ${weekLabel ? `<span class="home-hero__dot">·</span><span>本周 ${weekLabel}</span>` : ''}
            ${project ? `<span class="home-hero__dot">·</span><span class="home-hero__project">🚩 ${App.escapeHtml(project.name || '')}</span>` : '<span class="home-hero__dot">·</span><span>无所属项目</span>'}
            ${roleLabel ? `<span class="home-hero__role${isPm ? ' home-hero__role--pm' : ''}">${roleLabel}</span>` : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="home-customize-btn">⚙ 自定义看板</button>
      </div>
      <div class="home-grid" id="home-grid">${App.renderLoading()}</div>
    `;
    document.getElementById('home-customize-btn')
      .addEventListener('click', () => this.openCustomize());
    this.loadWidgets();
  },

  /* ------------------------------------------------------------------
   * 数据加载 (并行, 单源失败不影响其他)
   * ---------------------------------------------------------------- */
  async loadWidgets() {
    const safe = (p) => p.catch(() => null);
    // 看板口径: 后端按登录人过滤 (项目经理看负责项目全量, 成员仅看自己相关)
    const [workTasks, runs, progressTasks, agents] = await Promise.all([
      safe(API.getWorkTasks(this.weekStart, null, true)),
      safe(API.getTaskRuns({ home_scope: true })),
      safe(API.getProgressTasks({ home_scope: true })),
      safe(API.getAgents()),
    ]);
    this._agents = agents || [];
    this._data = {
      workTasks: workTasks || [],
      runs: (runs || []).slice(0, 6),
      progressTasks: progressTasks || [],
      agents: agents || [],
    };
    this.renderWidgets();
  },

  /* ------------------------------------------------------------------
   * 渲染各 widget (renderer 返回 {html, count})
   * ---------------------------------------------------------------- */
  renderWidgets() {
    const grid = document.getElementById('home-grid');
    if (!grid || !this._data) return;
    const isPm = Auth.isPm();
    // 成员视角下以下 widget 仅含本人相关数据, 标题加注 "仅我的"
    const scopedKeys = ['runs', 'week', 'delayed'];
    const renderers = {
      todo: () => this._widgetTodo(),
      runs: () => this._widgetRuns(),
      week: () => this._widgetWeek(),
      delayed: () => this._widgetDelayed(),
      agents: () => this._widgetAgents(),
    };
    grid.innerHTML = this.cfg.order
      .filter(key => !this.cfg.hidden.includes(key))
      .map(key => {
        const meta = this.WIDGETS.find(w => w.key === key);
        const { html, count } = renderers[key]();
        const scopeTag = (!isPm && scopedKeys.includes(key))
          ? '<span class="home-widget__scope">仅我的</span>' : '';
        return `
          <div class="card home-widget home-widget--${key}" data-widget="${key}">
            <div class="card__header home-widget__header">
              <div class="card__title">
                <span class="home-widget__icon">${meta.icon}</span>${meta.title}${scopeTag}
              </div>
              <span class="home-widget__count">${count}</span>
            </div>
            <div class="card__body home-widget__body">${html}</div>
          </div>`;
      }).join('') || App.renderEmpty('看板为空', '点击右上角"自定义看板"开启小部件', '🏠');
    this._bindClicks(grid);
  },

  /** 列表行 HTML */
  _rows(items, emptyHint) {
    if (!items.length) {
      return `<div class="home-empty">${App.escapeHtml(emptyHint)}</div>`;
    }
    return items.join('');
  },

  _widgetTodo() {
    const mine = this._data.workTasks.filter(t =>
      (t.owner || '').trim() === this.me && !this.DONE_STATUSES.includes(t.status)
    ).slice(0, 8);
    const html = this._rows(mine.map(t => `
      <div class="home-row" data-goto="work-tasks">
        <span class="home-row__name" title="${App.escapeHtml(t.name)}">${App.escapeHtml(t.name)}</span>
        <span class="home-row__meta">${App.statusBadge(t.status)}</span>
      </div>`), '本周没有指派给你的待办任务 🎉');
    return { html, count: mine.length };
  },

  _widgetRuns() {
    const runs = this._data.runs;
    const html = this._rows(runs.map(r => `
      <div class="home-row" data-goto="tasks" title="${App.escapeHtml((r.result_text || '').slice(0, 200))}">
        <span class="home-row__name">${App.escapeHtml(r.title || `任务 #${r.id}`)}</span>
        <span class="home-row__meta">${Auth.isPm() && r.user_name ? `<i>${App.escapeHtml(r.user_name)}</i>` : ''}${App.statusBadge(r.status)}<i>${this._timeAgo(r.updated_at)}</i></span>
      </div>`), '还没有执行过长任务');
    return { html, count: runs.length };
  },

  _widgetWeek() {
    const items = this._data.workTasks
      .filter(t => !this.DONE_STATUSES.includes(t.status))
      .slice(0, 8);
    const html = this._rows(items.map(t => `
      <div class="home-row" data-goto="work-tasks">
        <span class="home-row__name" title="${App.escapeHtml(t.name)}">${App.escapeHtml(t.name)}</span>
        <span class="home-row__meta"><i>${App.escapeHtml(t.owner || '—')}</i>${App.statusBadge(t.status)}</span>
      </div>`), '本周暂无进行中的工作任务');
    return { html, count: items.length };
  },

  _widgetDelayed() {
    const today = this._today();
    const items = this._data.progressTasks.filter(t => {
      if (this.DONE_STATUSES.includes(t.status)) return false;
      if (['delayed', '延期'].includes(t.status)) return true;
      return t.end_date && String(t.end_date) < today;
    }).slice(0, 8);
    const html = this._rows(items.map(t => {
      const days = t.end_date
        ? Math.max(0, Math.floor((new Date(today) - new Date(t.end_date)) / 86400000))
        : 0;
      return `
      <div class="home-row" data-goto="progress-plan">
        <span class="home-row__name" title="${App.escapeHtml(t.name)}">${t.is_milestone ? '★ ' : ''}${App.escapeHtml(t.name)}</span>
        <span class="home-row__meta"><i>${App.escapeHtml(t.owner || '—')}</i><span class="home-row__danger">${days > 0 ? `延误${days}天` : '延期'}</span></span>
      </div>`;
    }), '没有延误的进度任务 👍');
    return { html, count: items.length };
  },

  /** 分身头像配色 (按名字稳定取色) */
  _avatarStyle(name) {
    const palette = [
      ['#FF8C00', '#FFF3E0'], ['#3B82F6', '#EFF6FF'], ['#10B981', '#ECFDF5'],
      ['#8B5CF6', '#F5F3FF'], ['#EC4899', '#FDF2F8'], ['#14B8A6', '#F0FDFA'],
    ];
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [fg, bg] = palette[h % palette.length];
    return `color:${fg};background:${bg};`;
  },

  _widgetAgents() {
    const all = this._data.agents;
    let list = all.filter(a => this.cfg.pinnedAgents.includes(a.id));
    let hint = '';
    if (list.length === 0) {
      list = all.filter(a => a.is_active !== false).slice(0, 4);
      if (list.length) hint = '<div class="home-empty" style="padding:4px 2px;">未收藏分身, 以下为推荐 (⚙ 自定义看板可收藏)</div>';
    }
    if (list.length === 0) return { html: '<div class="home-empty">暂无可用数字分身</div>', count: 0 };
    const html = hint + `<div class="home-agents">` + list.map(a => `
      <div class="home-agent" data-agent-id="${a.id}" title="${App.escapeHtml(a.description || a.name)}">
        <div class="home-agent__avatar" style="${this._avatarStyle(a.name)}">${App.escapeHtml((a.name || '?').slice(0, 1))}</div>
        <div class="home-agent__name">${App.escapeHtml(a.name)}</div>
      </div>`).join('') + '</div>';
    return { html, count: list.length };
  },

  /** 行点击跳转 / 分身对话 */
  _bindClicks(grid) {
    grid.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => App.switchView(el.dataset.goto));
    });
    grid.querySelectorAll('[data-agent-id]').forEach(el => {
      el.addEventListener('click', () => {
        const agent = this._agents.find(a => String(a.id) === el.dataset.agentId);
        if (agent && typeof AgentChat !== 'undefined' && AgentChat.open) {
          AgentChat.open(agent);
        } else {
          App.switchView('agents');
        }
      });
    });
  },

  /* ------------------------------------------------------------------
   * 自定义看板 (显示/排序/收藏分身)
   * ---------------------------------------------------------------- */
  openCustomize() {
    const widgetRows = this.cfg.order.map((key, idx) => {
      const meta = this.WIDGETS.find(w => w.key === key);
      const shown = !this.cfg.hidden.includes(key);
      return `
        <div class="home-cfg-row" data-key="${key}">
          <label><input type="checkbox" data-cfg-show ${shown ? 'checked' : ''}> ${meta.icon} ${meta.title}</label>
          <span class="home-cfg-row__ops">
            <button class="btn btn-ghost btn-sm" data-cfg-up ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-ghost btn-sm" data-cfg-down ${idx === this.cfg.order.length - 1 ? 'disabled' : ''}>↓</button>
          </span>
        </div>`;
    }).join('');

    const agentRows = this._agents.length
      ? this._agents.map(a => `
        <label class="home-cfg-agent">
          <input type="checkbox" data-cfg-agent="${a.id}" ${this.cfg.pinnedAgents.includes(a.id) ? 'checked' : ''}>
          ${App.escapeHtml(a.name)}
        </label>`).join('')
      : '<div class="home-empty">暂无数字分身</div>';

    const modal = App.openModal({
      title: '自定义首页看板',
      bodyHtml: `
        <div class="home-cfg-section">小部件 (勾选显示, ↑↓ 调整顺序)</div>
        ${widgetRows}
        <div class="home-cfg-section" style="margin-top:14px;">常用数字分身 (勾选后显示在"常用数字分身"小部件)</div>
        <div class="home-cfg-agents">${agentRows}</div>
      `,
      footerHtml: `
        <button class="btn btn-ghost btn-sm" data-cfg-reset>恢复默认</button>
        <button class="btn btn-primary btn-sm" data-cfg-done>完成</button>
      `,
    });

    // 上下移动
    modal.querySelectorAll('[data-cfg-up],[data-cfg-down]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.home-cfg-row');
        const key = row.dataset.key;
        const i = this.cfg.order.indexOf(key);
        const j = i + (btn.hasAttribute('data-cfg-up') ? -1 : 1);
        if (j < 0 || j >= this.cfg.order.length) return;
        [this.cfg.order[i], this.cfg.order[j]] = [this.cfg.order[j], this.cfg.order[i]];
        // 同步隐藏状态后重开面板 (保持已勾选状态)
        this._collectCfg(modal);
        App.closeModal(modal);
        this.openCustomize();
      });
    });

    modal.querySelector('[data-cfg-done]').addEventListener('click', () => {
      this._collectCfg(modal);
      this._saveCfg();
      App.closeModal(modal);
      this.render();
    });
    modal.querySelector('[data-cfg-reset]').addEventListener('click', () => {
      this.cfg = { order: this.WIDGETS.map(w => w.key), hidden: [], pinnedAgents: [] };
      this._saveCfg();
      App.closeModal(modal);
      this.render();
    });
  },

  /** 从自定义面板收集配置 */
  _collectCfg(modal) {
    modal.querySelectorAll('.home-cfg-row').forEach(row => {
      const key = row.dataset.key;
      const checked = row.querySelector('[data-cfg-show]').checked;
      if (!checked && !this.cfg.hidden.includes(key)) this.cfg.hidden.push(key);
      if (checked) this.cfg.hidden = this.cfg.hidden.filter(k => k !== key);
    });
    this.cfg.pinnedAgents = Array.from(
      modal.querySelectorAll('[data-cfg-agent]:checked')
    ).map(el => parseInt(el.dataset.cfgAgent, 10));
  },
};
