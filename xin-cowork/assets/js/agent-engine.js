/* ==========================================================================
   XIN 信 · 前端 Agent 引擎模块
   管理 Agent 对话的状态与交互流程: 选择 Agent/会话、加载消息历史、
   发送消息并解析 SSE 流式响应,实现逐字渲染的打字机效果
   ========================================================================== */

import { agentApi } from './agent-api.js';
import { agentUI } from './agent-ui.js';

/**
 * 前端 Agent 引擎对象
 * 负责对话界面的状态管理与流式交互
 */
export const agentEngine = {
  /** 引擎状态 */
  state: {
    currentAgent: null,   // 当前选中的 Agent
    currentSession: null, // 当前选中的会话
    messages: [],         // 当前会话的消息列表
    isStreaming: false    // 是否正在接收流式响应
  },

  /** 对话消息容器 */
  container: null,

  /**
   * 初始化对话界面
   * @param {HTMLElement} container - 消息展示容器
   */
  init(container) {
    this.container = container;
    this.clearChat();
  },

  /**
   * 选择 Agent,加载其会话列表
   * @param {object} agent - Agent 对象
   */
  async selectAgent(agent) {
    this.state.currentAgent = agent;
    this.state.currentSession = null;
    this.state.messages = [];
    this.clearChat();
    try {
      const sessions = await agentApi.getSessions(agent.id);
      // 有历史会话时自动选中最近一个
      if (Array.isArray(sessions) && sessions.length > 0) {
        await this.selectSession(sessions[0]);
      }
      return sessions;
    } catch (err) {
      console.error('加载会话列表失败:', err);
      return [];
    }
  },

  /**
   * 选择会话,加载消息历史
   * @param {object} session - 会话对象
   */
  async selectSession(session) {
    this.state.currentSession = session;
    this.state.messages = [];
    this.clearChat();
    try {
      const messages = await agentApi.getMessages(session.id);
      this.state.messages = Array.isArray(messages) ? messages : [];
      // 逐条渲染历史消息
      this.state.messages.forEach((msg) => {
        agentUI.renderChatMessage(msg.role, msg.content, this.container);
      });
    } catch (err) {
      console.error('加载消息历史失败:', err);
    }
  },

  /**
   * 发送消息,处理 SSE 流式响应
   * @param {string} content - 用户消息内容
   */
  async sendMessage(content) {
    // 防止流式响应期间重复发送
    if (this.state.isStreaming) return;
    if (!this.state.currentAgent) {
      console.warn('请先选择一个 Agent');
      return;
    }
    if (!content || !content.trim()) return;

    // 无会话时自动创建新会话
    if (!this.state.currentSession) {
      await this.newSession();
      if (!this.state.currentSession) return; // 创建失败则中止
    }

    const agentId = this.state.currentAgent.id;
    const sessionId = this.state.currentSession.id;

    // 渲染用户消息并记录
    this.state.messages.push({ role: 'user', content });
    agentUI.renderChatMessage('user', content, this.container);

    // 显示打字动画,标记流式状态
    agentUI.renderTypingIndicator(this.container);
    this.state.isStreaming = true;

    try {
      const stream = await agentApi.chat(agentId, content, sessionId);
      await this._handleSSEStream(stream, this.container);
    } catch (err) {
      agentUI.removeTypingIndicator(this.container);
      agentUI.renderChatMessage('assistant', `⚠️ 出错了: ${err.message}`, this.container);
    } finally {
      this.state.isStreaming = false;
    }
  },

  /**
   * 解析 SSE 流式数据,逐字渲染
   * 数据格式:
   *   data: {"type": "content", "content": "文字片段", "session_id": 1}
   *   data: {"type": "done", "session_id": 1}
   *   data: {"type": "error", "content": "错误信息"}
   * @param {ReadableStream} stream - fetch 返回的原始字节流
   * @param {HTMLElement} container - 消息容器
   */
  async _handleSSEStream(stream, container) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';        // 未处理的原始文本缓冲
    let fullContent = '';   // 累积的助手完整回复
    let msgEl = null;       // 当前助手消息气泡元素

    // 移除打字动画,创建空的助手消息气泡
    agentUI.removeTypingIndicator(container);
    msgEl = agentUI.renderChatMessage('assistant', '', container);
    const contentEl = msgEl.querySelector('.chat-message__content');

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以空行分隔,逐条解析
        const events = buffer.split('\n\n');
        buffer = events.pop(); // 最后一段可能不完整,留待下次拼接

        for (const eventBlock of events) {
          const line = eventBlock.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          let data;
          try {
            data = JSON.parse(jsonStr);
          } catch (e) {
            continue; // 忽略无法解析的数据块
          }

          if (data.type === 'content') {
            // 内容片段: 累积并实时渲染
            fullContent += data.content || '';
            contentEl.innerHTML = agentUI.simpleMarkdown(fullContent);
            container.scrollTop = container.scrollHeight;
            // 记录服务端返回的 session_id (新会话场景)
            if (data.session_id && this.state.currentSession &&
                this.state.currentSession.id !== data.session_id) {
              this.state.currentSession.id = data.session_id;
            }
          } else if (data.type === 'done') {
            // 流结束: 保存完整消息
            this.state.messages.push({ role: 'assistant', content: fullContent });
            if (data.session_id && this.state.currentSession) {
              this.state.currentSession.id = data.session_id;
            }
          } else if (data.type === 'error') {
            // 错误: 展示错误信息
            contentEl.innerHTML = `⚠️ ${agentUI.escapeHtml(data.content || '未知错误')}`;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /** 创建新会话 */
  async newSession() {
    if (!this.state.currentAgent) return null;
    try {
      const session = await agentApi.createSession(
        this.state.currentAgent.id,
        '新会话'
      );
      this.state.currentSession = session;
      this.state.messages = [];
      this.clearChat();
      return session;
    } catch (err) {
      console.error('创建会话失败:', err);
      return null;
    }
  },

  /** 清空对话区 */
  clearChat() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  },

  /** 返回当前状态 */
  getState() {
    return this.state;
  }
};
