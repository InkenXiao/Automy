/* ==========================================================================
   XIN 信 · 主题切换模块
   支持 深色/浅色 模式,localStorage 持久化,默认浅色
   ========================================================================== */

const THEME_STORAGE_KEY = 'automy-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

/**
 * 主题管理器
 * 通过在 <html> 上设置 data-theme 属性切换主题
 * 所有 CSS 变量在 style.css 中根据 data-theme 属性变化
 */
export const theme = {
  current: THEME_LIGHT,

  /**
   * 初始化主题
   * 1. 读取 localStorage,若不存在则默认浅色
   * 2. 应用主题到 <html> 元素
   * 3. 绑定切换按钮事件
   */
  init() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    this.current = saved === THEME_DARK ? THEME_DARK : THEME_LIGHT;
    this.apply();

    // 监听主题切换按钮(所有带 .theme-toggle 的元素)
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('.theme-toggle');
      if (toggle) {
        e.preventDefault();
        this.toggle();
      }
    });

    // 监听系统主题变化(仅当用户未手动选择时)
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_STORAGE_KEY)) {
          this.current = e.matches ? THEME_DARK : THEME_LIGHT;
          this.apply();
        }
      });
    }
  },

  /** 应用当前主题到 DOM */
  apply() {
    document.documentElement.setAttribute('data-theme', this.current);
    this.updateToggleButtons();
  },

  /** 切换主题 */
  toggle() {
    this.current = this.current === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    localStorage.setItem(THEME_STORAGE_KEY, this.current);
    this.apply();
  },

  /** 设置指定主题 */
  set(themeName) {
    this.current = themeName === THEME_DARK ? THEME_DARK : THEME_LIGHT;
    localStorage.setItem(THEME_STORAGE_KEY, this.current);
    this.apply();
  },

  /** 更新切换按钮的图标显示 */
  updateToggleButtons() {
    const buttons = document.querySelectorAll('.theme-toggle');
    const isDark = this.current === THEME_DARK;
    buttons.forEach((btn) => {
      btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
      // 更新图标 (太阳/月亮)
      const iconHolder = btn.querySelector('.theme-toggle__icon');
      if (iconHolder) {
        iconHolder.innerHTML = isDark
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      }
    });
  }
};

// 在脚本加载时立即应用主题,避免 FOUC(闪烁)
// 在 <head> 中通过 inline script 提前执行,这里仅作为兜底
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === THEME_DARK) {
    document.documentElement.setAttribute('data-theme', THEME_DARK);
  }
}

export default theme;
