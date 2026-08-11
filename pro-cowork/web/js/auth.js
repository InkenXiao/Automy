/* ==========================================================================
   身份确认模块 Auth
   - 姓名直登 (无密码): localStorage 'cowork_user' 存姓名, 'cowork_user_projects' 存归属项目
   - 未登录 -> 全屏登录覆盖层; 无效姓名允许进入但 projects 为空 (看不到项目数据)
   - 侧边栏底部显示当前用户 + 退出登录
   ========================================================================== */

const Auth = {
  // 当前用户姓名
  name: '',
  // 当前用户归属项目 [{id,name,role,status,manager}...]
  projects: [],
  // 当前用户是否已设置登录密码
  hasPassword: false,

  /* ------------------------------------------------------------------
   * 状态读取
   * ---------------------------------------------------------------- */
  user() {
    return this.name || (localStorage.getItem('cowork_user') || '').trim();
  },

  /** 当前用户在指定项目(默认当前激活项目)的成员记录 */
  membership(projectId) {
    const pid = projectId || (App.state.project && App.state.project.id);
    if (!pid) return null;
    return (this.projects || []).find(p => String(p.id) === String(pid)) || null;
  },

  /** 是否指定项目(默认当前激活项目)的项目经理 */
  isPm(projectId) {
    const p = App.state.project;
    const pid = projectId || (p && p.id);
    if (!pid) return false;
    // 优先按激活项目的 manager 字段判定
    if (!projectId && p && (p.manager || '').trim()) {
      return (p.manager || '').trim() === this.user();
    }
    const m = this.membership(pid);
    return !!m && (m.is_manager === true || ((m.manager || '').trim() === this.user() && (m.manager || '').trim() !== ''));
  },

  /** 是否当前项目的全职成员 (项目经理视同全职) */
  isFulltime(projectId) {
    if (this.isPm(projectId)) return true;
    const m = this.membership(projectId);
    return !!m && (m.status || '') === '全职';
  },

  /** 是否任何项目的经理 (导出 Excel 等场景); 登录/会话项目含 is_manager 标记 */
  isAnyPm() {
    const name = this.user();
    return !!name && (this.projects || []).some(
      p => p.is_manager === true || ((p.manager || '').trim() !== '' && (p.manager || '').trim() === name)
    );
  },

  /* ------------------------------------------------------------------
   * 登录流程
   * ---------------------------------------------------------------- */
  /** 应用启动时调用: 确保已登录 (未登录则阻塞展示登录页) */
  async ensure() {
    const saved = (localStorage.getItem('cowork_user') || '').trim();
    if (saved) {
      this.name = saved;
      // 刷新归属项目 (失败则视为无归属, 不阻断进入)
      try {
        const res = await API.getAuthMe(saved);
        this.projects = (res && res.projects) || [];
        this.hasPassword = !!(res && res.has_password);
      } catch (e) {
        this.projects = [];
      }
      this.renderUserBadge();
      return;
    }
    await this.showLoginOverlay();
  },

  /** 全屏登录覆盖层 (姓名登录; 已设密码的成员在输入姓名后需再输入密码) */
  showLoginOverlay() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.innerHTML = `
        <div class="auth-card">
          <img class="auth-card__logo" src="images/XIN.png" alt="XIN">
          <div class="auth-card__title">玄圃 · 智创</div>
          <div class="auth-card__subtitle">项目成员身份确认</div>
          <input class="auth-card__input" id="auth-name-input" type="text"
                 placeholder="请输入项目组中的成员姓名" autocomplete="off">
          <input class="auth-card__input" id="auth-password-input" type="password"
                 placeholder="请输入密码" autocomplete="off" style="display:none;">
          <button class="btn btn-primary auth-card__btn" id="auth-login-btn">进入系统</button>
          <div class="auth-card__hint" id="auth-hint"></div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#auth-name-input');
      const pwdInput = overlay.querySelector('#auth-password-input');
      const btn = overlay.querySelector('#auth-login-btn');
      const hint = overlay.querySelector('#auth-hint');
      // 是否已确认需要密码 (姓名提交后由后端 need_password 判定)
      let needPassword = false;
      input.focus();

      const doLogin = async () => {
        const name = (input.value || '').trim();
        if (!name) {
          hint.textContent = '请输入姓名';
          input.focus();
          return;
        }
        const password = needPassword ? (pwdInput.value || '') : '';
        if (needPassword && !password) {
          hint.textContent = '请输入密码';
          pwdInput.focus();
          return;
        }
        btn.disabled = true;
        hint.textContent = '正在确认身份...';
        try {
          const res = await API.login(name, password || undefined);
          if (res && res.need_password) {
            // 该成员已设置密码: 显示密码框, 等待再次提交
            needPassword = true;
            pwdInput.style.display = '';
            pwdInput.value = '';
            hint.textContent = '该成员已设置密码, 请输入密码';
            btn.disabled = false;
            pwdInput.focus();
            return;
          }
          this.name = name;
          this.projects = (res && res.projects) || [];
          this.hasPassword = !!(res && res.has_password);
          localStorage.setItem('cowork_user', name);
          if (res && res.ok) {
            hint.textContent = '';
          } else {
            // 无效姓名: 允许进入, 但提示无任何项目权限
            App.showToast('该姓名不在任何项目组中, 进入后无项目数据', 'warning', 4000);
          }
          this.renderUserBadge();
          overlay.remove();
          resolve();
        } catch (err) {
          hint.textContent = `登录失败: ${err.message}`;
          btn.disabled = false;
          if (needPassword) { pwdInput.value = ''; pwdInput.focus(); }
        }
      };

      btn.addEventListener('click', doLogin);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
      });
      pwdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
      });
    });
  },

  /* ------------------------------------------------------------------
   * 密码设置
   * ---------------------------------------------------------------- */
  /** 打开设置/修改本人密码的模态框 */
  openPasswordModal() {
    if (!this.user()) {
      App.showToast('请先登录', 'warning');
      return;
    }
    const hasPwd = this.hasPassword;
    const modal = App.openModal({
      title: hasPwd ? '修改密码' : '设置密码',
      size: 'sm',
      bodyHtml: `
        ${hasPwd ? `
        <div class="form-group">
          <label>原密码</label>
          <input type="password" id="pwd-old" class="auth-card__input" style="width:100%;" autocomplete="off">
        </div>` : ''}
        <div class="form-group">
          <label>新密码${hasPwd ? '' : ' (设置后登录需输入密码)'}</label>
          <input type="password" id="pwd-new" class="auth-card__input" style="width:100%;" autocomplete="off">
        </div>
        <div class="form-group">
          <label>确认新密码</label>
          <input type="password" id="pwd-confirm" class="auth-card__input" style="width:100%;" autocomplete="off">
        </div>
        <div class="auth-card__hint" id="pwd-hint">${hasPwd ? '新密码留空并提交可清除密码, 恢复姓名直登' : ''}</div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="pwd-save-btn">保存</button>
      `,
    });

    const oldEl = modal.querySelector('#pwd-old');
    const newEl = modal.querySelector('#pwd-new');
    const confirmEl = modal.querySelector('#pwd-confirm');
    const hintEl = modal.querySelector('#pwd-hint');
    const saveBtn = modal.querySelector('#pwd-save-btn');
    (oldEl || newEl).focus();

    saveBtn.addEventListener('click', async () => {
      const oldPwd = oldEl ? oldEl.value : '';
      const newPwd = newEl.value || '';
      const confirmPwd = confirmEl.value || '';
      if (newPwd !== confirmPwd) {
        hintEl.textContent = '两次输入的新密码不一致';
        confirmEl.focus();
        return;
      }
      saveBtn.disabled = true;
      try {
        const res = await API.setPassword(oldPwd, newPwd);
        this.hasPassword = !!(res && res.has_password);
        App.closeModal(modal);
        App.showToast(this.hasPassword ? '密码已保存, 下次登录需输入密码' : '密码已清除, 恢复姓名直登', 'success');
      } catch (err) {
        hintEl.textContent = err.message;
        saveBtn.disabled = false;
      }
    });
    [oldEl, newEl, confirmEl].filter(Boolean).forEach(el => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
      });
    });
  },

  /** 退出登录 */
  logout() {
    localStorage.removeItem('cowork_user');
    this.name = '';
    this.projects = [];
    this.hasPassword = false;
    location.reload();
  },

  /* ------------------------------------------------------------------
   * 侧边栏用户标识
   * ---------------------------------------------------------------- */
  renderUserBadge() {
    const sidebar = document.querySelector('.app-frame__sidebar');
    if (!sidebar) return;
    let el = document.getElementById('auth-user-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'auth-user-badge';
      el.className = 'sidebar__user';
      // 插在周选择器之后、footer 之前
      const footer = sidebar.querySelector('.sidebar__footer');
      sidebar.insertBefore(el, footer || null);
    }
    const name = this.user();
    el.innerHTML = `
      <span class="sidebar__user-name" title="${App.escapeHtml(name)}">👤 ${App.escapeHtml(name || '未登录')}</span>
      <button class="sidebar__user-logout" id="auth-password-btn" title="设置/修改本人登录密码">密码</button>
      <button class="sidebar__user-logout" id="auth-logout-btn" title="退出登录">退出</button>
    `;
    const pwdBtn = el.querySelector('#auth-password-btn');
    if (pwdBtn) pwdBtn.addEventListener('click', () => this.openPasswordModal());
    const btn = el.querySelector('#auth-logout-btn');
    if (btn) btn.addEventListener('click', () => this.logout());
  },
};
