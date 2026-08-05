/* ==========================================================================
   XIN 信 · 搜索模块
   Ctrl+K 唤起搜索弹窗,前端检索 search-index.json
   ========================================================================== */

import { router } from './router.js';

const SEARCH_INDEX_URL = './assets/data/search-index.json';

/**
 * 搜索管理器
 * - 监听 Ctrl/Cmd+K 快捷键
 * - 加载搜索索引
 * - 前端关键词检索(支持标题、描述、路径模糊匹配)
 * - 显示分组结果,支持键盘导航
 */
export const search = {
  index: [],
  indexLoaded: false,
  modalEl: null,
  inputEl: null,
  resultsEl: null,
  currentResults: [],
  highlightedIndex: -1,

  /** 初始化搜索 */
  async init() {
    this.cacheElements();
    this.bindEvents();
    // 延迟加载索引(首次打开时加载)
  },

  /** 缓存 DOM 元素 */
  cacheElements() {
    this.modalEl = document.getElementById('search-modal');
    this.inputEl = document.getElementById('search-input');
    this.resultsEl = document.getElementById('search-results');
  },

  /** 绑定事件 */
  bindEvents() {
    // 快捷键 Ctrl/Cmd+K
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.open();
      }
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });

    // 点击搜索触发按钮
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('.search-trigger, [data-search-trigger]');
      if (trigger) {
        e.preventDefault();
        this.open();
      }
    });

    // 点击遮罩关闭
    if (this.modalEl) {
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl || e.target.closest('[data-close-modal]')) {
          this.close();
        }
      });
    }

    // 输入搜索
    if (this.inputEl) {
      this.inputEl.addEventListener('input', (e) => {
        this.performSearch(e.target.value.trim());
      });

      // 键盘导航
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.moveHighlight(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.moveHighlight(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.selectHighlighted();
        }
      });
    }
  },

  /** 是否打开 */
  isOpen() {
    return this.modalEl && this.modalEl.classList.contains('open');
  },

  /** 打开搜索弹窗 */
  async open() {
    if (!this.modalEl) {
      // 动态创建搜索弹窗
      this.createModal();
    }
    this.modalEl.classList.add('open');
    this.modalEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // 确保索引已加载
    if (!this.indexLoaded) {
      await this.loadIndex();
    }
    // 立即聚焦
    setTimeout(() => this.inputEl && this.inputEl.focus(), 50);
    // 显示全部(无搜索词时)
    if (this.inputEl && !this.inputEl.value) {
      this.performSearch('');
    }
  },

  /** 关闭搜索弹窗 */
  close() {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('open');
    this.modalEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (this.inputEl) this.inputEl.value = '';
    this.currentResults = [];
    this.highlightedIndex = -1;
  },

  /** 动态创建搜索弹窗(如果 HTML 中未提供) */
  createModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal search-modal" role="document">
        <div class="search-input-wrap">
          <svg class="search-input-wrap__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="search-input" class="search-input" placeholder="搜索文档、原型、技能..." autocomplete="off" />
          <span class="search-trigger__kbd">ESC</span>
        </div>
        <div class="search-results" id="search-results"></div>
      </div>
    `;
    document.body.appendChild(modal);
    this.modalEl = modal;
    this.inputEl = modal.querySelector('#search-input');
    this.resultsEl = modal.querySelector('#search-results');
    this.bindEvents();
  },

  /** 加载搜索索引 */
  async loadIndex() {
    try {
      const res = await fetch(SEARCH_INDEX_URL);
      if (!res.ok) throw new Error('索引加载失败');
      this.index = await res.json();
      this.indexLoaded = true;
    } catch (err) {
      console.warn('[Search] 索引加载失败,使用内置索引:', err);
      // 使用内置索引兜底
      this.index = this.getFallbackIndex();
      this.indexLoaded = true;
    }
  },

  /** 兜底搜索索引 */
  getFallbackIndex() {
    return [
      { type: 'page', title: '首页', desc: 'XIN 信首页', path: '#/', category: '页面' },
      { type: 'page', title: '需求文档', desc: '12 个需求模块', path: '#/docs/requirements/overview', category: '文档' },
      { type: 'page', title: '技术架构', desc: '10 个架构章节', path: '#/docs/architecture/overview', category: '文档' },
      { type: 'page', title: '产品原型', desc: '高保真原型界面', path: '#/prototype/workspace', category: '原型' },
      { type: 'page', title: '通用组件', desc: '组件样式示例', path: 'shared/components.html', category: '页面' }
    ];
  },

  /** 执行搜索 */
  performSearch(query) {
    if (!this.resultsEl) return;
    if (!query) {
      // 显示推荐结果
      this.currentResults = this.index.slice(0, 8);
    } else {
      const q = query.toLowerCase();
      this.currentResults = this.index
        .filter((item) => {
          const title = (item.title || '').toLowerCase();
          const desc = (item.desc || '').toLowerCase();
          const path = (item.path || '').toLowerCase();
          const keywords = (item.keywords || '').toLowerCase();
          return title.includes(q) || desc.includes(q) || path.includes(q) || keywords.includes(q);
        })
        .slice(0, 12);
    }
    this.highlightedIndex = this.currentResults.length ? 0 : -1;
    this.renderResults();
  },

  /** 渲染搜索结果 */
  renderResults() {
    if (!this.resultsEl) return;
    if (!this.currentResults.length) {
      this.resultsEl.innerHTML = `
        <div class="search-empty">
          <div style="font-size:32px;margin-bottom:8px;opacity:0.4;">🔍</div>
          <div>没有找到相关内容</div>
        </div>`;
      return;
    }

    // 按分类分组
    const groups = {};
    this.currentResults.forEach((item) => {
      const cat = item.category || '其他';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });

    let html = '';
    Object.entries(groups).forEach(([cat, items]) => {
      html += `<div class="search-result-group__label">${cat}</div>`;
      items.forEach((item, idx) => {
        const globalIdx = this.currentResults.indexOf(item);
        const icon = this.getIconForType(item.type);
        html += `
          <a href="${item.path}" class="search-result-item${globalIdx === this.highlightedIndex ? ' highlighted' : ''}" data-idx="${globalIdx}">
            <div class="search-result-item__icon">${icon}</div>
            <div style="flex:1;min-width:0;">
              <div class="search-result-item__title">${this.escape(item.title)}</div>
              <div class="search-result-item__desc">${this.escape(item.desc || '')}</div>
            </div>
            <div class="search-result-item__path">${this.escape(item.path)}</div>
          </a>`;
      });
    });
    this.resultsEl.innerHTML = html;

    // 绑定点击关闭
    this.resultsEl.querySelectorAll('.search-result-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.close();
      });
    });
  },

  /** 移动高亮项 */
  moveHighlight(direction) {
    if (!this.currentResults.length) return;
    this.highlightedIndex += direction;
    if (this.highlightedIndex < 0) this.highlightedIndex = this.currentResults.length - 1;
    if (this.highlightedIndex >= this.currentResults.length) this.highlightedIndex = 0;
    this.renderResults();
    // 滚动到视图
    const el = this.resultsEl.querySelector('.highlighted');
    if (el) el.scrollIntoView({ block: 'nearest' });
  },

  /** 选中当前高亮项 */
  selectHighlighted() {
    if (this.highlightedIndex < 0 || !this.currentResults[this.highlightedIndex]) return;
    const item = this.currentResults[this.highlightedIndex];
    this.close();
    if (item.path && item.path.startsWith('#')) {
      router.go(item.path);
    } else if (item.path) {
      window.location.href = item.path;
    }
  },

  /** 根据类型返回图标 */
  getIconForType(type) {
    const map = {
      page: '📄',
      doc: '📚',
      prototype: '🎯',
      skill: '⚡',
      expert: '🤖',
      mcp: '🔌',
      glossary: '📖',
      roadmap: '🚀'
    };
    return map[type] || '📄';
  },

  /** HTML 转义 */
  escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

export default search;
