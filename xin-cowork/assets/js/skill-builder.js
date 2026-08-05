/* ==========================================================================
   XIN 信 · Skill 构建器模块
   提供 Skill 的可视化创建与编辑能力,包括基本信息表单、
   工具链步骤编排、保存与测试执行
   ========================================================================== */

import { agentApi } from './agent-api.js';
import { skillEngine } from './skill-engine.js';

/**
 * Skill 构建器对象
 */
export const skillBuilder = {
  /** 当前编辑的 Skill ID (新建时为 null) */
  skillId: null,
  /** 当前容器元素 */
  container: null,
  /** 工具链步骤列表 */
  steps: [],

  /**
   * 初始化构建器(新建或编辑)
   * @param {HTMLElement} container - 容器元素
   * @param {string|number} [skillId] - Skill ID,不传则为新建
   */
  async init(container, skillId) {
    this.container = container;
    this.skillId = skillId || null;
    this.steps = [];
    let skill = null;
    // 编辑模式下加载已有 Skill 数据
    if (this.skillId) {
      try {
        skill = await agentApi.getSkill(this.skillId);
        // 解析已有配置中的步骤
        this.steps = Array.isArray(skill?.config?.steps) ? [...skill.config.steps] : [];
      } catch (err) {
        console.error('[SkillBuilder] 加载 Skill 失败:', err);
      }
    }
    this.renderForm(skill);
  },

  /**
   * 渲染 Skill 表单(名称、描述、分类、触发类型、配置、代码)
   * @param {object|null} skill - 已有 Skill 数据,新建时为 null
   */
  renderForm(skill) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="cowork-page-header">
        <h2>${this.skillId ? '编辑 Skill' : '新建 Skill'}</h2>
      </div>
      <form id="skill-builder-form" class="form">
        <div class="form__field">
          <label class="form__label">名称</label>
          <input type="text" name="name" class="form__input" value="${this._escape(skill?.name || '')}" required>
        </div>
        <div class="form__field">
          <label class="form__label">描述</label>
          <textarea name="description" class="form__input" rows="3">${this._escape(skill?.description || '')}</textarea>
        </div>
        <div class="form__field">
          <label class="form__label">分类</label>
          <select name="category" class="form__input">
            ${['通用', '数据处理', '内容生成', '检索分析', '集成调用'].map(c => `
              <option value="${c}" ${skill?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form__field">
          <label class="form__label">触发类型</label>
          <select name="trigger_type" class="form__input">
            <option value="manual" ${skill?.trigger_type === 'manual' ? 'selected' : ''}>手动触发</option>
            <option value="intent" ${skill?.trigger_type === 'intent' ? 'selected' : ''}>意图识别</option>
            <option value="schedule" ${skill?.trigger_type === 'schedule' ? 'selected' : ''}>定时触发</option>
          </select>
        </div>
        <div class="form__field">
          <label class="form__label">工具链步骤</label>
          <div id="skill-steps"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="skill-add-step">+ 添加步骤</button>
        </div>
        <div class="form__field">
          <label class="form__label">执行代码</label>
          <textarea name="code" class="form__input" rows="8" placeholder="# Skill 执行逻辑代码">${this._escape(skill?.code || '')}</textarea>
        </div>
        <div class="form__actions">
          <button type="submit" class="btn btn-primary">保存</button>
          <button type="button" class="btn btn-ghost" id="skill-test-btn">测试执行</button>
        </div>
      </form>
      <div id="skill-test-result" style="margin-top:16px;"></div>`;

    // 渲染步骤列表
    this.renderSteps();
    // 绑定表单提交(保存)
    this.container.querySelector('#skill-builder-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSkill();
    });
    // 绑定测试执行按钮
    this.container.querySelector('#skill-test-btn').addEventListener('click', () => {
      this.testSkill();
    });
    // 绑定添加步骤按钮
    this.container.querySelector('#skill-add-step').addEventListener('click', () => {
      this.addStep();
    });
  },

  /** 保存 Skill(新建或更新) */
  async saveSkill() {
    const form = this.container.querySelector('#skill-builder-form');
    if (!form) return;
    const formData = new FormData(form);
    // 组装提交数据,工具链步骤放入 config 中
    const data = {
      name: formData.get('name'),
      description: formData.get('description'),
      category: formData.get('category'),
      trigger_type: formData.get('trigger_type'),
      code: formData.get('code'),
      config: { steps: this.steps }
    };
    try {
      if (this.skillId) {
        await agentApi.updateSkill(this.skillId, data);
      } else {
        const created = await agentApi.createSkill(data);
        this.skillId = created?.id || this.skillId;
      }
      // 保存成功后返回列表页
      window.location.hash = '#/cowork/skills';
    } catch (err) {
      console.error('[SkillBuilder] 保存失败:', err);
      alert('保存失败: ' + err.message);
    }
  },

  /** 测试执行 Skill */
  async testSkill() {
    const resultEl = this.container.querySelector('#skill-test-result');
    if (!resultEl) return;
    // 测试前需先保存(后端按 ID 执行)
    if (!this.skillId) {
      resultEl.innerHTML = '<div class="alert alert-warning">请先保存 Skill,再进行测试执行。</div>';
      return;
    }
    resultEl.innerHTML = '<div class="spinner"></div>';
    try {
      // 收集表单中的代码作为测试输入
      const form = this.container.querySelector('#skill-builder-form');
      const input = { test: true, code: new FormData(form).get('code') };
      const result = await skillEngine.executeSkill(this.skillId, input);
      skillEngine.renderExecutionResult(result, resultEl);
    } catch (err) {
      console.error('[SkillBuilder] 测试执行失败:', err);
      resultEl.innerHTML = `<div class="alert alert-error">执行失败: ${this._escape(err.message)}</div>`;
    }
  },

  /** 添加执行步骤 */
  addStep() {
    // 默认步骤: 调用工具,名称为空待填写
    this.steps.push({ name: '', tool: '', params: {} });
    this.renderSteps();
  },

  /**
   * 移除指定索引的步骤
   * @param {number} index - 步骤索引
   */
  removeStep(index) {
    this.steps.splice(index, 1);
    this.renderSteps();
  },

  /** 渲染工具链步骤列表 */
  renderSteps() {
    const stepsEl = this.container?.querySelector('#skill-steps');
    if (!stepsEl) return;
    if (this.steps.length === 0) {
      stepsEl.innerHTML = '<div class="text-muted">暂无步骤,点击下方按钮添加。</div>';
      return;
    }
    stepsEl.innerHTML = this.steps.map((step, i) => `
      <div class="skill-step" data-index="${i}">
        <span class="skill-step__order">${i + 1}</span>
        <input type="text" class="form__input skill-step__name" placeholder="步骤名称"
               value="${this._escape(step.name || '')}" data-index="${i}" data-field="name">
        <input type="text" class="form__input skill-step__tool" placeholder="工具/动作"
               value="${this._escape(step.tool || '')}" data-index="${i}" data-field="tool">
        <button type="button" class="btn btn-ghost btn-sm skill-step__remove" data-index="${i}">移除</button>
      </div>`).join('');

    // 绑定步骤字段输入事件
    stepsEl.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.index);
        const field = input.dataset.field;
        if (this.steps[index]) this.steps[index][field] = input.value;
      });
    });
    // 绑定移除按钮事件
    stepsEl.querySelectorAll('.skill-step__remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.removeStep(Number(btn.dataset.index));
      });
    });
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

export default skillBuilder;
