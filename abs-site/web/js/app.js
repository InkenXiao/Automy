/* ==========================================================================
   艾宾浩斯背单词 · 主应用
   负责导航、全局状态、右栏面板、Toast、工具函数、API 封装
   ========================================================================== */

/* ------------------------------------------------------------------
   API 请求封装
   所有后端接口在 /api 前缀下
   ------------------------------------------------------------------ */
const API = {
  baseUrl: '/api',

  /** 通用请求方法 */
  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    };
    const config = { ...options, headers };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        let errorMessage = `请求失败 (${response.status})`;
        try {
          const errBody = await response.json();
          errorMessage = errBody.message || errBody.detail || errBody.error || errorMessage;
        } catch (e) { /* 非 JSON 错误体 */ }
        const error = new Error(errorMessage);
        error.status = response.status;
        throw error;
      }

      if (response.status === 204) return null;

      const text = await response.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (err) {
      if (err instanceof TypeError) {
        throw new Error('网络连接失败,请检查后端服务是否启动');
      }
      throw err;
    }
  },

  /** GET 请求 */
  async get(url) { return this.request(url); },

  /** POST 请求 */
  async post(url, data) {
    return this.request(url, { method: 'POST', body: JSON.stringify(data) });
  },

  /** PUT 请求 */
  async put(url, data) {
    return this.request(url, { method: 'PUT', body: JSON.stringify(data) });
  },

  /** DELETE 请求 */
  async del(url) {
    return this.request(url, { method: 'DELETE' });
  }
};

/* ------------------------------------------------------------------
   主应用
   ------------------------------------------------------------------ */
const App = {
  state: {
    currentView: 'dashboard'
  },

  /** 初始化 */
  async init() {
    this.bindNav();
    this.createToastContainer();

    // 初始化各页面模块
    Dashboard.init();
    Words.init();
    Review.init();
    Learn.init();
    Stubborn.init();

    // 默认展示仪表盘
    this.switchView('dashboard');
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
  switchView(name) {
    this.state.currentView = name;

    // 切换导航高亮
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-view') === name);
    });

    // 切换视图容器显示
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    const target = document.getElementById(`view-${name}`);
    if (target) target.classList.add('active');

    // 触发对应模块的 onShow 回调
    const modules = { dashboard: Dashboard, words: Words, review: Review, learn: Learn, stubborn: Stubborn };
    const mod = modules[name];
    if (mod && typeof mod.onShow === 'function') {
      try { mod.onShow(); } catch (err) { console.error(err); }
    }

    // 切换视图时清空右栏
    this.clearDetail();
  },

  /* ------------------------------------------------------------------
     右栏详情面板
     ---------------------------------------------------------------- */
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
    panel.innerHTML = '<div class="detail-empty">点击单词查看详情</div>';
  },

  /* ------------------------------------------------------------------
     Toast
     ---------------------------------------------------------------- */
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
     工具函数
     ---------------------------------------------------------------- */
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
     PDF 导出 (基于 html2pdf.js)
     ---------------------------------------------------------------- */
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

    // 显示 loading
    const loadingToast = this.showToast('正在生成PDF...', 'info', 60000);

    // 克隆元素到离屏容器, 避免影响原布局
    const clone = element.cloneNode(true);
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1;background:#ffffff;';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    clone.style.width = (element.scrollWidth || element.offsetWidth || 1000) + 'px';
    clone.style.boxSizing = 'border-box';
    clone.style.margin = '0';

    if (prepareClone) {
      try { prepareClone(clone); } catch (e) { /* 忽略准备阶段错误 */ }
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
      if (loadingToast && loadingToast.parentNode) loadingToast.remove();
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      this.showToast(`导出失败: ${err && err.message ? err.message : err}`, 'error');
    });
  }
};

/* ------------------------------------------------------------------
   启动应用
   ---------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
