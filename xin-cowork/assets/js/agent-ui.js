/* ==========================================================================
   XIN 信 · Agent UI 组件模块
   提供 Agent 对话界面的各类渲染函数: 消息气泡、打字动画、工具调用标签、
   Agent/技能卡片、会话列表项、记忆项,以及简单的 Markdown 渲染
   ========================================================================== */

/**
 * Agent UI 组件对象
 * 所有 render* 方法均为纯 DOM 操作,向指定容器追加元素
 */
export const agentUI = {
  /**
   * 渲染一条聊天消息到容器
   * @param {string} role - 消息角色 ('user' | 'assistant' | 'system')
   * @param {string} content - 消息内容 (支持简单 Markdown)
   * @param {HTMLElement} container - 目标容器
   * @returns {HTMLElement} 创建的消息元素
   */
  renderChatMessage(role, content, container) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message chat-message--${role}`;
    // 助手消息渲染 Markdown,用户消息直接转义文本
    const body = role === 'assistant' ? this.simpleMarkdown(content) : this.escapeHtml(content);
    msgEl.innerHTML = `
      <div class="chat-message__avatar">${role === 'user' ? '👤' : '🤖'}</div>
      <div class="chat-message__content">${body}</div>`;
    container.appendChild(msgEl);
    // 滚动到底部,保持最新消息可见
    container.scrollTop = container.scrollHeight;
    return msgEl;
  },

  /**
   * 渲染"正在输入"动画 (三个跳动的点)
   * @param {HTMLElement} container - 目标容器
   * @returns {HTMLElement} 打字动画元素
   */
  renderTypingIndicator(container) {
    // 避免重复添加
    if (container.querySelector('.typing-indicator')) {
      return container.querySelector('.typing-indicator');
    }
    const el = document.createElement('div');
    el.className = 'chat-message chat-message--assistant typing-indicator';
    el.innerHTML = `
      <div class="chat-message__avatar">🤖</div>
      <div class="chat-message__content typing-indicator__dots">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  /**
   * 移除打字动画
   * @param {HTMLElement} container - 目标容器
   */
  removeTypingIndicator(container) {
    const el = container.querySelector('.typing-indicator');
    if (el) el.remove();
  },

  /**
   * 渲染工具调用标签
   * @param {string} toolName - 工具名称
   * @param {string} status - 状态 ('running' | 'done' | 'error')
   * @param {HTMLElement} container - 目标容器
   * @returns {HTMLElement} 工具调用元素
   */
  renderToolCall(toolName, status, container) {
    const el = document.createElement('div');
    el.className = `tool-call tool-call--${status}`;
    const statusText = { running: '执行中', done: '已完成', error: '失败' }[status] || status;
    el.innerHTML = `
      <span class="tool-call__icon">🔧</span>
      <span class="tool-call__name">${this.escapeHtml(toolName)}</span>
      <span class="tool-call__status">${this.escapeHtml(statusText)}</span>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  /**
   * 渲染 Agent 卡片 (图标、名称、描述、类型标签)
   * @param {object} agent - Agent 数据 {id, name, description, type, icon}
   * @param {HTMLElement} container - 目标容器
   * @returns {HTMLElement} 卡片元素
   */
  renderAgentCard(agent, container) {
    const el = document.createElement('div');
    el.className = 'agent-card';
    el.dataset.agentId = agent.id;
    el.innerHTML = `
      <div class="agent-card__icon">${agent.icon || '🤖'}</div>
      <div class="agent-card__body">
        <div class="agent-card__name">${this.escapeHtml(agent.name || '未命名')}</div>
        <div class="agent-card__desc">${this.escapeHtml(agent.description || '')}</div>
        <span class="agent-card__type tag">${this.escapeHtml(agent.type || '通用')}</span>
      </div>`;
    container.appendChild(el);
    return el;
  },

  /**
   * 渲染会话列表项
   * @param {object} session - 会话数据 {id, title, updated_at}
   * @param {HTMLElement} container - 目标容器
   * @param {Function} onClick - 点击回调,参数为 session 对象
   * @returns {HTMLElement} 会话项元素
   */
  renderSessionItem(session, container, onClick) {
    const el = document.createElement('div');
    el.className = 'session-item';
    el.dataset.sessionId = session.id;
    el.innerHTML = `
      <span class="session-item__icon">💬</span>
      <span class="session-item__title">${this.escapeHtml(session.title || '新会话')}</span>`;
    if (typeof onClick === 'function') {
      el.addEventListener('click', () => onClick(session));
    }
    container.appendChild(el);
    return el;
  },

  /**
   * 渲染记忆项
   * @param {object} memory - 记忆数据 {id, type, content, created_at}
   * @param {HTMLElement} container - 目标容器
   * @returns {HTMLElement} 记忆项元素
   */
  renderMemoryItem(memory, container) {
    const el = document.createElement('div');
    el.className = 'memory-item';
    el.dataset.memoryId = memory.id;
    el.innerHTML = `
      <div class="memory-item__header">
        <span class="memory-item__type tag">${this.escapeHtml(memory.type || '通用')}</span>
      </div>
      <div class="memory-item__content">${this.escapeHtml(memory.content || '')}</div>`;
    container.appendChild(el);
    return el;
  },

  /**
   * 渲染技能卡片
   * @param {object} skill - 技能数据 {id, name, description, category, icon}
   * @param {HTMLElement} container - 目标容器
   * @returns {HTMLElement} 卡片元素
   */
  renderSkillCard(skill, container) {
    const el = document.createElement('div');
    el.className = 'skill-card';
    el.dataset.skillId = skill.id;
    el.innerHTML = `
      <div class="skill-card__icon">${skill.icon || '⚡'}</div>
      <div class="skill-card__body">
        <div class="skill-card__name">${this.escapeHtml(skill.name || '未命名技能')}</div>
        <div class="skill-card__desc">${this.escapeHtml(skill.description || '')}</div>
        <span class="skill-card__category tag">${this.escapeHtml(skill.category || '通用')}</span>
      </div>`;
    container.appendChild(el);
    return el;
  },

  /**
   * HTML 转义,防止 XSS
   * @param {string} text - 原始文本
   * @returns {string} 转义后的文本
   */
  escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * 简单 Markdown 转 HTML
   * 支持: ```代码块```、`行内代码`、**粗体**、- 列表、> 引用
   * @param {string} text - Markdown 文本
   * @returns {string} HTML 字符串
   */
  simpleMarkdown(text) {
    if (!text) return '';
    // 先整体转义,再按规则替换,避免注入
    let html = this.escapeHtml(text);

    // 代码块 ```...``` (需在行内代码之前处理)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      return `<pre class="md-codeblock"><code>${code.replace(/^\n+|\n+$/g, '')}</code></pre>`;
    });
    // 行内代码 `code`
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
    // 粗体 **text**
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // 引用 > text (按行处理)
    html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote class="md-quote">$1</blockquote>');
    // 列表: 连续的 "- item" 行包裹为 <ul>
    html = html.replace(/((?:^-\s+.*(?:\n|$))+)/gm, (block) => {
      const items = block.trim().split('\n')
        .map(line => `<li>${line.replace(/^-\s+/, '')}</li>`)
        .join('');
      return `<ul class="md-list">${items}</ul>`;
    });
    // 换行转 <br> (代码块内的换行已被包裹在 pre 中,不受影响)
    html = html.replace(/\n/g, '<br>');
    // 修正: pre 块内部的 <br> 应还原为换行
    html = html.replace(/<pre class="md-codeblock"><code>([\s\S]*?)<\/code><\/pre>/g, (m, code) => {
      return `<pre class="md-codeblock"><code>${code.replace(/<br>/g, '\n')}</code></pre>`;
    });
    return html;
  }
};
