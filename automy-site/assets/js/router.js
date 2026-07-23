/* ==========================================================================
   XIN 信 · 路由模块
   基于 Hash 的前端路由,支持懒加载页面内容
   路由格式: #/docs/requirements/overview, #/prototype/workspace 等
   ========================================================================== */

/**
 * 简单的 Hash 路由器
 * - 监听 hashchange 事件
 * - 支持注册路由模式(支持 :param 占位符)
 * - 支持 404 回退
 * - 支持懒加载页面内容(从独立 HTML 文件加载)
 */
export const router = {
  routes: [],
  notFoundHandler: null,
  currentRoute: null,

  /** 注册路由 */
  register(pattern, handler) {
    // 将 /docs/:type/:name 转换为正则
    const paramNames = [];
    const regexPattern = pattern
      .replace(/\/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return '/([^/]+)';
      })
      .replace(/\//g, '\\/');
    this.routes.push({
      pattern,
      regex: new RegExp(`^${regexPattern}$`),
      paramNames,
      handler
    });
  },

  /** 注册 404 处理 */
  notFound(handler) {
    this.notFoundHandler = handler;
  },

  /** 启动路由监听 */
  start() {
    window.addEventListener('hashchange', () => this.handle());
    window.addEventListener('load', () => this.handle());
    // 首次手动触发
    this.handle();
  },

  /** 解析当前 hash 为路径 */
  parseHash() {
    let hash = window.location.hash || '#/';
    if (hash.startsWith('#')) hash = hash.slice(1);
    if (!hash.startsWith('/')) hash = '/' + hash;
    return hash;
  },

  /** 处理当前 hash */
  async handle() {
    const path = this.parseHash();
    let matched = false;

    for (const route of this.routes) {
      const match = path.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1] || '');
        });
        this.currentRoute = { path, params, route };
        try {
          await route.handler(params, path);
          matched = true;
          // 更新顶栏导航高亮
          this.updateNavActive(path);
        } catch (err) {
          console.error('[Router] 路由处理失败:', err);
          if (this.notFoundHandler) this.notFoundHandler(path);
        }
        break;
      }
    }

    if (!matched && this.notFoundHandler) {
      this.notFoundHandler(path);
    }
  },

  /** 跳转到指定路径 */
  go(path) {
    if (!path.startsWith('#')) path = '#' + (path.startsWith('/') ? path : '/' + path);
    window.location.hash = path;
  },

  /**
   * 重新渲染容器内的 mermaid 图表
   * 动态加载的 HTML 不会触发 mermaid 的 startOnLoad，需手动调用
   */
  _initMermaid(container) {
    const mermaidBlocks = container.querySelectorAll('.mermaid');
    if (mermaidBlocks.length === 0) return;
    // 跳过已渲染的块（含 svg 子元素）
    const unrendered = Array.from(mermaidBlocks).filter((el) => !el.querySelector('svg'));
    if (unrendered.length === 0) return;

    const runMermaid = () => {
      try {
        window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
        window.mermaid.run({ nodes: unrendered });
      } catch (e) { console.error('[Mermaid] 渲染失败:', e); }
    };

    if (window.mermaid) {
      runMermaid();
    } else {
      // 检查是否已有 mermaid 脚本正在加载
      let script = document.querySelector('script[src*="mermaid"]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        document.head.appendChild(script);
      }
      // 脚本加载完成后执行渲染
      const onLoad = () => { if (window.mermaid) runMermaid(); };
      if (script.readyState) {
        script.onreadystatechange = onLoad;
      } else {
        script.onload = onLoad;
      }
      // 如果脚本已经加载完成（缓存）
      if (window.mermaid) runMermaid();
    }
  },

  /** 更新顶栏导航当前项高亮 */
  updateNavActive(path) {
    const navItems = document.querySelectorAll('.topbar__nav .nav-item, .mobile-menu .nav-item');
    navItems.forEach((item) => {
      const href = item.getAttribute('href') || '';
      const hash = href.startsWith('#') ? href.slice(1) : href;
      // 主导航的高亮规则
      let isActive = false;
      if (hash === '/' && (path === '/' || path === '')) {
        isActive = true;
      } else if (hash !== '/' && path.startsWith(hash)) {
        isActive = true;
      }
      item.classList.toggle('active', isActive);
    });
  },

  /**
   * 从外部 HTML 文件懒加载内容到容器
   * @param {string} url - HTML 文件相对路径
   * @param {HTMLElement} container - 容器元素
   * @returns {Promise<boolean>} 是否成功
   */
  async loadPage(url, container) {
    if (!container) return false;
    try {
      container.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
      const response = await fetch(url);
      if (!response.ok) throw new Error(`加载失败: ${response.status}`);
      const html = await response.text();
      // 提取 body 内容(简单处理)
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const content = bodyMatch ? bodyMatch[1] : html;
      // 提取并执行 script 标签
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;
      // 移除 script 后插入 DOM
      const scripts = tempDiv.querySelectorAll('script');
      scripts.forEach((s) => s.remove());
      container.innerHTML = tempDiv.innerHTML;
      // 重新执行 script
      scripts.forEach((oldScript) => {
        const newScript = document.createElement('script');
        for (const attr of oldScript.attributes) {
          newScript.setAttribute(attr.name, attr.value);
        }
        newScript.textContent = oldScript.textContent;
        container.appendChild(newScript);
      });
      // 重新渲染 mermaid 图表（动态加载的页面不会触发 auto-init）
      this._initMermaid(container);
      return true;
    } catch (err) {
      console.error('[Router] 加载页面失败:', url, err);
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">⚠</div>
          <div class="empty-state__title">页面加载失败</div>
          <div class="empty-state__desc">无法加载页面内容,请检查路径或网络后重试。</div>
          <a href="#/" class="btn btn-primary">返回首页</a>
        </div>`;
      return false;
    }
  }
};

export default router;
