/* ==========================================================================
   XIN CoWork · 应用主入口
   初始化路由、主题、搜索、顶栏、原型交互、CoWork 工作台
   ========================================================================== */

import { theme } from './theme.js';
import { router } from './router.js';
import { search } from './search.js';
import { prototype, annotationMode } from './prototype.js';
import { cowork } from './cowork.js';

/**
 * 应用主对象
 * 在 DOMContentLoaded 后初始化所有模块
 */
const app = {
  /** 主内容容器 */
  contentEl: null,

  /** 初始化应用 */
  async init() {
    // 在 DOMContentLoaded 之前提前应用主题
    theme.init();
    // 等待 DOM 就绪
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.boot());
    } else {
      this.boot();
    }
  },

  /** 启动各模块 */
  boot() {
    this.contentEl = document.getElementById('app-content') || document.getElementById('main-content');
    this.injectTopbar();
    this.injectFooter();
    this.injectSearchModal();
    this.registerRoutes();
    this.bindTopbar();
    search.init();
    prototype.init();
    annotationMode.init();
    cowork.init();
    // 路由变化时重新渲染标注面板
    window.addEventListener('hashchange', () => annotationMode.renderAnnotationPanel());
    router.start();
    // 初始渲染标注面板(处理首次加载)
    annotationMode.renderAnnotationPanel();
    // 标记已加载
    document.documentElement.classList.add('app-ready');
  },

  /** 注册路由 */
  registerRoutes() {
    // 首页 - 不需要加载,直接显示首页内容
    router.register('/', (params, path) => {
      this.showHome();
    });
    router.register('', (params, path) => {
      this.showHome();
    });

    // CoWork 工作台路由 (由 cowork.js 处理)
    cowork.registerRoutes(router);

    // 需求文档
    router.register('/docs/requirements/:module', async (params) => {
      const module = params.module || 'overview';
      await this.loadDocPage(`docs/requirements/${module}.html`, '需求文档', 'requirements', module);
    });

    // 技术架构
    router.register('/docs/architecture/:chapter', async (params) => {
      const chapter = params.chapter || 'overview';
      await this.loadDocPage(`docs/architecture/${chapter}.html`, '技术架构', 'architecture', chapter);
    });

    // 产品原型 - 子页面 (如 skill-market/detail)
    router.register('/prototype/:section/:subsection', async (params) => {
      const { section, subsection } = params;
      await this.loadPrototypePage(`prototype/${section}/${subsection}.html`, `${section}/${subsection}`);
    });

    // 产品原型 - 主页面
    router.register('/prototype/:section', async (params) => {
      const section = params.section || 'workspace';
      await this.loadPrototypePage(`prototype/${section}/index.html`, section);
    });

    // 路线图
    router.register('/roadmap', async () => {
      await this.loadDocPage('docs/roadmap.html', '路线图', 'roadmap', 'roadmap');
    });

    // 术语表
    router.register('/glossary', async () => {
      await this.loadDocPage('docs/glossary.html', '术语表', 'glossary', 'glossary');
    });

    // 404
    router.notFound((path) => {
      if (path === '/' || path === '') {
        this.showHome();
      } else {
        this.showNotFound(path);
      }
    });
  },

  /** 显示首页 (默认隐藏 SPA 内容容器,显示静态首页) */
  showHome() {
    if (this.contentEl) {
      this.contentEl.classList.add('hidden');
    }
    const home = document.getElementById('home-page');
    if (home) {
      home.classList.remove('hidden');
      home.style.display = '';
    }
    window.scrollTo(0, 0);
    document.title = 'XIN 信 · 企业级自主智能体平台';
  },

  /** 隐藏首页,显示 SPA 容器 */
  showAppContent() {
    const home = document.getElementById('home-page');
    if (home) home.classList.add('hidden');
    if (this.contentEl) {
      this.contentEl.classList.remove('hidden');
      this.contentEl.style.display = '';
    }
    window.scrollTo(0, 0);
  },

  /** 加载文档页面 */
  async loadDocPage(url, category, group, current) {
    this.showAppContent();
    if (!this.contentEl) return;
    // 包装在文档布局中
    this.contentEl.innerHTML = `
      <div class="container">
        <div class="docs-layout">
          <aside class="docs-layout__sidebar" id="docs-sidebar"></aside>
          <main class="docs-layout__main">
            <div id="doc-content" class="prose">
              <div class="spinner-center"><div class="spinner"></div></div>
            </div>
          </main>
        </div>
      </div>`;
    // 加载侧边栏
    this.renderDocsSidebar(group, current);
    // 加载文档内容
    const docContent = document.getElementById('doc-content');
    await router.loadPage(url, docContent);
    document.title = `${category} · XIN`;
  },

  /** 加载原型页面 */
  async loadPrototypePage(url, section) {
    this.showAppContent();
    if (!this.contentEl) return;
    this.contentEl.innerHTML = `<div class="prototype-shell">
      <div class="prototype-banner">
        <span class="prototype-banner__icon">🎨</span>
        <span>这是产品原型界面,用于展示交互效果与设计概念,非最终生产版本。</span>
      </div>
      <div id="prototype-content" style="min-height:600px;">
        <div class="spinner-center"><div class="spinner"></div></div>
      </div>
    </div>`;
    const protoContent = document.getElementById('prototype-content');
    await router.loadPage(url, protoContent);
    document.title = `原型 · ${section} · XIN`;
  },

  /** 渲染文档侧边栏 */
  renderDocsSidebar(group, current) {
    const sidebar = document.getElementById('docs-sidebar');
    if (!sidebar) return;
    const sidebarEl = document.createElement('div');
    sidebarEl.className = 'sidebar';

    if (group === 'requirements') {
      sidebarEl.innerHTML = this.getRequirementsSidebar(current);
    } else if (group === 'architecture') {
      sidebarEl.innerHTML = this.getArchitectureSidebar(current);
    } else {
      sidebarEl.innerHTML = this.getDefaultSidebar(current);
    }
    sidebar.innerHTML = '';
    sidebar.appendChild(sidebarEl);
  },

  /** 需求文档侧边栏 */
  getRequirementsSidebar(current) {
    const modules = [
      { id: 'overview', name: '总览', icon: '📋' },
      { id: 'companion', name: '长期陪伴与记忆', icon: '🤝' },
      { id: 'skill-market', name: '技能市场', icon: '⚡' },
      { id: 'expert-market', name: '专家 Agent 市场', icon: '🤖' },
      { id: 'mcp-integration', name: 'MCP 服务集成', icon: '🔌' },
      { id: 'workspace', name: '工作台与会话', icon: '💼' },
      { id: 'knowledge', name: '知识与文档库', icon: '📚' },
      { id: 'security-audit', name: '安全合规与审计', icon: '🛡' },
      { id: 'auth-rbac', name: '身份与权限', icon: '🔐' },
      { id: 'admin', name: '平台管理后台', icon: '⚙' },
      { id: 'profile', name: '用户中心', icon: '👤' },
      { id: 'integration', name: '第三方集成', icon: '🔗' }
    ];
    return `
      <div class="sidebar__group">
        <div class="sidebar__title">需求文档</div>
        ${modules.map(m => `
          <a href="#/docs/requirements/${m.id}" class="sidebar-item ${current === m.id ? 'active' : ''}">
            <span>${m.icon}</span>
            <span>${m.name}</span>
          </a>`).join('')}
      </div>`;
  },

  /** 技术架构侧边栏 */
  getArchitectureSidebar(current) {
    const chapters = [
      { id: 'architecture-goals', name: '架构目标', icon: '🎯' },
      { id: 'overview', name: '架构总览', icon: '🏛' },
      { id: 'system-design', name: '系统设计与分层', icon: '🏗' },
      { id: 'agent-runtime', name: '智能体运行时 (Eino ADK)', icon: '⚙' },
      { id: 'memory-system', name: '记忆系统设计', icon: '🧠' },
      { id: 'skill-system', name: '技能系统设计', icon: '⚡' },
      { id: 'mcp-protocol', name: 'MCP 协议与接入', icon: '🔌' },
      { id: 'knowledge-base', name: '知识库与 RAG', icon: '📚' },
      { id: 'session-store', name: '会话数据库设计', icon: '🗂' },
      { id: 'im-channels', name: 'IM 通道集成架构', icon: '📢' },
      { id: 'security', name: '安全与合规', icon: '🛡' },
      { id: 'data-model', name: '数据模型与存储', icon: '🗄' },
      { id: 'deployment', name: '部署与运维', icon: '☁' }
    ];
    return `
      <div class="sidebar__group">
        <div class="sidebar__title">技术架构</div>
        ${chapters.map(c => `
          <a href="#/docs/architecture/${c.id}" class="sidebar-item ${current === c.id ? 'active' : ''}">
            <span>${c.icon}</span>
            <span>${c.name}</span>
          </a>`).join('')}
      </div>`;
  },

  /** 默认侧边栏 */
  getDefaultSidebar(current) {
    return `
      <div class="sidebar__group">
        <div class="sidebar__title">导航</div>
        <a href="#/" class="sidebar-item"><span>🏠</span><span>首页</span></a>
        <a href="#/docs/requirements/overview" class="sidebar-item"><span>📋</span><span>需求文档</span></a>
        <a href="#/docs/architecture/overview" class="sidebar-item"><span>🏛</span><span>技术架构</span></a>
        <a href="#/prototype/workspace" class="sidebar-item"><span>🎯</span><span>产品原型</span></a>
        <a href="#/roadmap" class="sidebar-item ${current === 'roadmap' ? 'active' : ''}"><span>🚀</span><span>路线图</span></a>
        <a href="#/glossary" class="sidebar-item ${current === 'glossary' ? 'active' : ''}"><span>📖</span><span>术语表</span></a>
      </div>`;
  },

  /** 显示 404 */
  showNotFound(path) {
    this.showAppContent();
    if (!this.contentEl) return;
    this.contentEl.innerHTML = `
      <div class="container">
        <div class="empty-state" style="padding:120px 0;">
          <div class="empty-state__icon" style="width:80px;height:80px;font-size:36px;">404</div>
          <div class="empty-state__title" style="font-size:24px;">页面不存在</div>
          <div class="empty-state__desc">您访问的路径 <code>${this.escape(path)}</code> 不存在或已迁移。</div>
          <div style="display:flex;gap:12px;">
            <a href="#/" class="btn btn-primary">返回首页</a>
            <button class="btn btn-ghost" onclick="window.history.back()">返回上一页</button>
          </div>
        </div>
      </div>`;
    document.title = '404 · 页面不存在 · XIN';
  },

  /** 注入顶栏 */
  injectTopbar() {
    // 如果页面已包含顶栏则跳过
    if (document.querySelector('.topbar')) return;
    const topbarHTML = `
      <header class="topbar">
        <div class="topbar__inner">
          <a href="#/" class="logo" aria-label="XIN 首页">
            <span class="logo__mark">X</span>
            <span class="logo__text">XIN</span>
          </a>
          <nav class="topbar__nav" aria-label="主导航">
            <a href="#/" class="nav-item">首页</a>
            <a href="#/docs/requirements/overview" class="nav-item">需求文档</a>
            <a href="#/docs/architecture/overview" class="nav-item">技术架构</a>
            <a href="#/prototype/workspace" class="nav-item">产品原型</a>
            <a href="#/roadmap" class="nav-item">路线图</a>
            <a href="#/glossary" class="nav-item">术语表</a>
          </nav>
          <div class="topbar__actions">
            <button class="search-trigger" type="button" aria-label="搜索 (Ctrl+K)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span class="search-trigger__text">搜索文档...</span>
              <span class="search-trigger__kbd">Ctrl K</span>
            </button>
            <button class="annotation-toggle" title="标注模式" aria-label="切换标注模式" aria-pressed="false">📌</button>
            <button class="theme-toggle" type="button" aria-label="切换主题">
              <span class="theme-toggle__icon"></span>
            </button>
            <button class="menu-toggle" type="button" aria-label="菜单" aria-expanded="false">
              <span class="menu-toggle__line"></span>
            </button>
          </div>
        </div>
      </header>
      <div class="mobile-menu" id="mobile-menu">
        <a href="#/" class="nav-item">首页</a>
        <a href="#/docs/requirements/overview" class="nav-item">需求文档</a>
        <a href="#/docs/architecture/overview" class="nav-item">技术架构</a>
        <a href="#/prototype/workspace" class="nav-item">产品原型</a>
        <a href="#/roadmap" class="nav-item">路线图</a>
        <a href="#/glossary" class="nav-item">术语表</a>
      </div>`;
    const body = document.body;
    body.insertAdjacentHTML('afterbegin', topbarHTML);
  },

  /** 注入页脚 */
  injectFooter() {
    if (document.querySelector('.site-footer')) return;
    // 只在首页注入(其他页面通过加载内容包含)
    const home = document.getElementById('home-page');
    if (!home) return;
    const footerHTML = `
      <footer class="footer site-footer">
        <div class="container">
          <div class="footer__grid">
            <div>
              <a href="#/" class="logo">
                <span class="logo__mark">X</span>
                <span class="logo__text">XIN</span>
              </a>
              <p class="footer__brand-desc">企业级自主智能体平台,面向投资公司内部使用。让 AI 成为每位员工的长期伙伴,沉淀技能与专家生态。</p>
            </div>
            <div>
              <div class="footer__col-title">产品</div>
              <ul class="footer__list">
                <li><a href="#/prototype/workspace">工作台</a></li>
                <li><a href="#/prototype/skill-market">技能市场</a></li>
                <li><a href="#/prototype/expert-market">专家市场</a></li>
                <li><a href="#/prototype/mcp">MCP 集成</a></li>
              </ul>
            </div>
            <div>
              <div class="footer__col-title">文档</div>
              <ul class="footer__list">
                <li><a href="#/docs/requirements/overview">需求文档</a></li>
                <li><a href="#/docs/architecture/overview">技术架构</a></li>
                <li><a href="#/roadmap">路线图</a></li>
                <li><a href="#/glossary">术语表</a></li>
              </ul>
            </div>
            <div>
              <div class="footer__col-title">资源</div>
              <ul class="footer__list">
                <li><a href="shared/components.html">组件库</a></li>
                <li><a href="#/prototype/admin">管理后台</a></li>
                <li><a href="#/prototype/profile">用户中心</a></li>
              </ul>
            </div>
          </div>
          <div class="footer__bottom">
            <span>© 2026 XIN 信 · 企业级智能体平台 · 内部使用</span>
            <span>构建于 Vite + 原生 JS · 部署于 Cloudflare Pages</span>
          </div>
        </div>
      </footer>`;
    home.insertAdjacentHTML('beforeend', footerHTML);
  },

  /** 注入搜索弹窗 (骨架) */
  injectSearchModal() {
    if (document.getElementById('search-modal')) return;
    // search.js 会在 open() 时自动创建,这里不预先注入
  },

  /** 绑定顶栏交互 */
  bindTopbar() {
    // 汉堡菜单切换
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('.menu-toggle');
      if (toggle) {
        const menu = document.getElementById('mobile-menu');
        if (menu) {
          const isOpen = menu.classList.toggle('open');
          toggle.setAttribute('aria-expanded', String(isOpen));
        }
      } else if (!e.target.closest('.mobile-menu') && !e.target.closest('.menu-toggle')) {
        // 点击外部关闭移动菜单
        const menu = document.getElementById('mobile-menu');
        const toggle = document.querySelector('.menu-toggle');
        if (menu && menu.classList.contains('open')) {
          menu.classList.remove('open');
          if (toggle) toggle.setAttribute('aria-expanded', 'false');
        }
      }
    });
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

// 启动应用
app.init();

export default app;
