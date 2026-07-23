/* ==========================================================================
   仪表盘模块
   展示学习概览统计、7 日复习趋势、快捷操作
   ========================================================================== */
const Dashboard = {
  /** 容器节点缓存 */
  container: null,

  /** 初始化: 绑定事件 (使用事件委托, 只绑定一次) */
  init() {
    this.container = document.getElementById('view-dashboard');
    if (!this.container) return;

    this.container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');

      if (action === 'go-review') {
        App.switchView('review');
      } else if (action === 'go-learn') {
        App.switchView('learn');
      }
    });
  },

  /** 视图显示时触发: 拉取统计并渲染 */
  async onShow() {
    if (!this.container) {
      this.container = document.getElementById('view-dashboard');
      if (!this.container) return;
    }

    // 先渲染 loading 占位
    this.container.innerHTML = App.renderLoading('加载统计数据...');

    try {
      const stats = await API.get('/review/stats');
      this.render(stats || {});
    } catch (err) {
      this.container.innerHTML = App.renderEmpty('加载失败', err && err.message ? err.message : '请稍后重试', '⚠️');
      App.showToast(err && err.message ? err.message : '加载统计数据失败', 'error');
    }
  },

  /** 渲染整页 */
  render(stats) {
    const todayPending = Number(stats.today_pending) || 0;
    const todayLearned = Number(stats.today_learned) || 0;
    const mastered = Number(stats.mastered) || 0;
    const stubborn = Number(stats.stubborn) || 0;
    const totalWords = Number(stats.total_words) || 0;
    const learningWords = Number(stats.learning_words) || 0;
    const newWords = Number(stats.new_words) || 0;
    const streakDays = Number(stats.streak_days) || 0;
    const weeklyReviews = Array.isArray(stats.weekly_reviews) ? stats.weekly_reviews.slice(-7) : [];

    this.container.innerHTML = `
      ${this._renderHeader(todayPending)}
      ${this._renderStatCards({ todayPending, todayLearned, mastered, stubborn })}
      ${this._renderSecondaryStats({ newWords, learningWords, mastered, totalWords })}
      ${this._renderStreak(streakDays)}
      ${this._renderWeeklyChart(weeklyReviews)}
      ${this._renderQuickActions(todayPending)}
    `;
  },

  /** 页头 */
  _renderHeader(todayPending) {
    const hint = todayPending > 0
      ? `今日还有 ${todayPending} 个单词待复习, 加油!`
      : '今日复习已完成, 继续保持!';
    return `
      <div class="dashboard-header">
        <h1 class="dashboard-header__title">📊 仪表盘</h1>
        <p class="dashboard-header__subtitle">${App.escapeHtml(hint)}</p>
      </div>
    `;
  },

  /** 顶部四张统计卡片 */
  _renderStatCards({ todayPending, todayLearned, mastered, stubborn }) {
    const cards = [
      { key: 'pending',  number: todayPending, label: '今日待复习', icon: '📅', modifier: 'blue'   },
      { key: 'learned',  number: todayLearned, label: '今日新学',   icon: '📖', modifier: 'green'  },
      { key: 'mastered', number: mastered,     label: '已掌握',     icon: '✅', modifier: 'purple' },
      { key: 'stubborn', number: stubborn,     label: '顽固词',     icon: '⚠️', modifier: 'orange' }
    ];

    const items = cards.map(c => `
      <div class="stat-card stat-card--${c.modifier}">
        <div class="stat-card__icon">${c.icon}</div>
        <div class="stat-card__body">
          <div class="stat-card__number">${App.escapeHtml(String(c.number))}</div>
          <div class="stat-card__label">${App.escapeHtml(c.label)}</div>
        </div>
      </div>
    `).join('');

    return `<div class="stat-grid">${items}</div>`;
  },

  /** 累计进度 (新词 / 学习中 / 已掌握) */
  _renderSecondaryStats({ newWords, learningWords, mastered, totalWords }) {
    const total = totalWords || (newWords + learningWords + mastered);
    const safeTotal = total > 0 ? total : 1;

    const segments = [
      { value: newWords,      label: '新词',     modifier: 'new'      },
      { value: learningWords, label: '学习中',   modifier: 'learning' },
      { value: mastered,      label: '已掌握',   modifier: 'mastered' }
    ];

    const bar = segments.map(seg => {
      const pct = (seg.value / safeTotal) * 100;
      if (pct <= 0) return '';
      return `<div class="progress-segment progress-segment--${seg.modifier}"
                   style="width: ${pct}%"
                   title="${App.escapeHtml(seg.label)}: ${seg.value}"></div>`;
    }).join('');

    const legend = segments.map(seg => `
      <div class="progress-legend__item">
        <span class="progress-legend__dot progress-legend__dot--${seg.modifier}"></span>
        <span class="progress-legend__label">${App.escapeHtml(seg.label)}</span>
        <span class="progress-legend__value">${App.escapeHtml(String(seg.value))}</span>
      </div>
    `).join('');

    return `
      <div class="card">
        <div class="card-head">
          <span class="card-head__title">累计进度</span>
          <span class="badge badge--primary">共 ${App.escapeHtml(String(total))} 词</span>
        </div>
        <div class="card-body">
          <div class="progress-bar">${bar}</div>
          <div class="progress-legend">${legend}</div>
        </div>
      </div>
    `;
  },

  /** 连续学习天数 */
  _renderStreak(streakDays) {
    return `
      <div class="streak-banner">
        <span class="streak-banner__icon">🔥</span>
        <span class="streak-banner__text">连续学习 <strong>${App.escapeHtml(String(streakDays))}</strong> 天</span>
      </div>
    `;
  },

  /** 7 日复习趋势柱状图 (纯 CSS) */
  _renderWeeklyChart(weeklyReviews) {
    // 不足 7 天时用 0 填充前面, 保证显示 7 列
    const padded = [];
    for (let i = 0; i < 7; i++) padded.push({ date: '', count: 0 });
    weeklyReviews.slice(-7).forEach((item, idx) => {
      padded[7 - weeklyReviews.slice(-7).length + idx] = {
        date: item.date || '',
        count: Number(item.count) || 0
      };
    });

    const maxCount = Math.max(1, ...padded.map(d => d.count));

    const bars = padded.map(d => {
      const heightPct = (d.count / maxCount) * 100;
      const dateLabel = d.date ? this._formatShortDate(d.date) : '—';
      const countLabel = d.date ? String(d.count) : '';
      return `
        <div class="chart-bar">
          <div class="chart-bar__count">${App.escapeHtml(countLabel)}</div>
          <div class="chart-bar__track">
            <div class="chart-bar__fill" style="height: ${heightPct}%"></div>
          </div>
          <div class="chart-bar__label">${App.escapeHtml(dateLabel)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="card">
        <div class="card-head">
          <span class="card-head__title">📈 近 7 日复习趋势</span>
        </div>
        <div class="card-body">
          <div class="chart-container">${bars}</div>
        </div>
      </div>
    `;
  },

  /** 快捷操作按钮 */
  _renderQuickActions(todayPending) {
    const reviewPrimary = todayPending > 0 ? 'btn-primary' : '';
    return `
      <div class="quick-actions">
        <button class="btn ${reviewPrimary}" data-action="go-review">🔁 开始复习</button>
        <button class="btn" data-action="go-learn">✨ 学习新词</button>
      </div>
    `;
  },

  /** 将 YYYY-MM-DD 转为 MM-DD 简短日期 */
  _formatShortDate(dateStr) {
    const parts = String(dateStr).split('-');
    if (parts.length < 3) return dateStr;
    return `${parts[1]}-${parts[2]}`;
  }
};
