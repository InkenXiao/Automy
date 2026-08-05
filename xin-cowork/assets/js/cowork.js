/* ==========================================================================
   XIN 信 · CoWork 主控制器
   CoWork 模块入口,负责注册 /cowork/* 路由、渲染三栏布局骨架
   (左侧导航 + 中间内容 + 右侧面板),并加载各子页面
   (工作台、Agent、Skill、会话历史、记忆管理)
   ========================================================================== */

import { agentApi } from './agent-api.js';
import { agentEngine } from './agent-engine.js';
import { agentUI } from './agent-ui.js';

/**
 * CoWork 主控制器对象
 * 由 app.js 调用 init() 完成初始化
 */
export const cowork = {
  /** 当前激活的导航项 */
  activeNav: 'workspace',

  /** 初始化 CoWork 模块 */
  init() {
    // 动态注入 cowork.css
    if (!document.querySelector('link[href*="cowork.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = './assets/css/cowork.css';
      document.head.appendChild(link);
    }
    console.log('[CoWork] 模块初始化完成');
  },

  /**
   * 注册所有 /cowork/* 路由
   * @param {object} router - 路由实例 (router.js)
   */
  registerRoutes(router) {
    // AI 工作台主页
    router.register('/cowork/workspace', () => {
      this.loadWorkspace(this._getContentEl());
    });

    // Agent 构建器(需在 /cowork/agents/:id 之前注册,避免被 :id 匹配)
    router.register('/cowork/agents/builder', () => {
      this.loadAgentBuilder(this._getContentEl());
    });

    // Agent 列表页
    router.register('/cowork/agents', () => {
      this.loadAgentList(this._getContentEl());
    });

    // Agent 详情/调试页
    router.register('/cowork/agents/:id', (params) => {
      this.loadAgentDetail(this._getContentEl(), params.id);
    });

    // Skill 构建器(需在 /cowork/skills/:id 之前注册)
    router.register('/cowork/skills/builder', () => {
      this.loadSkillBuilder(this._getContentEl());
    });

    // Skill 列表页
    router.register('/cowork/skills', () => {
      this.loadSkillList(this._getContentEl());
    });

    // Skill 详情页
    router.register('/cowork/skills/:id', (params) => {
      this.loadSkillDetail(this._getContentEl(), params.id);
    });

    // 会话历史页
    router.register('/cowork/sessions', () => {
      this.loadSessions(this._getContentEl());
    });

    // 记忆管理页
    router.register('/cowork/memory', () => {
      this.loadMemory(this._getContentEl());
    });
  },

  /** 获取主内容容器 */
  _getContentEl() {
    return document.getElementById('app-content') || document.getElementById('main-content');
  },

  /* ------------------------------ 页面加载 ------------------------------ */

  /** 加载工作台主页(三栏布局,Agent 对话) */
  async loadWorkspace(container) {
    if (!container) return;
    this.showCoworkLayout(container, 'workspace');
    const mainEl = container.querySelector('#cowork-main');
    // 加载 Agent 列表供对话选择
    let agents = [];
    try {
      agents = await agentApi.getAgents();
    } catch (err) {
      console.error('[CoWork] 加载 Agent 列表失败:', err);
    }
    mainEl.innerHTML = `
      <div class="cowork-workspace">
        <div class="cowork-workspace__header">
          <h2>AI 工作台</h2>
          <p class="text-muted">选择一个 Agent 开始对话,或创建新的 Agent。</p>
        </div>
        <div class="cowork-workspace__agents">
          ${agents.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state__icon">🤖</div>
              <div class="empty-state__title">暂无 Agent</div>
              <div class="empty-state__desc">创建你的第一个 Agent,开始智能协作。</div>
              <a href="#/cowork/agents/builder" class="btn btn-primary">创建 Agent</a>
            </div>` : agents.map(a => `
            <div class="agent-card" data-agent-id="${a.id}">
              <div class="agent-card__name">${this._escape(a.name || '未命名 Agent')}</div>
              <div class="agent-card__desc">${this._escape(a.description || '')}</div>
              <button class="btn btn-primary btn-sm cowork-chat-btn" data-agent-id="${a.id}">开始对话</button>
            </div>`).join('')}
        </div>
        <div class="cowork-workspace__chat" id="cowork-chat-area"></div>
      </div>`;
    // 绑定"开始对话"按钮
    mainEl.querySelectorAll('.cowork-chat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const agentId = btn.dataset.agentId;
        if (agentEngine && typeof agentEngine.startChat === 'function') {
          agentEngine.startChat(agentId, mainEl.querySelector('#cowork-chat-area'));
        }
      });
    });
    this.renderRightPanel('workspace', { agents });
    document.title = 'AI 工作台 · CoWork · XIN';
  },

  /** 加载 Agent 列表 */
  async loadAgentList(container) {
    if (!container) return;
    this.showCoworkLayout(container, 'agents');
    const mainEl = container.querySelector('#cowork-main');
    mainEl.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
    try {
      const agents = await agentApi.getAgents();
      if (agentUI && typeof agentUI.renderAgentList === 'function') {
        agentUI.renderAgentList(agents, mainEl);
      } else {
        mainEl.innerHTML = `
          <div class="cowork-page-header">
            <h2>Agent 列表</h2>
            <a href="#/cowork/agents/builder" class="btn btn-primary">新建 Agent</a>
          </div>
          <div class="agent-list">
            ${agents.map(a => `
              <a href="#/cowork/agents/${a.id}" class="agent-card">
                <div class="agent-card__name">${this._escape(a.name || '')}</div>
                <div class="agent-card__desc">${this._escape(a.description || '')}</div>
              </a>`).join('')}
          </div>`;
      }
      this.renderRightPanel('agents', { agents });
    } catch (err) {
      console.error('[CoWork] 加载 Agent 列表失败:', err);
      mainEl.innerHTML = `<div class="empty-state"><div class="empty-state__title">加载失败</div><div class="empty-state__desc">${this._escape(err.message)}</div></div>`;
    }
    document.title = 'Agent 列表 · CoWork · XIN';
  },

  /** 加载 Agent 构建器(新建或编辑) */
  async loadAgentBuilder(container, agentId) {
    if (!container) return;
    this.showCoworkLayout(container, 'agents');
    const mainEl = container.querySelector('#cowork-main');
    let agent = null;
    if (agentId) {
      try {
        agent = await agentApi.getAgent(agentId);
      } catch (err) {
        console.error('[CoWork] 加载 Agent 失败:', err);
      }
    }
    if (agentUI && typeof agentUI.renderAgentBuilder === 'function') {
      agentUI.renderAgentBuilder(agent, mainEl);
    } else {
      mainEl.innerHTML = `
        <div class="cowork-page-header">
          <h2>${agentId ? '编辑 Agent' : '新建 Agent'}</h2>
        </div>
        <form id="agent-builder-form" class="form">
          <div class="form__field">
            <label class="form__label">名称</label>
            <input type="text" name="name" class="form__input" value="${this._escape(agent?.name || '')}" required>
          </div>
          <div class="form__field">
            <label class="form__label">描述</label>
            <textarea name="description" class="form__input">${this._escape(agent?.description || '')}</textarea>
          </div>
          <div class="form__field">
            <label class="form__label">系统提示词</label>
            <textarea name="system_prompt" class="form__input" rows="6">${this._escape(agent?.system_prompt || '')}</textarea>
          </div>
          <button type="submit" class="btn btn-primary">保存</button>
        </form>`;
      mainEl.querySelector('#agent-builder-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        try {
          if (agentId) {
            await agentApi.updateAgent(agentId, data);
          } else {
            await agentApi.createAgent(data);
          }
          window.location.hash = '#/cowork/agents';
        } catch (err) {
          alert('保存失败: ' + err.message);
        }
      });
    }
    this.renderRightPanel('agent-builder', { agent });
    document.title = 'Agent 构建器 · CoWork · XIN';
  },

  /** 加载 Agent 详情/调试页 */
  async loadAgentDetail(container, agentId) {
    if (!container) return;
    this.showCoworkLayout(container, 'agents');
    const mainEl = container.querySelector('#cowork-main');
    mainEl.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
    try {
      const agent = await agentApi.getAgent(agentId);
      if (agentUI && typeof agentUI.renderAgentDetail === 'function') {
        agentUI.renderAgentDetail(agent, mainEl);
      } else {
        mainEl.innerHTML = `
          <div class="cowork-page-header">
            <h2>${this._escape(agent.name || 'Agent 详情')}</h2>
            <div>
              <a href="#/cowork/agents/builder?id=${agentId}" class="btn btn-ghost">编辑</a>
              <button class="btn btn-primary" id="agent-debug-btn">调试对话</button>
            </div>
          </div>
          <div class="agent-detail__desc">${this._escape(agent.description || '')}</div>
          <div id="agent-debug-area"></div>`;
        mainEl.querySelector('#agent-debug-btn')?.addEventListener('click', () => {
          if (agentEngine && typeof agentEngine.startChat === 'function') {
            agentEngine.startChat(agentId, mainEl.querySelector('#agent-debug-area'));
          }
        });
      }
      this.renderRightPanel('agent-detail', { agent });
    } catch (err) {
      console.error('[CoWork] 加载 Agent 详情失败:', err);
      mainEl.innerHTML = `<div class="empty-state"><div class="empty-state__title">加载失败</div><div class="empty-state__desc">${this._escape(err.message)}</div></div>`;
    }
    document.title = 'Agent 详情 · CoWork · XIN';
  },

  /** 加载 Skill 列表 */
  async loadSkillList(container) {
    if (!container) return;
    this.showCoworkLayout(container, 'skills');
    const mainEl = container.querySelector('#cowork-main');
    mainEl.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
    try {
      const skills = await agentApi.getSkills();
      if (agentUI && typeof agentUI.renderSkillList === 'function') {
        agentUI.renderSkillList(skills, mainEl);
      } else {
        mainEl.innerHTML = `
          <div class="cowork-page-header">
            <h2>Skill 列表</h2>
            <a href="#/cowork/skills/builder" class="btn btn-primary">新建 Skill</a>
          </div>
          <div class="skill-list">
            ${skills.map(s => `
              <a href="#/cowork/skills/${s.id}" class="skill-card">
                <div class="skill-card__name">${this._escape(s.name || '')}</div>
                <div class="skill-card__desc">${this._escape(s.description || '')}</div>
              </a>`).join('')}
          </div>`;
      }
      this.renderRightPanel('skills', { skills });
    } catch (err) {
      console.error('[CoWork] 加载 Skill 列表失败:', err);
      mainEl.innerHTML = `<div class="empty-state"><div class="empty-state__title">加载失败</div><div class="empty-state__desc">${this._escape(err.message)}</div></div>`;
    }
    document.title = 'Skill 列表 · CoWork · XIN';
  },

  /** 加载 Skill 构建器(新建或编辑) */
  async loadSkillBuilder(container, skillId) {
    if (!container) return;
    this.showCoworkLayout(container, 'skills');
    const mainEl = container.querySelector('#cowork-main');
    // 动态导入 Skill 构建器模块
    const { skillBuilder } = await import('./skill-builder.js');
    skillBuilder.init(mainEl, skillId);
    this.renderRightPanel('skill-builder', { skillId });
    document.title = 'Skill 构建器 · CoWork · XIN';
  },

  /** 加载 Skill 详情页 */
  async loadSkillDetail(container, skillId) {
    if (!container) return;
    this.showCoworkLayout(container, 'skills');
    const mainEl = container.querySelector('#cowork-main');
    mainEl.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
    try {
      const skill = await agentApi.getSkill(skillId);
      if (agentUI && typeof agentUI.renderSkillDetail === 'function') {
        agentUI.renderSkillDetail(skill, mainEl);
      } else {
        mainEl.innerHTML = `
          <div class="cowork-page-header">
            <h2>${this._escape(skill.name || 'Skill 详情')}</h2>
            <a href="#/cowork/skills/builder?id=${skillId}" class="btn btn-ghost">编辑</a>
          </div>
          <div class="skill-detail__desc">${this._escape(skill.description || '')}</div>
          <div id="skill-execution-area"></div>`;
      }
      // 加载执行历史
      const { skillEngine } = await import('./skill-engine.js');
      try {
        const executions = await agentApi.getSkillExecutions(skillId);
        skillEngine.renderExecutionHistory(executions, mainEl.querySelector('#skill-execution-area'));
      } catch (e) {
        console.error('[CoWork] 加载 Skill 执行历史失败:', e);
      }
      this.renderRightPanel('skill-detail', { skill });
    } catch (err) {
      console.error('[CoWork] 加载 Skill 详情失败:', err);
      mainEl.innerHTML = `<div class="empty-state"><div class="empty-state__title">加载失败</div><div class="empty-state__desc">${this._escape(err.message)}</div></div>`;
    }
    document.title = 'Skill 详情 · CoWork · XIN';
  },

  /** 加载会话历史页 */
  async loadSessions(container) {
    if (!container) return;
    this.showCoworkLayout(container, 'sessions');
    const mainEl = container.querySelector('#cowork-main');
    mainEl.innerHTML = '<div class="spinner-center"><div class="spinner"></div></div>';
    try {
      // 先获取 Agent 列表,再汇总各 Agent 的会话
      const agents = await agentApi.getAgents();
      const sessionGroups = await Promise.all(
        agents.map(async (a) => {
          try {
            const sessions = await agentApi.getSessions(a.id);
            return { agent: a, sessions };
          } catch (e) {
            return { agent: a, sessions: [] };
          }
        })
      );
      if (agentUI && typeof agentUI.renderSessionList === 'function') {
        agentUI.renderSessionList(sessionGroups, mainEl);
      } else {
        mainEl.innerHTML = `
          <div class="cowork-page-header"><h2>会话历史</h2></div>
          ${sessionGroups.map(g => `
            <div class="session-group">
              <div class="session-group__agent">${this._escape(g.agent.name || '')}</div>
              ${g.sessions.map(s => `
                <div class="session-item" data-session-id="${s.id}">
                  <span class="session-item__title">${this._escape(s.title || '未命名会话')}</span>
                  <span class="session-item__time">${this._escape(s.created_at || '')}</span>
                </div>`).join('')}
            </div>`).join('')}`;
      }
      this.renderRightPanel('sessions', { sessionGroups });
    } catch (err) {
      console.error('[CoWork] 加载会话历史失败:', err);
      mainEl.innerHTML = `<div class="empty-state"><div class="empty-state__title">加载失败</div><div class="empty-state__desc">${this._escape(err.message)}</div></div>`;
    }
    document.title = '会话历史 · CoWork · XIN';
  },

  /** 加载记忆管理页 */
  async loadMemory(container) {
    if (!container) return;
    this.showCoworkLayout(container, 'memory');
    const mainEl = container.querySelector('#cowork-main');
    // 动态导入记忆管理模块
    const { memoryStore } = await import('./memory-store.js');
    memoryStore.init(mainEl);
    this.renderRightPanel('memory', {});
    document.title = '记忆管理 · CoWork · XIN';
  },

  /* ------------------------------ 布局渲染 ------------------------------ */

  /**
   * 显示三栏布局骨架(左侧导航 + 中间内容 + 右侧面板)
   * @param {HTMLElement} container - 主内容容器
   * @param {string} activeNav - 当前激活的导航项
   */
  showCoworkLayout(container, activeNav) {
    this.activeNav = activeNav;
    // 隐藏首页,显示 SPA 容器(与 app.js 的行为保持一致)
    const home = document.getElementById('home-page');
    if (home) home.classList.add('hidden');
    container.classList.remove('hidden');
    container.style.display = '';
    window.scrollTo(0, 0);

    container.innerHTML = `
      <div class="cowork-layout">
        <aside class="cowork-layout__sidebar">${this.renderSidebar(activeNav)}</aside>
        <main class="cowork-layout__main" id="cowork-main">
          <div class="spinner-center"><div class="spinner"></div></div>
        </main>
        <aside class="cowork-layout__right" id="cowork-right-panel"></aside>
      </div>`;
  },

  /**
   * 渲染左侧导航 HTML
   * @param {string} activeNav - 当前激活的导航项
   * @returns {string} 导航 HTML
   */
  renderSidebar(activeNav) {
    const navItems = [
      { id: 'workspace', name: 'AI 工作台', icon: '💼', href: '#/cowork/workspace' },
      { id: 'agents', name: 'Agent', icon: '🤖', href: '#/cowork/agents' },
      { id: 'skills', name: 'Skill', icon: '⚡', href: '#/cowork/skills' },
      { id: 'sessions', name: '会话历史', icon: '💬', href: '#/cowork/sessions' },
      { id: 'memory', name: '记忆管理', icon: '🧠', href: '#/cowork/memory' }
    ];
    return `
      <div class="sidebar__group">
        <div class="sidebar__title">CoWork</div>
        ${navItems.map(item => `
          <a href="${item.href}" class="sidebar-item ${activeNav === item.id ? 'active' : ''}">
            <span>${item.icon}</span>
            <span>${item.name}</span>
          </a>`).join('')}
      </div>`;
  },

  /**
   * 渲染右侧面板内容
   * @param {string} panelType - 面板类型 (workspace/agents/skills 等)
   * @param {object} data - 面板所需数据
   */
  renderRightPanel(panelType, data = {}) {
    const panel = document.getElementById('cowork-right-panel');
    if (!panel) return;
    switch (panelType) {
      case 'workspace':
        panel.innerHTML = `
          <div class="panel__title">快捷操作</div>
          <a href="#/cowork/agents/builder" class="btn btn-ghost btn-block">新建 Agent</a>
          <a href="#/cowork/skills/builder" class="btn btn-ghost btn-block">新建 Skill</a>
          <div class="panel__title" style="margin-top:16px;">统计</div>
          <div class="panel__stat">Agent 数量: ${(data.agents || []).length}</div>`;
        break;
      case 'agents':
        panel.innerHTML = `
          <div class="panel__title">Agent 概览</div>
          <div class="panel__stat">共 ${(data.agents || []).length} 个 Agent</div>`;
        break;
      case 'skills':
        panel.innerHTML = `
          <div class="panel__title">Skill 概览</div>
          <div class="panel__stat">共 ${(data.skills || []).length} 个 Skill</div>`;
        break;
      case 'memory':
        panel.innerHTML = `
          <div class="panel__title">记忆说明</div>
          <div class="panel__desc">管理 Agent 的长期记忆,支持按类型筛选与搜索。</div>`;
        break;
      default:
        panel.innerHTML = `
          <div class="panel__title">CoWork</div>
          <div class="panel__desc">企业级智能体协作平台</div>`;
    }
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

export default cowork;
