/* ==========================================================================
   单词库模块
   单词的增删改查 / 行内编辑 / 批量导入 / 单元管理
   ========================================================================== */
const Words = {
  /** 容器节点缓存 */
  container: null,

  /** 状态 */
  state: {
    words: [],
    units: [],
    filters: { q: '', unit_id: '', status: '' },
    snapshot: '',        // 行内编辑前的文本快照
    snapshotId: null,   // 行内编辑的 word id
    snapshotField: null, // 行内编辑的字段名
    detailWordId: null, // 右栏当前展示的单词 id
  },

  /** 搜索防抖计时器 */
  _searchTimer: null,

  /** 初始化: 绑定事件委托 (只绑定一次) */
  init() {
    this.container = document.getElementById('view-words');
    if (!this.container) return;

    this.container.addEventListener('click', (e) => this._onClick(e));
    this.container.addEventListener('input', (e) => this._onInput(e));
    this.container.addEventListener('keydown', (e) => this._onKeyDown(e));
    // contenteditable 的 focus/blur 不冒泡, 用 focusin/focusout 委托
    this.container.addEventListener('focusin', (e) => this._onFocusIn(e));
    this.container.addEventListener('focusout', (e) => this._onFocusOut(e));
    this.container.addEventListener('paste', (e) => this._onPaste(e));
  },

  /** 视图显示时触发: 加载并渲染 */
  async onShow() {
    if (!this.container) {
      this.container = document.getElementById('view-words');
      if (!this.container) return;
    }
    this.state.detailWordId = null;

    // 先渲染骨架 (含 loading)
    this.container.innerHTML = this._renderShell(App.renderLoading('加载单词列表...'));

    try {
      const [units, words] = await Promise.all([
        API.get('/units/').catch(() => []),
        API.get(this._buildWordsUrl(this.state.filters)),
      ]);
      this.state.units = Array.isArray(units) ? units : [];
      this.state.words = Array.isArray(words) ? words : [];
      this._renderShellIntoDom();
      this._renderTableIntoDom();
    } catch (err) {
      this.container.innerHTML = this._renderShell(
        App.renderEmpty('加载失败', err && err.message ? err.message : '请稍后重试', '⚠️')
      );
      App.showToast(err && err.message ? err.message : '加载单词列表失败', 'error');
    }
  },

  /* ------------------------------------------------------------------
     渲染
     ------------------------------------------------------------------ */

  /** 整页骨架 (header + filter + 表格容器) */
  _renderShell(tableHtml = '') {
    const f = this.state.filters;
    return `
      <div class="page-header">
        <div>
          <h1 class="page-header__title">📚 单词库</h1>
          <p class="page-header__subtitle">共 <span data-count>${this.state.words.length}</span> 个单词</p>
        </div>
        <div class="page-header__actions">
          <button class="btn btn-primary" data-action="new-word">➕ 新增单词</button>
          <button class="btn" data-action="batch-import">📥 批量导入</button>
          <button class="btn" data-action="manage-units">📁 管理单元</button>
        </div>
      </div>
      <div class="filter-bar">
        <input class="input filter-bar__search" data-filter="q"
               value="${App.escapeHtml(f.q)}"
               placeholder="搜索单词或释义...">
        <select class="select filter-bar__select" data-filter="unit_id">
          ${this._renderUnitFilterOptions(this.state.units, f.unit_id)}
        </select>
        <select class="select filter-bar__select" data-filter="status">
          ${this._renderStatusFilterOptions(f.status)}
        </select>
      </div>
      <div id="words-table-area">${tableHtml}</div>
    `;
  },

  /** 单词表 */
  _renderTable() {
    if (!this.state.words.length) {
      return App.renderEmpty('暂无单词', '点击右上角"新增单词"或"批量导入"添加', '📚');
    }
    const rows = this.state.words.map(w => `
      <tr data-word-id="${w.id}">
        <td>
          <div class="editable-cell" contenteditable="true"
               data-id="${w.id}" data-field="english">${App.escapeHtml(w.english)}</div>
        </td>
        <td>
          <div class="editable-cell" contenteditable="true"
               data-id="${w.id}" data-field="phonetic">${App.escapeHtml(w.phonetic)}</div>
        </td>
        <td>
          <div class="editable-cell editable-cell--def" contenteditable="true"
               data-id="${w.id}" data-field="definition">${App.escapeHtml(w.definition)}</div>
        </td>
        <td>${this._renderStatusBadge(w.status)}</td>
        <td class="td-actions">
          <button class="btn btn-sm" data-action="edit-word" data-id="${w.id}">编辑</button>
          <button class="btn btn-sm btn-danger" data-action="delete-word" data-id="${w.id}">删除</button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="card card--flush-table">
        <div class="table-wrap">
          <table class="table words-table">
            <thead>
              <tr>
                <th>单词</th>
                <th>音标</th>
                <th>释义</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  /** 状态徽章 */
  _renderStatusBadge(status) {
    const map = {
      new:      { cls: 'status-badge--new',      label: '新词' },
      learning: { cls: 'status-badge--learning', label: '学习中' },
      mastered: { cls: 'status-badge--mastered', label: '已掌握' },
    };
    const s = map[status] || map.new;
    return `<span class="status-badge ${s.cls}">${App.escapeHtml(s.label)}</span>`;
  },

  /** 单元过滤下拉项 */
  _renderUnitFilterOptions(units, selectedValue) {
    let opts = `<option value="">全部单元</option>`;
    if (Array.isArray(units) && units.length) {
      opts += units.map(u => {
        const sel = String(u.id) === String(selectedValue) ? ' selected' : '';
        return `<option value="${u.id}"${sel}>${App.escapeHtml(u.name)}</option>`;
      }).join('');
    }
    return opts;
  },

  /** 状态过滤下拉项 */
  _renderStatusFilterOptions(selectedValue) {
    const opts = [
      { value: '', label: '全部状态' },
      { value: 'new', label: '新词' },
      { value: 'learning', label: '学习中' },
      { value: 'mastered', label: '已掌握' },
    ];
    return opts.map(o => {
      const sel = o.value === selectedValue ? ' selected' : '';
      return `<option value="${o.value}"${sel}>${App.escapeHtml(o.label)}</option>`;
    }).join('');
  },

  /** 新增单词 / 批量导入 模态框使用的单元下拉项 */
  _renderUnitOptions(units, selectedValue, includeNone) {
    let opts = '';
    if (includeNone) opts += `<option value="">无单元</option>`;
    if (Array.isArray(units) && units.length) {
      opts += units.map(u => {
        const sel = String(u.id) === String(selectedValue) ? ' selected' : '';
        return `<option value="${u.id}"${sel}>${App.escapeHtml(u.name)}</option>`;
      }).join('');
    }
    return opts;
  },

  /** 将骨架写入 DOM */
  _renderShellIntoDom() {
    this.container.innerHTML = this._renderShell();
  },

  /** 将表格写入 DOM */
  _renderTableIntoDom() {
    const area = this.container.querySelector('#words-table-area');
    if (area) area.innerHTML = this._renderTable();
    const countEl = this.container.querySelector('[data-count]');
    if (countEl) countEl.textContent = String(this.state.words.length);
  },

  /* ------------------------------------------------------------------
     数据加载
     ------------------------------------------------------------------ */

  /** 构造列表请求 URL */
  _buildWordsUrl(filters) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.unit_id) params.set('unit_id', String(filters.unit_id));
    if (filters.status) params.set('status', filters.status);
    const qs = params.toString();
    return qs ? `/words/?${qs}` : '/words/';
  },

  /** 重新拉取单词列表 (保留过滤输入框焦点) */
  async _reloadWords() {
    const area = this.container.querySelector('#words-table-area');
    if (area) area.innerHTML = App.renderLoading('加载中...');
    try {
      const words = await API.get(this._buildWordsUrl(this.state.filters));
      this.state.words = Array.isArray(words) ? words : [];
      this._renderTableIntoDom();
    } catch (err) {
      if (area) {
        area.innerHTML = App.renderEmpty(
          '加载失败',
          err && err.message ? err.message : '请稍后重试',
          '⚠️'
        );
      }
      App.showToast(err && err.message ? err.message : '加载单词失败', 'error');
    }
  },

  /** 刷新过滤栏的单元下拉 */
  _refreshFilterDropdowns() {
    const unitSel = this.container.querySelector('[data-filter="unit_id"]');
    if (unitSel) {
      const current = this.state.filters.unit_id;
      unitSel.innerHTML = this._renderUnitFilterOptions(this.state.units, current);
    }
  },

  /* ------------------------------------------------------------------
     事件处理
     ------------------------------------------------------------------ */

  /** 点击委托 */
  _onClick(e) {
    // 操作按钮 (含 header 按钮 / 行内编辑/删除)
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'new-word') this._openNewWordModal();
      else if (action === 'batch-import') this._openBatchModal();
      else if (action === 'manage-units') this._openUnitModal();
      else if (action === 'edit-word' && id) this._showDetail(Number(id));
      else if (action === 'delete-word' && id) this._confirmDelete(Number(id));
      return;
    }
    // 点击可编辑单元格 → 让其进入编辑, 不触发详情
    if (e.target.closest('[contenteditable="true"]')) return;
    // 点击行其它区域 → 展示详情
    const row = e.target.closest('tr[data-word-id]');
    if (row) this._showDetail(Number(row.getAttribute('data-word-id')));
  },

  /** 输入委托 (搜索框防抖 / 下拉立即过滤) */
  _onInput(e) {
    const target = e.target;
    if (!target || !target.matches) return;

    if (target.matches('[data-filter="q"]')) {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this.state.filters.q = target.value.trim();
        this._reloadWords();
      }, 300);
    } else if (target.matches('[data-filter="unit_id"]')) {
      this.state.filters.unit_id = target.value;
      this._reloadWords();
    } else if (target.matches('[data-filter="status"]')) {
      this.state.filters.status = target.value;
      this._reloadWords();
    }
  },

  /** 行内编辑键盘: Enter 保存, Esc 撤销 */
  _onKeyDown(e) {
    const cell = e.target.closest && e.target.closest('[data-field][contenteditable="true"]');
    if (!cell) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      cell.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cell.textContent = this.state.snapshot;
      cell.blur();
    }
  },

  /** 记录编辑前快照 */
  _onFocusIn(e) {
    const cell = e.target.closest('[data-field][contenteditable="true"]');
    if (!cell) return;
    this.state.snapshot = cell.textContent;
    this.state.snapshotId = Number(cell.getAttribute('data-id'));
    this.state.snapshotField = cell.getAttribute('data-field');
  },

  /** 失焦后比较并保存 */
  _onFocusOut(e) {
    const cell = e.target.closest('[data-field][contenteditable="true"]');
    if (!cell) return;
    const id = Number(cell.getAttribute('data-id'));
    const field = cell.getAttribute('data-field');
    if (id !== this.state.snapshotId || field !== this.state.snapshotField) return;

    const newValue = cell.textContent;
    if (newValue === this.state.snapshot) return; // 无变化

    // 必填字段不允许为空
    if ((field === 'english' || field === 'definition') && !newValue.trim()) {
      cell.textContent = this.state.snapshot;
      App.showToast('单词和释义不能为空', 'warning');
      return;
    }
    this._saveInline(id, field, newValue);
  },

  /** 粘贴时只插入纯文本, 防止 HTML 注入 */
  _onPaste(e) {
    const cell = e.target.closest('[contenteditable="true"]');
    if (!cell) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  },

  /* ------------------------------------------------------------------
     行内保存
     ------------------------------------------------------------------ */
  async _saveInline(wordId, field, value) {
    try {
      const updated = await API.put(`/words/${wordId}`, { [field]: value });
      const idx = this.state.words.findIndex(w => w.id === wordId);
      if (idx >= 0 && updated) {
        this.state.words[idx] = { ...this.state.words[idx], ...updated };
      }
      App.showToast('已保存', 'success');
      // 若右栏正在展示该单词, 同步刷新
      if (this.state.detailWordId === wordId) this._showDetail(wordId);
    } catch (err) {
      App.showToast(err && err.message ? err.message : '保存失败', 'error');
      // 回滚到快照
      const cell = this.container.querySelector(
        `[data-id="${wordId}"][data-field="${field}"]`
      );
      if (cell) cell.textContent = this.state.snapshot;
    }
  },

  /* ------------------------------------------------------------------
     删除
     ------------------------------------------------------------------ */
  async _confirmDelete(wordId) {
    const w = this.state.words.find(x => x.id === wordId);
    const name = w ? w.english : `#${wordId}`;
    if (!confirm(`确定删除单词 "${name}" ?`)) return;
    try {
      await API.del(`/words/${wordId}`);
      this.state.words = this.state.words.filter(x => x.id !== wordId);
      this._renderTableIntoDom();
      App.showToast('已删除', 'success');
      if (this.state.detailWordId === wordId) {
        this.state.detailWordId = null;
        App.clearDetail();
      }
    } catch (err) {
      App.showToast(err && err.message ? err.message : '删除失败', 'error');
    }
  },

  /* ------------------------------------------------------------------
     右栏详情
     ------------------------------------------------------------------ */
  _showDetail(wordId) {
    const w = this.state.words.find(x => x.id === wordId);
    if (!w) return;
    this.state.detailWordId = wordId;
    const unit = w.unit_id
      ? this.state.units.find(u => u.id === w.unit_id)
      : null;

    App.showDetail(`
      <div class="word-detail">
        <div class="word-detail__english">${App.escapeHtml(w.english)}</div>
        ${w.phonetic ? `<div class="word-detail__phonetic">${App.escapeHtml(w.phonetic)}</div>` : ''}
        <div class="word-detail__def">${App.escapeHtml(w.definition)}</div>
        ${w.example
          ? `<div class="word-detail__example">例: ${App.escapeHtml(w.example)}</div>`
          : ''}
        <div class="word-detail__meta">
          ${this._renderStatusBadge(w.status)}
          <span>单元: ${unit ? App.escapeHtml(unit.name) : '无'}</span>
        </div>
        <div class="word-detail__stats">
          <span>连续通过: ${App.escapeHtml(String(w.consecutive_passes ?? 0))}</span>
          ${w.learned_at ? `<span>首次学习: ${this._formatDate(w.learned_at)}</span>` : ''}
          ${w.created_at ? `<span>创建于: ${this._formatDate(w.created_at)}</span>` : ''}
        </div>
      </div>
    `);
  },

  /** ISO 时间 → YYYY-MM-DD HH:mm */
  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  /* ------------------------------------------------------------------
     模态框
     ------------------------------------------------------------------ */

  /** 打开模态框 (返回 overlay 元素) */
  _openModal(innerHTML) {
    this._closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${innerHTML}</div>`;
    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeModal();
    });
    // 关闭按钮
    overlay.querySelectorAll('[data-modal-close]').forEach(el => {
      el.addEventListener('click', () => this._closeModal());
    });
    // Esc 关闭
    const onKey = (e) => {
      if (e.key === 'Escape') this._closeModal();
    };
    document.addEventListener('keydown', onKey);
    overlay._onKey = onKey;

    // 自动聚焦首个输入框
    const first = overlay.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 0);

    return overlay;
  },

  /** 关闭模态框 */
  _closeModal() {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
      if (overlay._onKey) document.removeEventListener('keydown', overlay._onKey);
      overlay.remove();
    }
  },

  /* ----- 新增单词 ----- */
  _openNewWordModal() {
    const unitOptions = this._renderUnitOptions(
      this.state.units, this.state.filters.unit_id, true
    );
    const html = `
      <div class="modal__header">
        <h3 class="modal__title">新增单词</h3>
        <button class="modal__close" data-modal-close aria-label="关闭">×</button>
      </div>
      <div class="modal__body">
        <div class="form-row">
          <label class="form-row__label">单词 <span class="req">*</span></label>
          <input class="input" name="english" placeholder="如: abandon" autocomplete="off">
        </div>
        <div class="form-row">
          <label class="form-row__label">音标</label>
          <input class="input" name="phonetic" placeholder="如: /əˈbændən/" autocomplete="off">
        </div>
        <div class="form-row">
          <label class="form-row__label">释义 <span class="req">*</span></label>
          <textarea class="textarea" name="definition" placeholder="如: vt. 放弃; 抛弃"></textarea>
        </div>
        <div class="form-row">
          <label class="form-row__label">例句</label>
          <textarea class="textarea" name="example" placeholder="可选"></textarea>
        </div>
        <div class="form-row">
          <label class="form-row__label">所属单元</label>
          <select class="select" name="unit_id">${unitOptions}</select>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn" data-modal-close>取消</button>
        <button class="btn btn-primary" data-modal-submit="new-word">保存</button>
      </div>
    `;
    const overlay = this._openModal(html);
    overlay.querySelector('[data-modal-submit="new-word"]')
      .addEventListener('click', () => this._submitNewWord(overlay));
    overlay.querySelector('[name="english"]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._submitNewWord(overlay); }
    });
  },

  async _submitNewWord(overlay) {
    const english = overlay.querySelector('[name="english"]').value.trim();
    const phonetic = overlay.querySelector('[name="phonetic"]').value.trim();
    const definition = overlay.querySelector('[name="definition"]').value.trim();
    const example = overlay.querySelector('[name="example"]').value.trim();
    const unitIdRaw = overlay.querySelector('[name="unit_id"]').value;

    if (!english) { App.showToast('请输入单词', 'warning'); return; }
    if (!definition) { App.showToast('请输入释义', 'warning'); return; }

    const unit_id = unitIdRaw ? Number(unitIdRaw) : null;
    try {
      await API.post('/words/', { english, phonetic, definition, example, unit_id });
      this._closeModal();
      App.showToast('已添加', 'success');
      await this._reloadWords();
    } catch (err) {
      App.showToast(err && err.message ? err.message : '添加失败', 'error');
    }
  },

  /* ----- 批量导入 ----- */
  _openBatchModal() {
    const unitOptions = this._renderUnitOptions(
      this.state.units, this.state.filters.unit_id, true
    );
    const html = `
      <div class="modal__header">
        <h3 class="modal__title">批量导入</h3>
        <button class="modal__close" data-modal-close aria-label="关闭">×</button>
      </div>
      <div class="modal__body">
        <div class="form-row">
          <label class="form-row__label">所属单元</label>
          <select class="select" name="unit_id">${unitOptions}</select>
        </div>
        <div class="form-row">
          <label class="form-row__label">单词文本</label>
          <textarea class="textarea textarea--mono" name="text" rows="10"
            placeholder="每行一条, 格式:&#10;word|phonetic|definition|example&#10;&#10;abandon|/əˈbændən/|vt. 放弃|He abandoned his car.&#10;benefit|/ˈbenɪfɪt/|n. 利益"></textarea>
          <div class="form-hint">每行格式: word|phonetic|definition|example (example 可选)</div>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn" data-modal-close>取消</button>
        <button class="btn btn-primary" data-modal-submit="batch">导入</button>
      </div>
    `;
    const overlay = this._openModal(html);
    overlay.querySelector('[data-modal-submit="batch"]')
      .addEventListener('click', () => this._submitBatch(overlay));
  },

  async _submitBatch(overlay) {
    const text = overlay.querySelector('[name="text"]').value;
    const unitIdRaw = overlay.querySelector('[name="unit_id"]').value;
    if (!text.trim()) { App.showToast('请粘贴单词文本', 'warning'); return; }

    const query = unitIdRaw ? `?unit_id=${encodeURIComponent(unitIdRaw)}` : '';
    try {
      const result = await API.post(`/words/batch-import${query}`, { text });
      const success = Number(result && result.success) || 0;
      const failed = Number(result && result.failed) || 0;
      if (failed > 0) {
        App.showToast(`成功 ${success} 条, 失败 ${failed} 条`, 'warning');
      } else {
        App.showToast(`成功导入 ${success} 条`, 'success');
      }
      this._closeModal();
      await this._reloadWords();
    } catch (err) {
      App.showToast(err && err.message ? err.message : '导入失败', 'error');
    }
  },

  /* ----- 单元管理 ----- */
  async _openUnitModal() {
    // 先刷新单元数据
    try {
      const units = await API.get('/units/');
      this.state.units = Array.isArray(units) ? units : [];
      this._refreshFilterDropdowns();
    } catch (e) { /* 使用缓存 */ }

    const html = `
      <div class="modal__header">
        <h3 class="modal__title">管理单元</h3>
        <button class="modal__close" data-modal-close aria-label="关闭">×</button>
      </div>
      <div class="modal__body">
        <div class="form-row form-row--inline">
          <input class="input" name="unit_name" placeholder="单元名称" autocomplete="off">
          <input class="input" name="unit_desc" placeholder="描述 (可选)" autocomplete="off">
          <button class="btn btn-primary" data-modal-submit="create-unit">新增</button>
        </div>
        <div class="unit-list" data-name="unit-list">
          ${this._renderUnitList(this.state.units)}
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn" data-modal-close>关闭</button>
      </div>
    `;
    const overlay = this._openModal(html);
    overlay.querySelector('[data-modal-submit="create-unit"]')
      .addEventListener('click', () => this._submitCreateUnit(overlay));

    // 单元删除使用事件委托 (列表 innerHTML 刷新后仍生效)
    const listEl = overlay.querySelector('[data-name="unit-list"]');
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-unit-delete]');
      if (btn) this._deleteUnit(overlay, Number(btn.getAttribute('data-unit-delete')));
    });
  },

  /** 单元列表项 */
  _renderUnitList(units) {
    if (!units || units.length === 0) {
      return App.renderEmpty('暂无单元', '创建一个单元来组织单词', '📦');
    }
    return units.map(u => {
      const count = Array.isArray(u.words) ? u.words.length : 0;
      return `
        <div class="unit-item">
          <div class="unit-item__info">
            <div class="unit-item__name">${App.escapeHtml(u.name)}</div>
            <div class="unit-item__meta">${count} 词 · ${App.escapeHtml(u.description || '无描述')}</div>
          </div>
          <button class="btn btn-sm btn-danger" data-unit-delete="${u.id}">删除</button>
        </div>
      `;
    }).join('');
  },

  async _submitCreateUnit(overlay) {
    const name = overlay.querySelector('[name="unit_name"]').value.trim();
    const description = overlay.querySelector('[name="unit_desc"]').value.trim();
    if (!name) { App.showToast('请输入单元名称', 'warning'); return; }
    try {
      await API.post('/units/', { name, description });
      App.showToast('单元已创建', 'success');
      await this._refreshUnits(overlay);
      overlay.querySelector('[name="unit_name"]').value = '';
      overlay.querySelector('[name="unit_desc"]').value = '';
      overlay.querySelector('[name="unit_name"]').focus();
      this._refreshFilterDropdowns();
    } catch (err) {
      App.showToast(err && err.message ? err.message : '创建单元失败', 'error');
    }
  },

  async _deleteUnit(overlay, unitId) {
    const unit = this.state.units.find(u => u.id === unitId);
    const count = unit && Array.isArray(unit.words) ? unit.words.length : 0;
    const msg = count > 0
      ? `确定删除单元 "${unit.name}" ? 将级联删除 ${count} 个单词, 此操作不可恢复。`
      : `确定删除单元 "${unit ? unit.name : '#' + unitId}" ?`;
    if (!confirm(msg)) return;
    try {
      await API.del(`/units/${unitId}`);
      App.showToast('单元已删除', 'success');
      await this._refreshUnits(overlay);
      // 若当前过滤的是被删单元, 重置过滤并重新加载
      if (String(this.state.filters.unit_id) === String(unitId)) {
        this.state.filters.unit_id = '';
      }
      this._refreshFilterDropdowns();
      await this._reloadWords();
    } catch (err) {
      App.showToast(err && err.message ? err.message : '删除单元失败', 'error');
    }
  },

  /** 刷新单元数据并更新模态框列表 */
  async _refreshUnits(overlay) {
    try {
      const units = await API.get('/units/');
      this.state.units = Array.isArray(units) ? units : [];
    } catch (e) { /* 忽略 */ }
    const listEl = overlay.querySelector('[data-name="unit-list"]');
    if (listEl) listEl.innerHTML = this._renderUnitList(this.state.units);
  },
};
