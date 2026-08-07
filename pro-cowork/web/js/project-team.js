/* ==========================================================================
   项目成员模块 ProjectTeam (项目驾驶舱)
   - 项目维护: 新建/编辑项目, 指定项目经理与起止时间, 停止/恢复项目, 当前状态
   - 成员维护: 所选项目的成员 (姓名/角色岗位/入组时间/当前状态)
   ========================================================================== */

const ProjectTeam = {
  // 全部项目
  projects: [],
  // 当前选中的项目 id
  currentProjectId: null,
  // 当前项目的成员列表
  members: [],

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    // 首次切换到本视图时加载
  },

  /** 切换到此视图时触发 */
  onShow() {
    this.loadProjects();
  },

  /* ------------------------------------------------------------------
   * 项目列表
   * ---------------------------------------------------------------- */
  async loadProjects() {
    const view = document.getElementById('view-project-team');
    if (!view) return;

    view.innerHTML = `
      <div class="view__header">
        <div>
          <div class="view__title">👥 项目成员</div>
          <div class="view__subtitle">项目与项目成员维护</div>
        </div>
        <div class="view__actions">
          <button class="btn btn-primary btn-sm" id="pt-new-project-btn">＋ 新建项目</button>
        </div>
      </div>
      <div id="pt-projects-loading">${App.renderLoading()}</div>
      <div id="pt-projects"></div>
      <div id="pt-members"></div>
    `;

    document.getElementById('pt-new-project-btn')
      .addEventListener('click', () => this.showProjectForm(null));

    try {
      this.projects = await API.getProjects() || [];
      // 默认选中当前激活项目
      if (!this.currentProjectId
          || !this.projects.some(p => String(p.id) === String(this.currentProjectId))) {
        const active = this.projects.find(p => p.is_active) || this.projects[0];
        this.currentProjectId = active ? active.id : null;
      }
      this.renderProjects();
      if (this.currentProjectId) this.loadMembers(this.currentProjectId);
    } catch (err) {
      document.getElementById('pt-projects-loading').innerHTML =
        App.renderEmpty('加载失败', err.message, '⚠️');
      App.showToast(`加载项目失败: ${err.message}`, 'error');
    }
  },

  /** 项目状态徽章 */
  projectStatusBadge(status) {
    const map = {
      '进行中': 'badge--success',
      '已停止': 'badge--danger',
      '已完成': 'badge--gray',
    };
    const cls = map[status] || 'badge--gray';
    return `<span class="badge ${cls}">${App.escapeHtml(status || '进行中')}</span>`;
  },

  /** 渲染项目表格 */
  renderProjects() {
    const loadingEl = document.getElementById('pt-projects-loading');
    if (loadingEl) loadingEl.innerHTML = '';
    const container = document.getElementById('pt-projects');
    if (!container) return;

    if (this.projects.length === 0) {
      container.innerHTML = App.renderEmpty('还没有项目', '点击右上角"新建项目"', '🚩');
      return;
    }

    container.innerHTML = `
      <div class="card">
        <div class="card__header">
          <div class="card__title">项目列表</div>
          <span class="badge badge--primary">共 ${this.projects.length} 个</span>
        </div>
        <div class="card__body" style="padding:0;">
          <table class="wr-list-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>项目经理</th>
                <th>起始时间</th>
                <th>结束时间</th>
                <th>当前状态</th>
                <th style="width:220px;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${this.projects.map(p => `
                <tr data-id="${p.id}" class="${String(p.id) === String(this.currentProjectId) ? 'pt-row--active' : ''}">
                  <td>
                    <strong>${App.escapeHtml(p.name)}</strong>
                    ${p.is_active ? '<span class="tag tag--gold" style="margin-left:4px;">当前</span>' : ''}
                  </td>
                  <td>${App.escapeHtml(p.manager || '—')}</td>
                  <td>${App.escapeHtml(App.formatDate(p.start_date))}</td>
                  <td>${App.escapeHtml(App.formatDate(p.end_date))}</td>
                  <td>${this.projectStatusBadge(p.status)}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" data-action="members" data-id="${p.id}">成员</button>
                    <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${p.id}">编辑</button>
                    ${(p.status || '进行中') === '已停止'
                      ? `<button class="btn btn-ghost btn-sm" data-action="resume" data-id="${p.id}">恢复</button>`
                      : `<button class="btn btn-ghost btn-sm" data-action="stop" data-id="${p.id}">停止</button>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        const project = this.projects.find(p => String(p.id) === String(id));
        if (action === 'members') {
          this.currentProjectId = id;
          this.renderProjects();
          this.loadMembers(id);
        } else if (action === 'edit') {
          this.showProjectForm(project);
        } else if (action === 'stop') {
          this.setProjectStatus(project, '已停止');
        } else if (action === 'resume') {
          this.setProjectStatus(project, '进行中');
        }
      });
    });

    // 行点击 = 查看成员
    container.querySelectorAll('tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        this.currentProjectId = tr.getAttribute('data-id');
        this.renderProjects();
        this.loadMembers(this.currentProjectId);
      });
    });
  },

  /** 停止 / 恢复项目 */
  async setProjectStatus(project, status) {
    const label = status === '已停止' ? '停止' : '恢复';
    if (!confirm(`确认${label}项目"${project.name}"?`)) return;
    try {
      await API.updateProject(project.id, { status });
      project.status = status;
      this.renderProjects();
      App.showToast(`项目已${label}`, 'success');
    } catch (err) {
      App.showToast(`${label}失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 项目表单 (新建 / 编辑)
   * ---------------------------------------------------------------- */
  showProjectForm(project) {
    const isEdit = !!project;
    const p = project || {};
    const statusOptions = ['进行中', '已停止', '已完成']
      .map(s => `<option value="${s}" ${(p.status || '进行中') === s ? 'selected' : ''}>${s}</option>`)
      .join('');

    const modal = App.openModal({
      title: isEdit ? `编辑项目 · ${p.name || ''}` : '新建项目',
      bodyHtml: `
        <div class="form-group">
          <label>项目名称 *</label>
          <input type="text" id="pt-p-name" value="${App.escapeHtml(p.name || '')}" placeholder="如: 信投AI2.0">
        </div>
        <div class="form-group">
          <label>项目标题 *</label>
          <input type="text" id="pt-p-title" value="${App.escapeHtml(p.title || '')}" placeholder="如: 信投 AI 2.0 项目进度计划执行图">
        </div>
        <div class="form-group">
          <label>项目经理</label>
          <input type="text" id="pt-p-manager" value="${App.escapeHtml(p.manager || '')}" placeholder="项目经理姓名">
        </div>
        <div style="display:flex;gap:12px;">
          <div class="form-group" style="flex:1;">
            <label>起始时间 *</label>
            <input type="date" id="pt-p-start" value="${App.escapeHtml(p.start_date || '')}">
          </div>
          <div class="form-group" style="flex:1;">
            <label>结束时间 *</label>
            <input type="date" id="pt-p-end" value="${App.escapeHtml(p.end_date || '')}">
          </div>
        </div>
        <div class="form-group">
          <label>当前状态</label>
          <select id="pt-p-status">${statusOptions}</select>
        </div>
        <div class="form-group">
          <label>基于文档</label>
          <input type="text" id="pt-p-doc" value="${App.escapeHtml(p.based_doc || '')}" placeholder="可选">
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="pt-p-save">${isEdit ? '保存' : '创建'}</button>
      `
    });

    modal.querySelector('#pt-p-save').addEventListener('click', async () => {
      const data = {
        name: modal.querySelector('#pt-p-name').value.trim(),
        title: modal.querySelector('#pt-p-title').value.trim(),
        manager: modal.querySelector('#pt-p-manager').value.trim(),
        start_date: modal.querySelector('#pt-p-start').value,
        end_date: modal.querySelector('#pt-p-end').value,
        status: modal.querySelector('#pt-p-status').value,
        based_doc: modal.querySelector('#pt-p-doc').value.trim(),
      };
      if (!data.name || !data.title || !data.start_date || !data.end_date) {
        App.showToast('请填写项目名称/标题/起止时间', 'warning');
        return;
      }
      try {
        if (isEdit) {
          await API.updateProject(p.id, data);
          App.showToast('项目已保存', 'success');
        } else {
          const created = await API.createProject(data);
          this.currentProjectId = created.id;
          App.showToast('项目已创建', 'success');
        }
        App.closeModal(modal);
        this.loadProjects();
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /* ------------------------------------------------------------------
   * 成员列表 (所选项目)
   * ---------------------------------------------------------------- */
  async loadMembers(projectId) {
    const container = document.getElementById('pt-members');
    if (!container) return;
    const project = this.projects.find(p => String(p.id) === String(projectId));
    container.innerHTML = App.renderLoading('加载成员...');

    try {
      this.members = await API.getProjectMembers(projectId) || [];
      this.renderMembers(project);
    } catch (err) {
      container.innerHTML = App.renderEmpty('成员加载失败', err.message, '⚠️');
    }
  },

  /** 成员状态徽章 (全职/临时/退出) */
  memberStatusBadge(status) {
    const map = {
      '全职': 'badge--success',
      '临时': 'badge--warning',
      '退出': 'badge--gray',
    };
    const cls = map[status] || 'badge--success';
    return `<span class="badge ${cls}">${App.escapeHtml(status || '全职')}</span>`;
  },

  /** 渲染成员表格 */
  renderMembers(project) {
    const container = document.getElementById('pt-members');
    if (!container || !project) return;

    container.innerHTML = `
      <div class="card" style="margin-top:16px;">
        <div class="card__header">
          <div class="card__title">项目成员 · ${App.escapeHtml(project.name)}</div>
          <div>
            <span class="badge badge--primary">共 ${this.members.length} 人</span>
            <button class="btn btn-primary btn-sm" id="pt-new-member-btn" style="margin-left:8px;">＋ 新增成员</button>
          </div>
        </div>
        <div class="card__body" style="padding:0;">
          ${this.members.length === 0
            ? App.renderEmpty('该项目还没有成员', '点击"新增成员"添加', '👤')
            : `
          <table class="wr-list-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>姓名</th>
                <th>角色/岗位</th>
                <th>入组时间</th>
                <th>当前状态</th>
                <th style="width:180px;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${this.members.map(m => `
                <tr data-id="${m.id}">
                  <td>${App.escapeHtml(project.name)}</td>
                  <td><strong>${App.escapeHtml(m.name)}</strong></td>
                  <td>${App.escapeHtml(m.role || '—')}</td>
                  <td>${App.escapeHtml(m.join_date ? App.formatDate(m.join_date) : '—')}</td>
                  <td>${this.memberStatusBadge(m.status)}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" data-action="edit-member" data-id="${m.id}">编辑</button>
                    ${(m.status || '全职') !== '退出'
                      ? `<button class="btn btn-ghost btn-sm" data-action="leave-member" data-id="${m.id}">退出</button>`
                      : `<button class="btn btn-ghost btn-sm" data-action="rejoin-member" data-id="${m.id}">返岗</button>`}
                    <button class="btn btn-ghost btn-sm" data-action="delete-member" data-id="${m.id}">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
    `;

    document.getElementById('pt-new-member-btn')
      .addEventListener('click', () => this.showMemberForm(null));

    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const member = this.members.find(m => String(m.id) === String(id));
        const action = btn.getAttribute('data-action');
        if (action === 'edit-member') {
          this.showMemberForm(member);
        } else if (action === 'leave-member' || action === 'rejoin-member') {
          const status = action === 'leave-member' ? '退出' : '全职';
          if (action === 'leave-member' && !confirm('确认将该成员标记为退出?')) return;
          try {
            await API.updateProjectMember(id, { status });
            member.status = status;
            this.renderMembers(project);
            App.showToast(`已标记为"${status}"`, 'success');
          } catch (err) {
            App.showToast(`状态更新失败: ${err.message}`, 'error');
          }
        } else if (action === 'delete-member') {
          if (!confirm(`确认删除成员"${member.name}"?`)) return;
          try {
            await API.deleteProjectMember(id);
            this.members = this.members.filter(m => String(m.id) !== String(id));
            this.renderMembers(project);
            App.showToast('成员已删除', 'success');
          } catch (err) {
            App.showToast(`删除失败: ${err.message}`, 'error');
          }
        }
      });
    });
  },

  /* ------------------------------------------------------------------
   * 成员表单 (新增 / 编辑)
   * ---------------------------------------------------------------- */
  showMemberForm(member) {
    const isEdit = !!member;
    const m = member || {};
    const project = this.projects.find(p => String(p.id) === String(this.currentProjectId));
    const statusOptions = ['全职', '临时', '退出']
      .map(s => `<option value="${s}" ${(m.status || '全职') === s ? 'selected' : ''}>${s}</option>`)
      .join('');

    const modal = App.openModal({
      title: isEdit ? `编辑成员 · ${m.name || ''}` : `新增成员 · ${project ? project.name : ''}`,
      bodyHtml: `
        <div class="form-group">
          <label>所属项目</label>
          <input type="text" value="${App.escapeHtml(project ? project.name : '')}" disabled>
        </div>
        <div class="form-group">
          <label>姓名 *</label>
          <input type="text" id="pt-m-name" value="${App.escapeHtml(m.name || '')}" placeholder="成员姓名">
        </div>
        <div class="form-group">
          <label>角色/岗位</label>
          <input type="text" id="pt-m-role" value="${App.escapeHtml(m.role || '')}" placeholder="如: 项目经理 / 后端开发 / 测试">
        </div>
        <div class="form-group">
          <label>入组时间</label>
          <input type="date" id="pt-m-join" value="${App.escapeHtml(m.join_date || '')}">
        </div>
        <div class="form-group">
          <label>当前状态</label>
          <select id="pt-m-status">${statusOptions}</select>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="pt-m-save">${isEdit ? '保存' : '新增'}</button>
      `
    });

    modal.querySelector('#pt-m-save').addEventListener('click', async () => {
      const data = {
        name: modal.querySelector('#pt-m-name').value.trim(),
        role: modal.querySelector('#pt-m-role').value.trim(),
        join_date: modal.querySelector('#pt-m-join').value || null,
        status: modal.querySelector('#pt-m-status').value,
      };
      if (!data.name) {
        App.showToast('请填写成员姓名', 'warning');
        return;
      }
      try {
        if (isEdit) {
          await API.updateProjectMember(m.id, data);
          App.showToast('成员已保存', 'success');
        } else {
          await API.createProjectMember({ ...data, project_id: parseInt(this.currentProjectId, 10) });
          App.showToast('成员已新增', 'success');
        }
        App.closeModal(modal);
        this.loadMembers(this.currentProjectId);
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },
};
