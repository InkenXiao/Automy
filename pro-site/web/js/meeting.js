/* ==========================================================================
   项目例会 · 会议议程管理
   交互逻辑:
     1. 列表页(中栏): 会议卡片列表
        - 单击卡片 → 右栏(detail-panel)显示会议纪要(meetings.description)
        - 双击卡片 / 点击"查看详情" → 进入议程页
     2. 议程页(中栏): 议程表格
        - 点击某条议程 → 右栏(detail-panel)显示内容简介(meeting_items.description)
   ========================================================================== */

const Meeting = {
  state: {
    meetings: [],            // 会议列表
    currentMeeting: null,     // 议程页当前会议(双击/查看详情)
    selectedMeeting: null,    // 列表页选中的会议(单击)
    selectedItem: null,       // 议程页选中的议程项
  },

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    const container = document.getElementById('view-meeting');
    if (container) {
      container.addEventListener('click', (e) => this.handleClick(e));
      container.addEventListener('dblclick', (e) => this.handleDblClick(e));
      // 中栏议程页的 contenteditable 单元格 focus/blur
      container.addEventListener('focusin', (e) => this.handleFocus(e));
      container.addEventListener('blur', (e) => this.handleBlur(e), true);
    }
    // 右栏 detail-panel: 监听 click(进入议程按钮) + focus/blur (编辑保存)
    const detail = document.getElementById('detail-panel');
    if (detail) {
      detail.addEventListener('click', (e) => this.handleClick(e));
      detail.addEventListener('focusin', (e) => this.handleFocus(e));
      detail.addEventListener('blur', (e) => this.handleBlur(e), true);
    }
  },

  /** 视图显示时加载列表 */
  async onShow() {
    this.state.currentMeeting = null;
    this.state.selectedItem = null;
    await this.loadMeetings();
  },

  /* ------------------------------------------------------------------
   * 列表页: 中栏渲染会议卡片列表
   * ---------------------------------------------------------------- */
  async loadMeetings() {
    const container = document.getElementById('view-meeting');
    if (!container) return;
    container.innerHTML = App.renderLoading('加载会议列表...');

    try {
      const data = await API.getMeetings();
      this.state.meetings = Array.isArray(data) ? data : [];
      if (this.state.selectedMeeting) {
        const still = this.state.meetings.find(x => String(x.id) === String(this.state.selectedMeeting.id));
        this.state.selectedMeeting = still || null;
      }
      this.renderList();
    } catch (err) {
      container.innerHTML = App.renderEmpty('加载失败', err.message, '⚠️');
    }
  },

  /** 渲染列表页(仅中栏) */
  renderList() {
    const container = document.getElementById('view-meeting');
    if (!container) return;

    const items = this.state.meetings;
    const selectedId = this.state.selectedMeeting ? String(this.state.selectedMeeting.id) : '';

    let listHtml = '';
    if (items.length === 0) {
      listHtml = App.renderEmpty('暂无会议', '点击右上角"新建会议"创建第一条会议议程', '📅');
    } else {
      items.forEach(m => {
        const itemCount = (m.items || []).length;
        const active = String(m.id) === selectedId ? ' active' : '';
        listHtml += `
          <div class="mt-card${active}" data-action="select" data-id="${m.id}" data-meeting-id="${m.id}">
            <div class="mt-card-head">
              <span class="mt-card-dot"></span>
              <span class="mt-card-title">${App.escapeHtml(m.title || '项目周例会')}</span>
            </div>
            <div class="mt-card-meta">
              <span class="mt-meta-item">📅 ${App.escapeHtml(m.meet_date || '未定日期')}</span>
              <span class="mt-meta-item">🕐 ${App.escapeHtml(m.meet_time || '')}</span>
              <span class="mt-meta-item">📍 ${App.escapeHtml(m.place || '未定地点')}</span>
              <span class="mt-meta-item">👤 ${App.escapeHtml(m.host || '')}</span>
              <span class="mt-meta-item">📋 ${itemCount} 项议程</span>
            </div>
            <div class="mt-card-actions">
              <button class="mt-btn sm" data-action="open" data-id="${m.id}">查看详情</button>
              <button class="mt-btn sm danger" data-action="delete" data-id="${m.id}">删除</button>
            </div>
            <div class="mt-card-hint">单击查看纪要 · 双击进入议程</div>
          </div>
        `;
      });
    }

    container.innerHTML = `
      <div class="mt-container">
        <div class="mt-header">
          <div class="mt-header-l">
            <h1>📅 项目例会</h1>
            <span class="mt-subtitle">管理会议议程 · 记录会议安排</span>
          </div>
          <div class="mt-header-r">
            <button class="mt-btn primary" data-action="new-meeting">＋ 新建会议</button>
          </div>
        </div>
        <div class="mt-list">${listHtml}</div>
      </div>
    `;
  },

  /* ------------------------------------------------------------------
   * 议程页: 中栏渲染议程表格
   * ---------------------------------------------------------------- */
  /** 加载会议详情(进入议程页) */
  async loadMeeting(id) {
    const container = document.getElementById('view-meeting');
    if (!container) return;
    container.innerHTML = App.renderLoading('加载会议详情...');
    App.clearDetail();

    try {
      const meeting = await API.getMeeting(id);
      this.state.currentMeeting = meeting;
      this.state.selectedItem = null;
      this.renderDetail(meeting);
    } catch (err) {
      App.showToast(`加载失败: ${err.message}`, 'error');
      await this.loadMeetings();
    }
  },

  /** 渲染议程页(仅中栏, 全部可编辑) */
  renderDetail(m) {
    const container = document.getElementById('view-meeting');
    if (!container) return;

    const items = m.items || [];
    const selectedId = this.state.selectedItem ? String(this.state.selectedItem.id) : '';

    let rowsHtml = '';
    if (items.length === 0) {
      rowsHtml = `<div class="mt-empty-hint">暂无议程，点击下方按钮添加。</div>`;
    } else {
      rowsHtml = items.map((it, i) => {
        const active = String(it.id) === selectedId ? ' active' : '';
        return `
          <tr class="mt-item-row${active}" data-id="${it.id}">
            <td class="mt-c-idx">${i + 1}</td>
            <td class="mt-c-time"><div class="mt-cell" contenteditable="true" data-k="item_time" data-id="${it.id}">${App.escapeHtml(it.item_time || '')}</div></td>
            <td class="mt-c-theme"><div class="mt-cell" contenteditable="true" data-k="theme" data-id="${it.id}">${App.escapeHtml(it.theme || '')}</div></td>
            <td class="mt-c-speaker"><div class="mt-cell" contenteditable="true" data-k="speaker" data-id="${it.id}">${App.escapeHtml(it.speaker || '')}</div></td>
            <td class="mt-c-dur"><div class="mt-cell" contenteditable="true" data-k="duration" data-id="${it.id}">${App.escapeHtml(it.duration || '')}</div></td>
            <td class="mt-c-note"><div class="mt-cell" contenteditable="true" data-k="note" data-id="${it.id}">${App.escapeHtml(it.note || '')}</div></td>
            <td class="mt-c-del">
              <button class="mt-del-btn" data-action="del-item" data-id="${it.id}" title="删除">×</button>
              <button class="mt-info-btn" data-action="select-item" data-id="${it.id}" title="查看简介">📋</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    container.innerHTML = `
      <div class="mt-container" id="mt-detail">
        <div class="mt-header">
          <div class="mt-header-l">
            <button class="mt-btn" data-action="back">← 返回列表</button>
          </div>
          <div class="mt-header-r">
            <button class="mt-btn primary" data-action="add-item">＋ 新增议程项</button>
            <button class="mt-btn" data-action="export-pdf">📄 导出PDF</button>
          </div>
        </div>
        <div class="mt-meeting-info">
          <div class="mt-meeting-info-row mt-meeting-info-row--title">
            <label>主题</label>
            <div class="mt-meeting-editable mt-meeting-editable--title" contenteditable="true" data-field="title" data-placeholder="会议主题">${App.escapeHtml(m.title || '')}</div>
          </div>
          <div class="mt-meeting-info-grid">
            <div class="mt-meeting-info-row"><label>日期</label><div class="mt-meeting-editable" contenteditable="true" data-field="meet_date">${App.escapeHtml(m.meet_date || '')}</div></div>
            <div class="mt-meeting-info-row"><label>时间</label><div class="mt-meeting-editable" contenteditable="true" data-field="meet_time">${App.escapeHtml(m.meet_time || '')}</div></div>
            <div class="mt-meeting-info-row"><label>地点</label><div class="mt-meeting-editable" contenteditable="true" data-field="place">${App.escapeHtml(m.place || '')}</div></div>
            <div class="mt-meeting-info-row"><label>主持人</label><div class="mt-meeting-editable" contenteditable="true" data-field="host">${App.escapeHtml(m.host || '')}</div></div>
          </div>
        </div>
        <div class="mt-agenda">
          <div class="mt-agenda-title">议程安排 <span class="mt-desc-hint">（点击单元格编辑 · 点击📋查看简介）</span></div>
          <table class="mt-table">
            <thead>
              <tr>
                <th class="mt-c-idx">序号</th>
                <th class="mt-c-time">时间</th>
                <th class="mt-c-theme">议程主题</th>
                <th class="mt-c-speaker">汇报人</th>
                <th class="mt-c-dur">时长</th>
                <th class="mt-c-note">备注</th>
                <th class="mt-c-del">操作</th>
              </tr>
            </thead>
            <tbody id="mt-agenda-body">${rowsHtml}</tbody>
          </table>
          <button class="mt-add-row" data-action="add-item">＋ 新增议程项</button>
        </div>
        <div class="mt-attendees-readonly">
          <label>参会人员</label>
          <div class="mt-val attendees" contenteditable="true" data-field="attendees" data-placeholder="列出参会人员，用、或逗号分隔">${App.escapeHtml(m.attendees || '')}</div>
        </div>
      </div>
    `;
  },

  /* ------------------------------------------------------------------
   * 事件处理 (中栏点击)
   * ---------------------------------------------------------------- */
  handleClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;

    switch (action) {
      case 'new-meeting':
        this.createMeeting();
        break;
      case 'select':
        // 单击卡片: 右栏显示会议纪要
        e.preventDefault();
        this.selectMeeting(id);
        break;
      case 'open':
        // 查看详情: 进入议程页
        e.preventDefault();
        e.stopPropagation();
        this.loadMeeting(id);
        break;
      case 'delete':
        e.stopPropagation();
        this.deleteMeeting(id);
        break;
      case 'back':
        this.state.currentMeeting = null;
        this.state.selectedItem = null;
        App.clearDetail();
        this.loadMeetings();
        break;
      case 'select-item':
        // 点击议程行: 右栏显示内容简介
        e.preventDefault();
        this.selectItem(id);
        break;
      case 'add-item':
        this.addItem();
        break;
      case 'del-item':
        e.stopPropagation();
        this.deleteItem(id);
        break;
      case 'export-pdf':
        this.exportPdf();
        break;
    }
  },

  /** 双击: 进入议程页 */
  handleDblClick(e) {
    const card = e.target.closest('.mt-card[data-meeting-id]');
    if (card) {
      e.preventDefault();
      this.loadMeeting(card.dataset.meetingId);
    }
  },

  /* ------------------------------------------------------------------
   * 右栏详情: 会议纪要 / 议程简介
   * ---------------------------------------------------------------- */
  /** 选中会议 → 右栏显示会议纪要(仅 description) */
  selectMeeting(id) {
    const m = this.state.meetings.find(x => String(x.id) === String(id));
    if (!m) return;
    this.state.selectedMeeting = m;
    this.state.currentMeeting = null;
    this.renderList();

    App.showDetail(`
      <div class="detail-panel__header">
        <div class="detail-panel__title">📝 会议纪要</div>
        <div class="detail-panel__meta">${App.escapeHtml(m.title || '')} · ${App.escapeHtml(m.meet_date || '')}</div>
      </div>
      <div class="detail-panel__body">
        <div class="detail-editable detail-editable--lg" contenteditable="true" data-field="description" data-placeholder="请输入会议纪要、描述或总结...">${App.escapeHtml(m.description || '')}</div>
      </div>
    `);
  },

  /** 选中议程项 → 右栏显示内容简介(仅 description) */
  selectItem(itemId) {
    const m = this.state.currentMeeting;
    if (!m) return;
    const it = (m.items || []).find(x => String(x.id) === String(itemId));
    if (!it) return;
    this.state.selectedItem = it;
    this.renderDetail(m);

    App.showDetail(`
      <div class="detail-panel__header">
        <div class="detail-panel__title">📋 议程内容简介</div>
        <div class="detail-panel__meta">${App.escapeHtml(it.theme || '(未命名)')} · 议程 #${it.id}</div>
      </div>
      <div class="detail-panel__body">
        <div class="detail-editable detail-editable--lg" contenteditable="true" data-item-field="description" data-item-id="${it.id}" data-placeholder="请输入该议程项的内容简介...">${App.escapeHtml(it.description || '')}</div>
      </div>
    `);
  },

  /* ------------------------------------------------------------------
   * 右栏 contenteditable focus/blur 事件处理
   * ---------------------------------------------------------------- */
  handleFocus(e) {
    // 议程项单元格
    const cell = e.target.closest('.mt-cell[data-k]');
    if (cell) {
      this._focusSnapshot = cell.textContent.trim();
      return;
    }
    // 右栏编辑字段
    const el = e.target.closest('[data-field]') || e.target.closest('[data-item-field]');
    if (el) {
      this._focusSnapshot = el.textContent.trim();
    }
  },

  async handleBlur(e) {
    // 议程项单元格失焦
    const cell = e.target.closest('.mt-cell[data-k]');
    if (cell) {
      const m = this.state.currentMeeting;
      if (!m) { this._focusSnapshot = null; return; }
      const itemId = cell.dataset.id;
      const key = cell.dataset.k;
      const val = cell.textContent.trim();
      if (val !== this._focusSnapshot) {
        try {
          await API.updateMeetingItem(m.id, itemId, { [key]: val });
          const it = (m.items || []).find(x => String(x.id) === String(itemId));
          if (it) it[key] = val;
          App.showToast('已保存', 'success', 1500);
        } catch (err) {
          App.showToast(`保存失败: ${err.message}`, 'error');
        }
      }
      this._focusSnapshot = null;
      return;
    }

    // 议程项内容简介失焦(右栏)
    const itemEl = e.target.closest('[data-item-field]');
    if (itemEl) {
      const itemId = itemEl.dataset.itemId;
      const field = itemEl.dataset.itemField;
      const val = itemEl.textContent.trim();
      if (val !== this._focusSnapshot) {
        try {
          await API.updateMeetingItem(this.state.currentMeeting.id, itemId, { [field]: val });
          const it = (this.state.currentMeeting.items || []).find(x => String(x.id) === String(itemId));
          if (it) it[field] = val;
          if (this.state.selectedItem && String(this.state.selectedItem.id) === String(itemId)) {
            this.state.selectedItem[field] = val;
          }
          App.showToast('已保存', 'success', 1500);
        } catch (err) {
          App.showToast(`保存失败: ${err.message}`, 'error');
        }
      }
      this._focusSnapshot = null;
      return;
    }

    // 会议元信息失焦(中栏议程页 + 右栏纪要)
    const el = e.target.closest('[data-field]');
    if (!el) return;
    const field = el.dataset.field;
    const value = el.textContent.trim();
    if (value === this._focusSnapshot) {
      this._focusSnapshot = null;
      return;
    }
    this._focusSnapshot = null;

    const ctx = this.state.currentMeeting || this.state.selectedMeeting;
    if (!ctx) return;
    try {
      await API.updateMeeting(ctx.id, { [field]: value });
      ctx[field] = value;
      const inList = this.state.meetings.find(x => String(x.id) === String(ctx.id));
      if (inList) inList[field] = value;
      App.showToast('已保存', 'success', 1500);
    } catch (err) {
      App.showToast(`保存失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * CRUD 操作
   * ---------------------------------------------------------------- */
  async createMeeting() {
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const meeting = await API.createMeeting({
        title: '项目周例会',
        meet_date: today,
        sort_order: this.state.meetings.length,
        items: [
          { item_time: '', theme: '上周工作回顾', speaker: '', duration: '10分钟', sort_order: 0 },
          { item_time: '', theme: '本周重点进展', speaker: '', duration: '30分钟', sort_order: 1 },
          { item_time: '', theme: '问题协调与下周计划', speaker: '', duration: '20分钟', sort_order: 2 },
        ],
      });
      App.showToast('会议已创建', 'success');
      await this.loadMeetings();
      this.state.selectedMeeting = meeting;
      this.renderList();
      this.selectMeeting(meeting.id);
    } catch (err) {
      App.showToast(`创建失败: ${err.message}`, 'error');
    }
  },

  async deleteMeeting(id) {
    if (!confirm('确认删除该会议?删除后不可恢复。')) return;
    try {
      await API.deleteMeeting(id);
      App.showToast('已删除', 'success');
      if (this.state.selectedMeeting && String(this.state.selectedMeeting.id) === String(id)) {
        this.state.selectedMeeting = null;
        App.clearDetail();
      }
      if (this.state.currentMeeting && String(this.state.currentMeeting.id) === String(id)) {
        this.state.currentMeeting = null;
      }
      await this.loadMeetings();
    } catch (err) {
      App.showToast(`删除失败: ${err.message}`, 'error');
    }
  },

  async addItem() {
    const m = this.state.currentMeeting;
    if (!m) return;
    try {
      const sortOrder = (m.items || []).length;
      const item = await API.addMeetingItem(m.id, {
        item_time: '', theme: '', speaker: '', duration: '', note: '', description: '', sort_order: sortOrder,
      });
      await this.loadMeeting(m.id);
      setTimeout(() => {
        const row = document.querySelector(`.mt-item-row[data-id="${item.id}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } catch (err) {
      App.showToast(`添加失败: ${err.message}`, 'error');
    }
  },

  async deleteItem(itemId) {
    const m = this.state.currentMeeting;
    if (!m) return;
    try {
      await API.deleteMeetingItem(m.id, itemId);
      App.showToast('已删除', 'success', 1500);
      if (this.state.selectedItem && String(this.state.selectedItem.id) === String(itemId)) {
        this.state.selectedItem = null;
        App.clearDetail();
      }
      await this.loadMeeting(m.id);
    } catch (err) {
      App.showToast(`删除失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * PDF 导出
   * ---------------------------------------------------------------- */
  exportPdf() {
    const element = document.getElementById('mt-detail');
    if (!element) {
      App.showToast('没有可导出的内容', 'error');
      return;
    }
    const m = this.state.currentMeeting;
    const filename = m ? `${m.title || '会议议程'}_${m.meet_date || ''}` : '会议议程';
    App.exportToPdf(element, filename, { addDate: false });
  },
};
