/* ==========================================================================
   XIN 信 · Agent API 封装模块
   封装与 pro-site 后端 (http://localhost:8088/api) 的所有 HTTP 交互
   包括 Agent、会话、消息、记忆、技能等资源的增删改查与流式对话
   ========================================================================== */

/** API 基础路径 */
const API_BASE = 'http://localhost:8088/api';

/**
 * 通用请求方法
 * @param {string} path - 请求路径 (以 / 开头,拼接在 API_BASE 之后)
 * @param {object} options - fetch 选项 (method, body 等)
 * @returns {Promise<any>} 解析后的 JSON 数据
 */
async function request(path, options = {}) {
  const opts = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  };
  // 有请求体时序列化为 JSON
  if (options.body !== undefined) {
    opts.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${API_BASE}${path}`, opts);
  if (!response.ok) {
    // 尝试读取后端返回的错误信息
    let errMsg = `请求失败: ${response.status} ${response.statusText}`;
    try {
      const errData = await response.json();
      if (errData && (errData.message || errData.error)) {
        errMsg = errData.message || errData.error;
      }
    } catch (e) {
      // 响应体不是 JSON 时忽略
    }
    throw new Error(errMsg);
  }
  // 204 No Content 等无响应体情况
  if (response.status === 204) return null;
  return response.json();
}

/**
 * Agent API 对象
 * 所有方法基于 fetch,返回 Promise
 */
export const agentApi = {
  /* ------------------------------ Agent 管理 ------------------------------ */

  /** 获取 Agent 列表 */
  getAgents() {
    return request('/agents/');
  },

  /** 获取单个 Agent 详情 */
  getAgent(id) {
    return request(`/agents/${id}`);
  },

  /** 创建 Agent */
  createAgent(data) {
    return request('/agents/', { method: 'POST', body: data });
  },

  /** 更新 Agent */
  updateAgent(id, data) {
    return request(`/agents/${id}`, { method: 'PUT', body: data });
  },

  /** 删除 Agent */
  deleteAgent(id) {
    return request(`/agents/${id}`, { method: 'DELETE' });
  },

  /* ------------------------------ 会话与消息 ------------------------------ */

  /** 为指定 Agent 创建会话 */
  createSession(agentId, title) {
    return request(`/agents/${agentId}/sessions`, {
      method: 'POST',
      body: { title }
    });
  },

  /** 获取指定 Agent 的会话列表 */
  getSessions(agentId) {
    return request(`/agents/${agentId}/sessions`);
  },

  /** 获取会话的消息历史 */
  getMessages(sessionId) {
    return request(`/agents/sessions/${sessionId}/messages`);
  },

  /**
   * 发送对话消息 (SSE 流式响应)
   * 特殊处理: 返回 response.body (ReadableStream),调用方负责解析 SSE
   * @param {number|string} agentId - Agent ID
   * @param {string} message - 用户消息内容
   * @param {number|string} sessionId - 会话 ID
   * @returns {Promise<ReadableStream>} 原始字节流
   */
  async chat(agentId, message, sessionId) {
    const response = await fetch(`${API_BASE}/agents/${agentId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId })
    });
    if (!response.ok) {
      throw new Error(`对话请求失败: ${response.status} ${response.statusText}`);
    }
    return response.body;
  },

  /* ------------------------------ 记忆管理 ------------------------------ */

  /** 获取 Agent 的记忆列表 (可按类型过滤) */
  getMemories(agentId, type) {
    const query = type ? `?type=${encodeURIComponent(type)}` : '';
    return request(`/agents/${agentId}/memories${query}`);
  },

  /** 创建记忆 */
  createMemory(agentId, data) {
    return request(`/agents/${agentId}/memories`, {
      method: 'POST',
      body: data
    });
  },

  /** 删除记忆 */
  deleteMemory(agentId, memoryId) {
    return request(`/agents/${agentId}/memories/${memoryId}`, {
      method: 'DELETE'
    });
  },

  /* ------------------------------ 技能管理 ------------------------------ */

  /** 获取技能列表 */
  getSkills() {
    return request('/skills/');
  },

  /** 获取单个技能详情 */
  getSkill(id) {
    return request(`/skills/${id}`);
  },

  /** 创建技能 */
  createSkill(data) {
    return request('/skills/', { method: 'POST', body: data });
  },

  /** 更新技能 */
  updateSkill(id, data) {
    return request(`/skills/${id}`, { method: 'PUT', body: data });
  },

  /** 删除技能 */
  deleteSkill(id) {
    return request(`/skills/${id}`, { method: 'DELETE' });
  },

  /** 执行技能 */
  executeSkill(id, inputData) {
    return request(`/skills/${id}/execute`, {
      method: 'POST',
      body: { input: inputData }
    });
  },

  /** 获取技能执行记录 */
  getSkillExecutions(id) {
    return request(`/skills/${id}/executions`);
  }
};
