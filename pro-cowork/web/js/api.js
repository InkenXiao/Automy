/* ==========================================================================
   API 请求封装
   所有后端接口在 /api 前缀下
   ========================================================================== */

const API = {
  baseUrl: '/api',

  /**
   * 通用请求方法
   * @param {string} path - 路径 (不含 baseUrl)
   * @param {object} options - fetch 配置
   * @returns {Promise<any>}
   */
  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);

      // 处理非 2xx 响应
      if (!response.ok) {
        let errorMessage = `请求失败 (${response.status})`;
        try {
          const errBody = await response.json();
          errorMessage = errBody.message || errBody.error || errorMessage;
        } catch (e) {
          // 非 JSON 错误体
        }
        const error = new Error(errorMessage);
        error.status = response.status;
        throw error;
      }

      // 处理 204 无内容
      if (response.status === 204) {
        return null;
      }

      // 尝试解析 JSON
      const text = await response.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (err) {
      // 网络错误或 JSON 解析错误
      if (err instanceof TypeError) {
        throw new Error('网络连接失败,请检查后端服务是否启动');
      }
      throw err;
    }
  },

  /** GET 请求 */
  async get(path) {
    return this.request(path);
  },

  /** POST 请求 */
  async post(path, data) {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  /** PUT 请求 */
  async put(path, data) {
    return this.request(path, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  /** PATCH 请求 */
  async patch(path, data) {
    return this.request(path, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  /** DELETE 请求 */
  async del(path) {
    return this.request(path, {
      method: 'DELETE'
    });
  },

  /* ------------------------------------------------------------------
     模块与阶段
     ------------------------------------------------------------------ */
  getModules() {
    return this.get('/modules/');
  },
  createModule(data) {
    return this.post('/modules/', data);
  },
  updateModule(id, data) {
    return this.put(`/modules/${id}`, data);
  },
  deleteModule(id) {
    return this.del(`/modules/${id}`);
  },

  getPhases() {
    return this.get('/phases/');
  },
  createPhase(data) {
    return this.post('/phases/', data);
  },
  updatePhase(id, data) {
    return this.put(`/phases/${id}`, data);
  },
  deletePhase(id) {
    return this.del(`/phases/${id}`);
  },

  /* ------------------------------------------------------------------
     项目元信息
     ------------------------------------------------------------------ */
  getProjects() {
    return this.get('/projects/');
  },

  getActiveProject() {
    return this.get('/projects/active');
  },

  createProject(data) {
    return this.post('/projects/', data);
  },

  updateProject(id, data) {
    return this.put(`/projects/${id}`, data);
  },

  activateProject(id) {
    return this.patch(`/projects/${id}/activate`);
  },

  deleteProject(id) {
    return this.del(`/projects/${id}`);
  },

  /* ------------------------------------------------------------------
     项目成员
     ------------------------------------------------------------------ */
  getProjectMembers(projectId) {
    return this.get(`/project-members/${projectId ? `?project_id=${projectId}` : ''}`);
  },

  createProjectMember(data) {
    return this.post('/project-members/', data);
  },

  updateProjectMember(id, data) {
    return this.put(`/project-members/${id}`, data);
  },

  deleteProjectMember(id) {
    return this.del(`/project-members/${id}`);
  },

  /* ------------------------------------------------------------------
     个人周报
     ------------------------------------------------------------------ */
  getPersonalReports(params = {}) {
    const query = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return this.get(`/personal-reports/${query ? `?${query}` : ''}`);
  },

  getPersonalReport(id) {
    return this.get(`/personal-reports/${id}`);
  },

  createPersonalReport(data) {
    return this.post('/personal-reports/', data);
  },

  updatePersonalReport(id, data) {
    return this.put(`/personal-reports/${id}`, data);
  },

  deletePersonalReport(id) {
    return this.del(`/personal-reports/${id}`);
  },

  /* ------------------------------------------------------------------
     进度计划任务
     ------------------------------------------------------------------ */
  getProgressTasks(params = {}) {
    // 拼接查询参数
    const query = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const qs = query ? `?${query}` : '';
    return this.get(`/progress-tasks/${qs}`);
  },

  getProgressTask(id) {
    return this.get(`/progress-tasks/${id}`);
  },

  createProgressTask(data) {
    return this.post('/progress-tasks/', data);
  },

  updateProgressTask(id, data) {
    return this.put(`/progress-tasks/${id}`, data);
  },

  updateProgressTaskStatus(id, status) {
    return this.patch(`/progress-tasks/${id}/status`, { status });
  },

  deleteProgressTask(id) {
    return this.del(`/progress-tasks/${id}`);
  },

  /* ------------------------------------------------------------------
     周报
     ------------------------------------------------------------------ */
  getWeeklyReports() {
    return this.get('/weekly-reports/');
  },

  getWeeklyReport(id) {
    return this.get(`/weekly-reports/${id}`);
  },

  createWeeklyReport(data) {
    return this.post('/weekly-reports/', data);
  },

  copyLastWeekReport(data) {
    return this.post('/weekly-reports/copy-last', data);
  },

  updateWeeklyReport(id, data) {
    return this.put(`/weekly-reports/${id}`, data);
  },

  deleteWeeklyReport(id) {
    return this.del(`/weekly-reports/${id}`);
  },

  /* 周报下周计划任务 */
  addPlanTask(reportId, data) {
    return this.post(`/weekly-reports/${reportId}/plan-tasks`, data);
  },

  updatePlanTask(reportId, taskId, data) {
    return this.put(`/weekly-reports/${reportId}/plan-tasks/${taskId}`, data);
  },

  deletePlanTask(reportId, taskId) {
    return this.del(`/weekly-reports/${reportId}/plan-tasks/${taskId}`);
  },

  /** 从进度计划任务关联到周报下周任务 */
  linkPlanTask(reportId, data) {
    return this.post(`/weekly-reports/${reportId}/plan-tasks/link`, data);
  },

  /** 保存周报 KPI */
  saveKpis(reportId, kpis) {
    return this.post(`/weekly-reports/${reportId}/kpis`, kpis);
  },

  /** 删除单个 KPI */
  deleteKpi(reportId, kpiId) {
    return this.del(`/weekly-reports/${reportId}/kpis/${kpiId}`);
  },

  /* 周报本周进展项 */
  addProgressItem(reportId, data) {
    return this.post(`/weekly-reports/${reportId}/progress-items`, data);
  },

  updateProgressItem(reportId, itemId, data) {
    return this.put(`/weekly-reports/${reportId}/progress-items/${itemId}`, data);
  },

  deleteProgressItem(reportId, itemId) {
    return this.del(`/weekly-reports/${reportId}/progress-items/${itemId}`);
  },

  /* 周报风险 */
  addRisk(reportId, data) {
    return this.post(`/weekly-reports/${reportId}/risks`, data);
  },

  updateRisk(reportId, riskId, data) {
    return this.put(`/weekly-reports/${reportId}/risks/${riskId}`, data);
  },

  deleteRisk(reportId, riskId) {
    return this.del(`/weekly-reports/${reportId}/risks/${riskId}`);
  },

  /* ------------------------------------------------------------------
     每周工作任务
     ------------------------------------------------------------------ */
  getWorkTasks(weekStart) {
    return this.get(`/work-tasks/?week_start=${weekStart}`);
  },

  createWorkTask(data) {
    return this.post('/work-tasks/', data);
  },

  /** 从周报下周计划导入工作任务 */
  importFromPlan(reportId, data) {
    return this.post(`/work-tasks/from-plan/${reportId}`, data);
  },

  updateWorkTask(id, data) {
    return this.put(`/work-tasks/${id}`, data);
  },

  deleteWorkTask(id) {
    return this.del(`/work-tasks/${id}`);
  },

  /* ------------------------------------------------------------------
     项目会议
     ------------------------------------------------------------------ */
  getMeetings() {
    return this.get('/meetings/');
  },

  getMeeting(id) {
    return this.get(`/meetings/${id}`);
  },

  createMeeting(data) {
    return this.post('/meetings/', data);
  },

  updateMeeting(id, data) {
    return this.put(`/meetings/${id}`, data);
  },

  deleteMeeting(id) {
    return this.del(`/meetings/${id}`);
  },

  addMeetingItem(meetingId, data) {
    return this.post(`/meetings/${meetingId}/items`, data);
  },

  updateMeetingItem(meetingId, itemId, data) {
    return this.put(`/meetings/${meetingId}/items/${itemId}`, data);
  },

  deleteMeetingItem(meetingId, itemId) {
    return this.del(`/meetings/${meetingId}/items/${itemId}`);
  },

  /* ------------------------------------------------------------------
     智能体 (Agent)
     ------------------------------------------------------------------ */
  getAgents(type) {
    return this.get(type ? `/agents/?type=${encodeURIComponent(type)}` : '/agents/');
  },

  getAgent(id) {
    return this.get(`/agents/${id}`);
  },

  createAgent(data) {
    return this.post('/agents/', data);
  },

  updateAgent(id, data) {
    return this.put(`/agents/${id}`, data);
  },

  deleteAgent(id) {
    return this.del(`/agents/${id}`);
  },

  getAgentSessions(agentId) {
    return this.get(`/agents/${agentId}/sessions`);
  },

  createAgentSession(agentId, data = {}) {
    return this.post(`/agents/${agentId}/sessions`, data);
  },

  updateSession(sessionId, data) {
    return this.patch(`/agents/sessions/${sessionId}`, data);
  },

  archiveSession(sessionId) {
    return this.del(`/agents/sessions/${sessionId}`);
  },

  getSessionMessages(sessionId) {
    return this.get(`/agents/sessions/${sessionId}/messages`);
  },

  /** Agent 调试 (非流式, 返回 {reply, trace, memories, session_id}; session_id 用于上下文记忆) */
  debugAgent(agentId, message, sessionId) {
    return this.post(`/agents/${agentId}/debug`, { message, session_id: sessionId || null });
  },

  /* 智能体记忆 */
  getAgentMemories(agentId, memoryType, projectId) {
    const params = [];
    if (memoryType) params.push(`memory_type=${encodeURIComponent(memoryType)}`);
    if (projectId) params.push(`project_id=${encodeURIComponent(projectId)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return this.get(`/agents/${agentId}/memories${qs}`);
  },

  createAgentMemory(agentId, data) {
    return this.post(`/agents/${agentId}/memories`, data);
  },

  updateAgentMemory(agentId, memoryId, data) {
    return this.put(`/agents/${agentId}/memories/${memoryId}`, data);
  },

  deleteAgentMemory(agentId, memoryId) {
    return this.del(`/agents/${agentId}/memories/${memoryId}`);
  },

  /* ------------------------------------------------------------------
     技能 (Skill)
     ------------------------------------------------------------------ */
  getSkills(category) {
    return this.get(category ? `/skills/?category=${encodeURIComponent(category)}` : '/skills/');
  },

  getSkill(id) {
    return this.get(`/skills/${id}`);
  },

  createSkill(data) {
    return this.post('/skills/', data);
  },

  updateSkill(id, data) {
    return this.put(`/skills/${id}`, data);
  },

  deleteSkill(id) {
    return this.del(`/skills/${id}`);
  },

  executeSkill(id, inputData = {}) {
    return this.post(`/skills/${id}/execute`, { input_data: inputData });
  },

  /** 技能调试执行 (不落记录; priorResults 为前几轮 steps, 支持上下文记忆) */
  testSkill(id, inputData = {}, priorResults = []) {
    return this.post(`/skills/${id}/test`, { input_data: inputData, prior_results: priorResults });
  },

  getSkillExecutions(id) {
    return this.get(`/skills/${id}/executions`);
  },

  /* ------------------------------------------------------------------
     工作台任务 (TaskRun)
     ------------------------------------------------------------------ */
  getTaskRuns(params = {}) {
    const query = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return this.get(`/task-runs/${query ? '?' + query : ''}`);
  },

  getTaskRun(id) {
    return this.get(`/task-runs/${id}`);
  },

  createTaskRun(data) {
    return this.post('/task-runs/', data);
  },

  deleteTaskRun(id) {
    return this.del(`/task-runs/${id}`);
  },

  /** 意图识别失败后的用户选择: 指定分身/技能, 任务继续执行 */
  chooseTaskRun(id, data) {
    return this.post(`/task-runs/${id}/choose`, data);
  },

  /** 任务会话消息列表 */
  getTaskRunMessages(id) {
    return this.get(`/task-runs/${id}/messages`);
  },

  /** 启动任务后台执行 (立即返回; 执行过程经 events SSE 订阅) */
  runTaskRun(id) {
    return this.post(`/task-runs/${id}/run`, {});
  },

  /** 任务继续对话 (后台执行) */
  continueTaskRun(id, payload) {
    return this.post(`/task-runs/${id}/continue`, payload);
  },

  /** 上传任务附件 (multipart) */
  async uploadTaskFile(file, projectId) {
    const formData = new FormData();
    formData.append('file', file);
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    const response = await fetch(`${this.baseUrl}/task-runs/files/upload${qs}`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      let msg = `上传失败 (${response.status})`;
      try { msg = (await response.json()).detail || msg; } catch (e) { /* 忽略 */ }
      throw new Error(msg);
    }
    return response.json();
  },

  getTaskFiles(projectId) {
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    return this.get(`/task-runs/files/list${qs}`);
  },

  deleteTaskFile(filename, projectId) {
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    return this.del(`/task-runs/files/${encodeURIComponent(filename)}${qs}`);
  },

  /* ------------------------------------------------------------------
     SSE 流式请求 (Agent 对话)
     ------------------------------------------------------------------ */
  /**
   * 发送 POST 并解析 SSE 事件流
   * @param {string} path - 路径 (不含 baseUrl)
   * @param {object} data - POST body
   * @param {(event: object) => void} onEvent - 每个 SSE data JSON 事件回调
   * @returns {Promise<void>}
   */
  async stream(path, data, onEvent) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      throw new Error(`请求失败 (${response.status})`);
    }
    await this._readSse(response, onEvent);
  },

  /**
   * GET 方式订阅 SSE 事件流 (任务执行过程回放/实时 tail)
   * @param {string} path - 路径 (不含 baseUrl)
   * @param {(event: object) => void} onEvent - 每个 SSE data JSON 事件回调
   * @param {AbortSignal} [signal] - 可选中止信号 (切换任务时断开旧流)
   * @returns {Promise<void>}
   */
  async streamGet(path, onEvent, signal) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' },
      signal,
    });
    if (!response.ok) {
      throw new Error(`请求失败 (${response.status})`);
    }
    await this._readSse(response, onEvent);
  },

  /** 读取 SSE 响应流并按事件回调 */
  async _readSse(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以 \n\n 分隔, data: 前缀
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()));
        } catch (e) {
          console.warn('[SSE] 事件解析失败', e, line);
        }
      }
    }
  }
};
