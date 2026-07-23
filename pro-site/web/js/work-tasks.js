/* ==========================================================================
   每周工作任务模块 WorkTasks
   - 看板布局 (待开始 / 进行中 / 已完成)
   - 任务来源: 来自周报 (🔗) 或 临时任务 (⚡)
   - 可从周报下周计划导入
   ========================================================================== */

const WorkTasks = {
  // 当前周任务列表
  tasks: [],
  // 当前周开始日期
  currentWeekStart: '',

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    // 由 onShow 触发首次加载
  },

  /** 切换到此视图时触发 */
  onShow() {
    if (!this.currentWeekStart) {
      this.loadTasks();
    }
  },

  /** 周次切换回调 */
  onWeekChange(weekStr) {
    // weekStr 格式 YYYY-Www, 转换为该周周一日期
    this.currentWeekStart = App.weekToDate(weekStr, 1);
    this.loadTasks(this.currentWeekStart);
  },

  /* ------------------------------------------------------------------
   * 加载工作任务
   * ---------------------------------------------------------------- */
  async loadTasks(weekStart) {
    const view = document.getElementById('view-work-tasks');
    if (!view) return;

    // 如果未传入, 取当前选中周
    if (!weekStart) {
      const picker = document.getElementById('week-picker');
      if (picker && picker.value) {
        this.currentWeekStart = App.weekToDate(picker.value, 1);
      } else {
        const today = new Date();
        const day = today.getDay() || 7;
        today.setDate(today.getDate() - (day - 1));
        this.currentWeekStart = App.formatDate(today);
      }
      weekStart = this.currentWeekStart;
    } else {
      this.currentWeekStart = weekStart;
    }

    const range = App.weekRange(document.getElementById('week-picker')?.value || '');

    view.innerHTML = `
      <div class="view__header">
        <div>
          <div class="view__title">✅ 每周工作任务</div>
          <div class="view__subtitle">周次: ${App.escapeHtml(range.label || weekStart)}</div>
        </div>
        <div class="view__actions">
          <button class="btn btn-ghost btn-sm" id="wt-import-btn">📥 从周报导入</button>
          <button class="btn btn-ghost btn-sm" id="wt-export-btn">📄 导出PDF</button>
          <button class="btn btn-primary btn-sm" id="wt-add-btn">⚡ 新建临时任务</button>
        </div>
      </div>
      <div id="wt-kanban">${App.renderLoading('加载工作任务...')}</div>
    `;

    // 绑定按钮
    const importBtn = document.getElementById('wt-import-btn');
    const addBtn = document.getElementById('wt-add-btn');
    const exportBtn = document.getElementById('wt-export-btn');
    if (importBtn) importBtn.addEventListener('click', () => this.importFromPlan());
    if (addBtn) addBtn.addEventListener('click', () => this.addTemporaryTask());
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportToPdf());

    try {
      const data = await API.getWorkTasks(weekStart);
      this.tasks = Array.isArray(data) ? data : (data.items || []);
      this.renderKanban(this.tasks);
    } catch (err) {
      document.getElementById('wt-kanban').innerHTML =
        App.renderEmpty('加载失败', err.message, '⚠️');
      App.showToast(`加载工作任务失败: ${err.message}`, 'error');
    }
  },

  /** 渲染看板 (入口) */
  renderTasks(tasks) {
    this.renderKanban(tasks);
  },

  /* ------------------------------------------------------------------
   * 看板布局: 三列 (后端状态: 待开始/进行中/已完成)
   * ---------------------------------------------------------------- */
  renderKanban(tasks) {
    const container = document.getElementById('wt-kanban');
    if (!container) return;

    if (!tasks || tasks.length === 0) {
      container.innerHTML = App.renderEmpty('本周暂无任务', '点击右上角导入周报或新建任务', '✅');
      return;
    }

    // 分组 (兼容中文与英文状态值)
    const isTodo = s => s === 'todo' || s === '待开始' || !s;
    const isDoing = s => s === 'in_progress' || s === 'doing' || s === '进行中';
    const isDone = s => s === 'done' || s === 'completed' || s === '已完成';

    const todoList = tasks.filter(t => isTodo(t.status));
    const doingList = tasks.filter(t => isDoing(t.status));
    const doneList = tasks.filter(t => isDone(t.status));

    container.innerHTML = `
      <div class="kanban">
        <div class="kanban__column kanban__column--todo">
          <div class="kanban__column-header">
            <div class="kanban__column-title">待开始</div>
            <div class="kanban__column-count">${todoList.length}</div>
          </div>
          <div class="kanban__column-body" data-status="todo">
            ${todoList.map(t => this.renderTaskCard(t)).join('') || '<div class="empty-state"><div class="empty-state__hint">空</div></div>'}
          </div>
        </div>
        <div class="kanban__column kanban__column--doing">
          <div class="kanban__column-header">
            <div class="kanban__column-title">进行中</div>
            <div class="kanban__column-count">${doingList.length}</div>
          </div>
          <div class="kanban__column-body" data-status="in_progress">
            ${doingList.map(t => this.renderTaskCard(t)).join('') || '<div class="empty-state"><div class="empty-state__hint">空</div></div>'}
          </div>
        </div>
        <div class="kanban__column kanban__column--done">
          <div class="kanban__column-header">
            <div class="kanban__column-title">已完成</div>
            <div class="kanban__column-count">${doneList.length}</div>
          </div>
          <div class="kanban__column-body" data-status="done">
            ${doneList.map(t => this.renderTaskCard(t)).join('') || '<div class="empty-state"><div class="empty-state__hint">空</div></div>'}
          </div>
        </div>
      </div>
    `;

    // 绑定卡片事件
    this.bindKanbanEvents();
  },

  /* ------------------------------------------------------------------
   * 渲染单个任务卡片
   * ---------------------------------------------------------------- */
  renderTaskCard(task) {
    const mod = App.getModule(task.module_id);
    const color = App.getModuleColor(task.module_id);

    // 来源标记: 有 plan_task_id 表示来自周报
    const isFromPlan = !!task.plan_task_id;
    const sourceBadge = isFromPlan
      ? `<span class="badge badge--primary" title="来自周报下周计划">🔗 周报</span>`
      : `<span class="badge badge--gray" title="临时任务">⚡ 临时</span>`;

    // 优先级
    const priorityMap = {
      'high':   { cls: 'badge--danger',  label: '高优先级' },
      'medium': { cls: 'badge--warning', label: '中' },
      'low':    { cls: 'badge--gray',    label: '低' }
    };
    const pri = priorityMap[task.priority] || priorityMap.medium;
    const hours = task.planned_hours || task.actual_hours || 0;
    const isDone = task.status === 'done' || task.status === 'completed' || task.status === '已完成';

    return `
      <div class="task-item" data-task-id="${task.id}">
        <div class="task-item__header">
          <div class="task-item__name">${App.escapeHtml(task.name || '')}</div>
          ${sourceBadge}
        </div>
        <div class="task-item__meta">
          ${mod ? `<span class="task-item__meta-item"><span class="tag tag--${color}">${App.escapeHtml(mod.title)}</span></span>` : ''}
          ${task.owner ? `<span class="task-item__meta-item">👤 ${App.escapeHtml(task.owner)}</span>` : ''}
          <span class="task-item__meta-item"><span class="badge ${pri.cls}">${pri.label}</span></span>
          ${hours ? `<span class="task-item__meta-item">⏱ ${hours}h</span>` : ''}
        </div>
        <div class="task-item__actions">
          <button class="btn-icon" data-action="edit" data-id="${task.id}" title="编辑">✏️</button>
          ${!isDone
            ? `<button class="btn-icon" data-action="advance" data-id="${task.id}" title="推进到下一状态">→</button>`
            : `<button class="btn-icon" data-action="advance" data-id="${task.id}" data-value="todo" title="重置为待开始">↺</button>`
          }
          <button class="btn-icon" data-action="delete" data-id="${task.id}" title="删除">🗑</button>
        </div>
      </div>
    `;
  },

  /* ------------------------------------------------------------------
   * 看板事件绑定
   * ---------------------------------------------------------------- */
  bindKanbanEvents() {
    const container = document.getElementById('wt-kanban');
    if (!container) return;

    // 卡片点击 -> 显示详情
    container.querySelectorAll('.task-item[data-task-id]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const id = item.getAttribute('data-task-id');
        const task = this.tasks.find(t => String(t.id) === String(id));
        if (task) this.showTaskDetail(task);
      });
    });

    // 编辑任务
    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        this.editTask(id);
      });
    });

    // 推进状态
    container.querySelectorAll('[data-action="advance"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const resetValue = btn.getAttribute('data-value');
        const task = this.tasks.find(t => String(t.id) === String(id));
        if (!task) return;
        const next = resetValue === 'todo' ? '待开始' : this.nextStatus(task.status);
        this.updateStatus(id, next);
      });
    });

    // 删除
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (!confirm('确认删除该任务?')) return;
        try {
          await API.deleteWorkTask(id);
          App.showToast('已删除', 'success');
          this.loadTasks(this.currentWeekStart);
        } catch (err) {
          App.showToast(`删除失败: ${err.message}`, 'error');
        }
      });
    });
  },

  /** 导出每周工作任务看板为 PDF (看板多列转单列, 便于阅读) */
  exportToPdf() {
    const kanban = document.getElementById('wt-kanban');
    if (!kanban) {
      App.showToast('没有可导出的内容', 'error');
      return;
    }
    const weekStart = this.currentWeekStart || '';
    const safeName = `每周工作任务_${weekStart}`.replace(/[\\/:*?"<>|]/g, '_');
    // 文件名已含周次日期, 不再追加导出日期
    App.exportToPdf(kanban, safeName, {
      addDate: false,
      prepareClone: (clone) => {
        // 看板多列布局转单列, 便于 PDF 阅读
        const kanbanEl = clone.querySelector('.kanban');
        if (kanbanEl) {
          kanbanEl.style.flexDirection = 'column';
          kanbanEl.style.gap = '16px';
        }
        clone.querySelectorAll('.kanban__column').forEach(col => {
          col.style.width = '100%';
          col.style.flex = 'none';
          col.style.minWidth = '0';
        });
        clone.querySelectorAll('.kanban__column-body').forEach(body => {
          body.style.overflow = 'visible';
          body.style.maxHeight = 'none';
          body.style.height = 'auto';
        });
      }
    });
  },

  /** 取下一状态 (后端使用中文状态值) */
  nextStatus(current) {
    // 兼容英文与中文状态值
    const normalize = (s) => {
      if (s === 'todo' || s === '待开始' || !s) return '待开始';
      if (s === 'in_progress' || s === 'doing' || s === '进行中') return '进行中';
      if (s === 'done' || s === 'completed' || s === '已完成') return '已完成';
      return '待开始';
    };
    const order = ['待开始', '进行中', '已完成'];
    const idx = order.indexOf(normalize(current));
    if (idx < 0) return '进行中';
    return order[(idx + 1) % order.length];
  },

  /* ------------------------------------------------------------------
   * 从周报导入
   * ---------------------------------------------------------------- */
  async importFromPlan() {
    // 弹出周报选择器
    let reports = [];
    try {
      const data = await API.getWeeklyReports();
      reports = Array.isArray(data) ? data : (data.items || []);
    } catch (err) {
      App.showToast(`加载周报列表失败: ${err.message}`, 'error');
      return;
    }

    if (reports.length === 0) {
      App.showToast('当前没有可用周报', 'warning');
      return;
    }

    const modal = App.openModal({
      title: '从周报导入下周任务',
      bodyHtml: `
        <div class="form-group">
          <label>选择周报</label>
          <select id="wt-import-report">
            ${reports.map(r => `<option value="${r.id}">${App.escapeHtml(r.title || r.week_start || '')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>导入到周次</label>
          <input type="week" id="wt-import-week" value="${document.getElementById('week-picker')?.value || ''}">
        </div>
        <div class="text-xs text-tertiary">
          导入后, 该周报的"下周计划任务"会被创建为本周工作任务, 并保留关联关系。
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="wt-import-confirm">导入</button>
      `
    });

    modal.querySelector('#wt-import-confirm').addEventListener('click', async () => {
      const reportId = modal.querySelector('#wt-import-report').value;
      const weekStr = modal.querySelector('#wt-import-week').value;

      if (!reportId) {
        App.showToast('请选择周报', 'warning');
        return;
      }
      if (!weekStr) {
        App.showToast('请选择导入周次', 'warning');
        return;
      }

      const weekStart = App.weekToDate(weekStr, 1);
      const weekEnd = App.weekToDate(weekStr, 7);

      try {
        // 后端 FromPlanRequest: { week_start, week_end }
        const result = await API.importFromPlan(reportId, {
          week_start: weekStart,
          week_end: weekEnd
        });
        const count = Array.isArray(result) ? result.length : (result?.imported_count || result?.count || '?');
        App.showToast(`成功导入 ${count} 个任务`, 'success');
        App.closeModal(modal);
        // 如果导入的就是当前周, 刷新看板
        if (weekStart === this.currentWeekStart) {
          this.loadTasks(this.currentWeekStart);
        }
      } catch (err) {
        App.showToast(`导入失败: ${err.message}`, 'error');
      }
    });
  },

  /* ------------------------------------------------------------------
   * 新增临时任务
   * ---------------------------------------------------------------- */
  addTemporaryTask() {
    // 状态值映射: 前端英文 -> 后端中文
    const statusMap = { 'todo': '待开始', 'in_progress': '进行中', 'done': '已完成' };

    const modal = App.openModal({
      title: '新建临时任务',
      bodyHtml: `
        <div class="form-group">
          <label>任务名称 *</label>
          <input type="text" id="wt-name" placeholder="任务名称">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>所属模块</label>
            <select id="wt-module">
              <option value="">— 请选择 —</option>
              ${App.state.modules.map(m => `<option value="${m.id}">${App.escapeHtml(m.title)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>负责人</label>
            <input type="text" id="wt-owner" placeholder="姓名">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>优先级</label>
            <select id="wt-priority">
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="low">低</option>
            </select>
          </div>
          <div class="form-group">
            <label>预估工时 (小时)</label>
            <input type="number" id="wt-hours" min="0" step="0.5" placeholder="0">
          </div>
        </div>
        <div class="form-group">
          <label>状态</label>
          <select id="wt-status">
            <option value="todo">待开始</option>
            <option value="in_progress">进行中</option>
          </select>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="wt-save-btn">创建</button>
      `
    });

    modal.querySelector('#wt-save-btn').addEventListener('click', async () => {
      const name = modal.querySelector('#wt-name').value.trim();
      if (!name) {
        App.showToast('请输入任务名称', 'warning');
        return;
      }

      const weekStr = document.getElementById('week-picker')?.value || '';
      const weekStart = this.currentWeekStart || App.weekToDate(weekStr, 1);
      const weekEnd = App.weekToDate(weekStr, 7) || weekStart;

      const statusVal = modal.querySelector('#wt-status').value;
      const hours = parseFloat(modal.querySelector('#wt-hours').value) || 0;

      // 后端 WeeklyWorkTaskCreate 字段: week_start, week_end, plan_task_id, name, module_id, owner,
      //                                    is_temporary, priority, status, planned_hours, actual_hours, remark, sort_order
      const payload = {
        name,
        module_id: modal.querySelector('#wt-module').value ? parseInt(modal.querySelector('#wt-module').value, 10) : null,
        owner: modal.querySelector('#wt-owner').value.trim() || '',
        is_temporary: true,
        priority: modal.querySelector('#wt-priority').value,
        status: statusMap[statusVal] || '待开始',
        planned_hours: hours,
        week_start: weekStart,
        week_end: weekEnd
      };

      try {
        await API.createWorkTask(payload);
        App.showToast('临时任务已创建', 'success');
        App.closeModal(modal);
        this.loadTasks(this.currentWeekStart);
      } catch (err) {
        App.showToast(`创建失败: ${err.message}`, 'error');
      }
    });
  },

  /* ------------------------------------------------------------------
   * 编辑工作任务 (完整表单)
   * ---------------------------------------------------------------- */
  editTask(id) {
    const task = this.tasks.find(t => String(t.id) === String(id));
    if (!task) {
      App.showToast('未找到任务', 'error');
      return;
    }

    const modal = App.openModal({
      title: '编辑工作任务',
      bodyHtml: `
        <div class="form-group">
          <label>任务名称 *</label>
          <input type="text" id="wt-edit-name" value="${App.escapeHtml(task.name || '')}" placeholder="任务名称">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>所属模块</label>
            <select id="wt-edit-module">
              <option value="">— 请选择 —</option>
              ${App.state.modules.map(m => `<option value="${m.id}" ${String(task.module_id) === String(m.id) ? 'selected' : ''}>${App.escapeHtml(m.title)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label>负责人</label>
            <input type="text" id="wt-edit-owner" value="${App.escapeHtml(task.owner || '')}" placeholder="姓名">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>优先级</label>
            <select id="wt-edit-priority">
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>高</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>中</option>
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>低</option>
            </select>
          </div>
          <div class="form-group">
            <label>状态</label>
            <select id="wt-edit-status">
              <option value="待开始" ${task.status === '待开始' ? 'selected' : ''}>待开始</option>
              <option value="进行中" ${task.status === '进行中' ? 'selected' : ''}>进行中</option>
              <option value="已完成" ${task.status === '已完成' ? 'selected' : ''}>已完成</option>
              <option value="已取消" ${task.status === '已取消' ? 'selected' : ''}>已取消</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>计划工时 (小时)</label>
            <input type="number" id="wt-edit-planned-hours" min="0" step="0.5" value="${task.planned_hours != null ? task.planned_hours : ''}" placeholder="0">
          </div>
          <div class="form-group">
            <label>实际工时 (小时)</label>
            <input type="number" id="wt-edit-actual-hours" min="0" step="0.5" value="${task.actual_hours != null ? task.actual_hours : ''}" placeholder="0">
          </div>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:normal;">
            <input type="checkbox" id="wt-edit-temporary" ${task.is_temporary ? 'checked' : ''} style="width:auto;margin:0;">
            <span>临时任务 (非周报来源)</span>
          </label>
        </div>
        <div class="form-group">
          <label>备注</label>
          <textarea id="wt-edit-remark" placeholder="备注说明">${App.escapeHtml(task.remark || '')}</textarea>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="wt-edit-save-btn">保存</button>
      `
    });

    modal.querySelector('#wt-edit-save-btn').addEventListener('click', async () => {
      const name = modal.querySelector('#wt-edit-name').value.trim();
      if (!name) {
        App.showToast('请输入任务名称', 'warning');
        return;
      }

      const plannedHours = parseFloat(modal.querySelector('#wt-edit-planned-hours').value);
      const actualHours = parseFloat(modal.querySelector('#wt-edit-actual-hours').value);

      const payload = {
        name,
        module_id: modal.querySelector('#wt-edit-module').value
          ? parseInt(modal.querySelector('#wt-edit-module').value, 10)
          : null,
        owner: modal.querySelector('#wt-edit-owner').value.trim() || '',
        is_temporary: modal.querySelector('#wt-edit-temporary').checked,
        priority: modal.querySelector('#wt-edit-priority').value,
        status: modal.querySelector('#wt-edit-status').value,
        planned_hours: isNaN(plannedHours) ? 0 : plannedHours,
        actual_hours: isNaN(actualHours) ? 0 : actualHours,
        remark: modal.querySelector('#wt-edit-remark').value.trim()
      };

      try {
        await API.updateWorkTask(id, payload);
        App.showToast('任务已更新', 'success');
        App.closeModal(modal);
        this.loadTasks(this.currentWeekStart);
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /* ------------------------------------------------------------------
   * 更新任务状态
   * ---------------------------------------------------------------- */
  async updateStatus(id, status) {
    try {
      await API.updateWorkTask(id, { status });
      // 更新本地缓存
      const task = this.tasks.find(t => String(t.id) === String(id));
      if (task) task.status = status;
      App.showToast('状态已更新', 'success');
      this.renderKanban(this.tasks);
    } catch (err) {
      App.showToast(`更新失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 右栏显示关联详情 (周报下周任务和进度计划任务)
   * ---------------------------------------------------------------- */
  showTaskDetail(task) {
    const mod = App.getModule(task.module_id);
    const color = App.getModuleColor(task.module_id);

    const isFromPlan = !!task.plan_task_id;
    const sourceHtml = isFromPlan ? `
      <div class="detail-section">
        <div class="detail-section__label">来源</div>
        <div class="detail-section__value">
          <span class="badge badge--primary">🔗 来自周报下周任务</span>
          ${task.plan_task?.report_id ? `<div class="text-xs text-tertiary" style="margin-top:4px;">周报 #${App.escapeHtml(String(task.plan_task.report_id))} · 下周任务 #${App.escapeHtml(String(task.plan_task.id))}</div>` : ''}
        </div>
      </div>
    ` : `
      <div class="detail-section">
        <div class="detail-section__label">来源</div>
        <div class="detail-section__value">
          <span class="badge badge--gray">⚡ 临时任务</span>
        </div>
      </div>
    `;

    let linkedPlanHtml = '';
    if (task.plan_task_id && task.plan_task) {
      const pt = task.plan_task;
      // plan_task 内嵌套 progress_task (关联链路终点)
      let progHtml = '';
      if (pt.progress_task) {
        const prog = pt.progress_task;
        const phase = App.getPhase(prog.phase_id);
        progHtml = `
          <div class="detail-section">
            <div class="detail-section__label">关联的进度计划任务</div>
            <div class="detail-section__value">
              🔗 <strong>${App.escapeHtml(prog.name || '')}</strong>
              <div class="text-xs text-tertiary" style="margin-top:4px;">UID: ${App.escapeHtml(prog.task_uid || '')}</div>
              ${phase ? `<div style="margin-top:4px;"><span class="tag tag--blue">${App.escapeHtml(phase.name)}</span></div>` : ''}
              ${prog.start_date ? `<div class="text-xs text-tertiary" style="margin-top:4px;">📅 ${App.escapeHtml(App.formatDate(prog.start_date))} ~ ${App.escapeHtml(App.formatDate(prog.end_date))}</div>` : ''}
              ${prog.owner ? `<div class="text-xs text-tertiary" style="margin-top:4px;">👤 ${App.escapeHtml(prog.owner)}</div>` : ''}
            </div>
          </div>
        `;
      } else {
        progHtml = `
          <div class="detail-section">
            <div class="detail-section__label">关联的进度计划任务</div>
            <div class="detail-section__value text-tertiary">未关联</div>
          </div>
        `;
      }

      // 周报下周任务详情
      const ptMod = App.getModule(pt.module_id);
      const ptColor = App.getModuleColor(pt.module_id);
      linkedPlanHtml = `
        <div class="detail-section">
          <div class="detail-section__label">关联的周报下周任务</div>
          <div class="detail-section__value">
            📌 <strong>${App.escapeHtml(pt.name || '')}</strong>
            <div class="text-xs text-tertiary" style="margin-top:4px;">下周任务 #${App.escapeHtml(String(pt.id))}</div>
            ${ptMod ? `<div style="margin-top:4px;"><span class="tag tag--${ptColor}">${App.escapeHtml(ptMod.title)}</span></div>` : ''}
            ${pt.owner ? `<div class="text-xs text-tertiary" style="margin-top:4px;">👤 ${App.escapeHtml(pt.owner)}</div>` : ''}
          </div>
        </div>
        ${progHtml}
      `;
    }

    const priorityMap = {
      'high':   { cls: 'badge--danger',  label: '高优先级' },
      'medium': { cls: 'badge--warning', label: '中' },
      'low':    { cls: 'badge--gray',    label: '低' }
    };
    const pri = priorityMap[task.priority] || priorityMap.medium;
    const hours = task.planned_hours || task.actual_hours || 0;

    App.showDetail(`
      <div class="detail-panel__header">
        <div class="detail-panel__title">✅ 工作任务</div>
        <div class="detail-panel__meta">周次: ${App.escapeHtml(this.currentWeekStart || '')}</div>
      </div>
      <div class="detail-panel__body">
        <div class="detail-section">
          <div class="detail-section__label">任务名称</div>
          <div class="detail-section__value font-bold">${App.escapeHtml(task.name || '')}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">所属模块</div>
          <div class="detail-section__value">
            ${mod ? `<span class="tag tag--${color}">${App.escapeHtml(mod.title)}</span>` : '<span class="text-tertiary">未指定</span>'}
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">负责人</div>
          <div class="detail-section__value">${App.escapeHtml(task.owner || '—')}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">优先级</div>
          <div class="detail-section__value"><span class="badge ${pri.cls}">${pri.label}</span></div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">预估工时</div>
          <div class="detail-section__value">
            ${hours}
            <span class="text-tertiary text-sm">小时</span>
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">状态</div>
          <div class="detail-section__value">${App.statusBadge(task.status || '待开始')}</div>
        </div>
        ${sourceHtml}
        ${linkedPlanHtml}
      </div>
    `);
  }
};
