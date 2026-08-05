/* ==========================================================================
   XIN 信 · 记忆管理模块
   提供 Agent 记忆的浏览、搜索过滤、删除与统计能力,
   对应 CoWork 的记忆管理页面
   ========================================================================== */

import { agentApi } from './agent-api.js';
import { agentUI } from './agent-ui.js';

/**
 * 记忆管理对象
 */
export const memoryStore = {
  /** 当前容器元素 */
  container: null,
  /** 当前选中的 Agent ID */
  agentId: null,
  /** 当前记忆类型过滤 */
  type: '',
  /** 当前搜索关键词 */
  keyword: '',
  /** 已加载的记忆列表(用于前端过滤) */
  memories: [],

  /**
   * 初始化记忆管理页
   * @param {HTMLElement} container - 容器元素
   */
  async init(container) {
    this.container = container;
    this.keyword = '';
    this.type = '';
    // 渲染页面骨架(Agent 选择器 + 类型筛选 + 搜索框 + 列表区)
    container.innerHTML = `
      <div class="cowork-page-header"><h2>记忆管理</h2></div>
      <div class="memory-toolbar">
        <select id="memory-agent-select" class="form__input">
          <option value="">请选择 Agent</option>
        </select>
        <select id="memory-type-select" class="form__input">
          <option value="">全部类型</option>
          <option value="long_term">长期记忆</option>
          <option value="short_term">短期记忆</option>
          <option value="profile">用户画像</option>
          <option value="preference">偏好</option>
        </select>
        <input type="text" id="memory-search-input" class="form__input" placeholder="搜索记忆内容...">
      </div>
      <div id="memory-stats"></div>
      <div id="memory-list"><div class="text-muted">请先选择 Agent。</div></div>`;

    // 加载 Agent 列表填充选择器
    try {
      const agents = await agentApi.getAgents();
      const select = container.querySelector('#memory-agent-select');
      agents.forEach((a) => {
        const option = document.createElement('option');
        option.value = a.id;
        option.textContent = a.name || `Agent #${a.id}`;
        select.appendChild(option);
      });
    } catch (err) {
      console.error('[MemoryStore] 加载 Agent 列表失败:', err);
    }

    // 绑定筛选与搜索事件
    container.querySelector('#memory-agent-select').addEventListener('change', (e) => {
      this.agentId = e.target.value || null;
      this.loadMemories(this.agentId, this.type);
    });
    container.querySelector('#memory-type-select').addEventListener('change', (e) => {
      this.type = e.target.value;
      this.loadMemories(this.agentId, this.type);
    });
    container.querySelector('#memory-search-input').addEventListener('input', (e) => {
      this.filterMemories(e.target.value);
    });
  },

  /**
   * 加载记忆列表
   * @param {string|number} agentId - Agent ID
   * @param {string} [type] - 记忆类型过滤
   */
  async loadMemories(agentId, type) {
    if (!this.container) return;
    const listEl = this.container.querySelector('#memory-list');
    if (!agentId) {
      listEl.innerHTML = '<div class="text-muted">请先选择 Agent。</div>';
      return;
    }
    this.agentId = agentId;
    this.type = type || '';
    listEl.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
    try {
      this.memories = await agentApi.getMemories(agentId, this.type || undefined);
      this.keyword = '';
      const searchInput = this.container.querySelector('#memory-search-input');
      if (searchInput) searchInput.value = '';
      this.renderMemoryStats(this.memories);
      this.renderMemoryList(this.memories, listEl);
    } catch (err) {
      console.error('[MemoryStore] 加载记忆失败:', err);
      listEl.innerHTML = `<div class="alert alert-error">加载失败: ${this._escape(err.message)}</div>`;
    }
  },

  /**
   * 渲染记忆列表
   * @param {Array} memories - 记忆列表
   * @param {HTMLElement} container - 容器元素
   */
  renderMemoryList(memories, container) {
    if (!container) return;
    if (!Array.isArray(memories) || memories.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🧠</div>
          <div class="empty-state__title">暂无记忆</div>
          <div class="empty-state__desc">该 Agent 在当前筛选条件下没有记忆记录。</div>
        </div>`;
      return;
    }
    // 优先使用 agentUI 的通用渲染能力
    if (agentUI && typeof agentUI.renderMemoryList === 'function') {
      agentUI.renderMemoryList(memories, container);
      return;
    }
    container.innerHTML = memories.map(m => `
      <div class="memory-item" data-memory-id="${m.id}">
        <div class="memory-item__header">
          <span class="memory-item__type badge">${this._escape(m.type || '未分类')}</span>
          <span class="memory-item__time text-muted">${this._escape(m.created_at || '')}</span>
          <button class="btn btn-ghost btn-sm memory-item__delete" data-memory-id="${m.id}">删除</button>
        </div>
        <div class="memory-item__content">${this._escape(m.content || m.value || '')}</div>
      </div>`).join('');

    // 绑定删除按钮事件
    container.querySelectorAll('.memory-item__delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.deleteMemory(this.agentId, btn.dataset.memoryId);
      });
    });
  },

  /**
   * 搜索过滤记忆(前端过滤已加载的列表)
   * @param {string} keyword - 搜索关键词
   */
  filterMemories(keyword) {
    this.keyword = (keyword || '').trim().toLowerCase();
    const listEl = this.container?.querySelector('#memory-list');
    if (!listEl) return;
    // 无关键词时显示全部
    if (!this.keyword) {
      this.renderMemoryList(this.memories, listEl);
      return;
    }
    // 按内容/类型匹配过滤
    const filtered = this.memories.filter((m) => {
      const text = `${m.content || ''} ${m.value || ''} ${m.type || ''}`.toLowerCase();
      return text.includes(this.keyword);
    });
    this.renderMemoryList(filtered, listEl);
  },

  /**
   * 删除记忆
   * @param {string|number} agentId - Agent ID
   * @param {string|number} memoryId - 记忆 ID
   */
  async deleteMemory(agentId, memoryId) {
    if (!confirm('确定删除这条记忆吗?删除后不可恢复。')) return;
    try {
      await agentApi.deleteMemory(agentId, memoryId);
      // 从本地列表移除并重新渲染
      this.memories = this.memories.filter((m) => String(m.id) !== String(memoryId));
      this.renderMemoryStats(this.memories);
      const listEl = this.container?.querySelector('#memory-list');
      if (listEl) this.renderMemoryList(this.memories, listEl);
    } catch (err) {
      console.error('[MemoryStore] 删除记忆失败:', err);
      alert('删除失败: ' + err.message);
    }
  },

  /**
   * 渲染记忆统计
   * @param {Array} memories - 记忆列表
   */
  renderMemoryStats(memories) {
    const statsEl = this.container?.querySelector('#memory-stats');
    if (!statsEl) return;
    // 按类型统计数量
    const byType = {};
    (memories || []).forEach((m) => {
      const t = m.type || '未分类';
      byType[t] = (byType[t] || 0) + 1;
    });
    statsEl.innerHTML = `
      <div class="memory-stats">
        <span class="memory-stats__total">共 ${(memories || []).length} 条记忆</span>
        ${Object.entries(byType).map(([type, count]) => `
          <span class="badge">${this._escape(type)}: ${count}</span>`).join('')}
      </div>`;
  },

  /** HTML 转义 */
  _escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

export default memoryStore;
