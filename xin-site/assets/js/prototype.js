/* ==========================================================================
   XIN 信 · 原型交互通用脚本
   Tab 切换 / 侧边栏切换 / 流式输出动画 / 市场安装状态切换 等
   ========================================================================== */

/**
 * 原型交互管理器
 * 提供 prototype 页面所需的交互能力
 * 全部基于事件委托,可在动态加载内容后自动生效
 */
export const prototype = {
  /** 初始化 */
  init() {
    this.bindTabSwitch();
    this.bindInstallToggle();
    this.bindSidebarToggle();
    this.bindChatDemo();
    this.bindFilterChips();
    this.bindCopyCode();
  },

  /** 标签页切换 */
  bindTabSwitch() {
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      const group = tab.closest('[data-tabs]');
      if (!group) return;
      const target = tab.getAttribute('data-tab');
      // 切换 tab 高亮
      group.querySelectorAll('.tab-item').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      // 切换内容显示
      const container = group.getAttribute('data-tabs-container');
      if (container) {
        const targetEl = document.querySelector(container);
        if (targetEl) {
          targetEl.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
          const panel = targetEl.querySelector(`[data-tab-content="${target}"]`);
          if (panel) panel.classList.add('active');
        }
      } else {
        // 同一容器内查找
        const panel = group.parentElement.querySelector(`[data-tab-content="${target}"]`);
        if (panel) {
          group.parentElement.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
          panel.classList.add('active');
        }
      }
    });
  },

  /** 安装状态切换 */
  bindInstallToggle() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.install-btn');
      if (!btn) return;
      e.preventDefault();
      const installed = btn.getAttribute('data-installed') === 'true';
      if (installed) {
        btn.setAttribute('data-installed', 'false');
        btn.textContent = '安装';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-outline');
        this.showToast('已卸载', 'success');
      } else {
        // 模拟安装过程
        const originalText = btn.textContent;
        btn.textContent = '安装中...';
        btn.disabled = true;
        setTimeout(() => {
          btn.setAttribute('data-installed', 'true');
          btn.textContent = '已安装';
          btn.classList.remove('btn-outline');
          btn.classList.add('btn-success');
          btn.disabled = false;
          this.showToast('安装成功', 'success');
        }, 800);
      }
    });
  },

  /** 侧边栏面板切换 */
  bindSidebarToggle() {
    document.addEventListener('click', (e) => {
      const item = e.target.closest('[data-sidebar-toggle]');
      if (!item) return;
      e.preventDefault();
      const target = item.getAttribute('data-sidebar-toggle');
      // 切换面板
      const sidebar = item.closest('.app-frame__sidebar, .docs-layout__sidebar');
      if (sidebar) {
        sidebar.querySelectorAll('.app-nav-item, .sidebar-item').forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
      }
      // 切换内容面板(如果存在)
      const panels = document.querySelectorAll('[data-sidebar-panel]');
      panels.forEach((p) => {
        p.classList.toggle('hidden', p.getAttribute('data-sidebar-panel') !== target);
      });
    });
  },

  /** 聊天对话演示 - 流式输出动画 */
  bindChatDemo() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-chat-send]');
      if (!btn) return;
      e.preventDefault();
      const chatId = btn.getAttribute('data-chat-send');
      const chat = document.getElementById(chatId);
      if (!chat) return;
      const input = chat.querySelector('.chat-input__textarea');
      const messages = chat.querySelector('.chat-messages');
      if (!input || !messages) return;
      const text = input.value.trim();
      if (!text) return;
      // 添加用户消息
      messages.appendChild(this.createUserMessage(text));
      input.value = '';
      // 模拟助手回复
      setTimeout(() => {
        const typing = this.createTypingIndicator();
        messages.appendChild(typing);
        messages.scrollTop = messages.scrollHeight;
        // 流式输出
        setTimeout(() => {
          typing.remove();
          const reply = this.createAssistantMessage('');
          messages.appendChild(reply);
          this.streamText(reply.querySelector('.chat-message__body'), this.getSampleReply(text), () => {
            messages.scrollTop = messages.scrollHeight;
          });
        }, 600);
      }, 200);
    });

    // 回车发送
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const textarea = e.target.closest('.chat-input__textarea');
        if (textarea) {
          const chat = textarea.closest('[data-chat]');
          if (chat) {
            const btn = chat.querySelector('[data-chat-send]');
            if (btn) {
              e.preventDefault();
              btn.click();
            }
          }
        }
      }
    });
  },

  /** 创建用户消息 */
  createUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-message chat-message--user';
    div.innerHTML = `
      <div class="chat-message__avatar">我</div>
      <div>
        <div class="chat-message__body">${this.escapeHtml(text)}</div>
        <div class="chat-message__meta">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;
    return div;
  },

  /** 创建助手消息 */
  createAssistantMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `
      <div class="chat-message__avatar">A</div>
      <div>
        <div class="chat-message__body">${this.escapeHtml(text)}</div>
        <div class="chat-message__meta">XIN · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;
    return div;
  },

  /** 创建输入指示器 */
  createTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `
      <div class="chat-message__avatar">A</div>
      <div class="chat-message__body">
        <div class="chat-typing">
          <span class="chat-typing__dot"></span>
          <span class="chat-typing__dot"></span>
          <span class="chat-typing__dot"></span>
        </div>
      </div>`;
    return div;
  },

  /** 流式输出文本 */
  streamText(el, text, onUpdate) {
    let i = 0;
    const cursor = '<span class="chat-cursor"></span>';
    const interval = setInterval(() => {
      if (i < text.length) {
        el.innerHTML = this.escapeHtml(text.slice(0, i + 1)) + cursor;
        i++;
        if (onUpdate) onUpdate();
      } else {
        el.innerHTML = this.escapeHtml(text);
        clearInterval(interval);
      }
    }, 24);
  },

  /** 根据用户输入返回示例回复 */
  getSampleReply(userInput) {
    const replies = [
      `我已理解您的需求:"${userInput.slice(0, 30)}${userInput.length > 30 ? '...' : ''}"。\n\n基于当前会话上下文与您的偏好记忆,我建议从以下几个维度展开:\n\n1. 数据采集与整理\n2. 结构化分析\n3. 风险点识别\n4. 输出可执行建议\n\n请告诉我您希望优先处理哪一部分?`,
      `已收到您的指令。我将调用 CRM 系统(MCP)查询本月商机数据,并结合您上次尽调项目的记忆,输出对比分析。请稍候...`,
      `好的,我已将这段内容沉淀到项目记忆中,后续您在相关对话中可以直接引用。`
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  },

  /** 筛选 chips */
  bindFilterChips() {
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      e.preventDefault();
      const filter = chip.getAttribute('data-filter');
      const group = chip.closest('[data-filter-group]');
      if (!group) return;
      group.querySelectorAll('[data-filter]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      // 触发自定义事件
      const event = new CustomEvent('filterchange', { detail: { filter, group } });
      group.dispatchEvent(event);
    });
  },

  /** 复制代码块 */
  bindCopyCode() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.code-block__copy');
      if (!btn) return;
      e.preventDefault();
      const block = btn.closest('.code-block');
      if (!block) return;
      const code = block.querySelector('code, pre');
      if (!code) return;
      const text = code.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = originalText; }, 1500);
        this.showToast('代码已复制到剪贴板', 'success');
      });
    });
  },

  /** 显示 Toast 通知 */
  showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const iconMap = { success: '✓', warning: '⚠', danger: '✕', info: 'ℹ' };
    toast.innerHTML = `<span style="font-size:16px;">${iconMap[type] || 'ℹ'}</span><span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  },

  /** HTML 转义 */
  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }
};

/* ==========================================================================
   标注模式 (Annotation Mode)
   开启后右侧浮窗显示当前原型页对应的需求数与设计说明
   ========================================================================== */
export const annotationMode = {
  enabled: false,

  init() {
    // 从 localStorage 读取状态
    this.enabled = localStorage.getItem('automy-annotation') === 'true';
    this.updateUI();

    // 监听开关点击
    document.addEventListener('click', (e) => {
      if (e.target.closest('.annotation-toggle')) {
        this.toggle();
      }
    });
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('automy-annotation', this.enabled);
    this.updateUI();
    this.renderAnnotationPanel();
  },

  updateUI() {
    document.body.classList.toggle('annotation-mode', this.enabled);
    const toggle = document.querySelector('.annotation-toggle');
    if (toggle) {
      toggle.classList.toggle('active', this.enabled);
      toggle.setAttribute('aria-pressed', this.enabled);
    }
  },

  // 每个原型页面对应的需求条目
  pageRequirements: {
    'prototype/workspace': ['REQ-3.1', 'REQ-3.2', 'REQ-3.3', 'REQ-3.4', 'REQ-3.5'],
    'prototype/auth': ['REQ-1.1', 'REQ-1.4'],
    'prototype/skill-market': ['REQ-4.4', 'REQ-4.5'],
    'prototype/skill-market/detail': ['REQ-4.4', 'REQ-4.5'],
    'prototype/skill-market/editor': ['REQ-4.2'],
    'prototype/skill-market/my-skills': ['REQ-4.1', 'REQ-4.3'],
    'prototype/expert-market': ['REQ-5.3', 'REQ-5.4'],
    'prototype/expert-market/detail': ['REQ-5.1', 'REQ-5.4'],
    'prototype/expert-market/customize': ['REQ-5.3'],
    'prototype/mcp': ['REQ-6.2', 'REQ-6.3'],
    'prototype/mcp/connections': ['REQ-6.3', 'REQ-6.4'],
    'prototype/mcp/service-detail': ['REQ-6.1', 'REQ-6.4'],
    'prototype/knowledge': ['REQ-7.1', 'REQ-7.3'],
    'prototype/knowledge/pipeline': ['REQ-7.2'],
    'prototype/knowledge/search-test': ['REQ-7.3', 'REQ-7.4', 'REQ-7.5'],
    'prototype/profile': ['REQ-11.2', 'REQ-11.6'],
    'prototype/admin': ['REQ-10.1'],
    'prototype/admin/users': ['REQ-10.1'],
    'prototype/admin/roles': ['REQ-10.2'],
    'prototype/admin/audit': ['REQ-10.3'],
    'prototype/admin/models': ['REQ-8.1', 'REQ-10.4'],
    'prototype/admin/market-review': ['REQ-4.6', 'REQ-10.5'],
    'prototype/admin/settings': ['REQ-9.4', 'REQ-10.6'],
    // 本次新增：IM 通道与会话数据库（用 IM-/SD- 前缀避免与既有 REQ-6.x/7.x 冲突）
    'prototype/notifications': ['IM-6.2', 'IM-6.6'],
    'prototype/im-channels': ['IM-6.1', 'IM-6.2'],
    'prototype/im-channels/template-editor': ['IM-6.4'],
    'prototype/im-channels/reminder-rules': ['IM-6.3']
  },

  renderAnnotationPanel() {
    // 移除现有面板
    const existing = document.getElementById('annotation-panel');
    if (existing) existing.remove();

    if (!this.enabled) return;

    // 判断当前页面是否为原型页
    const hash = location.hash || '#/prototype/workspace';
    const match = hash.match(/^#\/(prototype\/.+)$/);
    if (!match) return;
    const pageKey = match[1];
    const reqs = this.pageRequirements[pageKey] || [];

    // 创建面板
    const panel = document.createElement('aside');
    panel.id = 'annotation-panel';
    panel.className = 'annotation-panel';
    panel.innerHTML = `
      <div class="annotation-panel__header">
        <span class="annotation-panel__title">📌 标注模式</span>
        <span class="badge badge-primary">${reqs.length} 条需求</span>
      </div>
      <div class="annotation-panel__body">
        <div class="annotation-panel__section">
          <div class="annotation-panel__label">对应需求</div>
          ${reqs.map(r => `
            <a href="#/docs/requirements/${this.getReqDocLink(r)}#${r}" class="annotation-req-item">
              <span class="badge badge-primary">${r}</span>
              <span class="annotation-req-title">${this.getReqTitle(r)}</span>
            </a>
          `).join('')}
        </div>
        <div class="annotation-panel__section">
          <div class="annotation-panel__label">设计说明</div>
          <p class="text-sm text-secondary">${this.getDesignNote(pageKey)}</p>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
  },

  getReqDocLink(req) {
    const prefix = req.split('.')[0];
    const map = { 'REQ-1': 'auth-rbac', 'REQ-2': 'companion', 'REQ-3': 'workspace',
      'REQ-4': 'skill-market', 'REQ-5': 'expert-market', 'REQ-6': 'mcp-integration',
      'REQ-7': 'knowledge', 'REQ-8': 'integration', 'REQ-9': 'security-audit',
      'REQ-10': 'admin', 'REQ-11': 'profile',
      // 本次新增
      'IM-6': 'im-notification', 'SD-7': 'session-data' };
    return map[prefix] || 'overview';
  },

  getReqTitle(req) {
    const titles = {
      'REQ-1.1': 'SSO 单点登录', 'REQ-1.4': '多端会话',
      'REQ-2.2': '长期记忆库',
      'REQ-3.1': '多会话管理', 'REQ-3.2': '流式输出', 'REQ-3.3': '工具调用展开', 'REQ-3.4': '中断与追问', 'REQ-3.5': '项目空间',
      'REQ-4.1': '技能定义模型', 'REQ-4.2': '技能编辑器', 'REQ-4.3': '运行时沙箱', 'REQ-4.4': '市场浏览', 'REQ-4.5': '技能安装', 'REQ-4.6': '审核与下架',
      'REQ-5.1': '专家模型', 'REQ-5.3': '订阅与个性化', 'REQ-5.4': '专家市场',
      'REQ-6.1': 'MCP Adapter', 'REQ-6.2': '服务目录', 'REQ-6.3': '主动连接', 'REQ-6.4': '运行时管控',
      'REQ-7.1': '文档接入', 'REQ-7.2': '处理流水线', 'REQ-7.3': '混合检索', 'REQ-7.4': '来源引用', 'REQ-7.5': '未命中兜底',
      'REQ-8.1': '模型网关',
      'REQ-9.4': '脱敏与合规',
      'REQ-10.1': '用户管理', 'REQ-10.2': '角色权限', 'REQ-10.3': '审计日志', 'REQ-10.4': '模型配置', 'REQ-10.5': '市场审核', 'REQ-10.6': '系统配置',
      'REQ-11.2': '画像主页', 'REQ-11.6': '偏好设置',
      // 本次新增：IM 通道与主动提醒
      'IM-6.1': 'IM 通道接入', 'IM-6.2': '统一通知服务', 'IM-6.3': '主动提醒引擎', 'IM-6.4': '通知模板', 'IM-6.5': 'IM 双向交互', 'IM-6.6': '通知权限与隐私',
      // 本次新增：会话数据库设计
      'SD-7.1': '会话数据模型', 'SD-7.2': '跨端续接', 'SD-7.3': '检索与归档', 'SD-7.4': '数据架构文档要求'
    };
    return titles[req] || req;
  },

  getDesignNote(pageKey) {
    const notes = {
      'prototype/workspace': '对话主工作台,左侧多会话列表,右侧主对话区,顶部工具栏。流式输出用打字机动画。',
      'prototype/auth': 'SSO 登录入口,企业账号优先,本地账号兜底。首次登录触发引导流程。',
      'prototype/skill-market': '技能市场首页,分类导航+搜索+卡片瀑布流。每张卡片含评分与使用量。',
      'prototype/skill-market/detail': '技能详情页,展示技能元数据、示例输入输出、依赖权限、更新日志。',
      'prototype/skill-market/editor': '低代码技能编辑器,左节点库+中画布+右属性面板+下调试面板。',
      'prototype/skill-market/my-skills': '我的技能管理,Tab切换私有/部门/全企业,含版本与A/B测试。',
      'prototype/expert-market': '专家市场首页,专家卡片+领域分类+推荐位。',
      'prototype/expert-market/detail': '专家详情,展示Persona、绑定技能/MCP/知识库、记忆策略。',
      'prototype/expert-market/customize': '专家个性化微调,语气滑块+私有知识+自定义指令+预览。',
      'prototype/mcp': 'MCP 集成首页,服务目录+连接状态+调用统计。',
      'prototype/mcp/connections': 'MCP 连接管理,已连接服务卡片+授权范围+调用记录表+撤销。',
      'prototype/mcp/service-detail': '单个 MCP 服务详情,tools/resources/prompts 清单+限流配额。',
      'prototype/knowledge': '知识库管理,分类卡片+文档列表+语义搜索。',
      'prototype/knowledge/pipeline': '文档处理流水线,5步骤进度条+分块预览+元数据。',
      'prototype/knowledge/search-test': '检索测试,搜索框+结果列表(含来源引用与置信度)+未命中兜底。',
      'prototype/profile': '用户中心,画像主页+偏好设置+订阅管理+连接管理。',
      'prototype/admin': '管理后台首页,核心指标+用户管理+模型配置+审计日志。',
      'prototype/admin/users': '用户与组织管理,组织架构树+用户列表+编辑表单。',
      'prototype/admin/roles': '角色与权限,4角色卡片+功能权限矩阵+数据权限规则。',
      'prototype/admin/audit': '审计日志,筛选条+统计+日志明细表+导出。',
      'prototype/admin/models': '模型网关配置,模型列表+路由规则+限流配额+成本统计图表。',
      'prototype/admin/market-review': '市场审核,待审核列表+安全扫描结果+通过/驳回操作。',
      'prototype/admin/settings': '系统配置,KMS+数据驻留+脱敏规则+全局参数。',
      // 本次新增
      'prototype/notifications': '通知中心,站内通知列表+未读统计+分类Tab+来源渠道筛选+跳转会话。',
      'prototype/im-channels': 'IM 通道配置,飞书/企微/钉钉接入状态+授权+可见范围+频率限制+调用记录。',
      'prototype/im-channels/template-editor': '通知模板编辑器,模板列表+标题正文模板+变量插值+多渠道卡片预览+试发。',
      'prototype/im-channels/reminder-rules': '主动提醒规则,规则列表+触发条件编排+节流策略+渠道降级+试运行。'
    };
    return notes[pageKey] || '原型页面,展示 XIN 平台对应功能的高保真界面。';
  }
};

export default prototype;
