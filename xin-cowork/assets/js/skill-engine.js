/* ==========================================================================
   XIN 信 · 前端 Skill 引擎模块
   负责调用后端 API 执行 Skill,并将执行结果与执行历史渲染到页面
   ========================================================================== */

import { agentApi } from './agent-api.js';

/**
 * 前端 Skill 引擎对象
 */
export const skillEngine = {
  /**
   * 执行 Skill(调用 API)
   * @param {string|number} skillId - Skill ID
   * @param {object} inputData - 输入数据
   * @returns {Promise<object>} 执行结果
   */
  async executeSkill(skillId, inputData) {
    return agentApi.executeSkill(skillId, inputData);
  },

  /**
   * 渲染执行结果
   * @param {object} result - 执行结果对象
   * @param {HTMLElement} container - 容器元素
   */
  renderExecutionResult(result, container) {
    if (!container) return;
    // 判断执行状态
    const success = result && (result.status === 'success' || result.success === true);
    const statusText = success ? '执行成功' : '执行失败';
    const statusClass = success ? 'alert-success' : 'alert-error';
    container.innerHTML = `
      <div class="skill-execution-result">
        <div class="alert ${statusClass}">${statusText}</div>
        ${result?.output !== undefined ? `
          <div class="skill-execution-result__section">
            <div class="panel__title">输出</div>
            <pre class="code-block">${this._escape(this._format(result.output))}</pre>
          </div>` : ''}
        ${result?.error ? `
          <div class="skill-execution-result__section">
            <div class="panel__title">错误信息</div>
            <pre class="code-block">${this._escape(result.error)}</pre>
          </div>` : ''}
        ${result?.duration_ms !== undefined ? `
          <div class="text-muted">耗时: ${result.duration_ms} ms</div>` : ''}
      </div>`;
  },

  /**
   * 渲染执行历史
   * @param {Array} executions - 执行记录列表
   * @param {HTMLElement} container - 容器元素
   */
  renderExecutionHistory(executions, container) {
    if (!container) return;
    if (!Array.isArray(executions) || executions.length === 0) {
      container.innerHTML = `
        <div class="skill-execution-history">
          <div class="panel__title">执行历史</div>
          <div class="text-muted">暂无执行记录。</div>
        </div>`;
      return;
    }
    container.innerHTML = `
      <div class="skill-execution-history">
        <div class="panel__title">执行历史</div>
        ${executions.map(exec => {
          const success = exec.status === 'success' || exec.success === true;
          return `
            <div class="execution-item ${success ? 'execution-item--success' : 'execution-item--failed'}">
              <div class="execution-item__header">
                <span class="execution-item__status">${success ? '✓ 成功' : '✗ 失败'}</span>
                <span class="execution-item__time">${this._escape(exec.created_at || exec.time || '')}</span>
              </div>
              ${exec.output !== undefined ? `
                <pre class="code-block">${this._escape(this._format(exec.output))}</pre>` : ''}
              ${exec.error ? `<div class="execution-item__error">${this._escape(exec.error)}</div>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  },

  /** 将对象格式化为可读字符串 */
  _format(value) {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
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

export default skillEngine;
