/* ==========================================================================
   进度计划模块 ProgressPlan
   严格参照: 20260710信投AI2.0项目进度计划V2.3 执行图.html
   - 甘特图布局: 左 360px 任务面板 + 右时间轴面板
   - 184 天项目周期 (2026-07-01 至 2026-12-31)
   - 任务条按阶段着色 (p1/p2/p3), 里程碑用菱形, 今天线红色
   - 支持筛选 (阶段/状态/搜索)、图例切换、tooltip 悬停、模态框点击
   ========================================================================== */

const ProgressPlan = {
  // 全部任务 (缓存)
  tasks: [],
  // 筛选参数
  filters: {
    phase: 'all',       // 'all' | 1 | 2 | 3 | 'ms'
    status: 'all',      // 'all' | 'ongoing' | 'planned' | 'done'
    keyword: ''
  },
  // 被隐藏的阶段 (图例点击)
  hiddenPhases: new Set(),

  // 项目周期: 2026-07-01 ~ 2026-12-31, 共 184 天
  PROJECT_START: new Date('2026-06-30T16:00:00Z'),  // 2026-07-01 UTC+8
  TOTAL_DAYS: 184,

  // 月份定义 (start/end 为相对 2026-07-01 的天数偏移, 0-based)
  MONTHS: [
    { name: '2026年7月',  start: 0,   end: 30  },
    { name: '8月',         start: 31,  end: 61  },
    { name: '9月',         start: 62,  end: 91  },
    { name: '10月',        start: 92,  end: 122 },
    { name: '11月',        start: 123, end: 152 },
    { name: '12月',        start: 153, end: 183 }
  ],
  // 双周迭代 (12 个)
  BIWEEKS: [
    { label: '迭代1\n7/1-7/14',   start: 0,   end: 13  },
    { label: '迭代2\n7/15-7/31',  start: 14,  end: 30  },
    { label: '迭代3\n8/1-8/14',   start: 31,  end: 44  },
    { label: '迭代4\n8/15-8/31',  start: 45,  end: 61  },
    { label: '迭代5\n9/1-9/14',   start: 62,  end: 75  },
    { label: '迭代6\n9/15-9/30',  start: 76,  end: 91  },
    { label: '迭代7\n10/1-10/14', start: 92,  end: 105 },
    { label: '迭代8\n10/15-10/31',start: 106, end: 122 },
    { label: '迭代9\n11/1-11/14', start: 123, end: 136 },
    { label: '迭代10\n11/15-11/30',start: 137,end: 152 },
    { label: '迭代11\n12/1-12/15',start: 153, end: 167 },
    { label: '迭代12\n12/16-12/31',start: 168,end: 183 }
  ],

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    // 由 onShow 触发首次加载
  },

  /** 切换到此视图时触发 */
  onShow() {
    if (this.tasks.length === 0) {
      this.loadTasks();
    } else {
      this.render();
    }
  },

  /* ------------------------------------------------------------------
   * 工具函数
   * ---------------------------------------------------------------- */
  /** 把日期字符串 (YYYY-MM-DD) 转为相对 2026-07-01 的天数偏移 (0-based) */
  dateToDay(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    const diff = Math.round((d - this.PROJECT_START) / 86400000);
    return Math.max(0, Math.min(this.TOTAL_DAYS - 1, diff));
  },

  /** 天数偏移转百分比 (用于 left/width) */
  dayToPct(day) {
    return (day / this.TOTAL_DAYS * 100).toFixed(2);
  },

  /** 计算今天的偏移天数 (基于实际当前日期, 限制在 [0, TOTAL_DAYS-1]) */
  todayDay() {
    const now = new Date();
    const diff = Math.round((now - this.PROJECT_START) / 86400000);
    return Math.max(0, Math.min(this.TOTAL_DAYS - 1, diff));
  },

  /** 取阶段编号 (1/2/3) */
  phaseNo(phaseId) {
    if (String(phaseId) === '1') return 1;
    if (String(phaseId) === '2') return 2;
    if (String(phaseId) === '3') return 3;
    // 兜底: 用阶段在 App.state.phases 中的索引+1
    const idx = App.state.phases.findIndex(p => String(p.id) === String(phaseId));
    return idx >= 0 ? idx + 1 : 1;
  },

  /* ------------------------------------------------------------------
   * 加载任务列表
   * ---------------------------------------------------------------- */
  async loadTasks() {
    const view = document.getElementById('view-progress-plan');
    if (!view) return;

    view.innerHTML = App.renderLoading('加载进度计划...');

    try {
      const data = await API.getProgressTasks();
      this.tasks = Array.isArray(data) ? data : (data.items || []);
      this.render();
    } catch (err) {
      view.innerHTML = App.renderEmpty('加载失败', err.message, '⚠️');
      App.showToast(`加载进度计划失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 整体渲染
   * ---------------------------------------------------------------- */
  render() {
    const view = document.getElementById('view-progress-plan');
    if (!view) return;

    const phaseCount = App.state.phases.length;
    const msCount = this.tasks.filter(t => t.is_milestone || t.status === 'milestone').length;
    const taskCount = this.tasks.length - msCount;
    const biweekCount = this.BIWEEKS.length;

    view.innerHTML = `
      <div class="pp-container">
        <div class="pp-header">
          <div>
            <h1>信投 AI 2.0 项目进度计划执行图</h1>
            <div class="subtitle">
              <span>📅 基于《20260710信投AI2.0项目进度计划V2.3》</span>
              <span>⚡ ${phaseCount}阶段 · ${biweekCount}迭代 · ${msCount}里程碑 · ${taskCount}项任务</span>
              <span>🔍 点击任务查看详情, 勾选标记完成</span>
            </div>
          </div>
          <div class="date-range">2026年7月1日 — 2026年12月31日</div>
        </div>

        <div class="pp-stats-bar" id="pp-stats-bar">
          <div class="pp-stat-item p1" data-filter="1">
            <div class="num" id="pp-stat-p1">0</div>
            <div class="label">第一阶段任务</div>
            <div class="progress-bar"><div class="progress-fill" id="pp-prog-p1" style="width:0%"></div></div>
          </div>
          <div class="pp-stat-item p2" data-filter="2">
            <div class="num" id="pp-stat-p2">0</div>
            <div class="label">第二阶段任务</div>
            <div class="progress-bar"><div class="progress-fill" id="pp-prog-p2" style="width:0%"></div></div>
          </div>
          <div class="pp-stat-item p3" data-filter="3">
            <div class="num" id="pp-stat-p3">0</div>
            <div class="label">第三阶段任务</div>
            <div class="progress-bar"><div class="progress-fill" id="pp-prog-p3" style="width:0%"></div></div>
          </div>
          <div class="pp-stat-item ms" data-filter="ms">
            <div class="num" id="pp-stat-ms">0</div>
            <div class="label">里程碑达成</div>
            <div class="progress-bar"><div class="progress-fill" id="pp-prog-ms" style="width:0%"></div></div>
          </div>
          <div class="pp-stat-item" data-filter="all">
            <div class="num" id="pp-stat-total">0</div>
            <div class="label">总完成进度</div>
            <div class="progress-bar"><div class="progress-fill" id="pp-prog-total" style="width:0%;background:linear-gradient(90deg,#2563eb,#10b981)"></div></div>
          </div>
          <div class="pp-stat-item">
            <div class="num" style="background:linear-gradient(135deg,#ef4444,#f87171);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">26</div>
            <div class="label">周（约6个月）</div>
          </div>
        </div>

        <div class="pp-toolbar">
          <div class="pp-toolbar-group">
            <span class="pp-toolbar-label">🔒 筛选:</span>
            <button class="pp-btn active" data-phase="all" data-action="filter-phase">全部</button>
            <button class="pp-btn" data-phase="1" data-action="filter-phase">第一阶段</button>
            <button class="pp-btn p2-filter" data-phase="2" data-action="filter-phase">第二阶段</button>
            <button class="pp-btn p3-filter" data-phase="3" data-action="filter-phase">第三阶段</button>
            <button class="pp-btn ms-filter" data-phase="ms" data-action="filter-phase">里程碑</button>
          </div>
          <div class="pp-toolbar-group">
            <span class="pp-toolbar-label">✅ 状态:</span>
            <button class="pp-btn ${this.filters.status === 'all' ? 'active' : ''}" data-status="all" data-action="filter-status">全部</button>
            <button class="pp-btn ${this.filters.status === 'ongoing' ? 'active' : ''}" data-status="ongoing" data-action="filter-status">进行中</button>
            <button class="pp-btn ${this.filters.status === 'planned' ? 'active' : ''}" data-status="planned" data-action="filter-status">计划中</button>
            <button class="pp-btn ${this.filters.status === 'done' ? 'active' : ''}" data-status="done" data-action="filter-status">已完成</button>
          </div>
          <div class="pp-toolbar-group" style="margin-left:auto;">
            <div class="pp-search-box">
              <input type="text" id="pp-search" placeholder="搜索任务..." value="${App.escapeHtml(this.filters.keyword)}">
            </div>
            <button class="pp-btn" id="pp-new-btn">＋ 新建任务</button>
            <button class="pp-btn" id="pp-reset-btn">🔄 重置</button>
            <button class="pp-btn" id="pp-export-btn">📄 导出PDF</button>
          </div>
        </div>

        <div class="pp-legend" id="pp-legend">
          <div class="pp-legend-item" data-toggle-phase="1">
            <div class="pp-legend-bar" style="background:linear-gradient(135deg,var(--pp-p1),#93C5FD)"></div>
            第一阶段·有得用（7-8月）
          </div>
          <div class="pp-legend-item" data-toggle-phase="2">
            <div class="pp-legend-bar" style="background:linear-gradient(135deg,var(--pp-p2),#5EEAD4)"></div>
            第二阶段·用起来（9-10月）
          </div>
          <div class="pp-legend-item" data-toggle-phase="3">
            <div class="pp-legend-bar" style="background:linear-gradient(135deg,var(--pp-p3),#C4B5FD)"></div>
            第三阶段·用得好（11-12月）
          </div>
          <div class="pp-legend-item" data-toggle-phase="ms">
            <div class="pp-legend-diamond"></div>
            里程碑（M1-M11）
          </div>
          <div class="pp-legend-item">
            <div class="pp-legend-line"></div>
            当前日期
          </div>
          <div class="pp-legend-item">
            <span style="color:var(--pp-p1);font-size:14px;">●</span>
            进行中
          </div>
          <div class="pp-legend-item">
            <span style="color:var(--color-success);font-size:14px;">✓</span>
            已完成
          </div>
        </div>

        <div class="pp-gantt-wrapper">
          <div class="pp-task-panel">
            <div class="pp-task-panel-header">
              <span>📋 开发任务 / 里程碑</span>
              <span class="count" id="pp-task-count">0 / 0</span>
            </div>
            <div id="pp-task-list"></div>
          </div>
          <div class="pp-timeline-panel">
            <div class="pp-timeline-top">
              <div class="pp-month-headers" id="pp-month-headers"></div>
              <div class="pp-biweek-headers" id="pp-biweek-headers"></div>
            </div>
            <div id="pp-chart-body" style="position:relative;min-width:960px;">
              <div class="pp-grid-bg" id="pp-grid-bg"></div>
              <div id="pp-bars-area"></div>
              <div class="pp-today-line" id="pp-today-line"></div>
            </div>
          </div>
        </div>

        <div class="pp-mobile-hint" style="display:none;text-align:center;padding:40px;color:var(--color-text-secondary);">
          <div style="font-size:48px;margin-bottom:16px">🖥️</div>
          <div style="font-size:16px;font-weight:600">请在桌面端查看甘特图</div>
          <div style="font-size:13px;margin-top:8px">本页面需要至少 900px 宽度以获得最佳体验</div>
        </div>
      </div>
      <div class="pp-tooltip" id="pp-tooltip"></div>
    `;

    this.renderTimelineHeaders();
    this.renderGridBg();
    this.renderTodayLine();
    this.renderTasks();
    this.bindEvents();
  },

  /** 渲染时间轴顶部月份/双周表头 */
  renderTimelineHeaders() {
    const monthEl = document.getElementById('pp-month-headers');
    if (monthEl) {
      monthEl.innerHTML = this.MONTHS.map((m, i) => `
        <div class="pp-month-header" style="width:${((m.end - m.start + 1) / this.TOTAL_DAYS * 100).toFixed(2)}%;${i === this.MONTHS.length - 1 ? 'border-right:none;' : ''}">${App.escapeHtml(m.name)}</div>
      `).join('');
    }
    const biweekEl = document.getElementById('pp-biweek-headers');
    if (biweekEl) {
      biweekEl.innerHTML = this.BIWEEKS.map(b => `
        <div class="pp-biweek-header" style="width:${((b.end - b.start + 1) / this.TOTAL_DAYS * 100).toFixed(2)}%;">${App.escapeHtml(b.label).replace(/\n/g, '<br>')}</div>
      `).join('');
    }
  },

  /** 渲染网格背景线 (月份线 + 双周线) */
  renderGridBg() {
    const bg = document.getElementById('pp-grid-bg');
    if (!bg) return;
    let html = '';
    this.MONTHS.forEach(m => {
      html += `<div class="pp-grid-line month" style="left:${this.dayToPct(m.start)}%;"></div>`;
    });
    html += `<div class="pp-grid-line month" style="left:100%;"></div>`;
    this.BIWEEKS.forEach(b => {
      html += `<div class="pp-grid-line biweek" style="left:${this.dayToPct(b.start)}%;"></div>`;
    });
    // 交替背景 (偶数双周)
    this.BIWEEKS.forEach((b, i) => {
      if (i % 2 === 1) {
        html += `<div style="position:absolute;top:0;bottom:0;left:${this.dayToPct(b.start)}%;width:${((b.end - b.start + 1) / this.TOTAL_DAYS * 100).toFixed(2)}%;background:rgba(0,0,0,0.015);"></div>`;
      }
    });
    bg.innerHTML = html;
  },

  /** 渲染今天线 */
  renderTodayLine() {
    const line = document.getElementById('pp-today-line');
    if (line) line.style.left = this.dayToPct(this.todayDay()) + '%';
  },

  /* ------------------------------------------------------------------
   * 渲染任务行 + 任务条 (甘特图主体)
   * ---------------------------------------------------------------- */
  renderTasks() {
    const taskList = document.getElementById('pp-task-list');
    const barsArea = document.getElementById('pp-bars-area');
    if (!taskList || !barsArea) return;

    taskList.innerHTML = '';
    barsArea.innerHTML = '';

    // 排序: 按 phase_id 升序, 再按 start_date 升序, 里程碑排在同日期末尾
    const sorted = [...this.tasks].sort((a, b) => {
      const pa = this.phaseNo(a.phase_id);
      const pb = this.phaseNo(b.phase_id);
      if (pa !== pb) return pa - pb;
      const sa = new Date(a.start_date || '2026-07-01').getTime();
      const sb = new Date(b.start_date || '2026-07-01').getTime();
      if (sa !== sb) return sa - sb;
      // 同日期: 普通任务在前, 里程碑在后
      return (a.is_milestone ? 1 : 0) - (b.is_milestone ? 1 : 0);
    });

    let currentPhaseNo = 0;
    let visibleCount = 0;

    sorted.forEach(task => {
      const isMilestone = task.is_milestone || task.status === 'milestone';
      const isDone = task.status === 'done';
      const phaseNo = this.phaseNo(task.phase_id);

      // ---- 应用筛选 ----
      if (this.hiddenPhases.has(isMilestone ? 'ms' : String(phaseNo))) return;
      if (this.filters.phase !== 'all') {
        if (this.filters.phase === 'ms') { if (!isMilestone) return; }
        else if (phaseNo !== parseInt(this.filters.phase, 10)) return;
      }
      if (this.filters.status !== 'all') {
        if (isMilestone) {
          // 里程碑只在筛选"已完成"时按完成状态过滤，其他状态筛选隐藏
          if (this.filters.status === 'done' ? !isDone : true) return;
        } else {
          const effectiveStatus = isDone ? 'done' : (task.status || 'planned');
          if (effectiveStatus !== this.filters.status) return;
        }
      }
      if (this.filters.keyword) {
        const kw = this.filters.keyword.toLowerCase();
        const text = (task.name || '').toLowerCase() + ' ' + (task.full_desc || '').toLowerCase();
        if (!text.includes(kw)) return;
      }

      visibleCount++;

      // ---- 阶段标题行 (新阶段开始时) ----
      if (phaseNo !== currentPhaseNo) {
        currentPhaseNo = phaseNo;
        const phase = App.getPhase(task.phase_id);
        const phaseName = phase?.name || `第${phaseNo}阶段`;
        const phaseSubtitle = phase?.subtitle || '';
        const phaseDesc = phase?.description || '';
        const phaseStart = phase?.start_date ? this.dateToDay(phase.start_date) : 0;
        const phaseEnd = phase?.end_date ? this.dateToDay(phase.end_date) : (this.TOTAL_DAYS - 1);

        // 左侧阶段标题
        const phLeft = document.createElement('div');
        phLeft.className = 'pp-phase-header';
        phLeft.innerHTML = `
          <div class="phase-name" style="width:360px;min-width:360px;flex-shrink:0;">
            <span style="color:var(--pp-p${phaseNo});font-weight:700;">${App.escapeHtml(phaseName)}${phaseSubtitle ? '·' + App.escapeHtml(phaseSubtitle) : ''}</span>
          </div>
        `;
        taskList.appendChild(phLeft);

        // 右侧阶段条
        const phBar = document.createElement('div');
        phBar.style.cssText = 'height:34px;border-bottom:2px solid #d0d0d0;border-top:2px solid #d0d0d0;position:relative;background:transparent;';
        const phInner = document.createElement('div');
        phInner.className = `phase-${phaseNo}`;
        phInner.style.cssText = `position:absolute;height:26px;top:50%;transform:translateY(-50%);left:${this.dayToPct(phaseStart)}%;width:${this.dayToPct(phaseEnd - phaseStart + 1)}%;border-radius:4px;display:flex;align-items:center;padding:0 12px;font-size:11px;color:rgba(255,255,255,0.95);font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:linear-gradient(135deg,var(--pp-p${phaseNo}),var(--pp-p${phaseNo}));`;
        phInner.textContent = phaseDesc;
        phBar.appendChild(phInner);
        barsArea.appendChild(phBar);
      }

      // ---- 任务行 (左) ----
      const row = document.createElement('div');
      row.className = isMilestone ? 'pp-milestone-row' : 'pp-task-row';
      row.dataset.taskId = task.id;
      row.style.position = 'relative';

      const startDay = this.dateToDay(task.start_date);
      const endDay = this.dateToDay(task.end_date || task.start_date);

      const nameEl = document.createElement('div');
      nameEl.className = 'pp-task-name';
      if (isMilestone) {
        nameEl.innerHTML = `<span style="color:${isDone ? 'var(--color-success)' : 'var(--pp-ms)'};font-weight:700;">${App.escapeHtml(task.name || '')}</span>`;
      } else {
        const statusCls = isDone ? 'done' : (task.status === 'ongoing' ? 'ongoing' : 'planned');
        const checkCls = isDone ? 'checked' : '';
        nameEl.innerHTML = `
          <div class="check-btn ${checkCls}" data-action="toggle-done" data-id="${task.id}" title="标记完成">${isDone ? '✓' : ''}</div>
          <span class="status-dot ${statusCls}"></span>
          <span class="task-id">${App.escapeHtml(task.task_uid || '')}</span>
          <span title="${App.escapeHtml(task.full_desc || '')}">${App.escapeHtml(task.name || '')}</span>
        `;
      }
      row.appendChild(nameEl);
      taskList.appendChild(row);

      // ---- 任务条 (右) ----
      const barRow = document.createElement('div');
      barRow.className = isMilestone ? 'pp-milestone-row' : 'pp-task-row';
      barRow.style.position = 'relative';
      barRow.dataset.taskId = task.id;

      const barContainer = document.createElement('div');
      barContainer.className = 'pp-task-bar-container';

      if (isMilestone) {
        const diamond = document.createElement('div');
        diamond.className = 'pp-milestone-diamond' + (isDone ? ' done' : '');
        diamond.style.left = this.dayToPct(startDay) + '%';
        diamond.dataset.taskId = task.id;
        diamond.dataset.action = 'task-click';
        barContainer.appendChild(diamond);

        const label = document.createElement('div');
        label.className = 'pp-milestone-label';
        label.style.left = `calc(${this.dayToPct(startDay)}% + 12px)`;
        label.textContent = (task.name || '').replace(/^★\s*/, '');
        barContainer.appendChild(label);
      } else {
        const bar = document.createElement('div');
        const cls = ['pp-task-bar', `p${phaseNo}`];
        if (isDone) cls.push('done');
        if (task.status === 'ongoing' && !isDone) cls.push('ongoing');
        bar.className = cls.join(' ');
        bar.style.left = this.dayToPct(startDay) + '%';
        bar.style.width = this.dayToPct(Math.max(1, endDay - startDay + 1)) + '%';
        bar.textContent = task.task_uid || '';
        bar.dataset.taskId = task.id;
        bar.dataset.action = 'task-click';
        barContainer.appendChild(bar);
      }

      barRow.appendChild(barContainer);
      barsArea.appendChild(barRow);
    });

    // 计数显示
    const countEl = document.getElementById('pp-task-count');
    if (countEl) countEl.textContent = `${visibleCount} / ${this.tasks.length}`;

    this.updateStats();
  },

  /** 更新统计栏 */
  updateStats() {
    const counts = { 1: 0, 2: 0, 3: 0, ms: 0, total: 0 };
    const dones  = { 1: 0, 2: 0, 3: 0, ms: 0, total: 0 };

    this.tasks.forEach(t => {
      const isMs = t.is_milestone || t.status === 'milestone';
      const key = isMs ? 'ms' : this.phaseNo(t.phase_id);
      counts[key]++;
      counts.total++;
      if (t.status === 'done') {
        dones[key]++;
        dones.total++;
      }
    });

    const setStat = (id, done, total) => {
      const numEl = document.getElementById(`pp-stat-${id}`);
      const progEl = document.getElementById(`pp-prog-${id}`);
      if (numEl) numEl.textContent = `${done}/${total}`;
      if (progEl) progEl.style.width = total > 0 ? (done / total * 100) + '%' : '0%';
    };

    setStat('p1', dones[1], counts[1]);
    setStat('p2', dones[2], counts[2]);
    setStat('p3', dones[3], counts[3]);
    setStat('ms', dones.ms, counts.ms);
    setStat('total', dones.total, counts.total);
  },

  /* ------------------------------------------------------------------
   * 绑定事件
   * ---------------------------------------------------------------- */
  bindEvents() {
    // 阶段筛选
    document.querySelectorAll('[data-action="filter-phase"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filters.phase = btn.dataset.phase;
        document.querySelectorAll('[data-action="filter-phase"]').forEach(b => {
          b.classList.toggle('active', b.dataset.phase === btn.dataset.phase);
        });
        this.renderTasks();
      });
    });

    // 状态筛选
    document.querySelectorAll('[data-action="filter-status"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filters.status = btn.dataset.status;
        document.querySelectorAll('[data-action="filter-status"]').forEach(b => {
          b.classList.toggle('active', b.dataset.status === btn.dataset.status);
        });
        this.renderTasks();
      });
    });

    // 搜索
    const search = document.getElementById('pp-search');
    if (search) {
      search.addEventListener('input', () => {
        this.filters.keyword = search.value.trim();
        this.renderTasks();
      });
    }

    // 重置
    const reset = document.getElementById('pp-reset-btn');
    if (reset) {
      reset.addEventListener('click', () => {
        this.filters = { phase: 'all', status: 'all', keyword: '' };
        this.hiddenPhases.clear();
        const s = document.getElementById('pp-search');
        if (s) s.value = '';
        document.querySelectorAll('[data-action="filter-phase"]').forEach(b => {
          b.classList.toggle('active', b.dataset.phase === 'all');
        });
        document.querySelectorAll('[data-action="filter-status"]').forEach(b => {
          b.classList.toggle('active', b.dataset.status === 'all');
        });
        document.querySelectorAll('.pp-legend-item').forEach(el => el.classList.remove('hidden'));
        this.renderTasks();
        App.showToast('已重置所有筛选', 'info');
      });
    }

    // 新建任务
    const newBtn = document.getElementById('pp-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => this.editTask(null));

    // 统计栏点击 -> 阶段筛选
    document.querySelectorAll('.pp-stat-item[data-filter]').forEach(item => {
      item.addEventListener('click', () => {
        const f = item.dataset.filter;
        this.filters.phase = f;
        document.querySelectorAll('[data-action="filter-phase"]').forEach(b => {
          b.classList.toggle('active', b.dataset.phase === String(f));
        });
        this.renderTasks();
      });
    });

    // 图例点击 -> 切换隐藏
    document.querySelectorAll('.pp-legend-item[data-toggle-phase]').forEach(el => {
      el.addEventListener('click', () => {
        const ph = el.dataset.togglePhase;
        el.classList.toggle('hidden');
        if (this.hiddenPhases.has(ph)) this.hiddenPhases.delete(ph);
        else this.hiddenPhases.add(ph);
        this.renderTasks();
      });
    });

    // 任务条 / 菱形点击 -> 模态框; tooltip 悬停
    const tooltip = document.getElementById('pp-tooltip');
    const barsArea = document.getElementById('pp-bars-area');
    if (barsArea) {
      barsArea.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-action="task-click"]');
        if (!target) return;
        this.showTooltip(target, tooltip);
      });
      barsArea.addEventListener('mouseout', (e) => {
        if (e.target.closest('[data-action="task-click"]')) {
          if (tooltip) tooltip.style.display = 'none';
        }
      });
      barsArea.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action="task-click"]');
        if (!target) return;
        const id = target.dataset.taskId;
        const task = this.tasks.find(t => String(t.id) === String(id));
        if (task) this.openTaskModal(task);
      });
    }

    // 勾选完成
    const taskList = document.getElementById('pp-task-list');
    if (taskList) {
      taskList.addEventListener('click', (e) => {
        const check = e.target.closest('[data-action="toggle-done"]');
        if (!check) return;
        e.stopPropagation();
        const id = check.dataset.id;
        const task = this.tasks.find(t => String(t.id) === String(id));
        if (!task) return;
        const newStatus = task.status === 'done' ? 'planned' : 'done';
        this.updateTaskStatus(id, newStatus);
      });

      // 点击任务行 (非勾选按钮) -> 显示详情到右栏
      taskList.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="toggle-done"]')) return;
        const row = e.target.closest('.pp-task-row, .pp-milestone-row');
        if (!row) return;
        const id = row.dataset.taskId;
        const task = this.tasks.find(t => String(t.id) === String(id));
        if (task) this.showTaskDetail(task);
      });
    }

    // 滚动同步 (task-panel 与 timeline-panel)
    this.syncScroll();

    // 导出 PDF
    const exportBtn = document.getElementById('pp-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportToPdf());
  },

  /** 导出甘特图为 PDF (横向, 完整展开滚动区域) */
  exportToPdf() {
    const container = document.querySelector('.pp-container');
    if (!container) {
      App.showToast('没有可导出的内容', 'error');
      return;
    }
    App.exportToPdf(container, '项目进度计划', {
      landscape: true,
      prepareClone: (clone) => {
        // 展开滚动容器, 让所有任务条/行完整呈现, 避免被裁切
        clone.style.width = 'auto';
        clone.style.minWidth = '1320px';
        clone.querySelectorAll('.pp-gantt-wrapper, .pp-task-panel, .pp-timeline-panel, .pp-timeline-top, #pp-chart-body, #pp-task-list, #pp-bars-area').forEach(el => {
          el.style.overflow = 'visible';
          el.style.height = 'auto';
          el.style.maxHeight = 'none';
        });
        const chartBody = clone.querySelector('#pp-chart-body');
        if (chartBody) chartBody.style.minWidth = '960px';
      }
    });
  },

  /** 显示 tooltip */
  showTooltip(target, tooltip) {
    if (!tooltip) return;
    const id = target.dataset.taskId;
    const task = this.tasks.find(t => String(t.id) === String(id));
    if (!task) return;
    const isMs = task.is_milestone || task.status === 'milestone';
    const phase = App.getPhase(task.phase_id);
    const dateRange = (task.start_date || task.end_date)
      ? `${task.start_date ? App.formatDate(task.start_date) : '—'} ~ ${task.end_date ? App.formatDate(task.end_date) : '—'}`
      : '—';
    tooltip.innerHTML = `
      <div class="tt-title">${App.escapeHtml(task.task_uid || '')} · ${App.escapeHtml(task.name || '')}</div>
      <div class="tt-meta">
        <span>${phase ? App.escapeHtml(phase.name) : '未分阶段'}</span>
        <span>${dateRange}</span>
        ${task.owner ? `<span>👤 ${App.escapeHtml(task.owner)}</span>` : ''}
      </div>
      ${task.full_desc ? `<div class="tt-desc">${App.escapeHtml(task.full_desc)}</div>` : ''}
    `;
    tooltip.style.display = 'block';
    const rect = target.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + 420 > window.innerWidth) left = window.innerWidth - 440;
    if (top + 120 > window.innerHeight) top = rect.top - 120;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  },

  /** 同步 task-panel 与 timeline-panel 的垂直滚动 */
  syncScroll() {
    const taskPanel = document.querySelector('.pp-task-panel');
    const timelinePanel = document.querySelector('.pp-timeline-panel');
    if (!taskPanel || !timelinePanel) return;
    let syncing = false;
    taskPanel.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      timelinePanel.scrollTop = taskPanel.scrollTop;
      syncing = false;
    });
    timelinePanel.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      taskPanel.scrollTop = timelinePanel.scrollTop;
      syncing = false;
    });
  },

  /* ------------------------------------------------------------------
   * 任务详情模态框 (参照 HTML 中的 openModal)
   * ---------------------------------------------------------------- */
  openTaskModal(task) {
    const isMilestone = task.is_milestone || task.status === 'milestone';
    const isDone = task.status === 'done';
    const phase = App.getPhase(task.phase_id);
    const phaseNo = this.phaseNo(task.phase_id);

    const badgeCls = isMilestone ? 'ms' : `p${phaseNo}`;
    const badgeText = isMilestone
      ? '★ 里程碑'
      : (phase ? `${phase.name}${phase.subtitle ? '·' + phase.subtitle : ''}` : `第${phaseNo}阶段`);

    const startDay = this.dateToDay(task.start_date);
    const endDay = this.dateToDay(task.end_date || task.start_date);
    const duration = Math.max(1, endDay - startDay + 1);
    const statusText = isDone ? '✅ 已完成'
      : (task.status === 'ongoing' ? '● 进行中' : '○ 计划中');
    const statusColor = isDone ? 'var(--color-success)'
      : (task.status === 'ongoing' ? 'var(--pp-p1)' : 'var(--color-text-secondary)');

    const modal = App.openModal({
      title: (task.name || '').replace(/^★\s*/, ''),
      size: 'lg',
      bodyHtml: `
        <div class="pp-modal-badge" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-bottom:14px;background:var(--pp-${badgeCls}-light, #fef3c7);color:var(--pp-${badgeCls}, #92400e);">
          ${App.escapeHtml(badgeText)}
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">📋 任务描述</div>
          <div style="font-size:13px;color:var(--color-text);line-height:1.7;">${App.escapeHtml(task.full_desc || '（无详细描述）')}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">📅 时间信息</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div style="background:#f8fafc;padding:10px 12px;border-radius:6px;">
              <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:2px;">开始日期</div>
              <div style="font-size:13px;font-weight:600;">${App.formatDate(task.start_date)}</div>
            </div>
            <div style="background:#f8fafc;padding:10px 12px;border-radius:6px;">
              <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:2px;">结束日期</div>
              <div style="font-size:13px;font-weight:600;">${App.formatDate(task.end_date)}</div>
            </div>
            <div style="background:#f8fafc;padding:10px 12px;border-radius:6px;">
              <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:2px;">持续时间</div>
              <div style="font-size:13px;font-weight:600;">${duration} 天</div>
            </div>
            <div style="background:#f8fafc;padding:10px 12px;border-radius:6px;">
              <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:2px;">完成状态</div>
              <div style="font-size:13px;font-weight:600;color:${statusColor};">${statusText}</div>
            </div>
          </div>
        </div>
        ${task.owner ? `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">👤 责任方</div>
            <div style="font-size:13px;">${App.escapeHtml(task.owner)}</div>
          </div>
        ` : ''}
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">📎 操作</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="pp-btn ${isDone ? '' : 'pp-btn-success'}" id="pp-modal-toggle">${isDone ? '🔄 标记为未完成' : '✅ 标记为完成'}</button>
            <button class="pp-btn" id="pp-modal-edit">✏️ 编辑</button>
          </div>
        </div>
      `,
      footerHtml: `<button class="btn btn-ghost" data-modal-close>关闭</button>`
    });

    // 绑定模态框内按钮
    const toggleBtn = modal.querySelector('#pp-modal-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async () => {
        const newStatus = isDone ? 'planned' : 'done';
        App.closeModal(modal);
        await this.updateTaskStatus(task.id, newStatus);
        // 重新打开模态框显示新状态
        const updated = this.tasks.find(t => String(t.id) === String(task.id));
        if (updated) this.openTaskModal(updated);
      });
    }
    const editBtn = modal.querySelector('#pp-modal-edit');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        App.closeModal(modal);
        this.editTask(task.id);
      });
    }
  },

  /* ------------------------------------------------------------------
   * 右栏显示任务详情 (供任务行点击)
   * ---------------------------------------------------------------- */
  showTaskDetail(task) {
    const phase = App.getPhase(task.phase_id);
    const refCount = task.ref_count || task.reference_count || 0;
    const dateRange = (task.start_date || task.end_date)
      ? `${task.start_date ? App.formatDate(task.start_date) : '—'} ~ ${task.end_date ? App.formatDate(task.end_date) : '—'}`
      : '—';

    App.showDetail(`
      <div class="detail-panel__header">
        <div class="detail-panel__title">${task.is_milestone ? '★ ' : ''}${App.escapeHtml(task.name || '')}</div>
        <div class="detail-panel__meta">进度计划任务 #${App.escapeHtml(String(task.id))} · UID: ${App.escapeHtml(task.task_uid || '—')}</div>
      </div>
      <div class="detail-panel__body">
        <div class="detail-section">
          <div class="detail-section__label">所属阶段</div>
          <div class="detail-section__value">
            ${phase ? `<span class="tag tag--blue">${App.escapeHtml(phase.name)}</span>` : '<span class="text-tertiary">未分阶段</span>'}
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">日期范围</div>
          <div class="detail-section__value">${App.escapeHtml(dateRange)}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">责任方</div>
          <div class="detail-section__value">${App.escapeHtml(task.owner || '—')}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">状态</div>
          <div class="detail-section__value">${App.statusBadge(task.status || 'planned')}</div>
        </div>
        ${task.is_milestone ? `
          <div class="detail-section">
            <div class="detail-section__label">类型</div>
            <div class="detail-section__value"><span class="badge badge--primary">★ 里程碑</span></div>
          </div>
        ` : ''}
        ${task.full_desc ? `
          <div class="detail-section">
            <div class="detail-section__label">完整描述</div>
            <div class="detail-section__value">${App.escapeHtml(task.full_desc)}</div>
          </div>
        ` : ''}
        <div class="detail-section">
          <div class="detail-section__label">被引用情况</div>
          <div class="detail-section__value">
            ${refCount > 0
              ? `<span class="badge badge--primary">🔗 共被 ${refCount} 处周报下周任务引用</span>`
              : '<span class="text-tertiary">尚未被周报引用</span>'}
          </div>
        </div>
      </div>
    `);
  },

  /* ------------------------------------------------------------------
   * 编辑任务 (新建或修改)
   * ---------------------------------------------------------------- */
  editTask(id) {
    const task = id ? this.tasks.find(t => String(t.id) === String(id)) : null;
    const statusVal = task?.status || 'planned';

    const modal = App.openModal({
      title: id ? '编辑任务' : '新建任务',
      bodyHtml: `
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>任务名称 *</label>
            <input type="text" id="pp-name" value="${task ? App.escapeHtml(task.name || '') : ''}" placeholder="任务名称">
          </div>
          <div class="form-group" style="flex:1;">
            <label>任务 UID *</label>
            <input type="text" id="pp-uid" value="${task ? App.escapeHtml(task.task_uid || '') : ''}" placeholder="例如 1-1 或 M1">
          </div>
        </div>
        <div class="form-group">
          <label>所属阶段</label>
          <select id="pp-phase">
            <option value="">— 请选择 —</option>
            ${App.state.phases.map(p => `<option value="${p.id}" ${task && String(task.phase_id) === String(p.id) ? 'selected' : ''}>${App.escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>开始日期</label>
            <input type="date" id="pp-start" value="${task && task.start_date ? App.formatDate(task.start_date) : ''}">
          </div>
          <div class="form-group">
            <label>结束日期</label>
            <input type="date" id="pp-end" value="${task && task.end_date ? App.formatDate(task.end_date) : ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>责任方</label>
            <input type="text" id="pp-owner" value="${task ? App.escapeHtml(task.owner || '') : ''}" placeholder="负责人 / 团队">
          </div>
          <div class="form-group">
            <label>状态</label>
            <select id="pp-status">
              <option value="planned" ${statusVal === 'planned' ? 'selected' : ''}>待开始</option>
              <option value="ongoing" ${statusVal === 'ongoing' ? 'selected' : ''}>进行中</option>
              <option value="done" ${statusVal === 'done' ? 'selected' : ''}>已完成</option>
              <option value="milestone" ${statusVal === 'milestone' ? 'selected' : ''}>里程碑</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>类型</label>
          <select id="pp-milestone">
            <option value="false" ${!task || !task.is_milestone ? 'selected' : ''}>普通任务</option>
            <option value="true" ${task && task.is_milestone ? 'selected' : ''}>★ 里程碑</option>
          </select>
        </div>
        <div class="form-group">
          <label>完整描述</label>
          <textarea id="pp-desc" placeholder="任务详细说明 (含责任方等)">${task ? App.escapeHtml(task.full_desc || '') : ''}</textarea>
        </div>
      `,
      footerHtml: `
        ${id ? '<button class="btn btn-danger" id="pp-delete-btn" style="margin-right:auto">🗑 删除任务</button>' : ''}
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="pp-save-btn">${id ? '保存' : '创建'}</button>
      `
    });

    // 删除任务 (仅编辑已有任务时显示)
    if (id) {
      const deleteBtn = modal.querySelector('#pp-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirm('确认删除该任务?删除后不可恢复。')) return;
          try {
            await API.deleteProgressTask(id);
            App.showToast('任务已删除', 'success');
            App.closeModal(modal);
            this.loadTasks();
          } catch (err) {
            App.showToast(`删除失败: ${err.message}`, 'error');
          }
        });
      }
    }

    modal.querySelector('#pp-save-btn').addEventListener('click', async () => {
      const name = modal.querySelector('#pp-name').value.trim();
      const taskUid = modal.querySelector('#pp-uid').value.trim();
      if (!name) { App.showToast('请输入任务名称', 'warning'); return; }
      if (!taskUid) { App.showToast('请输入任务 UID', 'warning'); return; }

      const payload = {
        task_uid: taskUid,
        name,
        phase_id: modal.querySelector('#pp-phase').value ? parseInt(modal.querySelector('#pp-phase').value, 10) : null,
        start_date: modal.querySelector('#pp-start').value || null,
        end_date: modal.querySelector('#pp-end').value || null,
        owner: modal.querySelector('#pp-owner').value.trim() || '',
        status: modal.querySelector('#pp-status').value,
        is_milestone: modal.querySelector('#pp-milestone').value === 'true',
        full_desc: modal.querySelector('#pp-desc').value.trim()
      };

      try {
        if (id) {
          await API.updateProgressTask(id, payload);
          App.showToast('任务已更新', 'success');
        } else {
          await API.createProgressTask(payload);
          App.showToast('任务已创建', 'success');
        }
        App.closeModal(modal);
        this.loadTasks();
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /** 更新任务状态 */
  async updateTaskStatus(id, status) {
    try {
      await API.updateProgressTaskStatus(id, status);
      const task = this.tasks.find(t => String(t.id) === String(id));
      if (task) task.status = status;
      App.showToast(status === 'done' ? '✅ 已标记为完成' : '🔄 已重置为未完成', 'success');
      this.renderTasks();
    } catch (err) {
      App.showToast(`更新失败: ${err.message}`, 'error');
    }
  }
};
