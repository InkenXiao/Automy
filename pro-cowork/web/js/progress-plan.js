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

  // 时间轴参数 (由 initTimeline() 根据当前项目周期 + 阶段日期动态生成)
  project: null,        // 当前项目元信息 {id,name,title,based_doc,start_date,end_date}
  projects: [],         // 全部项目列表 (供头部下拉切换)
  PROJECT_START: null,  // 项目起始日 (本地午夜 Date)
  TOTAL_DAYS: 184,      // 项目总天数
  PX_PER_DAY: 5,        // 每天 px 宽度 (固定, 保持周间距不变; 7天≈35px)
  TIMELINE_WIDTH: 960,  // 时间轴总宽度 (px, = TOTAL_DAYS * PX_PER_DAY)
  MONTHS: [],           // 月份定义 [{name, start, end}] (start/end 为相对起始日的天数偏移)
  BIWEEKS: [],          // 双周迭代 [{label, start, end}]

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    // 由 onShow 触发首次加载
  },

  /** 切换到此视图时触发 */
  async onShow() {
    // 确保项目元信息已加载 (后端在无项目时会幂等创建默认项目)
    if (!this.project) {
      await this.ensureProject();
    }
    if (this.tasks.length === 0) {
      this.loadTasks();
    } else {
      this.render();
    }
  },

  /** 加载当前激活项目 + 全部项目列表 + 阶段, 并重建时间轴 */
  async ensureProject() {
    try {
      const [active, all] = await Promise.all([
        API.getActiveProject(),
        API.getProjects(),
      ]);
      App.state.project = active;
      this.project = active;
      this.projects = Array.isArray(all) ? all : [];
      // 重新加载阶段 (切换项目时阶段也需更新)
      await App.loadPhases();
      this.initTimeline();
    } catch (err) {
      App.showToast(`加载项目信息失败: ${err.message}`, 'error');
    }
  },

  /** 根据当前项目 + 阶段的日期范围动态生成时间轴参数 (阶段日期优先) */
  initTimeline() {
    const p = this.project;
    const phases = App.state.phases || [];
    // 收集所有有效日期 (项目 + 阶段)
    const dates = [];
    if (p?.start_date) dates.push(p.start_date);
    if (p?.end_date) dates.push(p.end_date);
    phases.forEach(ph => {
      if (ph.start_date) dates.push(ph.start_date);
      if (ph.end_date) dates.push(ph.end_date);
    });
    if (dates.length < 2) {
      this.PROJECT_START = null;
      this.TOTAL_DAYS = 1;
      this.TIMELINE_WIDTH = 960;
      this.MONTHS = [];
      this.BIWEEKS = [];
      return;
    }
    dates.sort();
    // 本地午夜起始, 避免 dateToDay 因时区偏移
    const start = new Date(dates[0] + 'T00:00:00');
    const end = new Date(dates[dates.length - 1] + 'T00:00:00');
    this.PROJECT_START = start;
    this.TOTAL_DAYS = Math.max(1, Math.round((end - start) / 86400000) + 1);
    // 固定每周间距: 7天 = 35px, 总宽度 = 天数 × 5px (最少 960px)
    this.TIMELINE_WIDTH = Math.max(960, this.TOTAL_DAYS * this.PX_PER_DAY);
    this.MONTHS = this.buildMonths(start, end);
    this.BIWEEKS = this.buildBiweeks(start, end);
  },

  /** 按月切分, 返回 [{name, start, end}] (跨年时显示年度) */
  buildMonths(start, end) {
    const months = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const startYear = start.getFullYear();
    let lastYear = null;
    while (cur <= end) {
      const mStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0); // 月末
      const so = Math.max(0, Math.round((mStart - start) / 86400000));
      const eo = Math.min(this.TOTAL_DAYS - 1, Math.round((mEnd - start) / 86400000));
      // 首月或跨年时显示年度
      const showYear = cur.getFullYear() !== lastYear;
      const name = showYear
        ? `${cur.getFullYear()}年${cur.getMonth() + 1}月`
        : `${cur.getMonth() + 1}月`;
      months.push({ name, start: so, end: eo });
      lastYear = cur.getFullYear();
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  },

  /** 从起始日按 14 天一段切分双周迭代, 跨年时日期含年度 */
  buildBiweeks(start, end) {
    const list = [];
    let idx = 1;
    let cur = new Date(start);
    let lastYear = null;
    while (cur <= end) {
      const segStart = new Date(cur);
      let segEnd = new Date(cur);
      segEnd.setDate(segEnd.getDate() + 13); // 14 天 (含首日)
      if (segEnd > end) segEnd = new Date(end);
      const so = Math.round((segStart - start) / 86400000);
      const eo = Math.round((segEnd - start) / 86400000);
      // 跨年时显示年度
      const fmt = (d) => {
        const crossYear = d.getFullYear() !== lastYear;
        return crossYear
          ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
          : `${d.getMonth() + 1}/${d.getDate()}`;
      };
      list.push({
        label: `迭代${idx}\n${fmt(segStart)}-${fmt(segEnd)}`,
        start: so,
        end: eo,
      });
      lastYear = segEnd.getFullYear();
      idx++;
      cur = new Date(segEnd);
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  },

  /* ------------------------------------------------------------------
   * 工具函数
   * ---------------------------------------------------------------- */
  /** 把日期字符串 (YYYY-MM-DD) 转为相对项目起始日的天数偏移 (0-based) */
  dateToDay(dateStr) {
    if (!dateStr || !this.PROJECT_START) return 0;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    const diff = Math.round((d - this.PROJECT_START) / 86400000);
    return Math.max(0, Math.min(this.TOTAL_DAYS - 1, diff));
  },

  /** 天数偏移转百分比 (用于 left/width) */
  dayToPct(day) {
    return (day / this.TOTAL_DAYS * 100).toFixed(2);
  },

  /** 天数偏移转像素 (固定每周间距, 用于 left/width) */
  dayToPx(day) {
    return (day * this.PX_PER_DAY).toFixed(1);
  },

  /** 计算今天的偏移天数 (基于实际当前日期, 限制在 [0, TOTAL_DAYS-1]) */
  todayDay() {
    if (!this.PROJECT_START) return 0;
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
    const weekCount = Math.max(1, Math.round(this.TOTAL_DAYS / 7));
    const p = this.project || {};
    const projTitle = p.title || '项目进度计划执行图';
    const projBasedDoc = p.based_doc || '';
    const projStart = p.start_date ? App.formatDate(p.start_date) : '';
    const projEnd = p.end_date ? App.formatDate(p.end_date) : '';
    const projectId = p.id || '';
    const projectOptions = (this.projects.length ? this.projects : (p.id ? [p] : []))
      .map(pr => `<option value="${pr.id}" ${String(pr.id) === String(projectId) ? 'selected' : ''}>${App.escapeHtml(pr.name || pr.title || ('项目#' + pr.id))}</option>`).join('');

    view.innerHTML = `
      <div class="pp-container">
        <div class="pp-header">
          <div>
            <h1 class="pp-editable-title" contenteditable="true" data-pfield="title" data-placeholder="项目进度计划执行图标题">${App.escapeHtml(projTitle)}</h1>
            <div class="subtitle">
              <span>📅 基于《<span class="pp-editable-inline" contenteditable="true" data-pfield="based_doc" data-placeholder="文档名称">${App.escapeHtml(projBasedDoc)}</span>》</span>
              <span>⚡ ${phaseCount}阶段 · ${biweekCount}迭代 · ${msCount}里程碑 · ${taskCount}项任务</span>
            </div>
          </div>
          <div class="pp-header-r">
            <div class="pp-project-switch">
              <select id="pp-project-select" title="切换项目">${projectOptions}</select>
              <button class="pp-btn" id="pp-new-project-btn" title="新建项目">＋ 新建项目</button>
            </div>
            <div class="date-range">
              <input type="date" id="pp-proj-start" value="${projStart}" title="项目开始日期">
              <span>—</span>
              <input type="date" id="pp-proj-end" value="${projEnd}" title="项目结束日期">
            </div>
          </div>
        </div>

        <div class="pp-stats-bar" id="pp-stats-bar">
          ${App.state.phases.map((p, i) => {
            const pn = i + 1;
            return `<div class="pp-stat-item p${pn}" data-filter="${pn}">
              <div class="num" id="pp-stat-p${pn}">0</div>
              <div class="label">${App.escapeHtml(p.name)}任务</div>
              <div class="progress-bar"><div class="progress-fill" id="pp-prog-p${pn}" style="width:0%"></div></div>
            </div>`;
          }).join('')}
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
            <div class="num" style="background:linear-gradient(135deg,#ef4444,#f87171);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${weekCount}</div>
            <div class="label">周（约${Math.round(weekCount / 4.3)}个月）</div>
          </div>
        </div>

        <div class="pp-toolbar">
          <div class="pp-toolbar-group">
            <span class="pp-toolbar-label">🔒 筛选:</span>
            <button class="pp-btn active" data-phase="all" data-action="filter-phase">全部</button>
            ${App.state.phases.map((p, i) => {
              const pn = i + 1;
              const cls = pn === 2 ? 'p2-filter' : pn === 3 ? 'p3-filter' : '';
              return `<button class="pp-btn ${cls}" data-phase="${pn}" data-action="filter-phase">${App.escapeHtml(p.name)}</button>`;
            }).join('')}
            <button class="pp-btn ms-filter" data-phase="ms" data-action="filter-phase">里程碑</button>
          </div>
          <div class="pp-toolbar-group">
            <span class="pp-toolbar-label">✅ 状态:</span>
            <button class="pp-btn ${this.filters.status === 'all' ? 'active' : ''}" data-status="all" data-action="filter-status">全部</button>
            <button class="pp-btn ${this.filters.status === 'ongoing' ? 'active' : ''}" data-status="ongoing" data-action="filter-status">进行中</button>
            <button class="pp-btn ${this.filters.status === 'planned' ? 'active' : ''}" data-status="planned" data-action="filter-status">计划中</button>
            <button class="pp-btn ${this.filters.status === 'done' ? 'active' : ''}" data-status="done" data-action="filter-status">已完成</button>
            <button class="pp-btn ${this.filters.status === 'deleted' ? 'active' : ''}" data-status="deleted" data-action="filter-status">已删除</button>
          </div>
          <div class="pp-toolbar-group" style="margin-left:auto;">
            <div class="pp-search-box">
              <input type="text" id="pp-search" placeholder="搜索任务..." value="${App.escapeHtml(this.filters.keyword)}">
            </div>
            <button class="pp-btn" id="pp-edit-phases-btn">⚙ 编辑阶段</button>
            <button class="pp-btn" id="pp-new-btn">＋ 新建任务</button>
            <button class="pp-btn" id="pp-reset-btn">🔄 重置</button>
            <button class="pp-btn" id="pp-export-btn">📄 导出PDF</button>
          </div>
        </div>

        <div class="pp-legend" id="pp-legend">
          ${App.state.phases.map((p, i) => {
            const pn = i + 1;
            const subtitle = p.subtitle ? `·${App.escapeHtml(p.subtitle)}` : '';
            const dateRange = (p.start_date && p.end_date) ? `（${App.formatDate(p.start_date)}~${App.formatDate(p.end_date)}）` : '';
            const gradient = pn === 2 ? 'var(--pp-p2),#5EEAD4' : pn === 3 ? 'var(--pp-p3),#C4B5FD' : 'var(--pp-p1),#93C5FD';
            return `<div class="pp-legend-item" data-toggle-phase="${pn}">
              <div class="pp-legend-bar" style="background:linear-gradient(135deg,${gradient})"></div>
              ${App.escapeHtml(p.name)}${subtitle}${dateRange}
            </div>`;
          }).join('')}
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
            <div id="pp-chart-body" style="position:relative;min-width:${this.TIMELINE_WIDTH}px;">
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
    // 设置表头最小宽度 = 时间轴总宽度
    const topEl = document.querySelector('.pp-timeline-top');
    if (topEl) topEl.style.minWidth = this.TIMELINE_WIDTH + 'px';
    const monthEl = document.getElementById('pp-month-headers');
    if (monthEl) {
      monthEl.innerHTML = this.MONTHS.map((m, i) => `
        <div class="pp-month-header" style="width:${((m.end - m.start + 1) * this.PX_PER_DAY).toFixed(1)}px;${i === this.MONTHS.length - 1 ? 'border-right:none;' : ''}">${App.escapeHtml(m.name)}</div>
      `).join('');
    }
    const biweekEl = document.getElementById('pp-biweek-headers');
    if (biweekEl) {
      biweekEl.innerHTML = this.BIWEEKS.map(b => `
        <div class="pp-biweek-header" style="width:${((b.end - b.start + 1) * this.PX_PER_DAY).toFixed(1)}px;">${App.escapeHtml(b.label).replace(/\n/g, '<br>')}</div>
      `).join('');
    }
  },

  /** 渲染网格背景线 (月份线 + 双周线) */
  renderGridBg() {
    const bg = document.getElementById('pp-grid-bg');
    if (!bg) return;
    let html = '';
    this.MONTHS.forEach(m => {
      html += `<div class="pp-grid-line month" style="left:${this.dayToPx(m.start)}px;"></div>`;
    });
    html += `<div class="pp-grid-line month" style="left:${this.TIMELINE_WIDTH}px;"></div>`;
    this.BIWEEKS.forEach(b => {
      html += `<div class="pp-grid-line biweek" style="left:${this.dayToPx(b.start)}px;"></div>`;
    });
    // 交替背景 (偶数双周)
    this.BIWEEKS.forEach((b, i) => {
      if (i % 2 === 1) {
        html += `<div style="position:absolute;top:0;bottom:0;left:${this.dayToPx(b.start)}px;width:${((b.end - b.start + 1) * this.PX_PER_DAY).toFixed(1)}px;background:rgba(0,0,0,0.015);"></div>`;
      }
    });
    bg.innerHTML = html;
  },

  /** 渲染今天线 (红色竖线 + 当天日期简写标签, 如 7/23) */
  renderTodayLine() {
    const line = document.getElementById('pp-today-line');
    if (!line) return;
    line.style.left = this.dayToPx(this.todayDay()) + 'px';
    // 日期标签 (替代原 CSS 固定文案 "今天")
    line.innerHTML = `<div class="pp-today-label">${App.formatShortDate()}</div>`;
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
      const isDeleted = task.status === 'deleted';
      const phaseNo = this.phaseNo(task.phase_id);

      // 逾期检测: 未完成、未删除、end_date 早于今天
      const todayStr = new Date().toISOString().split('T')[0];
      const isOverdue = !isDone && !isDeleted && task.end_date && task.end_date < todayStr;

      // ---- 应用筛选 ----
      if (this.hiddenPhases.has(isMilestone ? 'ms' : String(phaseNo))) return;
      if (this.filters.phase !== 'all') {
        if (this.filters.phase === 'ms') { if (!isMilestone) return; }
        else if (phaseNo !== parseInt(this.filters.phase, 10)) return;
      }
      if (this.filters.status !== 'all') {
        if (isMilestone) {
          // 里程碑: 筛选"已完成"时按完成状态过滤, 筛选"已删除"时按删除状态过滤, 其他隐藏
          if (this.filters.status === 'done') { if (!isDone) return; }
          else if (this.filters.status === 'deleted') { if (!isDeleted) return; }
          else return;
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
        phLeft.dataset.phaseId = task.phase_id;
        phLeft.dataset.phaseNo = phaseNo;
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
        phInner.style.cssText = `position:absolute;height:26px;top:50%;transform:translateY(-50%);left:${this.dayToPx(phaseStart)}px;width:${this.dayToPx(phaseEnd - phaseStart + 1)}px;border-radius:4px;display:flex;align-items:center;padding:0 12px;font-size:11px;color:rgba(255,255,255,0.95);font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:linear-gradient(135deg,var(--pp-p${phaseNo}),var(--pp-p${phaseNo}));`;
        phInner.textContent = phaseDesc;
        phBar.appendChild(phInner);
        barsArea.appendChild(phBar);
      }

      // ---- 任务行 (左) ----
      const row = document.createElement('div');
      row.className = isMilestone ? 'pp-milestone-row' : 'pp-task-row';
      if (isDeleted) row.classList.add('pp-deleted');
      if (isOverdue) row.classList.add('pp-overdue');
      row.dataset.taskId = task.id;
      row.style.position = 'relative';
      row.draggable = true;

      const startDay = this.dateToDay(task.start_date);
      const endDay = this.dateToDay(task.end_date || task.start_date);

      const nameEl = document.createElement('div');
      nameEl.className = 'pp-task-name';
      if (isMilestone) {
        const msColor = isDeleted ? '#999' : (isDone ? 'var(--color-success)' : (isOverdue ? 'var(--color-danger)' : 'var(--pp-ms)'));
        nameEl.innerHTML = `<span style="color:${msColor};font-weight:700;${isDeleted ? 'text-decoration:line-through;' : ''}">${App.escapeHtml(task.name || '')}</span>`;
      } else {
        const statusCls = isDeleted ? 'deleted' : (isDone ? 'done' : (task.status === 'ongoing' ? 'ongoing' : 'planned'));
        const checkCls = isDone ? 'checked' : '';
        const nameStyle = isDeleted ? 'text-decoration:line-through;color:#999;' : (isOverdue ? 'color:var(--color-danger);' : '');
        nameEl.innerHTML = `
          <div class="check-btn ${checkCls}" data-action="toggle-done" data-id="${task.id}" title="标记完成">${isDone ? '✓' : ''}</div>
          <span class="status-dot ${statusCls}"></span>
          <span class="task-id">${App.escapeHtml(task.task_uid || '')}</span>
          <span title="${App.escapeHtml(task.full_desc || '')}" style="${nameStyle}">${App.escapeHtml(task.name || '')}</span>
        `;
      }
      row.appendChild(nameEl);
      taskList.appendChild(row);

      // ---- 任务条 (右) ----
      const barRow = document.createElement('div');
      barRow.className = isMilestone ? 'pp-milestone-row' : 'pp-task-row';
      if (isDeleted) barRow.classList.add('pp-deleted');
      if (isOverdue) barRow.classList.add('pp-overdue');
      barRow.style.position = 'relative';
      barRow.dataset.taskId = task.id;

      const barContainer = document.createElement('div');
      barContainer.className = 'pp-task-bar-container';

      if (isMilestone) {
        const diamond = document.createElement('div');
        let diamondCls = 'pp-milestone-diamond';
        if (isDone) diamondCls += ' done';
        if (isDeleted) diamondCls += ' deleted';
        if (isOverdue) diamondCls += ' overdue';
        diamond.className = diamondCls;
        diamond.style.left = this.dayToPx(startDay) + 'px';
        diamond.dataset.taskId = task.id;
        diamond.dataset.action = 'task-click';
        barContainer.appendChild(diamond);

        const label = document.createElement('div');
        label.className = 'pp-milestone-label';
        if (isDeleted) label.classList.add('deleted');
        if (isOverdue) label.classList.add('overdue');
        label.style.left = `calc(${this.dayToPx(startDay)}px + 12px)`;
        label.textContent = (task.name || '').replace(/^★\s*/, '');
        barContainer.appendChild(label);
      } else {
        const bar = document.createElement('div');
        const cls = ['pp-task-bar', `p${phaseNo}`];
        if (isDone) cls.push('done');
        if (isDeleted) cls.push('deleted');
        if (isOverdue) cls.push('overdue');
        if (task.status === 'ongoing' && !isDone && !isDeleted) cls.push('ongoing');
        bar.className = cls.join(' ');
        bar.style.left = this.dayToPx(startDay) + 'px';
        bar.style.width = this.dayToPx(Math.max(1, endDay - startDay + 1)) + 'px';
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
    const counts = { ms: 0, total: 0 };
    const dones  = { ms: 0, total: 0 };
    // 按动态阶段初始化计数
    App.state.phases.forEach((p, i) => {
      counts[i + 1] = 0;
      dones[i + 1] = 0;
    });

    this.tasks.forEach(t => {
      const isMs = t.is_milestone || t.status === 'milestone';
      const key = isMs ? 'ms' : this.phaseNo(t.phase_id);
      counts[key] = (counts[key] || 0) + 1;
      counts.total++;
      if (t.status === 'done') {
        dones[key] = (dones[key] || 0) + 1;
        dones.total++;
      }
    });

    const setStat = (id, done, total) => {
      const numEl = document.getElementById(`pp-stat-${id}`);
      const progEl = document.getElementById(`pp-prog-${id}`);
      if (numEl) numEl.textContent = `${done}/${total}`;
      if (progEl) progEl.style.width = total > 0 ? (done / total * 100) + '%' : '0%';
    };

    App.state.phases.forEach((p, i) => {
      const pn = i + 1;
      setStat(`p${pn}`, dones[pn] || 0, counts[pn] || 0);
    });
    setStat('ms', dones.ms, counts.ms);
    setStat('total', dones.total, counts.total);
  },

  /* ------------------------------------------------------------------
   * 绑定事件
   * ---------------------------------------------------------------- */
  bindEvents() {
    // ---- 项目元信息编辑 (标题/基于文档 contenteditable blur 保存) ----
    document.querySelectorAll('[data-pfield]').forEach(el => {
      if (el.tagName === 'INPUT') return; // 日期用 change 单独处理
      const field = el.dataset.pfield;
      let snapshot = el.textContent.trim();
      el.addEventListener('focus', () => { snapshot = el.textContent.trim(); });
      el.addEventListener('blur', async () => {
        const val = el.textContent.trim();
        if (val === snapshot) return;
        snapshot = val;
        await this.saveProjectField(field, val);
      });
    });

    // 项目周期日期 (开始/结束) change → 保存并重建时间轴
    const projStart = document.getElementById('pp-proj-start');
    const projEnd = document.getElementById('pp-proj-end');
    if (projStart) {
      projStart.addEventListener('change', async () => {
        await this.saveProjectField('start_date', projStart.value);
        this.initTimeline();
        this.renderTimelineHeaders();
        this.renderGridBg();
        this.renderTodayLine();
        this.renderTasks();
      });
    }
    if (projEnd) {
      projEnd.addEventListener('change', async () => {
        await this.saveProjectField('end_date', projEnd.value);
        this.initTimeline();
        this.renderTimelineHeaders();
        this.renderGridBg();
        this.renderTodayLine();
        this.renderTasks();
      });
    }

    // 项目切换
    const projSelect = document.getElementById('pp-project-select');
    if (projSelect) {
      projSelect.addEventListener('change', async () => {
        const newId = projSelect.value;
        if (!newId || (this.project && String(this.project.id) === String(newId))) return;
        await API.activateProject(newId);
        this.tasks = []; // 切换项目后重新加载任务
        await this.ensureProject();
        this.loadTasks();
      });
    }

    // 新建项目
    const newProjBtn = document.getElementById('pp-new-project-btn');
    if (newProjBtn) newProjBtn.addEventListener('click', () => this.createProject());

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

    // 编辑阶段
    const editPhasesBtn = document.getElementById('pp-edit-phases-btn');
    if (editPhasesBtn) editPhasesBtn.addEventListener('click', () => this.editPhases());

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

    // 任务拖拽排序 (左栏垂直拖拽 → 自动更新阶段与日期)
    this.bindTaskDragSort();

    // 任务条水平拖拽 (右栏拖拽任务条 → 更新开始/结束日期)
    this.bindBarDrag();

    // 滚动同步 (task-panel 与 timeline-panel)
    this.syncScroll();

    // 导出 PDF
    const exportBtn = document.getElementById('pp-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportToPdf());
  },

  /** 天数偏移转日期字符串 (YYYY-MM-DD) */
  dayToDateStr(day) {
    if (!this.PROJECT_START) return null;
    const d = new Date(this.PROJECT_START);
    d.setDate(d.getDate() + day);
    return d.toISOString().split('T')[0];
  },

  /** 根据日期字符串判断所属阶段 */
  getPhaseForDate(dateStr) {
    if (!dateStr) return null;
    const phases = App.state.phases || [];
    for (const ph of phases) {
      if (ph.start_date && ph.end_date && dateStr >= ph.start_date && dateStr <= ph.end_date) {
        return ph;
      }
    }
    return null;
  },

  /** 计算两个日期字符串间的天数差 (b - a) */
  daysBetween(a, b) {
    if (!a || !b) return 0;
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  },

  /** 任务行垂直拖拽排序: 拖到不同阶段区域 → 自动更新 phase_id + 日期 */
  bindTaskDragSort() {
    const taskList = document.getElementById('pp-task-list');
    if (!taskList) return;
    let dragRow = null;

    taskList.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.pp-task-row, .pp-milestone-row');
      if (!row) return;
      dragRow = row;
      row.classList.add('pp-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.taskId || '');
    });

    taskList.addEventListener('dragend', () => {
      if (dragRow) dragRow.classList.remove('pp-dragging');
      taskList.querySelectorAll('.pp-drag-over').forEach(el => el.classList.remove('pp-drag-over'));
      dragRow = null;
    });

    taskList.addEventListener('dragover', (e) => {
      if (!dragRow) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.pp-task-row, .pp-milestone-row, .pp-phase-header');
      if (!target || target === dragRow) return;
      taskList.querySelectorAll('.pp-drag-over').forEach(el => el.classList.remove('pp-drag-over'));
      target.classList.add('pp-drag-over');
    });

    taskList.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragRow) return;
      const dragTaskId = dragRow.dataset.taskId;
      const target = e.target.closest('.pp-task-row, .pp-milestone-row, .pp-phase-header');
      taskList.querySelectorAll('.pp-drag-over').forEach(el => el.classList.remove('pp-drag-over'));
      dragRow.classList.remove('pp-dragging');
      if (!target || target === dragRow) { dragRow = null; return; }

      const task = this.tasks.find(t => String(t.id) === String(dragTaskId));
      if (!task) { dragRow = null; return; }

      // 找到拖放位置的所属阶段 (从目标元素向上查找最近的阶段标题)
      let phaseHeader = null;
      if (target.classList.contains('pp-phase-header')) {
        phaseHeader = target;
      } else {
        let prev = target.previousElementSibling;
        while (prev) {
          if (prev.classList && prev.classList.contains('pp-phase-header')) {
            phaseHeader = prev;
            break;
          }
          prev = prev.previousElementSibling;
        }
      }

      if (!phaseHeader) { dragRow = null; return; }
      const newPhaseId = parseInt(phaseHeader.dataset.phaseId, 10);
      const newPhase = App.state.phases.find(p => String(p.id) === String(newPhaseId));
      if (!newPhase) { dragRow = null; return; }

      const oldPhaseId = task.phase_id;
      const duration = Math.max(1, this.daysBetween(task.start_date, task.end_date || task.start_date) + 1);

      // 计算新日期: 如果阶段变了, 用新阶段的开始日期 + 原时长
      let newStartDate, newEndDate;
      if (String(oldPhaseId) !== String(newPhaseId)) {
        newStartDate = newPhase.start_date;
        newEndDate = this.dayToDateStr(this.dateToDay(newStartDate) + duration - 1);
      } else {
        newStartDate = task.start_date;
        newEndDate = task.end_date;
      }

      dragRow = null;

      // 调用后端更新
      const payload = {
        phase_id: newPhaseId,
        start_date: newStartDate,
        end_date: newEndDate
      };
      try {
        await API.updateProgressTask(task.id, payload);
        Object.assign(task, payload);
        App.showToast(`已移动到「${newPhase.name}」, 日期已更新`, 'success', 2000);
        this.loadTasks();
      } catch (err) {
        App.showToast(`拖拽更新失败: ${err.message}`, 'error');
      }
    });
  },

  /** 任务条水平拖拽: 在时间轴上左右拖动任务条 → 更新开始/结束日期, 跨阶段时自动更新 phase_id */
  bindBarDrag() {
    const barsArea = document.getElementById('pp-bars-area');
    if (!barsArea) return;

    let dragInfo = null; // { taskId, bar, startMouseX, origLeftPx, origStartDay, origEndDay, isMilestone }

    barsArea.addEventListener('mousedown', (e) => {
      const bar = e.target.closest('.pp-task-bar, .pp-milestone-diamond');
      if (!bar) return;
      // 排除已删除任务
      if (bar.classList.contains('deleted')) return;
      const taskId = bar.dataset.taskId;
      const task = this.tasks.find(t => String(t.id) === String(taskId));
      if (!task) return;

      e.preventDefault();
      const origStartDay = this.dateToDay(task.start_date);
      const origEndDay = this.dateToDay(task.end_date || task.start_date);
      dragInfo = {
        taskId,
        bar,
        startMouseX: e.clientX,
        origLeftPx: parseFloat(bar.style.left) || 0,
        origStartDay,
        origEndDay,
        isMilestone: bar.classList.contains('pp-milestone-diamond'),
        moved: false
      };
      bar.classList.add('pp-dragging-bar');
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragInfo) return;
      const deltaX = e.clientX - dragInfo.startMouseX;
      if (Math.abs(deltaX) < 3 && !dragInfo.moved) return;
      dragInfo.moved = true;
      const deltaDays = Math.round(deltaX / this.PX_PER_DAY);
      const newLeftPx = dragInfo.origLeftPx + deltaDays * this.PX_PER_DAY;
      dragInfo.bar.style.left = newLeftPx + 'px';
      // 里程碑标签同步移动
      if (dragInfo.isMilestone) {
        const label = dragInfo.bar.parentElement.querySelector('.pp-milestone-label');
        if (label) label.style.left = `calc(${newLeftPx}px + 12px)`;
      }
    });

    document.addEventListener('mouseup', async (e) => {
      if (!dragInfo) return;
      const info = dragInfo;
      dragInfo = null;
      info.bar.classList.remove('pp-dragging-bar');
      if (!info.moved) return;

      const task = this.tasks.find(t => String(t.id) === String(info.taskId));
      if (!task) return;

      const deltaX = e.clientX - info.startMouseX;
      const deltaDays = Math.round(deltaX / this.PX_PER_DAY);
      const newStartDay = Math.max(0, info.origStartDay + deltaDays);
      const newEndDay = Math.max(newStartDay, info.origEndDay + deltaDays);
      const newStartDate = this.dayToDateStr(newStartDay);
      const newEndDate = this.dayToDateStr(newEndDay);

      // 检测新位置所属阶段
      const newPhase = this.getPhaseForDate(newStartDate);
      const payload = { start_date: newStartDate, end_date: newEndDate };
      let phaseChanged = false;
      if (newPhase && String(newPhase.id) !== String(task.phase_id)) {
        payload.phase_id = newPhase.id;
        phaseChanged = true;
      }

      try {
        await API.updateProgressTask(task.id, payload);
        Object.assign(task, payload);
        const msg = phaseChanged
          ? `日期已更新, 阶段变更为「${newPhase.name}」`
          : '日期已更新';
        App.showToast(msg, 'success', 2000);
        this.loadTasks();
      } catch (err) {
        App.showToast(`拖拽更新失败: ${err.message}`, 'error');
        this.renderTasks();
      }
    });
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

  /** 编辑项目阶段 (增删改) */
  editPhases() {
    const phases = App.state.phases.slice();
    const renderRow = (p) => {
      const id = p?.id || '';
      return `<div class="form-row" data-phase-row data-phase-id="${id}" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;">
        <div class="form-group" style="flex:1;">
          <label>阶段名称</label>
          <input type="text" data-phase-name value="${App.escapeHtml(p?.name || '')}" placeholder="如: 第一阶段">
        </div>
        <div class="form-group" style="flex:1;">
          <label>副标题</label>
          <input type="text" data-phase-subtitle value="${App.escapeHtml(p?.subtitle || '')}" placeholder="如: 有得用">
        </div>
        <div class="form-group" style="flex:1;">
          <label>开始日期</label>
          <input type="date" data-phase-start value="${p?.start_date || ''}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>结束日期</label>
          <input type="date" data-phase-end value="${p?.end_date || ''}">
        </div>
        ${id ? `<div class="form-group" style="flex:0 0 auto;">
          <button type="button" class="btn btn-ghost btn-sm" data-phase-del data-phase-id="${id}">删除</button>
        </div>` : ''}
      </div>`;
    };

    const modal = App.openModal({
      title: '编辑项目阶段',
      bodyHtml: `
        <div id="phase-editor">
          ${phases.length === 0 ? renderRow(null) : phases.map(p => renderRow(p)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="phase-add-row" style="margin-top:8px;">＋ 添加阶段</button>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="phase-save-btn">保存</button>
      `
    });

    modal.querySelector('#phase-add-row').addEventListener('click', () => {
      const editor = modal.querySelector('#phase-editor');
      const wrap = document.createElement('div');
      wrap.innerHTML = renderRow(null);
      editor.appendChild(wrap.firstElementChild);
    });

    modal.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('[data-phase-del]');
      if (!delBtn) return;
      const phaseId = delBtn.getAttribute('data-phase-id');
      if (!phaseId) return;
      if (!confirm('确认删除该阶段? 关联的任务将变为"未分阶段"')) return;
      try {
        await API.deletePhase(phaseId);
        App.showToast('阶段已删除', 'success');
        const row = delBtn.closest('[data-phase-row]');
        if (row) row.remove();
        // 同步刷新阶段缓存
        await App.loadPhases();
      } catch (err) {
        App.showToast(`删除失败: ${err.message}`, 'error');
      }
    });

    modal.querySelector('#phase-save-btn').addEventListener('click', async () => {
      const rows = modal.querySelectorAll('[data-phase-row]');
      const promises = [];
      rows.forEach(row => {
        const phaseId = row.getAttribute('data-phase-id');
        const name = row.querySelector('[data-phase-name]')?.value?.trim();
        const subtitle = row.querySelector('[data-phase-subtitle]')?.value?.trim() || '';
        const startDate = row.querySelector('[data-phase-start]')?.value;
        const endDate = row.querySelector('[data-phase-end]')?.value;
        if (!name || !startDate || !endDate) return;
        const data = { name, subtitle, start_date: startDate, end_date: endDate };
        if (phaseId) {
          promises.push(API.updatePhase(phaseId, data));
        } else {
          promises.push(API.createPhase(data));
        }
      });
      try {
        await Promise.all(promises);
        await App.loadPhases();
        // 阶段日期可能变化, 重建时间轴 + 重新加载任务
        this.initTimeline();
        App.showToast('阶段已保存', 'success');
        App.closeModal(modal);
        this.loadTasks();
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
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
   * 右栏显示任务详情 (全部字段可编辑, 保存写回后端)
   * ---------------------------------------------------------------- */
  showTaskDetail(task) {
    const isMilestone = task.is_milestone || task.status === 'milestone';
    const refCount = task.ref_count || task.reference_count || 0;
    const phaseOpts = App.state.phases.map(p =>
      `<option value="${p.id}" ${String(task.phase_id) === String(p.id) ? 'selected' : ''}>${App.escapeHtml(p.name)}</option>`
    ).join('');

    App.showDetail(`
      <div class="detail-panel__header">
        <div class="detail-panel__title">${isMilestone ? '★ ' : ''}编辑进度计划任务</div>
        <div class="detail-panel__meta">UID: ${App.escapeHtml(task.task_uid || '—')} · #${App.escapeHtml(String(task.id))} · 被引用 ${refCount} 次</div>
      </div>
      <div class="detail-panel__body is-pp-edit" data-pp-id="${task.id}">
        <div class="pp-edit-form">
          <div class="form-group">
            <label>任务名称 *</label>
            <input type="text" id="ppd-name" value="${App.escapeHtml(task.name || '')}">
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1;">
              <label>任务 UID *</label>
              <input type="text" id="ppd-uid" value="${App.escapeHtml(task.task_uid || '')}">
            </div>
            <div class="form-group" style="flex:1;">
              <label>所属阶段</label>
              <select id="ppd-phase"><option value="">— 请选择 —</option>${phaseOpts}</select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>开始日期</label>
              <input type="date" id="ppd-start" value="${task.start_date ? App.formatDate(task.start_date) : ''}">
            </div>
            <div class="form-group">
              <label>结束日期</label>
              <input type="date" id="ppd-end" value="${task.end_date ? App.formatDate(task.end_date) : ''}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1;">
              <label>责任方</label>
              <input type="text" id="ppd-owner" value="${App.escapeHtml(task.owner || '')}">
            </div>
            <div class="form-group" style="flex:1;">
              <label>状态</label>
              <select id="ppd-status">
                <option value="planned" ${task.status === 'planned' ? 'selected' : ''}>待开始</option>
                <option value="ongoing" ${task.status === 'ongoing' ? 'selected' : ''}>进行中</option>
                <option value="done" ${task.status === 'done' ? 'selected' : ''}>已完成</option>
                <option value="deleted" ${task.status === 'deleted' ? 'selected' : ''}>已删除</option>
                <option value="milestone" ${task.status === 'milestone' ? 'selected' : ''}>里程碑</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>类型</label>
            <select id="ppd-ms">
              <option value="false" ${!isMilestone ? 'selected' : ''}>普通任务</option>
              <option value="true" ${isMilestone ? 'selected' : ''}>★ 里程碑</option>
            </select>
          </div>
          <div class="form-group pp-edit-desc-group">
            <label>完整描述</label>
            <textarea id="ppd-desc" placeholder="任务详细说明 (含责任方等), 支持 Markdown 语法">${App.escapeHtml(task.full_desc || '')}</textarea>
          </div>
        </div>
        <div class="pp-edit-actions">
          <span class="pp-edit-status" data-pp-status></span>
          <button class="btn btn-primary" id="ppd-save">💾 保存</button>
        </div>
      </div>
    `);

    const saveBtn = document.getElementById('ppd-save');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveTaskDetail(task.id));
  },

  /** 保存右栏编辑的进度计划任务 */
  async saveTaskDetail(id) {
    const name = document.getElementById('ppd-name').value.trim();
    const taskUid = document.getElementById('ppd-uid').value.trim();
    if (!name) { App.showToast('请输入任务名称', 'warning'); return; }
    if (!taskUid) { App.showToast('请输入任务 UID', 'warning'); return; }

    const payload = {
      task_uid: taskUid,
      name,
      phase_id: document.getElementById('ppd-phase').value
        ? parseInt(document.getElementById('ppd-phase').value, 10) : null,
      start_date: document.getElementById('ppd-start').value || null,
      end_date: document.getElementById('ppd-end').value || null,
      owner: document.getElementById('ppd-owner').value.trim() || '',
      status: document.getElementById('ppd-status').value,
      is_milestone: document.getElementById('ppd-ms').value === 'true',
      full_desc: document.getElementById('ppd-desc').value.trim()
    };

    const statusEl = document.querySelector('[data-pp-status]');
    try {
      await API.updateProgressTask(id, payload);
      const t = this.tasks.find(x => String(x.id) === String(id));
      if (t) Object.assign(t, payload);
      if (statusEl) {
        statusEl.textContent = '✓ 已保存';
        statusEl.className = 'pp-edit-status saved';
        setTimeout(() => {
          if (statusEl.classList.contains('saved')) {
            statusEl.textContent = '';
            statusEl.className = 'pp-edit-status';
          }
        }, 2000);
      }
      App.showToast('已保存', 'success', 1500);
      this.renderTasks();   // 刷新甘特图任务条
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = '✗ 保存失败';
        statusEl.className = 'pp-edit-status dirty';
      }
      App.showToast(`保存失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 编辑任务 (新建或修改)
   * ---------------------------------------------------------------- */
  editTask(id) {
    const task = id ? this.tasks.find(t => String(t.id) === String(id)) : null;
    const statusVal = task?.status || 'planned';

    // 新建任务时, 默认使用当前选中阶段的阶段、开始/结束日期
    let defaultPhaseId = null;
    let defaultStart = '';
    let defaultEnd = '';
    if (!id) {
      let selPhase = null;
      if (this.filters.phase !== 'all' && this.filters.phase !== 'ms') {
        const phaseNo = parseInt(this.filters.phase, 10);
        selPhase = App.state.phases[phaseNo - 1];
      } else if (App.state.phases.length > 0) {
        // 未选阶段时默认第一个
        selPhase = App.state.phases[0];
      }
      if (selPhase) {
        defaultPhaseId = selPhase.id;
        defaultStart = selPhase.start_date ? App.formatDate(selPhase.start_date) : '';
        defaultEnd = selPhase.end_date ? App.formatDate(selPhase.end_date) : '';
      }
    }

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
            ${App.state.phases.map(p => `<option value="${p.id}" ${task ? (String(task.phase_id) === String(p.id) ? 'selected' : '') : (String(defaultPhaseId) === String(p.id) ? 'selected' : '')}>${App.escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>开始日期</label>
            <input type="date" id="pp-start" value="${task && task.start_date ? App.formatDate(task.start_date) : defaultStart}">
          </div>
          <div class="form-group">
            <label>结束日期</label>
            <input type="date" id="pp-end" value="${task && task.end_date ? App.formatDate(task.end_date) : defaultEnd}">
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
                <option value="deleted" ${statusVal === 'deleted' ? 'selected' : ''}>已删除</option>
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
  },

  /* ------------------------------------------------------------------
   * 项目元信息保存 / 新建项目
   * ---------------------------------------------------------------- */
  /** 保存当前项目的某个字段到后端, 并同步本地缓存 */
  async saveProjectField(field, value) {
    if (!this.project || !this.project.id) {
      App.showToast('项目信息未加载, 无法保存', 'warning');
      return;
    }
    try {
      const updated = await API.updateProject(this.project.id, { [field]: value });
      this.project = updated;
      App.state.project = updated;
      // 同步项目下拉里的显示名
      const inList = this.projects.find(p => String(p.id) === String(updated.id));
      if (inList) Object.assign(inList, updated);
      App.showToast('项目信息已保存', 'success', 1500);
    } catch (err) {
      App.showToast(`保存项目信息失败: ${err.message}`, 'error');
    }
  },

  /** 新建项目 (弹窗输入, 创建后切换为当前项目) */
  createProject() {
    const modal = App.openModal({
      title: '新建项目',
      bodyHtml: `
        <div class="form-group">
          <label>项目名称 *</label>
          <input type="text" id="pp-proj-name" placeholder="如 信投AI3.0">
        </div>
        <div class="form-group">
          <label>执行图标题</label>
          <input type="text" id="pp-proj-title" placeholder="项目进度计划执行图">
        </div>
        <div class="form-group">
          <label>基于文档</label>
          <input type="text" id="pp-proj-baseddoc" placeholder="文档名称">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>开始日期 *</label>
            <input type="date" id="pp-proj-new-start">
          </div>
          <div class="form-group">
            <label>结束日期 *</label>
            <input type="date" id="pp-proj-new-end">
          </div>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="pp-proj-create-btn">创建并切换</button>
      `
    });

    modal.querySelector('#pp-proj-create-btn').addEventListener('click', async () => {
      const name = modal.querySelector('#pp-proj-name').value.trim();
      const startDate = modal.querySelector('#pp-proj-new-start').value;
      const endDate = modal.querySelector('#pp-proj-new-end').value;
      if (!name) { App.showToast('请输入项目名称', 'warning'); return; }
      if (!startDate || !endDate) { App.showToast('请选择项目开始与结束日期', 'warning'); return; }
      try {
        const created = await API.createProject({
          name,
          title: modal.querySelector('#pp-proj-title').value.trim() || `${name} 项目进度计划执行图`,
          based_doc: modal.querySelector('#pp-proj-baseddoc').value.trim(),
          start_date: startDate,
          end_date: endDate,
          is_active: true,
          sort_order: this.projects.length,
        });
        App.showToast('项目已创建并切换', 'success');
        App.closeModal(modal);
        this.tasks = [];
        await this.ensureProject();
        this.loadTasks();
      } catch (err) {
        App.showToast(`创建项目失败: ${err.message}`, 'error');
      }
    });
  }
};
