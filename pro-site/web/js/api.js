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

  getPhases() {
    return this.get('/phases/');
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
     项目例会
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
  }
};
