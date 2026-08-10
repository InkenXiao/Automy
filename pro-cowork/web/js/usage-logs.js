/* ==========================================================================
   使用日志看板 UsageLogs (系统)
   - 顶部三卡片: 当天 / 当周 / 当月 (登录人次·登录人数·写操作·LLM 调用·token)
   - 分类汇总: 数据更新 (实体×动作) + LLM 调用 (来源×次数/token)
   - 两级下钻: 汇总行 → 实体明细 → 操作记录 (按日期倒序)
   ========================================================================== */

const UsageLogs = {
  // 当前选中的统计周期 (汇总区跟随切换)
  period: 'day',
  // 三周期统计数据缓存 {day, week, month}
  statsMap: {},
  // 下钻面包屑 [{level:'summary'|'detail'|'operations', label, params}]
  drillStack: [],

  PERIODS: [
    { key: 'day', label: '当天', icon: '☀️' },
    { key: 'week', label: '当周', icon: '📅' },
    { key: 'month', label: '当月', icon: '🗓' },
  ],

  // 指标展示配置 (图标 + 主题色)
  METRICS: [
    { key: 'login_count', label: '人次', icon: '🔑', cls: 'orange' },
    { key: 'login_users', label: '人数', icon: '👥', cls: 'blue' },
    { key: 'write_count', label: '更新', icon: '✏️', cls: 'green' },
    { key: 'llm_calls',   label: 'LLM 调用', icon: '🤖', cls: 'violet' },
    { key: 'llm_tokens',  label: 'Token 总数', icon: '🪙', cls: 'gold' },
  ],

  ACTION_LABELS: {
    create: '新增', update: '更新', delete: '删除', execute: '执行',
    export: '导出', login: '登录', login_invalid: '无效登录', llm_call: 'LLM调用',
  },

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    // 首次切换到本视图时加载
  },

  onShow() {
    this.loadDashboard();
  },

  /* ------------------------------------------------------------------
   * 看板主页面
   * ---------------------------------------------------------------- */
  async loadDashboard() {
    const view = document.getElementById('view-usage-logs');
    if (!view) return;

    view.innerHTML = `
      <div class="view__header">
        <div>
          <div class="view__title">📈 使用日志看板</div>
          <div class="view__subtitle">登录、数据更新与 LLM 调用统计 · 点击汇总行可逐级下钻</div>
        </div>
      </div>
      <div id="ul-cards">${App.renderLoading()}</div>
      <div id="ul-summary"></div>
      <div id="ul-drill"></div>
    `;

    try {
      // 并行拉取三周期统计
      const [day, week, month] = await Promise.all([
        API.getUsageStats('day'),
        API.getUsageStats('week'),
        API.getUsageStats('month'),
      ]);
      this.statsMap = { day, week, month };
      this.renderCards();
      this.renderSummary();
    } catch (err) {
      document.getElementById('ul-cards').innerHTML =
        App.renderEmpty('加载失败', err.message, '⚠️');
      App.showToast(`使用日志加载失败: ${err.message}`, 'error');
    }
  },

  /** 数字千分位 */
  _fmtNum(n) {
    return Number(n || 0).toLocaleString('en-US');
  },

  /** 顶部三卡片 (点击切换汇总区周期) */
  renderCards() {
    const el = document.getElementById('ul-cards');
    if (!el) return;
    el.innerHTML = `
      <div class="ul-cards">
        ${this.PERIODS.map(p => {
          const s = this.statsMap[p.key] || {};
          const active = this.period === p.key ? ' ul-card--active' : '';
          return `
            <div class="ul-card${active}" data-period="${p.key}">
              <div class="ul-card__title"><span class="ul-card__title-icon">${p.icon}</span>${p.label}</div>
              <div class="ul-card__grid">
                ${this.METRICS.map(m => `
                  <div class="ul-metric ul-metric--${m.cls}">
                    <div class="ul-metric__v">${this._fmtNum(s[m.key])}</div>
                    <div class="ul-metric__l">${m.icon} ${m.label}</div>
                  </div>`).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    el.querySelectorAll('.ul-card').forEach(card => {
      card.addEventListener('click', () => {
        this.period = card.getAttribute('data-period');
        this.renderCards();
        this.renderSummary();
        const drill = document.getElementById('ul-drill');
        if (drill) drill.innerHTML = '';
        this.drillStack = [];
      });
    });
  },

  actionLabel(a) {
    return this.ACTION_LABELS[a] || a || '—';
  },

  /** 分类汇总表 (当前周期) */
  renderSummary() {
    const el = document.getElementById('ul-summary');
    if (!el) return;
    const s = this.statsMap[this.period] || { writes: [], llm: [] };
    const periodLabel = (this.PERIODS.find(p => p.key === this.period) || {}).label || '';

    const writeRows = (s.writes || []).map(w => `
      <tr class="ul-row--link" data-entity="${App.escapeHtml(w.entity_type)}">
        <td>${App.escapeHtml(w.entity_type)}</td>
        <td>${App.escapeHtml(this.actionLabel(w.action))}</td>
        <td>${w.count}</td>
      </tr>
    `).join('');

    const llmRows = (s.llm || []).map(l => `
      <tr class="ul-row--link" data-llm-entity="${App.escapeHtml(l.entity_type)}">
        <td>${App.escapeHtml(l.entity_type)}</td>
        <td>${l.calls}</td>
        <td>${l.tokens}</td>
      </tr>
    `).join('');

    el.innerHTML = `
      <div class="ul-summary-grid">
        <div class="card">
          <div class="card__header">
            <div class="card__title">数据更新汇总 · ${periodLabel}</div>
            <span class="badge badge--primary">${(s.writes || []).length} 类</span>
          </div>
          <div class="card__body" style="padding:0;">
            <table class="wr-list-table">
              <thead><tr><th>数据类型</th><th>动作</th><th>次数</th></tr></thead>
              <tbody>
                <tr class="ul-row--link" data-entity="登录">
                  <td>登录</td><td>登录</td><td>${s.login_count ?? 0}</td>
                </tr>
                ${writeRows || ''}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card__header">
            <div class="card__title">LLM 调用汇总 · ${periodLabel}</div>
            <span class="badge badge--primary">${this._fmtNum(s.llm_calls)} 次 / ${this._fmtNum(s.llm_tokens)} tokens</span>
          </div>
          <div class="card__body" style="padding:0;">
            <table class="wr-list-table">
              <thead><tr><th>调用来源</th><th>调用次数</th><th>Token 数</th></tr></thead>
              <tbody>
                ${llmRows || '<tr><td colspan="3" style="text-align:center;color:#94A3B8;">本期无 LLM 调用</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // 一级下钻: 数据更新 -> 实体明细
    el.querySelectorAll('[data-entity]').forEach(tr => {
      tr.addEventListener('click', () => {
        this.showDetails(tr.getAttribute('data-entity'));
      });
    });
    // LLM 调用来源 -> 直接看操作记录 (llm_call 无实体维度)
    el.querySelectorAll('[data-llm-entity]').forEach(tr => {
      tr.addEventListener('click', () => {
        this.showOperations(tr.getAttribute('data-llm-entity'), null, { action: 'llm_call' },
          `${tr.getAttribute('data-llm-entity')} · LLM 调用记录`);
      });
    });
  },

  /* ------------------------------------------------------------------
   * 一级下钻: 实体明细
   * ---------------------------------------------------------------- */
  async showDetails(entityType) {
    const el = document.getElementById('ul-drill');
    if (!el) return;
    el.innerHTML = App.renderLoading('加载明细...');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const res = await API.getUsageDetails(this.period, entityType);
      const items = res.items || [];
      const rows = items.map(it => {
        const isLogin = entityType === '登录';
        const label = isLogin ? (it.user_name || '—') : (it.entity_id != null ? `#${it.entity_id}` : '—');
        return `
          <tr class="ul-row--link" data-entity-id="${it.entity_id != null ? it.entity_id : ''}"
              data-action="${App.escapeHtml(it.action || '')}" data-user="${App.escapeHtml(it.user_name || '')}">
            <td>${App.escapeHtml(label)}</td>
            <td>${App.escapeHtml(this.actionLabel(it.action))}</td>
            <td>${it.count}</td>
            <td>${isLogin ? (it.valid_count ?? '—') : (it.users ?? '—')}</td>
            <td>${it.tokens || 0}</td>
            <td>${App.escapeHtml(this.fmtTime(it.last_at))}</td>
          </tr>
        `;
      }).join('');

      el.innerHTML = `
        <div class="card">
          <div class="card__header">
            <div class="card__title">🔍 ${App.escapeHtml(entityType)} · 明细</div>
            <button class="btn btn-ghost btn-sm" id="ul-back-summary">← 返回汇总</button>
          </div>
          <div class="card__body" style="padding:0;">
            <table class="wr-list-table">
              <thead><tr><th>${entityType === '登录' ? '登录人' : '实体ID'}</th><th>动作</th><th>次数</th><th>${entityType === '登录' ? '有效次数' : '操作人数'}</th><th>Token</th><th>最近时间</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94A3B8;">本期无记录</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById('ul-back-summary').addEventListener('click', () => {
        el.innerHTML = '';
      });

      // 二级下钻: 操作记录
      el.querySelectorAll('tr.ul-row--link').forEach(tr => {
        tr.addEventListener('click', () => {
          const eid = tr.getAttribute('data-entity-id');
          const action = tr.getAttribute('data-action');
          const user = tr.getAttribute('data-user');
          const extra = {};
          if (entityType === '登录') {
            if (user) extra.user_name = user;
          } else if (action) {
            extra.action = action;
          }
          this.showOperations(entityType, eid || null, extra,
            `${entityType}${eid ? ' #' + eid : ''}${user ? ' · ' + user : ''} · 操作记录`);
        });
      });
    } catch (err) {
      el.innerHTML = App.renderEmpty('明细加载失败', err.message, '⚠️');
    }
  },

  /* ------------------------------------------------------------------
   * 二级下钻: 操作记录 (按日期倒序)
   * ---------------------------------------------------------------- */
  async showOperations(entityType, entityId, extra = {}, title = '') {
    const el = document.getElementById('ul-drill');
    if (!el) return;
    el.innerHTML = App.renderLoading('加载操作记录...');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const res = await API.getUsageOperations(this.period, entityType, entityId, extra);
      const items = res.items || [];
      const rows = items.map(it => `
        <tr>
          <td>${App.escapeHtml(this.fmtTime(it.created_at))}</td>
          <td>${App.escapeHtml(it.user_name || '—')}</td>
          <td>${App.escapeHtml(this.actionLabel(it.action))}</td>
          <td>${App.escapeHtml(it.method || '—')}</td>
          <td class="ul-path" title="${App.escapeHtml(it.path || '')}">${App.escapeHtml(it.path || '—')}</td>
          <td>${it.tokens || 0}</td>
          <td class="ul-detail" title="${App.escapeHtml(it.detail || '')}">${App.escapeHtml(it.detail || '—')}</td>
        </tr>
      `).join('');

      el.innerHTML = `
        <div class="card">
          <div class="card__header">
            <div class="card__title">🧾 ${App.escapeHtml(title || '操作记录')}</div>
            <button class="btn btn-ghost btn-sm" id="ul-back-detail">← 返回明细</button>
          </div>
          <div class="card__body" style="padding:0;">
            <table class="wr-list-table">
              <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>方法</th><th>路径</th><th>Token</th><th>详情</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94A3B8;">本期无操作记录</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;

      document.getElementById('ul-back-detail').addEventListener('click', () => {
        if (extra.action === 'llm_call') {
          // LLM 来源行直接来自汇总, 返回即回汇总
          el.innerHTML = '';
        } else {
          this.showDetails(entityType);
        }
      });
    } catch (err) {
      el.innerHTML = App.renderEmpty('操作记录加载失败', err.message, '⚠️');
    }
  },

  /** ISO 时间 -> 'MM-DD HH:mm' */
  fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
};
