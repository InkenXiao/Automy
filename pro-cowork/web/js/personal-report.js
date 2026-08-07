/* ==========================================================================
   个人周报模块 PersonalReport (项目驾驶舱)
   - 选择人员 + 周报周期 (YYYY/MM/DD - YYYY/MM/DD, 周一~周日) 后填写
   - 本周工作内容: 动态行, 每行一天 (项目名称/周几/工作内容/参与人员/交付物/工时H)
   - 工作内容输入 '/' 可弹出该项目本周工作任务选择层, 快速填入任务名称
   - 下周工作计划: 动态行 (项目名称/计划内容)
   - 实时计算本周工作总工时
   ========================================================================== */

const PersonalReport = {
  // 全部项目
  projects: [],
  // 当前激活项目的成员 (人员选择器, 不含已退出)
  members: [],
  // 成员姓名 -> 所属项目数组 (跨项目归属, 用于工作行项目下拉, 不含已退出)
  memberProjects: {},
  // 当前选择
  currentMember: '',
  currentWeekStart: '',   // YYYY-MM-DD (周一)
  // 已存在的周报 (null = 未填报)
  currentReport: null,
  // '/' 任务选择弹层状态 (同一时刻只有一个实例)
  _slash: null,

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
    this.closeSlashPopup();
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

      // 各项目成员 (构建 姓名 -> 项目 归属映射, 跳过已退出成员)
      const memberLists = await Promise.all(
        (projects || []).map(p => API.getProjectMembers(p.id).catch(() => []))
      );
      this.memberProjects = {};
      (projects || []).forEach((p, i) => {
        (memberLists[i] || []).forEach(m => {
          if (m.status === '退出') return; // 退出成员不可填对应项目的周报
          if (!this.memberProjects[m.name]) this.memberProjects[m.name] = [];
          this.memberProjects[m.name].push({ id: p.id, name: p.name, status: m.status });
        });
      });

      // 人员选择器 = 当前激活项目成员 (不含已退出, 全职优先)
      const activeMembers = activeId
        ? (memberLists[(projects || []).findIndex(p => p.id === activeId)] || [])
        : [];
      this.members = activeMembers
        .filter(m => m.status !== '退出')
        .sort((a, b) => {
          const ao = (a.status || '全职') === '全职' ? 0 : 1;
          const bo = (b.status || '全职') === '全职' ? 0 : 1;
          return ao - bo || a.sort_order - b.sort_order || a.id - b.id;
        });

      // 默认选择: 保留原选择; 否则当前登录用户; 否则第一个全职成员
      if (!this.currentMember || !this.members.some(m => m.name === this.currentMember)) {
        const loginName = Auth.user();
        const mine = loginName ? this.members.find(m => m.name === loginName) : null;
        const first = mine || this.members.find(m => (m.status || '全职') === '全职') || this.members[0];
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
    this.closeSlashPopup();
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

    const memberOpts = this.members.map(m =>
      `<option value="${App.escapeHtml(m.name)}" ${m.name === this.currentMember ? 'selected' : ''}>${App.escapeHtml(m.name)}</option>`
    ).join('');

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
                <th style="width:76px;">周几</th>
                <th style="min-width:220px;">工作内容</th>
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
      // 周期变化 -> 重绘表单
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

    // 实时总工时 + '/' 任务选择弹层
    document.getElementById('pr-work-tbody').addEventListener('input', (e) => {
      if (e.target.matches('[data-f="hours"]')) this.recalcTotal();
      if (e.target.matches('textarea[data-f="content"]')) this.onContentInput(e.target);
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

  /** 周几下拉 (新增空行时默认今天对应的周几) */
  dayOptionsHtml(selectedDay) {
    const todayDow = new Date().getDay() || 7; // 周日=7
    const cur = selectedDay || todayDow;
    return this.DAYS.map((d, i) =>
      `<option value="${i + 1}" ${i + 1 === cur ? 'selected' : ''}>${d.label}</option>`
    ).join('');
  },

  /** 添加本周工作行 (每行一天) */
  addWorkRow(item = null) {
    const tbody = document.getElementById('pr-work-tbody');
    if (!tbody) return;
    const w = item || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select data-f="project_id">${this.projectOptionsHtml(w.project_id)}</select></td>
      <td><select data-f="day_of_week">${this.dayOptionsHtml(w.day_of_week)}</select></td>
      <td><textarea data-f="content" rows="2" placeholder="输入 / 可选择本周工作任务">${App.escapeHtml(w.content || '')}</textarea></td>
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
   * '/' 工作任务选择弹层
   * ---------------------------------------------------------------- */
  /** 工作内容输入回调: 检测 '/关键词' 并弹出/更新任务选择层 */
  onContentInput(textarea) {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const slashIdx = before.lastIndexOf('/');
    if (slashIdx === -1) { this.closeSlashPopup(); return; }
    const query = before.slice(slashIdx + 1);
    if (query.includes('\n')) { this.closeSlashPopup(); return; }

    if (this._slash && this._slash.textarea === textarea) {
      // 弹层已打开: 仅更新过滤关键字
      this._slash.slashIdx = slashIdx;
      this._slash.query = query;
      this.renderSlashItems();
    } else {
      this.openSlashPopup(textarea, slashIdx, query);
    }
  },

  /** 打开任务选择弹层 */
  async openSlashPopup(textarea, slashIdx, query) {
    this.closeSlashPopup();
    const tr = textarea.closest('tr');
    const projectEl = tr ? tr.querySelector('[data-f="project_id"]') : null;
    const projectId = projectEl && projectEl.value ? parseInt(projectEl.value, 10) : null;

    // 拉取该项目本周的工作任务
    let tasks = [];
    if (projectId) {
      try {
        tasks = await API.getWorkTasks(this.currentWeekStart, projectId) || [];
      } catch (err) {
        tasks = [];
      }
    }
    // 等待期间可能已打开新弹层, 先清理旧实例
    this.closeSlashPopup();

    const popup = document.createElement('div');
    popup.className = 'pr-slash-popup';
    document.body.appendChild(popup);

    this._slash = { textarea, slashIdx, query, tasks, activeIdx: 0, popup };

    // 绝对定位在 textarea 下方
    const rect = textarea.getBoundingClientRect();
    popup.style.left = `${rect.left + window.scrollX}px`;
    popup.style.top = `${rect.bottom + window.scrollY + 4}px`;

    // 键盘操作: ↑/↓ 移动, Enter 选择, Esc 关闭
    this._slash.onKeydown = (e) => {
      if (!this._slash) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.moveSlashActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.moveSlashActive(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.pickSlashTask(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeSlashPopup(); }
    };
    textarea.addEventListener('keydown', this._slash.onKeydown);

    // 点击外部 / 页面滚动时关闭
    this._slash.onDocDown = (e) => {
      if (this._slash && !this._slash.popup.contains(e.target) && e.target !== textarea) {
        this.closeSlashPopup();
      }
    };
    document.addEventListener('mousedown', this._slash.onDocDown);
    this._slash.onScroll = () => this.closeSlashPopup();
    window.addEventListener('scroll', this._slash.onScroll, true);

    this.renderSlashItems();
  },

  /** 按关键字过滤并渲染弹层列表 */
  renderSlashItems() {
    const s = this._slash;
    if (!s) return;
    const q = (s.query || '').toLowerCase();
    s.filtered = (s.tasks || []).filter(t =>
      !q || (t.name || '').toLowerCase().includes(q)
    );
    if (s.activeIdx >= s.filtered.length) s.activeIdx = 0;

    if (s.filtered.length === 0) {
      s.popup.innerHTML = '<div class="pr-slash-popup__empty">暂无可选任务</div>';
      return;
    }
    s.popup.innerHTML = s.filtered.map((t, i) => `
      <div class="pr-slash-popup__item ${i === s.activeIdx ? 'pr-slash-popup__item--active' : ''}" data-idx="${i}">
        <span>${App.escapeHtml(t.name || '')}</span>
        <span class="tag">${App.escapeHtml(t.owner || '')}</span>
      </div>
    `).join('');
    // 鼠标点击选择
    s.popup.querySelectorAll('.pr-slash-popup__item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 保持 textarea 焦点
        this.pickSlashTask(parseInt(el.dataset.idx, 10));
      });
    });
  },

  /** 键盘上下移动高亮项 */
  moveSlashActive(delta) {
    const s = this._slash;
    if (!s || !s.filtered || s.filtered.length === 0) return;
    s.activeIdx = (s.activeIdx + delta + s.filtered.length) % s.filtered.length;
    this.renderSlashItems();
  },

  /** 选择任务: 把 '/关键词' 替换为任务名称 */
  pickSlashTask(idx = null) {
    const s = this._slash;
    if (!s || !s.filtered || s.filtered.length === 0) return;
    const task = s.filtered[idx === null ? s.activeIdx : idx];
    if (!task) return;

    const ta = s.textarea;
    const pos = ta.selectionStart;
    // '/关键词' 前的文本若不以空白结尾, 补一个空格再拼接任务名
    let head = ta.value.slice(0, s.slashIdx);
    if (head && !/\s$/.test(head)) head += ' ';
    const tail = ta.value.slice(pos);
    ta.value = head + task.name + tail;
    const newPos = (head + task.name).length;
    ta.setSelectionRange(newPos, newPos);

    this.closeSlashPopup();
    ta.focus();
  },

  /** 关闭弹层并移除 DOM 与事件 */
  closeSlashPopup() {
    const s = this._slash;
    if (!s) return;
    if (s.textarea && s.onKeydown) s.textarea.removeEventListener('keydown', s.onKeydown);
    if (s.onDocDown) document.removeEventListener('mousedown', s.onDocDown);
    if (s.onScroll) window.removeEventListener('scroll', s.onScroll, true);
    if (s.popup) s.popup.remove();
    this._slash = null;
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
        day_of_week: parseInt(val('day_of_week'), 10) || 1,
        content: val('content'),
        participants: val('participants'),
        deliverable: val('deliverable'),
        hours: parseFloat(val('hours')) || 0,
        sort_order: idx,
      };
      // 跳过完全空白行
      if (row.content || row.participants || row.deliverable || row.hours > 0 || row.project_id) {
        workItems.push(row);
      }
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
