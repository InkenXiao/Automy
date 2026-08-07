/* ==========================================================================
   主应用
   负责导航、全局状态、右栏面板、Toast、工具函数
   ========================================================================== */

const App = {
  // 全局状态
  state: {
    modules: [],     // 模块列表
    phases: [],      // 阶段列表
    project: null,   // 当前激活项目元信息 (进度计划执行图)
    currentWeek: '', // 当前选择的周次 (格式 YYYY-Www)
    currentView: 'tasks'
  },

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  async init() {
    this.bindNav();
    this.initWeekPicker();
    this.createToastContainer();

    // 身份确认: 未登录则阻塞展示登录页 (无效姓名可进入但无项目数据)
    await Auth.ensure();

    // 加载基础数据
    try {
      await this.loadModules();
      await this.loadPhases();
      await this.loadActiveProject();
    } catch (err) {
      this.showToast(`加载基础数据失败: ${err.message}`, 'error');
    }

    // 初始化各模块
    WeeklyReport.init();
    ProgressPlan.init();
    WorkTasks.init();
    Meeting.init();
    ProjectTeam.init();
    PersonalReport.init();
    // CoWork 智能体平台模块
    TaskCenter.init();
    CoworkAgents.init();
    AgentChat.init();
    CoworkBuilder.init();
    CoworkSkills.init();
    SkillBuilder.init();
    CoworkMemories.init();
    // 系统模块
    UsageLogs.init();

    // 触发默认视图(进度计划)的首次加载, 避免首屏主区域空白
    this.switchView(this.state.currentView);
  },

  /* ------------------------------------------------------------------
   * 维护权限 (依赖 Auth 身份与当前激活项目)
   * pm():       当前用户是当前激活项目的项目经理
   * fulltime(): 当前用户是当前激活项目的全职成员 (经理视同全职)
   * ---------------------------------------------------------------- */
  can: {
    pm() { return Auth.isPm(); },
    fulltime() { return Auth.isFulltime(); },
  },

  /** 绑定左侧导航切换 */
  bindNav() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.getAttribute('data-view');
        this.switchView(view);
      });
    });
  },

  /** 切换视图 */
  switchView(viewName) {
    this.state.currentView = viewName;

    // 切换导航高亮
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-view') === viewName);
    });

    // 切换视图容器显示
    document.querySelectorAll('.view').forEach(view => {
      view.classList.remove('active');
    });
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');

    // 触发对应模块的 onShow 回调
    const viewModuleMap = {
      'weekly-report': WeeklyReport,
      'progress-plan': ProgressPlan,
      'work-tasks': WorkTasks,
      'meeting': Meeting,
      'project-team': ProjectTeam,
      'personal-report': PersonalReport,
      'tasks': TaskCenter,
      'agents': CoworkAgents,
      'agent-chat': AgentChat,
      'builder': CoworkBuilder,
      'skills': CoworkSkills,
      'skill-builder': SkillBuilder,
      'memories': CoworkMemories,
      'usage-logs': UsageLogs,
    };
    const mod = viewModuleMap[viewName] || null;
    if (mod && typeof mod.onShow === 'function') {
      try { mod.onShow(); } catch (err) { console.error(err); }
    }

    // CoWork 全屏视图 (对话/构建器) 隐藏右栏详情面板
    const rightPanel = document.querySelector('.app-frame__right');
    if (rightPanel) {
      const fullWidthViews = ['tasks', 'agents', 'agent-chat', 'builder', 'skills', 'skill-builder', 'memories', 'usage-logs'];
      rightPanel.style.display = fullWidthViews.includes(viewName) ? 'none' : '';
    }

    // 切换视图时清空右栏
    this.clearDetail();
  },

  /** 初始化周选择器, 默认当前周 */
  initWeekPicker() {
    const picker = document.getElementById('week-picker');
    if (!picker) return;

    const now = new Date();
    const year = now.getFullYear();
    const firstDay = new Date(year, 0, 1);
    const days = Math.floor((now - firstDay) / 86400000);
    const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
    const currentWeek = `${year}-W${String(week).padStart(2, '0')}`;
    picker.value = currentWeek;
    this.state.currentWeek = currentWeek;

    picker.addEventListener('change', () => {
      this.state.currentWeek = picker.value;
      // 通知当前视图周次变化
      const view = this.state.currentView;
      if (view === 'weekly-report' && typeof WeeklyReport.onWeekChange === 'function') {
        WeeklyReport.onWeekChange(picker.value);
      } else if (view === 'work-tasks' && typeof WorkTasks.onWeekChange === 'function') {
        WorkTasks.onWeekChange(picker.value);
      }
    });
  },

  /** 加载模块列表到全局状态 */
  async loadModules() {
    const data = await API.getModules();
    this.state.modules = Array.isArray(data) ? data : (data.items || []);
  },

  /** 加载阶段列表到全局状态 */
  async loadPhases() {
    const data = await API.getPhases();
    this.state.phases = Array.isArray(data) ? data : (data.items || []);
  },

  /** 加载当前激活项目元信息到全局状态 (无所属项目时后端返回 403, 置空即可) */
  async loadActiveProject() {
    try {
      const data = await API.getActiveProject();
      this.state.project = data || null;
    } catch (err) {
      this.state.project = null;
    }
    return this.state.project;
  },

  /** 根据 id 取模块信息 */
  getModule(id) {
    return this.state.modules.find(m => String(m.id) === String(id));
  },

  /** 根据 id 取阶段信息 */
  getPhase(id) {
    return this.state.phases.find(p => String(p.id) === String(id));
  },

  /** 取模块对应的标签颜色 (稳定哈希) */
  getModuleColor(moduleId) {
    const colors = ['', 'gray', 'blue', 'green', 'purple', 'gold'];
    const name = (this.getModule(moduleId)?.title) || String(moduleId || '');
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  },

  /* ------------------------------------------------------------------
   * 右栏详情面板
   * ---------------------------------------------------------------- */
  /** 显示详情 */
  showDetail(html) {
    const panel = document.getElementById('detail-panel');
    if (!panel) return;
    panel.innerHTML = html;
  },

  /** 清空详情 */
  clearDetail() {
    const panel = document.getElementById('detail-panel');
    if (!panel) return;
    panel.innerHTML = '<div class="detail-empty">点击任务查看关联详情</div>';
  },

  /* ------------------------------------------------------------------
   * Toast
   * ---------------------------------------------------------------- */
  createToastContainer() {
    if (document.querySelector('.toast-container')) return;
    const div = document.createElement('div');
    div.className = 'toast-container';
    document.body.appendChild(div);
  },

  /**
   * 显示提示消息
   * @param {string} msg
   * @param {'info'|'success'|'error'|'warning'} type
   * @param {number} duration - 持续毫秒
   */
  showToast(msg, type = 'info', duration = 3000) {
    const container = document.querySelector('.toast-container');
    if (!container) return null;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
    return toast;
  },

  /* ------------------------------------------------------------------
   * 模态框通用工具
   * ---------------------------------------------------------------- */
  /**
   * 打开模态框
   * @param {object} opts - {title, body, footer, size}
   * @returns {HTMLElement} 模态框根元素
   */
  openModal(opts = {}) {
    const { title = '', bodyHtml = '', footerHtml = '', size = '' } = opts;
    const modal = document.createElement('div');
    modal.className = 'modal open';
    const cardCls = ['modal__card'];
    if (size === 'lg') cardCls.push('modal__card--lg');
    if (size === 'sm') cardCls.push('modal__card--sm');

    modal.innerHTML = `
      <div class="${cardCls.join(' ')}">
        <div class="modal__header">
          <div class="modal__title">${this.escapeHtml(title)}</div>
          <button class="modal__close" data-modal-close>×</button>
        </div>
        <div class="modal__body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal__footer">${footerHtml}</div>` : ''}
      </div>
    `;

    // 点击遮罩或关闭按钮关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.hasAttribute('data-modal-close')) {
        this.closeModal(modal);
      }
    });

    document.body.appendChild(modal);
    return modal;
  },

  /** 关闭模态框 */
  closeModal(modal) {
    if (!modal) return;
    modal.style.transition = 'opacity 0.15s ease';
    modal.style.opacity = '0';
    setTimeout(() => modal.remove(), 150);
  },

  /* ------------------------------------------------------------------
   * 工具函数
   * ---------------------------------------------------------------- */

  /** HTML 转义, 防止 XSS */
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** 格式化日期 YYYY-MM-DD */
  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  /** 格式化为简写日期 M/D (如 7/23), 用于今天线标签等 */
  formatShortDate(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  /** 将 Markdown 文本渲染为 HTML (用于富文本预览) */
  renderMarkdown(md) {
    if (!md) return '';
    try {
      if (typeof window.marked === 'undefined') {
        // marked 未加载时退化为转义文本 + 换行
        return this.escapeHtml(md).replace(/\n/g, '<br>');
      }
      return window.marked.parse(String(md), { breaks: true, gfm: true });
    } catch (e) {
      return this.escapeHtml(String(md)).replace(/\n/g, '<br>');
    }
  },

  /**
   * 根据周次字符串 (YYYY-Www) 取该周的范围
   * @returns {{start: Date, end: Date, label: string}}
   */
  weekRange(weekStr) {
    if (!weekStr) return { start: null, end: null, label: '' };
    const m = weekStr.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return { start: null, end: null, label: weekStr };
    const year = parseInt(m[1], 10);
    const week = parseInt(m[2], 10);

    // ISO 8601 周计算: 该年第一个星期四所在的周为第 1 周
    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - (jan4Day - 1));

    const monday = new Date(week1Monday);
    monday.setDate(monday.getDate() + (week - 1) * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const fmt = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
    return {
      start: monday,
      end: sunday,
      label: `${fmt(monday)} - ${fmt(sunday)}`
    };
  },

  /**
   * 根据周次字符串和指定 weekday (1-7, 周一为 1) 返回具体日期
   * @returns {string} YYYY-MM-DD
   */
  weekToDate(weekStr, weekday = 1) {
    const range = this.weekRange(weekStr);
    if (!range.start) return '';
    const d = new Date(range.start);
    d.setDate(d.getDate() + (weekday - 1));
    return this.formatDate(d);
  },

  /** 状态徽章 HTML */
  statusBadge(status) {
    const map = {
      // 通用英文
      'todo':          { cls: 'badge--gray',    label: '待开始' },
      'in_progress':   { cls: 'badge--warning', label: '进行中' },
      'doing':         { cls: 'badge--warning', label: '进行中' },
      'done':          { cls: 'badge--success', label: '已完成' },
      'completed':     { cls: 'badge--success', label: '已完成' },
      'blocked':       { cls: 'badge--danger',  label: '阻塞' },
      'delayed':       { cls: 'badge--danger',  label: '延期' },
      'pending':       { cls: 'badge--gray',    label: '待开始' },
      'in_review':     { cls: 'badge--info',    label: '评审中' },
      // 周报状态
      'draft':         { cls: 'badge--gray',    label: '待汇报' },
      'submitted':     { cls: 'badge--success', label: '已汇报' },
      // 进度计划任务状态 (后端)
      'planned':       { cls: 'badge--gray',    label: '待开始' },
      'ongoing':       { cls: 'badge--warning', label: '进行中' },
      'milestone':     { cls: 'badge--primary', label: '★ 里程碑' },
      // 通用中文 (周报/工作任务)
      '待开始':        { cls: 'badge--gray',    label: '待开始' },
      '进行中':        { cls: 'badge--warning', label: '进行中' },
      '已完成':        { cls: 'badge--success', label: '已完成' },
      '已取消':        { cls: 'badge--gray',    label: '已取消' },
      '阻塞':          { cls: 'badge--danger',  label: '阻塞' },
      '延期':          { cls: 'badge--danger',  label: '延期' }
    };
    const cfg = map[status] || { cls: 'badge--gray', label: status || '未知' };
    return `<span class="badge ${cfg.cls}">${this.escapeHtml(cfg.label)}</span>`;
  },

  /** 渲染加载中占位 */
  renderLoading(text = '加载中...') {
    return `<div class="loading"><div class="loading__spinner"></div><div>${this.escapeHtml(text)}</div></div>`;
  },

  /** 渲染空状态 */
  renderEmpty(title = '暂无数据', hint = '', icon = '📭') {
    return `<div class="empty-state">
      <div class="empty-state__icon">${icon}</div>
      <div class="empty-state__title">${this.escapeHtml(title)}</div>
      ${hint ? `<div class="empty-state__hint">${this.escapeHtml(hint)}</div>` : ''}
    </div>`;
  },

  /* ------------------------------------------------------------------
   * PDF 导出 (基于 html2pdf.js, 内部封装 html2canvas + jsPDF)
   * ---------------------------------------------------------------- */
  /**
   * 将指定 DOM 元素导出为 PDF
   * @param {HTMLElement} element - 待导出的 DOM 元素
   * @param {string} filename - 文件名 (不含扩展名)
   * @param {object} [options] - { landscape: bool, addDate: bool, prepareClone: (clone)=>void }
   * @returns {Promise<void>}
   */
  exportToPdf(element, filename, options = {}) {
    if (typeof window.html2pdf === 'undefined') {
      this.showToast('PDF 库未加载, 请检查网络后重试', 'error');
      return Promise.resolve();
    }
    if (!element) {
      this.showToast('没有可导出的内容', 'error');
      return Promise.resolve();
    }

    const landscape = !!options.landscape;
    const addDate = options.addDate !== false;
    const prepareClone = typeof options.prepareClone === 'function' ? options.prepareClone : null;

    // 日期后缀 YYYYMMDD
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const safeName = String(filename || 'export').replace(/[\\/:*?"<>|]/g, '_');
    const finalFilename = `${safeName}${addDate ? '_' + dateStr : ''}.pdf`;

    // 显示 loading (长持续时间, 完成后手动移除)
    const loadingToast = this.showToast('正在生成PDF...', 'info', 60000);

    // 克隆元素到离屏容器, 避免影响原布局
    // left:0 (非 -99999px) 确保 html2canvas windowWidth 能完整捕获内容, z-index:-1 遮盖避免视觉干扰
    const clone = element.cloneNode(true);
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;background:#ffffff;overflow:hidden;';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    // 默认按内容宽度展开
    clone.style.width = (element.scrollWidth || element.offsetWidth || 1000) + 'px';
    clone.style.boxSizing = 'border-box';
    clone.style.margin = '0';

    if (prepareClone) {
      try { prepareClone(clone); } catch (e) { /* 忽略准备阶段错误, 继续导出 */ }
    }

    // 单页导出: 不分页, PDF 页面尺寸 = 内容尺寸 (适合周报等需完整保留格式的场景)
    if (options.singlePage) {
      const html2canvasFn = window.html2canvas;
      const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (typeof html2canvasFn === 'function' && typeof JsPDF === 'function') {
        return html2canvasFn(clone, {
          scale: 2, useCORS: true, backgroundColor: '#ffffff',
          windowWidth: clone.scrollWidth || 1200
        }).then(canvas => {
          const imgData = canvas.toDataURL('image/jpeg', 0.95);
          const pdf = new JsPDF({
            unit: 'px',
            format: [canvas.width, canvas.height],
            orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
            hotfixes: ['px_scaling']
          });
          pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height, undefined, 'FAST');
          pdf.save(finalFilename);
          if (loadingToast && loadingToast.parentNode) loadingToast.remove();
          if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
          this.showToast('PDF已下载', 'success');
        }).catch((err) => {
          if (loadingToast && loadingToast.parentNode) loadingToast.remove();
          if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
          this.showToast(`导出失败: ${err && err.message ? err.message : err}`, 'error');
        });
      }
      // 库不可用时回退到标准分页导出
    }

    const opt = {
      margin: [10, 10, 10, 10],
      filename: finalFilename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: clone.scrollWidth || 1200
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    return html2pdf().set(opt).from(clone).save().then(() => {
      if (loadingToast && loadingToast.parentNode) loadingToast.remove();
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      this.showToast('PDF已下载', 'success');
    }).catch((err) => {
      console.error('[导出PDF失败]', err);
      if (loadingToast && loadingToast.parentNode) loadingToast.remove();
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      this.showToast(`导出失败: ${err && err.message ? err.message : err}`, 'error');
    });
  }
};

/* ------------------------------------------------------------------
 * 启动应用
 * ---------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
