/* ==========================================================================
   个人周报模块 PersonalReport (项目驾驶舱)
   - 选择人员 + 周报周期 (YYYY/MM/DD - YYYY/MM/DD, 周一~周日) 后填写
   - 本周工作内容: 动态行 (项目名称/周一~周日/参与人员/交付物/工时H)
   - 下周工作计划: 动态行 (项目名称/计划内容)
   - 实时计算本周工作总工时
   ========================================================================== */

const PersonalReport = {
  // 全部项目
  projects: [],
  // 当前激活项目的成员 (人员选择器)
  members: [],
  // 成员姓名 -> 所属项目数组 (跨项目归属, 用于工作行项目下拉)
  memberProjects: {},
  // 当前选择
  currentMember: '',
  currentWeekStart: '',   // YYYY-MM-DD (周一)
  // 已存在的周报 (null = 未填报)
  currentReport: null,

  DAYS: [
    { key: 'mon', label: '周一' },
    { key: 'tue', label: '周二' },
    { key: 'wed', label: '周三' },
    { key: 'thu', label: '周四' },
    { key: 'fri', label: '周五' },
    { key: 'sat', label: '周六' },
    { key: 'sun', label: '周日' },
  ],

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    // 首次切换到本视图时加载
  },

  /** 切换到此视图时触发 */
  onShow() {
    this.loadPage();
  },

  /* ------------------------------------------------------------------
   * 日期工具
   * ---------------------------------------------------------------- */
  /** 取所在周周一 */
  mondayOf(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay() || 7; // 周日=7
    date.setDate(date.getDate() - (day - 1));
    return date;
  },

  /** Date -> YYYY-MM-DD */
  fmt(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  /** Date -> YYYY/MM/DD */
  fmtSlash(d) {
    return this.fmt(d).replace(/-/g, '/');
  },

  /** 周一日期串 -> 周期标签 "2026/08/03 - 2026/08/09" */
  weekLabel(weekStart) {
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${this.fmtSlash(start)} - ${this.fmtSlash(end)}`;
  },

  /** 周期选项: 过去 10 周 ~ 未来 1 周 */
  weekOptions() {
    const thisMonday = this.mondayOf(new Date());
    const opts = [];
    for (let i = -10; i <= 1; i++) {
      const d = new Date(thisMonday);
      d.setDate(d.getDate() + i * 7);
      opts.push(this.fmt(d));
    }
    return opts.reverse(); // 最近的在前
  },

  /* ------------------------------------------------------------------
   * 页面加载
   * ---------------------------------------------------------------- */
  async loadPage() {
    const view = document.getElementById('view-personal-report');
    if (!view) return;

    view.innerHTML = `
      <div class="view__header">
        <div>
          <div class="view__title">✍️ 个人周报</div>
          <div class="view__subtitle">选择人员与周报周期, 填写本周工作内容与下周工作计划</div>
        </div>
        <div class="view__actions">
          <button class="btn btn-primary btn-sm" id="pr-save-btn">💾 保存周报</button>
        </div>
      </div>
      <div id="pr-body">${App.renderLoading()}</div>
    `;
    document.getElementById('pr-save-btn')
      .addEventListener('click', () => this.save());

    try {
      // 并行加载: 全部项目 + 当前激活项目成员
      const [projects, activeProject] = await Promise.all([
        API.getProjects(),
        API.getActiveProject(),
      ]);
      this.projects = (projects || []).filter(p => (p.status || '进行中') !== '已停止');
      const activeId = activeProject ? activeProject.id : null;

      // 各项目成员 (构建 姓名 -> 项目 归属映射)
      const memberLists = await Promise.all(
        (projects || []).map(p => API.getProjectMembers(p.id).catch(() => []))
      );
      this.memberProjects = {};
      (projects || []).forEach((p, i) => {
        (memberLists[i] || []).forEach(m => {
          if (!this.memberProjects[m.name]) this.memberProjects[m.name] = [];
          this.memberProjects[m.name].push({ id: p.id, name: p.name, status: m.status });
        });
      });

      // 人员选择器 = 当前激活项目成员 (在职优先)
      const activeMembers = activeId
        ? (memberLists[(projects || []).findIndex(p => p.id === activeId)] || [])
        : [];
      this.members = [...activeMembers].sort((a, b) => {
        const ao = (a.status || '在职') === '在职' ? 0 : 1;
        const bo = (b.status || '在职') === '在职' ? 0 : 1;
        return ao - bo || a.sort_order - b.sort_order || a.id - b.id;
      });

      // 默认选择: 保留原选择, 否则第一个在职成员
      if (!this.currentMember || !this.members.some(m => m.name === this.currentMember)) {
        const first = this.members.find(m => (m.status || '在职') === '在职') || this.members[0];
        this.currentMember = first ? first.name : '';
      }
      // 默认周期: 本周周一
      if (!this.currentWeekStart) {
        this.currentWeekStart = this.fmt(this.mondayOf(new Date()));
      }

      this.renderBody();
      await this.loadReport();
    } catch (err) {
      document.getElementById('pr-body').innerHTML =
        App.renderEmpty('加载失败', err.message, '⚠️');
      App.showToast(`加载失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 渲染选择区 + 表单骨架
   * ---------------------------------------------------------------- */
  renderBody() {
    const body = document.getElementById('pr-body');
    if (!body) return;

    if (this.members.length === 0) {
      body.innerHTML = App.renderEmpty(
        '当前项目还没有成员',
        '请先到"项目成员"页面维护项目成员',
        '👤'
      );
      return;
    }

    const memberOpts = this.members.map(m => {
      const tag = (m.status || '在职') === '在职' ? '' : ' (已退出)';
      return `<option value="${App.escapeHtml(m.name)}" ${m.name === this.currentMember ? 'selected' : ''}>${App.escapeHtml(m.name)}${tag}</option>`;
    }).join('');

    const weekOpts = this.weekOptions().map(ws =>
      `<option value="${ws}" ${ws === this.currentWeekStart ? 'selected' : ''}>${this.weekLabel(ws)}</option>`
    ).join('');

    body.innerHTML = `
      <div class="card">
        <div class="card__body pr-selector-bar">
          <div class="form-group" style="margin:0;min-width:160px;">
            <label>人员</label>
            <select id="pr-member-select">${memberOpts}</select>
          </div>
          <div class="form-group" style="margin:0;min-width:240px;">
            <label>周报周期 (周一 ~ 周日)</label>
            <select id="pr-week-select">${weekOpts}</select>
          </div>
          <div id="pr-status"></div>
        </div>
      </div>

      <div class="card" style="margin-top:14px;">
        <div class="card__header">
          <div class="card__title">本周工作内容</div>
          <button class="btn btn-ghost btn-sm" id="pr-add-work">＋ 添加工作行</button>
        </div>
        <div class="card__body pr-table-wrap">
          <table class="pr-table" id="pr-work-table">
            <thead>
              <tr>
                <th style="min-width:130px;">项目名称</th>
                ${this.DAYS.map((d, i) => {
                  const date = new Date(`${this.currentWeekStart}T00:00:00`);
                  date.setDate(date.getDate() + i);
                  return `<th class="pr-day-col">${d.label}<br><span class="pr-day-date">${date.getMonth() + 1}/${date.getDate()}</span></th>`;
                }).join('')}
                <th style="min-width:90px;">参与人员</th>
                <th style="min-width:90px;">交付物</th>
                <th style="width:64px;">工时(H)</th>
                <th style="width:40px;"></th>
              </tr>
            </thead>
            <tbody id="pr-work-tbody"></tbody>
          </table>
        </div>
        <div class="card__footer pr-total-bar">
          <span>本周工作总工时: <b id="pr-total-hours">0</b> H</span>
        </div>
      </div>

      <div class="card" style="margin-top:14px;">
        <div class="card__header">
          <div class="card__title">下周工作计划</div>
          <button class="btn btn-ghost btn-sm" id="pr-add-plan">＋ 添加计划行</button>
        </div>
        <div class="card__body pr-table-wrap">
          <table class="pr-table" id="pr-plan-table">
            <thead>
              <tr>
                <th style="width:200px;">项目名称</th>
                <th>计划内容</th>
                <th style="width:40px;"></th>
              </tr>
            </thead>
            <tbody id="pr-plan-tbody"></tbody>
          </table>
        </div>
      </div>

      <div class="pr-footer-bar">
        <button class="btn btn-danger btn-sm" id="pr-delete-btn" style="display:none;">删除本周报</button>
        <button class="btn btn-primary" id="pr-save-btn2">💾 保存周报</button>
      </div>
    `;

    // 选择器切换
    document.getElementById('pr-member-select').addEventListener('change', (e) => {
      this.currentMember = e.target.value;
      this.loadReport();
    });
    document.getElementById('pr-week-select').addEventListener('change', (e) => {
      this.currentWeekStart = e.target.value;
      // 周期变化 -> 表头日期需重绘
      this.renderBody();
      this.loadReport();
    });

    // 动态行
    document.getElementById('pr-add-work').addEventListener('click', () => this.addWorkRow());
    document.getElementById('pr-add-plan').addEventListener('click', () => this.addPlanRow());

    // 行删除 (事件委托)
    document.getElementById('pr-work-tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="del-work-row"]');
      if (btn) { btn.closest('tr').remove(); this.recalcTotal(); }
    });
    document.getElementById('pr-plan-tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="del-plan-row"]');
      if (btn) btn.closest('tr').remove();
    });

    // 实时总工时
    document.getElementById('pr-work-tbody').addEventListener('input', (e) => {
      if (e.target.matches('[data-f="hours"]')) this.recalcTotal();
    });

    // 保存 / 删除
    document.getElementById('pr-save-btn2').addEventListener('click', () => this.save());
    document.getElementById('pr-delete-btn').addEventListener('click', () => this.removeReport());
  },

  /** 填报状态徽章 */
  renderStatus() {
    const el = document.getElementById('pr-status');
    if (!el) return;
    if (this.currentReport) {
      el.innerHTML = `<span class="badge badge--success">已填报</span>
        <span class="badge badge--primary" style="margin-left:6px;">总工时 ${this.currentReport.total_hours || 0} H</span>`;
    } else {
      el.innerHTML = '<span class="badge badge--gray">未填报</span>';
    }
    const delBtn = document.getElementById('pr-delete-btn');
    if (delBtn) delBtn.style.display = this.currentReport ? '' : 'none';
  },

  /* ------------------------------------------------------------------
   * 加载某人某周的周报
   * ---------------------------------------------------------------- */
  async loadReport() {
    if (!this.currentMember || !this.currentWeekStart) return;
    try {
      const list = await API.getPersonalReports({
        member_name: this.currentMember,
        week_start: this.currentWeekStart,
      });
      this.currentReport = (Array.isArray(list) && list.length > 0) ? list[0] : null;
    } catch (err) {
      App.showToast(`加载周报失败: ${err.message}`, 'error');
      this.currentReport = null;
    }

    // 填充工作行
    const workTbody = document.getElementById('pr-work-tbody');
    const planTbody = document.getElementById('pr-plan-tbody');
    if (!workTbody || !planTbody) return;
    workTbody.innerHTML = '';
    planTbody.innerHTML = '';

    const workItems = this.currentReport ? (this.currentReport.work_items || []) : [];
    const planItems = this.currentReport ? (this.currentReport.plan_items || []) : [];
    workItems.forEach(w => this.addWorkRow(w));
    planItems.forEach(p => this.addPlanRow(p));
    if (workItems.length === 0) this.addWorkRow(); // 默认一空行

    this.renderStatus();
    this.recalcTotal();
  },

  /* ------------------------------------------------------------------
   * 动态行
   * ---------------------------------------------------------------- */
  /** 当前人员可填的项目下拉 (只属一个项目时默认选中) */
  projectOptionsHtml(selectedId) {
    const belonged = this.memberProjects[this.currentMember] || [];
    // 归属项目优先; 无归属信息时退化为全部进行中项目
    const pool = belonged.length > 0 ? belonged : this.projects;
    const opts = pool.map(p =>
      `<option value="${p.id}" ${String(p.id) === String(selectedId || '') ? 'selected' : ''}>${App.escapeHtml(p.name)}</option>`
    ).join('');
    const placeholder = '<option value="">— 选择项目 —</option>';
    // 只属一个项目 -> 默认选中, 不给空占位
    if (!selectedId && pool.length === 1) {
      return pool.map(p =>
        `<option value="${p.id}" selected>${App.escapeHtml(p.name)}</option>`
      ).join('');
    }
    return placeholder + opts;
  },

  /** 添加本周工作行 */
  addWorkRow(item = null) {
    const tbody = document.getElementById('pr-work-tbody');
    if (!tbody) return;
    const w = item || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select data-f="project_id">${this.projectOptionsHtml(w.project_id)}</select></td>
      ${this.DAYS.map(d =>
        `<td><textarea data-f="${d.key}" rows="2" placeholder="">${App.escapeHtml(w[d.key] || '')}</textarea></td>`
      ).join('')}
      <td><input type="text" data-f="participants" value="${App.escapeHtml(w.participants || '')}"></td>
      <td><input type="text" data-f="deliverable" value="${App.escapeHtml(w.deliverable || '')}"></td>
      <td><input type="number" data-f="hours" min="0" step="0.5" value="${w.hours || ''}" placeholder="0"></td>
      <td><button class="btn btn-ghost btn-sm" data-action="del-work-row" title="删除本行">×</button></td>
    `;
    tbody.appendChild(tr);
    this.recalcTotal();
  },

  /** 添加下周计划行 */
  addPlanRow(item = null) {
    const tbody = document.getElementById('pr-plan-tbody');
    if (!tbody) return;
    const p = item || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select data-f="project_id">${this.projectOptionsHtml(p.project_id)}</select></td>
      <td><textarea data-f="content" rows="2" placeholder="下周计划做什么...">${App.escapeHtml(p.content || '')}</textarea></td>
      <td><button class="btn btn-ghost btn-sm" data-action="del-plan-row" title="删除本行">×</button></td>
    `;
    tbody.appendChild(tr);
  },

  /** 实时计算本周总工时 */
  recalcTotal() {
    let total = 0;
    document.querySelectorAll('#pr-work-tbody [data-f="hours"]').forEach(inp => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) total += v;
    });
    total = Math.round(total * 100) / 100;
    const el = document.getElementById('pr-total-hours');
    if (el) el.textContent = total;
  },

  /* ------------------------------------------------------------------
   * 保存 / 删除
   * ---------------------------------------------------------------- */
  /** 收集表单数据 */
  collectPayload() {
    const workItems = [];
    document.querySelectorAll('#pr-work-tbody tr').forEach((tr, idx) => {
      const val = (f) => {
        const el = tr.querySelector(`[data-f="${f}"]`);
        return el ? el.value.trim() : '';
      };
      const pid = val('project_id');
      const row = {
        project_id: pid ? parseInt(pid, 10) : null,
        mon: val('mon'), tue: val('tue'), wed: val('wed'), thu: val('thu'),
        fri: val('fri'), sat: val('sat'), sun: val('sun'),
        participants: val('participants'),
        deliverable: val('deliverable'),
        hours: parseFloat(val('hours')) || 0,
        sort_order: idx,
      };
      // 跳过完全空白行
      const hasContent = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'participants', 'deliverable']
        .some(k => row[k]);
      if (hasContent || row.hours > 0 || row.project_id) workItems.push(row);
    });

    const planItems = [];
    document.querySelectorAll('#pr-plan-tbody tr').forEach((tr, idx) => {
      const val = (f) => {
        const el = tr.querySelector(`[data-f="${f}"]`);
        return el ? el.value.trim() : '';
      };
      const pid = val('project_id');
      const content = val('content');
      if (content || pid) {
        planItems.push({
          project_id: pid ? parseInt(pid, 10) : null,
          content,
          sort_order: idx,
        });
      }
    });

    return { work_items: workItems, plan_items: planItems };
  },

  /** 保存 (新建或全量更新) */
  async save() {
    if (!this.currentMember) {
      App.showToast('请选择人员', 'warning');
      return;
    }
    const payload = this.collectPayload();
    if (payload.work_items.length === 0 && payload.plan_items.length === 0 && !this.currentReport) {
      App.showToast('请至少填写一行工作内容或工作计划', 'warning');
      return;
    }

    try {
      if (this.currentReport) {
        this.currentReport = await API.updatePersonalReport(this.currentReport.id, payload);
        App.showToast('周报已保存', 'success');
      } else {
        const start = new Date(`${this.currentWeekStart}T00:00:00`);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        this.currentReport = await API.createPersonalReport({
          member_name: this.currentMember,
          week_start: this.currentWeekStart,
          week_end: this.fmt(end),
          ...payload,
        });
        App.showToast('周报已创建', 'success');
      }
      this.renderStatus();
      this.recalcTotal();
    } catch (err) {
      App.showToast(`保存失败: ${err.message}`, 'error');
    }
  },

  /** 删除当前周报 */
  async removeReport() {
    if (!this.currentReport) return;
    if (!confirm(`确认删除 ${this.currentMember} ${this.weekLabel(this.currentWeekStart)} 的周报?`)) return;
    try {
      await API.deletePersonalReport(this.currentReport.id);
      this.currentReport = null;
      App.showToast('周报已删除', 'success');
      this.loadReport();
    } catch (err) {
      App.showToast(`删除失败: ${err.message}`, 'error');
    }
  },
};
