/* ==========================================================================
   复习模块 (核心交互)
   主动回忆: 先看单词尝试回忆, 再显示释义, 最后标记 pass/struggle/fail
   艾宾浩斯 8 个复习间隔节点: 5分钟 / 30分钟 / 12小时 / D1 / D2 / D4 / D7 / D15
   ========================================================================== */

/* 复习间隔节点标签 (与后端 INTERVAL_OFFSETS 对应) */
const INTERVAL_LABELS = ['5分钟', '30分钟', '12小时', 'D1', 'D2', 'D4', 'D7', 'D15'];

const Review = {
  /** 容器节点缓存 */
  container: null,

  /** 状态 */
  state: {
    queue: [],          // 今日待复习列表
    currentIndex: 0,    // 当前卡片索引
    revealed: false,    // 释义是否已显示
    submitting: false,  // 标记请求进行中, 防止重复提交
    sessionStats: { pass: 0, struggle: 0, fail: 0, total: 0 },
    overdueCount: 0,
  },

  /** 初始化: 绑定事件委托 (只绑定一次) */
  init() {
    this.container = document.getElementById('view-review');
    if (!this.container) return;

    this.container.addEventListener('click', (e) => this._onClick(e));
    // 键盘快捷键: 空格=显示释义, 1=pass, 2=struggle, 3=fail
    document.addEventListener('keydown', (e) => this._onKeyDown(e));
  },

  /** 视图显示时触发: 拉取今日复习并渲染 */
  async onShow() {
    if (!this.container) {
      this.container = document.getElementById('view-review');
      if (!this.container) return;
    }

    this._resetState();
    this.container.innerHTML = App.renderLoading('加载今日复习...');

    try {
      const data = await API.get('/review/today-reviews');
      const reviews = data && Array.isArray(data.reviews) ? data.reviews : [];
      const overdue = Number(data && data.overdue_count) || 0;

      this.state.queue = reviews;
      this.state.overdueCount = overdue;

      if (!reviews.length) {
        this.container.innerHTML = this._renderEmptyState();
        return;
      }

      this._renderShellIntoDom();
      this._renderCardIntoDom(true);
    } catch (err) {
      this.container.innerHTML = App.renderEmpty(
        '加载失败',
        err && err.message ? err.message : '请稍后重试',
        '⚠️'
      );
      App.showToast(err && err.message ? err.message : '加载复习内容失败', 'error');
    }
  },

  /** 重置会话状态 */
  _resetState() {
    this.state.queue = [];
    this.state.currentIndex = 0;
    this.state.revealed = false;
    this.state.submitting = false;
    this.state.sessionStats = { pass: 0, struggle: 0, fail: 0, total: 0 };
    this.state.overdueCount = 0;
  },

  /* ------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------ */

  /** 整页骨架: 页头 + 逾期横幅 + 进度 + 卡片容器 + 工具栏 */
  _renderShell() {
    return `
      ${this._renderHeader()}
      ${this.state.overdueCount > 0 ? this._renderOverdueBanner() : ''}
      <div class="review-progress">${this._renderProgressInner()}</div>
      <div class="review-container">
        <div id="review-card-area"></div>
      </div>
      <div class="review-toolbar">
        <button class="btn" data-action="export-pdf">📄 导出今日复习清单</button>
      </div>
    `;
  },

  _renderShellIntoDom() {
    this.container.innerHTML = this._renderShell();
  },

  /** 页头 */
  _renderHeader() {
    const total = this.state.queue.length;
    return `
      <div class="dashboard-header">
        <h1 class="dashboard-header__title">🔁 今日复习</h1>
        <p class="dashboard-header__subtitle">共 ${App.escapeHtml(String(total))} 个单词待复习, 先尝试回忆再看释义</p>
      </div>
    `;
  },

  /** 逾期补测横幅 */
  _renderOverdueBanner() {
    return `
      <div class="overdue-banner">
        <span class="overdue-banner__icon">⚠️</span>
        <span>你有 <strong>${App.escapeHtml(String(this.state.overdueCount))}</strong> 个补测项（断更恢复），请优先完成</span>
      </div>
    `;
  },

  /** 进度条 + 节点 (内部) */
  _renderProgressInner() {
    const total = this.state.queue.length;
    const idx = this.state.currentIndex;
    const pct = total ? (idx / total) * 100 : 0;
    const s = this.state.sessionStats;
    const rate = s.total ? Math.round((s.pass / s.total) * 100) : 0;
    const item = this.state.queue[idx];
    const intervalIdx = item ? item.interval_index : -1;
    const nodes = INTERVAL_LABELS.map((label, i) => {
      const cls = i === intervalIdx ? ' review-node--current' : '';
      return `<span class="review-node${cls}">${App.escapeHtml(label)}</span>`;
    }).join('');

    return `
      <div class="review-progress__head">
        <span class="review-progress__text">第 ${App.escapeHtml(String(Math.min(idx + 1, total)))} / ${App.escapeHtml(String(total))} 张</span>
        <span class="review-progress__rate">${s.total ? '通过率 ' + App.escapeHtml(String(rate)) + '%' : ''}</span>
      </div>
      <div class="review-progress__bar">
        <div class="review-progress__fill" style="width: ${pct}%"></div>
      </div>
      <div class="review-progress__nodes">
        <span class="review-progress__nodes-label">复习节点</span>
        ${nodes}
      </div>
    `;
  },

  /** 仅更新进度区动态内容 (保留 fill 的过渡动画) */
  _updateProgressIntoDom() {
    const prog = this.container.querySelector('.review-progress');
    if (!prog) return;
    const total = this.state.queue.length;
    const idx = this.state.currentIndex;
    const pct = total ? (idx / total) * 100 : 0;
    const s = this.state.sessionStats;
    const rate = s.total ? Math.round((s.pass / s.total) * 100) : 0;

    const textEl = prog.querySelector('.review-progress__text');
    if (textEl) textEl.textContent = `第 ${Math.min(idx + 1, total)} / ${total} 张`;
    const rateEl = prog.querySelector('.review-progress__rate');
    if (rateEl) rateEl.textContent = s.total ? `通过率 ${rate}%` : '';
    const fill = prog.querySelector('.review-progress__fill');
    if (fill) fill.style.width = `${pct}%`;

    const nodesEl = prog.querySelector('.review-progress__nodes');
    if (nodesEl) {
      const item = this.state.queue[idx];
      const intervalIdx = item ? item.interval_index : -1;
      nodesEl.innerHTML = `<span class="review-progress__nodes-label">复习节点</span>` +
        INTERVAL_LABELS.map((label, i) => {
          const cls = i === intervalIdx ? ' review-node--current' : '';
          return `<span class="review-node${cls}">${App.escapeHtml(label)}</span>`;
        }).join('');
    }
  },

  /** 当前卡片 (reveal 前后两种形态) */
  _renderCard(animate) {
    const item = this.state.queue[this.state.currentIndex];
    if (!item) return '';
    const word = item.word || {};
    const enterClass = animate ? ' review-card--enter' : '';

    if (!this.state.revealed) {
      return `
        <div class="review-card${enterClass}">
          <div class="review-card__hint">试着回忆这个单词的含义</div>
          <div class="review-card__word">${App.escapeHtml(word.english || '')}</div>
          ${word.phonetic ? `<div class="review-card__phonetic">${App.escapeHtml(word.phonetic)}</div>` : ''}
          <button class="btn btn-primary review-card__reveal-btn" data-action="reveal">👇 显示释义</button>
          <div class="review-card__shortcuts">空格键 显示释义</div>
        </div>
      `;
    }

    return `
      <div class="review-card${enterClass}">
        <div class="review-card__word">${App.escapeHtml(word.english || '')}</div>
        ${word.phonetic ? `<div class="review-card__phonetic">${App.escapeHtml(word.phonetic)}</div>` : ''}
        <div class="review-card__reveal-block">
          <div class="review-card__definition">${App.escapeHtml(word.definition || '')}</div>
          ${word.example ? `<div class="review-card__example">例: ${App.escapeHtml(word.example)}</div>` : ''}
        </div>
        <div class="review-mark-btns">
          <button class="btn mark-btn mark-btn--pass" data-action="mark" data-mark="pass">✓ 记住了</button>
          <button class="btn mark-btn mark-btn--struggle" data-action="mark" data-mark="struggle">△ 卡了一下</button>
          <button class="btn mark-btn mark-btn--fail" data-action="mark" data-mark="fail">★ 没记住</button>
        </div>
        <div class="review-card__shortcuts">1 记住 · 2 卡壳 · 3 没记住</div>
      </div>
    `;
  },

  /** 将卡片写入 DOM */
  _renderCardIntoDom(animate = false) {
    const area = this.container.querySelector('#review-card-area');
    if (!area) return;
    area.innerHTML = this._renderCard(animate);
  },

  /** 空状态 */
  _renderEmptyState() {
    return `
      <div class="review-container">
        ${App.renderEmpty('今日复习已完成！没有待复习的单词。', '去学习新词或查看顽固词本吧', '🎉')}
        <button class="btn btn-primary review-back-btn" data-action="back-dashboard">返回仪表盘</button>
      </div>
    `;
  },

  /** 完成总结页 */
  _renderSummary() {
    const s = this.state.sessionStats;
    const total = s.total || (s.pass + s.struggle + s.fail) || 0;
    const rate = total ? Math.round((s.pass / total) * 100) : 0;
    return `
      <div class="review-container">
        <div class="review-summary">
          <div class="review-summary__icon">🎉</div>
          <h2 class="review-summary__title">本次复习完成！</h2>
          <div class="review-summary__stats">
            <div class="review-summary__stat review-summary__stat--pass">
              <div class="review-summary__num">${App.escapeHtml(String(s.pass))}</div>
              <div class="review-summary__label">通过</div>
            </div>
            <div class="review-summary__stat review-summary__stat--struggle">
              <div class="review-summary__num">${App.escapeHtml(String(s.struggle))}</div>
              <div class="review-summary__label">卡壳</div>
            </div>
            <div class="review-summary__stat review-summary__stat--fail">
              <div class="review-summary__num">${App.escapeHtml(String(s.fail))}</div>
              <div class="review-summary__label">顽固</div>
            </div>
          </div>
          <div class="review-summary__rate">通过率 <strong>${App.escapeHtml(String(rate))}%</strong></div>
          <button class="btn btn-primary" data-action="back-dashboard">返回仪表盘</button>
        </div>
      </div>
    `;
  },

  /* ------------------------------------------------------------------
     交互
     ------------------------------------------------------------------ */

  /** 点击委托 */
  _onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');

    if (action === 'reveal') this._reveal();
    else if (action === 'mark') this._mark(btn.getAttribute('data-mark'));
    else if (action === 'export-pdf') this._exportPdf();
    else if (action === 'back-dashboard') App.switchView('dashboard');
  },

  /** 键盘快捷键 */
  _onKeyDown(e) {
    if (App.state.currentView !== 'review') return;
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (!this.state.queue.length) return;
    if (this.state.currentIndex >= this.state.queue.length) return;
    if (this.state.submitting) return;

    if (e.key === ' ' || e.code === 'Space') {
      if (!this.state.revealed) {
        e.preventDefault();
        this._reveal();
      }
      return;
    }
    if (this.state.revealed) {
      if (e.key === '1') { e.preventDefault(); this._mark('pass'); }
      else if (e.key === '2') { e.preventDefault(); this._mark('struggle'); }
      else if (e.key === '3') { e.preventDefault(); this._mark('fail'); }
    }
  },

  /** 显示释义 */
  _reveal() {
    if (this.state.revealed) return;
    this.state.revealed = true;
    this._renderCardIntoDom(false);
  },

  /** 标记本次复习结果 */
  async _mark(mark) {
    if (this.state.submitting) return;
    if (!this.state.revealed) return;
    const item = this.state.queue[this.state.currentIndex];
    if (!item) return;

    this.state.submitting = true;
    try {
      const updated = await API.post('/review/mark-review', {
        review_id: item.id,
        mark,
      });

      this.state.sessionStats[mark] = (this.state.sessionStats[mark] || 0) + 1;
      this.state.sessionStats.total += 1;

      // 若该词已掌握, 后端会跳过其剩余待复习计划, 本地队列同步剔除
      if (updated && updated.word && updated.word.status === 'mastered') {
        const wid = item.word_id;
        const cur = this.state.currentIndex;
        this.state.queue = this.state.queue.filter((it, idx) =>
          idx <= cur || it.word_id !== wid
        );
      }

      this._advance();
    } catch (err) {
      App.showToast(err && err.message ? err.message : '标记失败, 请重试', 'error');
    } finally {
      this.state.submitting = false;
    }
  },

  /** 进入下一张卡片, 或显示总结 */
  _advance() {
    this.state.currentIndex += 1;
    this.state.revealed = false;

    if (this.state.currentIndex >= this.state.queue.length) {
      this.container.innerHTML = this._renderSummary();
      return;
    }
    this._updateProgressIntoDom();
    this._renderCardIntoDom(true);
  },

  /* ------------------------------------------------------------------
     PDF 导出
     ------------------------------------------------------------------ */
  _exportPdf() {
    const reviews = this.state.queue;
    if (!reviews || !reviews.length) {
      App.showToast('没有可导出的复习内容', 'warning');
      return;
    }

    const rows = reviews.map((r, i) => {
      const w = r.word || {};
      return `<tr>
        <td style="border:1px solid #e2e8f0;padding:6px;text-align:center;">${i + 1}</td>
        <td style="border:1px solid #e2e8f0;padding:6px;font-weight:600;">${App.escapeHtml(w.english || '')}</td>
        <td style="border:1px solid #e2e8f0;padding:6px;font-family:Consolas,monospace;">${App.escapeHtml(w.phonetic || '')}</td>
        <td style="border:1px solid #e2e8f0;padding:6px;">${App.escapeHtml(w.definition || '')}</td>
        <td style="border:1px solid #e2e8f0;padding:6px;text-align:center;">${App.escapeHtml(INTERVAL_LABELS[r.interval_index] || '-')}</td>
      </tr>`;
    }).join('');

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const genAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
                  `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const node = document.createElement('div');
    node.style.cssText = 'position:fixed;left:-99999px;top:0;background:#ffffff;padding:24px;font-family:Arial,Helvetica,sans-serif;';
    node.innerHTML = `
      <h2 style="margin:0 0 4px;font-size:20px;">今日复习清单</h2>
      <p style="margin:0 0 16px;color:#64748b;font-size:12px;">共 ${reviews.length} 词 · 生成于 ${App.escapeHtml(genAt)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #e2e8f0;padding:6px;">#</th>
            <th style="border:1px solid #e2e8f0;padding:6px;">单词</th>
            <th style="border:1px solid #e2e8f0;padding:6px;">音标</th>
            <th style="border:1px solid #e2e8f0;padding:6px;">释义</th>
            <th style="border:1px solid #e2e8f0;padding:6px;">复习节点</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    document.body.appendChild(node);

    App.exportToPdf(node, '今日复习清单', { landscape: true })
      .finally(() => {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
  },
};
