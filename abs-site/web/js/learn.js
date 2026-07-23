/* ==========================================================================
   学习新词模块
   分页学习 + 回忆测试 + 触发艾宾浩斯 8 点复习计划
   每页 10 词, 背完一页立刻遮中文回忆一遍
   ========================================================================== */

const Learn = {
  /** 容器节点缓存 */
  container: null,

  /** 每页单词数 (艾宾浩斯方法: 10 词/页, 约 5 分钟) */
  PAGE_SIZE: 10,

  /** 状态 */
  state: {
    units: [],
    selectedUnit: null,
    currentPage: 0,        // 当前页 (0 基)
    words: [],             // 选中单元的 new 词列表
    learnedWords: [],      // 本次会话已学单词
    sessionActive: false,
    reviewPending: 0,      // 今日待复习数 (用于复习优先级提示)
    revealedRecall: {},    // { wordId: true } 当前页回忆测试已显示释义的词
    submitting: false,
  },

  /** 初始化: 绑定事件委托 (只绑定一次) */
  init() {
    this.container = document.getElementById('view-learn');
    if (!this.container) return;
    this.container.addEventListener('click', (e) => this._onClick(e));
  },

  /** 视图显示时触发: 检查复习优先级 + 拉取单元列表 */
  async onShow() {
    if (!this.container) {
      this.container = document.getElementById('view-learn');
      if (!this.container) return;
    }
    this._resetState();
    this.container.innerHTML = App.renderLoading('加载单元列表...');

    try {
      // 并行拉取复习统计 (用于优先级提示) 与单元列表
      // stats 失败不应阻断学习流程, 兜底为空对象
      const [stats, units] = await Promise.all([
        API.get('/review/stats').catch(() => ({})),
        API.get('/units/'),
      ]);

      this.state.reviewPending = Number(stats && stats.today_pending) || 0;
      const unitList = Array.isArray(units) ? units : [];
      // 仅保留包含 new 词的单元, 并附加统计字段
      this.state.units = unitList
        .map((u) => this._withCounts(u))
        .filter((u) => u._newCount > 0);

      this._renderUnitSelection();
    } catch (err) {
      this.container.innerHTML = App.renderEmpty(
        '加载失败',
        err && err.message ? err.message : '请稍后重试',
        '⚠️'
      );
      App.showToast(err && err.message ? err.message : '加载单元列表失败', 'error');
    }
  },

  /** 重置会话状态 */
  _resetState() {
    this.state.units = [];
    this.state.selectedUnit = null;
    this.state.currentPage = 0;
    this.state.words = [];
    this.state.learnedWords = [];
    this.state.sessionActive = false;
    this.state.reviewPending = 0;
    this.state.revealedRecall = {};
    this.state.submitting = false;
  },

  /** 为单元附加统计字段 (_newCount / _learnedCount / _total) */
  _withCounts(u) {
    const words = Array.isArray(u.words) ? u.words : [];
    let newCount = 0;
    let learnedCount = 0;
    words.forEach((w) => {
      if (w.status === 'new') newCount += 1;
      else learnedCount += 1; // learning / master 统计为已学
    });
    return {
      ...u,
      _newCount: newCount,
      _learnedCount: learnedCount,
      _total: words.length,
    };
  },

  /* ------------------------------------------------------------------
     渲染: 单元选择
     ------------------------------------------------------------------ */

  _renderUnitSelection() {
    const { reviewPending, units } = this.state;
    const warning = reviewPending > 0 ? this._renderReviewWarning(reviewPending) : '';
    const body = units.length
      ? this._renderUnitGrid(units)
      : App.renderEmpty(
          '没有可学习的新词',
          '所有单元的单词都已进入复习或掌握, 去复习巩固一下吧',
          '🎉'
        );

    this.container.innerHTML = `
      <div class="learn-header">
        <h1 class="learn-header__title">📖 学习新词</h1>
        <p class="learn-header__subtitle">选择一个单元开始学习, 每页 10 词, 背完一页立刻遮中文回忆一遍</p>
      </div>
      ${warning}
      ${body}
    `;
  },

  /** 复习优先级警告横幅 */
  _renderReviewWarning(pending) {
    return `
      <div class="review-warning">
        <span class="review-warning__text">⚠️ 你有 <strong>${App.escapeHtml(String(pending))}</strong> 个单词到期复习, 请先完成复习</span>
        <button class="btn btn-primary btn-sm" data-action="go-review">去复习</button>
      </div>
    `;
  },

  /** 单元卡片网格 */
  _renderUnitGrid(units) {
    const cards = units.map((u) => this._renderUnitCard(u)).join('');
    return `<div class="unit-grid">${cards}</div>`;
  },

  _renderUnitCard(u) {
    const name = App.escapeHtml(u.name || '');
    const desc = u.description ? App.escapeHtml(u.description) : '';
    const disabled = u._newCount === 0 ? ' disabled' : '';
    return `
      <div class="unit-card">
        <div class="unit-card__name">${name}</div>
        ${desc ? `<div class="unit-card__desc">${desc}</div>` : ''}
        <div class="unit-card__stats">
          <span class="badge badge--primary">新词 ${App.escapeHtml(String(u._newCount))}</span>
          <span class="badge">共 ${App.escapeHtml(String(u._total))} 词</span>
          ${u._learnedCount ? `<span class="badge badge--success">已学 ${App.escapeHtml(String(u._learnedCount))}</span>` : ''}
        </div>
        <button class="btn btn-primary" data-action="start-unit" data-unit-id="${App.escapeHtml(String(u.id))}"${disabled}>开始学习</button>
      </div>
    `;
  },

  /* ------------------------------------------------------------------
     渲染: 学习屏幕
     ------------------------------------------------------------------ */

  _renderLearning() {
    const unit = this.state.selectedUnit || {};
    const { words, currentPage } = this.state;
    const totalPages = Math.max(1, Math.ceil(words.length / this.PAGE_SIZE));
    const page = Math.min(currentPage, totalPages - 1);
    const start = page * this.PAGE_SIZE;
    const pageWords = words.slice(start, start + this.PAGE_SIZE);

    const cards = pageWords.map((w) => this._renderWordCard(w)).join('');
    const recall = this._renderRecall(pageWords);
    const nav = this._renderPageNav(page, totalPages, words.length);

    this.container.innerHTML = `
      <button class="btn btn-sm" data-action="back-units">← 返回单元列表</button>
      <div class="learn-header">
        <h1 class="learn-header__title">📖 ${App.escapeHtml(unit.name || '')}</h1>
        <p class="learn-header__subtitle">共 ${App.escapeHtml(String(words.length))} 个新词 · 当前第 ${App.escapeHtml(String(page + 1))}/${App.escapeHtml(String(totalPages))} 页</p>
      </div>
      <div class="learn-page">
        ${cards}
        ${recall}
      </div>
      ${nav}
    `;
  },

  /** 单张单词学习卡片 */
  _renderWordCard(w) {
    const english = App.escapeHtml(w.english || '');
    const phonetic = w.phonetic ? App.escapeHtml(w.phonetic) : '';
    const definition = w.definition ? App.escapeHtml(w.definition) : '';
    const example = w.example ? App.escapeHtml(w.example) : '';
    return `
      <div class="learn-word-card">
        <div class="learn-word-card__head">
          <div class="learn-word-card__english">${english}</div>
          ${phonetic ? `<div class="learn-word-card__phonetic">${phonetic}</div>` : ''}
        </div>
        ${definition ? `<div class="learn-word-card__definition">${definition}</div>` : ''}
        ${example ? `<div class="learn-word-card__example">${example}</div>` : ''}
      </div>
    `;
  },

  /** 分页控件 (最后一页显示"完成学习") */
  _renderPageNav(page, totalPages, totalWords) {
    const isLast = page >= totalPages - 1;
    const isFirst = page <= 0;
    return `
      <div class="learn-page-nav">
        <button class="btn" data-action="prev-page"${isFirst ? ' disabled' : ''}>← 上一页</button>
        <span class="learn-page-nav__indicator">第 ${App.escapeHtml(String(page + 1))}/${App.escapeHtml(String(totalPages))} 页 · 共 ${App.escapeHtml(String(totalWords))} 词</span>
        ${isLast
          ? `<button class="btn btn-primary" data-action="complete">完成学习</button>`
          : `<button class="btn btn-primary" data-action="next-page">下一页 →</button>`}
      </div>
    `;
  },

  /** 回忆测试区: 仅显示英文, 逐个核对释义 */
  _renderRecall(pageWords) {
    if (!pageWords.length) return '';
    const items = pageWords.map((w) => this._renderRecallItem(w)).join('');
    return `
      <div class="learn-recall">
        <h2 class="learn-recall__title">🧠 回忆测试</h2>
        <p class="learn-recall__hint">背完一页（约5分钟），立刻遮中文回忆一遍。点击“显示释义”核对。</p>
        <div class="learn-recall__list" id="learn-recall-list">${items}</div>
      </div>
    `;
  },

  _renderRecallItem(w) {
    const id = w.id;
    const english = App.escapeHtml(w.english || '');
    const revealed = !!this.state.revealedRecall[id];
    const btnLabel = revealed ? '隐藏释义' : '显示释义';
    const detail = revealed
      ? `<div class="learn-recall__detail">
          ${w.phonetic ? `<div class="learn-recall__detail-phonetic">${App.escapeHtml(w.phonetic)}</div>` : ''}
          ${w.definition ? `<div>${App.escapeHtml(w.definition)}</div>` : ''}
          ${w.example ? `<div class="learn-recall__detail-example">例: ${App.escapeHtml(w.example)}</div>` : ''}
        </div>`
      : '';
    return `
      <div class="learn-recall__item">
        <div class="learn-recall__item-head">
          <span class="learn-recall__english">${english}</span>
          <button class="btn btn-sm learn-recall__reveal" data-action="reveal-recall" data-word-id="${App.escapeHtml(String(id))}">${btnLabel}</button>
        </div>
        ${detail}
      </div>
    `;
  },

  /** 仅刷新回忆测试列表 (保留滚动位置) */
  _refreshRecallList() {
    const list = this.container.querySelector('#learn-recall-list');
    if (!list) return;
    const { words, currentPage } = this.state;
    const start = currentPage * this.PAGE_SIZE;
    const pageWords = words.slice(start, start + this.PAGE_SIZE);
    list.innerHTML = pageWords.map((w) => this._renderRecallItem(w)).join('');
  },

  /* ------------------------------------------------------------------
     渲染: 完成屏幕
     ------------------------------------------------------------------ */

  _renderComplete(started) {
    return `
      <div class="learn-complete">
        <div class="learn-complete__icon">🎉</div>
        <h2 class="learn-complete__title">学习完成！已为 ${App.escapeHtml(String(started))} 个单词生成复习计划</h2>
        <p class="learn-complete__hint">5 分钟后开始第一轮复习, 请及时回到复习页完成</p>
        <div class="learn-complete__actions">
          <button class="btn btn-primary" data-action="go-review">去复习</button>
          <button class="btn" data-action="back-dashboard">返回仪表盘</button>
        </div>
      </div>
    `;
  },

  /* ------------------------------------------------------------------
     交互 (事件委托)
     ------------------------------------------------------------------ */

  _onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');

    if (action === 'go-review') App.switchView('review');
    else if (action === 'back-dashboard') App.switchView('dashboard');
    else if (action === 'back-units') this._backToUnits();
    else if (action === 'start-unit') this._startUnit(btn.getAttribute('data-unit-id'));
    else if (action === 'prev-page') this._changePage(-1);
    else if (action === 'next-page') this._changePage(1);
    else if (action === 'complete') this._complete();
    else if (action === 'reveal-recall') this._toggleRecall(btn.getAttribute('data-word-id'));
  },

  /** 开始学习某单元: 仅取 new 词, 按 sort_order / id 排序 */
  _startUnit(unitIdRaw) {
    const unitId = Number(unitIdRaw);
    const unit = this.state.units.find((u) => u.id === unitId);
    if (!unit) return;
    const words = (unit.words || [])
      .filter((w) => w.status === 'new')
      .slice()
      .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
    if (!words.length) {
      App.showToast('该单元没有新词', 'warning');
      return;
    }
    this.state.selectedUnit = unit;
    this.state.words = words;
    this.state.learnedWords = words.slice();
    this.state.currentPage = 0;
    this.state.sessionActive = true;
    this.state.revealedRecall = {};
    this._renderLearning();
  },

  /** 返回单元列表 */
  _backToUnits() {
    this.state.selectedUnit = null;
    this.state.words = [];
    this.state.learnedWords = [];
    this.state.currentPage = 0;
    this.state.sessionActive = false;
    this.state.revealedRecall = {};
    this._renderUnitSelection();
  },

  /** 翻页 (越界自动钳制, 翻页时清空回忆状态) */
  _changePage(delta) {
    const totalPages = Math.max(1, Math.ceil(this.state.words.length / this.PAGE_SIZE));
    let next = this.state.currentPage + delta;
    if (next < 0) next = 0;
    if (next > totalPages - 1) next = totalPages - 1;
    if (next === this.state.currentPage) return;
    this.state.currentPage = next;
    this.state.revealedRecall = {};
    this._renderLearning();
    this.container.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },

  /** 切换某词回忆释义的显示 */
  _toggleRecall(wordIdRaw) {
    const id = Number(wordIdRaw);
    if (this.state.revealedRecall[id]) {
      delete this.state.revealedRecall[id];
    } else {
      this.state.revealedRecall[id] = true;
    }
    this._refreshRecallList();
  },

  /** 完成学习: 调用后端为全部 new 词生成 8 点复习计划 */
  async _complete() {
    if (this.state.submitting) return;
    const unit = this.state.selectedUnit;
    if (!unit) return;
    this.state.submitting = true;
    const btn = this.container.querySelector('[data-action="complete"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '生成中...';
    }
    try {
      const res = await API.post('/review/start-learning', { unit_id: unit.id });
      const started = Number(res && res.started) || 0;
      this.container.innerHTML = this._renderComplete(started);
      App.showToast(`已为 ${started} 个单词生成复习计划`, 'success');
    } catch (err) {
      App.showToast(err && err.message ? err.message : '完成学习失败, 请重试', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '完成学习';
      }
    } finally {
      this.state.submitting = false;
    }
  },
};
