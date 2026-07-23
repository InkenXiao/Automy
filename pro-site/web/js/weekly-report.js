/* ==========================================================================
   周报模块 WeeklyReport
   严格参照: 信投AI2.0_项目周报工具.html
   - 4 个区块: 本周概览(KPI 网格) / 本周进展(进展行) / 下周计划(模块卡) / 风险与应对(风险表)
   - 下周计划任务可关联进度计划任务 (🔗)
   ========================================================================== */

const WeeklyReport = {
  // 当前周报列表
  list: [],
  // 当前选中的周报
  current: null,

  /* ------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------- */
  init() {
    this.loadList();
  },

  /** 切换到此视图时触发 */
  onShow() {
    // 已在 init 中加载
  },

  /** 周次切换回调 */
  onWeekChange(/*week*/) {
    // 周报不严格依赖周次, 用户从列表中选择
  },

  /* ------------------------------------------------------------------
   * 加载周报列表
   * ---------------------------------------------------------------- */
  async loadList() {
    const view = document.getElementById('view-weekly-report');
    if (!view) return;

    view.innerHTML = `
      <div class="view__header">
        <div>
          <div class="view__title">📋 周报管理</div>
          <div class="view__subtitle">本周概览、进展、下周计划与风险</div>
        </div>
        <div class="view__actions">
          <button class="btn btn-primary btn-sm" id="wr-new-btn">＋ 新建周报</button>
        </div>
      </div>
      <div id="wr-list-loading">${App.renderLoading()}</div>
      <div id="wr-list"></div>
      <div id="wr-detail"></div>
    `;

    const newBtn = document.getElementById('wr-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => this.showCreateForm());

    try {
      const data = await API.getWeeklyReports();
      this.list = Array.isArray(data) ? data : (data.items || []);
      this.renderList();
    } catch (err) {
      document.getElementById('wr-list-loading').innerHTML =
        App.renderEmpty('加载失败', err.message, '⚠️');
      App.showToast(`加载周报失败: ${err.message}`, 'error');
    }
  },

  /** 渲染周报列表 */
  renderList() {
    const loadingEl = document.getElementById('wr-list-loading');
    if (loadingEl) loadingEl.innerHTML = '';

    const container = document.getElementById('wr-list');
    if (!container) return;

    if (this.list.length === 0) {
      container.innerHTML = App.renderEmpty('还没有周报', '点击右上角"新建周报"开始记录', '📝');
      return;
    }

    // 按周次倒序
    const sorted = [...this.list].sort((a, b) =>
      (b.week_start || '').localeCompare(a.week_start || '')
    );

    container.innerHTML = `
      <div class="card">
        <div class="card__header">
          <div class="card__title">周报列表</div>
          <span class="badge badge--primary">共 ${sorted.length} 份</span>
        </div>
        <div class="card__body" style="padding:0;">
          <table class="wr-list-table">
            <thead>
              <tr>
                <th>周次</th>
                <th>时间范围</th>
                <th>本周任务数</th>
                <th>下周计划数</th>
                <th>风险数</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(r => `
                <tr data-action="open" data-id="${r.id}">
                  <td><span class="tag tag--gold">${App.escapeHtml(r.week_start || '')}</span></td>
                  <td>${App.escapeHtml(r.week_start && r.week_end ? `${App.formatDate(r.week_start)} - ${App.formatDate(r.week_end)}` : r.week_start || '—')}</td>
                  <td>${(r.progress_items || []).length}</td>
                  <td>${(r.plan_tasks || []).length}</td>
                  <td>${(r.risks || []).length}</td>
                  <td>${App.statusBadge(r.status || 'completed')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // 绑定行点击 -> 加载详情
    container.querySelectorAll('tr[data-action="open"]').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-id');
        this.loadReport(id);
      });
    });
  },

  /* ------------------------------------------------------------------
   * 加载某份周报详情
   * ---------------------------------------------------------------- */
  async loadReport(id) {
    const detail = document.getElementById('wr-detail');
    if (!detail) return;

    // 滚动到详情
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    detail.innerHTML = App.renderLoading('加载周报详情...');

    try {
      const report = await API.getWeeklyReport(id);
      this.current = report;
      this.renderReport(report);
    } catch (err) {
      detail.innerHTML = App.renderEmpty('加载失败', err.message, '⚠️');
      App.showToast(`加载周报详情失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 渲染周报详情 (严格参照 信投AI2.0_项目周报工具.html)
   * 4 个区块: 本周概览 / 本周进展 / 下周计划 / 风险与应对
   * ---------------------------------------------------------------- */
  renderReport(report) {
    const detail = document.getElementById('wr-detail');
    if (!detail) return;

    const formatRange = (r) => {
      if (r.week_start && r.week_end) return `${App.formatDate(r.week_start)} - ${App.formatDate(r.week_end)}`;
      return r.week_start || '—';
    };
    const title = report.title || `${report.week_start || ''} 周报`;

    detail.innerHTML = `
      <div class="wr-week-card">
        <div class="wr-week-bar">
          <div class="wr-week-bar-l">
            <span class="tag-no">周报</span>
            <input class="wr-week-title" type="text" value="${App.escapeHtml(title)}" readonly>
          </div>
          <div class="wr-week-bar-r">
            <button class="btn btn-ghost btn-sm" data-action="export-pdf" data-id="${report.id}">📄 导出PDF</button>
            <button class="btn btn-ghost btn-sm" data-action="edit-report" data-id="${report.id}">编辑</button>
            <button class="btn btn-ghost btn-sm" data-action="edit-kpi" data-id="${report.id}">编辑 KPI</button>
            <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${report.id}">删除</button>
          </div>
        </div>
        <div class="wr-week-body">
          <div class="wr-hd-row">
            <div class="wr-hd">
              <div class="wr-hd-l">
                <h2>信投 AI 2.0 项目建设 · 项目周报</h2>
                <p>上海信投 · AI 能力建设专项 · 周报</p>
              </div>
              <div class="wr-hd-r">
                <div class="rk-label">填报周期</div>
                <div class="rk-value">${App.escapeHtml(formatRange(report))}</div>
              </div>
            </div>
          </div>

          <div class="wr-sec">
            <div class="wr-sec-h">
              <h3>本周概览</h3>
              <span class="line"></span>
              <span class="count">${(report.kpis || []).length} 个模块</span>
            </div>
            ${this.renderKpis(report.kpis || [])}
          </div>

          <div class="wr-sec">
            <div class="wr-sec-h">
              <h3>本周进展</h3>
              <span class="line"></span>
              <span class="count">${(report.progress_items || []).length} 项</span>
              <button class="btn btn-ghost btn-sm" data-action="add-progress" data-id="${report.id}" style="margin-left:8px;">＋ 新增进展</button>
            </div>
            ${this.renderProgressItems(report.progress_items || [], report.id, report)}
          </div>

          <div class="wr-sec">
            <div class="wr-sec-h">
              <h3>下周计划</h3>
              <span class="line"></span>
              <span class="count">${(report.plan_tasks || []).length} 项</span>
              <button class="btn btn-primary btn-sm" data-action="link-plan" data-id="${report.id}" style="margin-left:8px;">🔗 关联进度计划</button>
              <button class="btn btn-ghost btn-sm" data-action="add-plan" data-id="${report.id}">＋ 新增任务</button>
            </div>
            ${this.renderPlanTasks(report.plan_tasks || [], report.id)}
          </div>

          <div class="wr-sec">
            <div class="wr-sec-h">
              <h3>风险与应对</h3>
              <span class="line"></span>
              <span class="count">${(report.risks || []).length} 项</span>
              <button class="btn btn-ghost btn-sm" data-action="add-risk" data-id="${report.id}" style="margin-left:8px;">＋ 新增风险</button>
            </div>
            ${this.renderRisks(report.risks || [], report.id)}
          </div>

          <div class="wr-foot2">
            <span>填报人：__________ · 归档日期：${App.escapeHtml(report.week_start || '—')}</span>
            <span>信投 AI 能力办 · PMO 归档</span>
          </div>
        </div>
      </div>
    `;

    this.bindReportEvents(report);
  },

  /** 导出当前周报详情为 PDF */
  exportToPdf(report) {
    const detail = document.getElementById('wr-detail');
    if (!detail) {
      App.showToast('没有可导出的周报内容', 'error');
      return;
    }
    const title = report.title || `${report.week_start || ''}周报`;
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_');
    // 周报标题通常已含日期, 不再追加导出日期
    App.exportToPdf(detail, safeName, { addDate: false });
  },

  /** 渲染 KPI 网格: 6 模块卡片 (背景色+进度条+状态+百分比) */
  renderKpis(kpis) {
    if (!kpis || kpis.length === 0) {
      return App.renderEmpty('暂无 KPI', '点击右上角"编辑 KPI"录入指标', '📊');
    }
    return `
      <div class="wr-kpis">
        ${kpis.map(k => {
          const mod = App.getModule(k.module_id);
          const color = mod?.color || '#FF8C00';
          const colorBg = mod?.color_bg || '#FFF3E0';
          const statusMap = {
            '正常': 'wr-sg',
            '关注': 'wr-sy',
            '风险': 'wr-sr'
          };
          const stCls = statusMap[k.status] || 'wr-sg';
          const pct = Math.max(0, Math.min(100, k.progress_pct ?? 0));
          return `
            <div class="wr-kpi" style="background:${colorBg};color:${color};">
              <div class="n">${mod ? App.escapeHtml(mod.idx + ' · ' + mod.tag) : '—'}</div>
              <div class="t">${mod ? App.escapeHtml(mod.title) : '未指定模块'}</div>
              <div class="pb"><div class="pf" style="width:${pct}%;background:${color};"></div></div>
              <div class="pv">
                <span class="${stCls}" style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${App.escapeHtml(k.status || '正常')}</span>
                <span class="pct-val" style="color:${color};">${pct}%</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  /** 渲染本周进展 (panel + rows 网格 230px/1fr/90px) */
  renderProgressItems(items, reportId, report) {
    if (!items || items.length === 0) {
      return App.renderEmpty('暂无进展记录', '点击右上角"新增进展"或编辑 KPI 后自动同步', '📝');
    }

    // 按模块分组
    const grouped = {};
    items.forEach(item => {
      const moduleId = item.module_id || 'other';
      if (!grouped[moduleId]) grouped[moduleId] = [];
      grouped[moduleId].push(item);
    });

    return `
      <div class="wr-panel">
        ${Object.entries(grouped).map(([moduleId, list]) => {
          const mod = App.getModule(moduleId);
          const color = mod?.color || '#FF8C00';
          const colorBg = mod?.color_bg || '#FFF3E0';
          // 从同模块 KPI 获取进度和状态（进展项本身无此字段）
          const kpi = (report.kpis || []).find(k => String(k.module_id) === String(moduleId));
          const pct = Math.max(0, Math.min(100, kpi?.progress_pct ?? 0));
          const kpiStatus = kpi?.status || '正常';
          const stCls = kpiStatus === '风险' ? 'wr-sr'
                      : kpiStatus === '关注' ? 'wr-sy' : 'wr-sg';
          return `
            <div class="wr-row" style="border-left:3px solid ${color};">
              <div class="wr-ri">
                <div class="idx" style="color:${color};">${mod ? App.escapeHtml(mod.idx + ' · ' + mod.tag) : '其他'}</div>
                <div class="ti">${mod ? App.escapeHtml(mod.title) : '其他事项'}</div>
                <div class="ow">负责人：${App.escapeHtml(mod?.owner || '—')}</div>
                <div class="bar"><div class="bf" style="width:${pct}%;background:${color};"></div></div>
              </div>
              <div class="wr-rb">
                <ul>
                  ${list.map(it => `
                    <li>
                      <b>${App.escapeHtml(it.content || '')}</b>
                      ${it.detail ? `<i>${App.escapeHtml(it.detail)}</i>` : ''}
                      <span class="wr-item-edit" data-action="edit-progress" data-id="${it.id}" data-report-id="${reportId}">编辑</span>
                      <span class="wr-del-item" data-action="delete-progress" data-id="${it.id}" data-report-id="${reportId}">×</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
              <div class="wr-rc">
                <span class="${stCls}" style="padding:3px 8px;border-radius:10px;font-size:11px;font-weight:600;">${App.escapeHtml(kpiStatus)}</span>
                <div class="pp"><span>${pct}</span><small>%</small></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  /** 渲染下周计划 (2 列卡片，每张含模块标题 + 重点toggle + 事项列表) */
  renderPlanTasks(planTasks, reportId) {
    if (!planTasks || planTasks.length === 0) {
      return App.renderEmpty('暂无下周计划', '点击右上角"关联进度计划"或"新增任务"', '📌');
    }

    // 按模块分组
    const grouped = {};
    planTasks.forEach(t => {
      const moduleId = t.module_id || 'other';
      if (!grouped[moduleId]) grouped[moduleId] = [];
      grouped[moduleId].push(t);
    });

    return `
      <div class="wr-nw">
        ${Object.entries(grouped).map(([moduleId, list]) => {
          const mod = App.getModule(moduleId);
          const color = mod?.color || '#FF8C00';
          const colorBg = mod?.color_bg || '#FFF3E0';
          const hasKey = list.some(t => t.is_key || t.is_important);
          return `
            <div class="wr-nc" style="background:${colorBg};border-color:${color}20;--mc:${color};">
              <h4 style="color:${color};">
                <span class="nc-title">${mod ? App.escapeHtml(mod.idx + ' ' + mod.title) : '其他'}</span>
                <span class="wr-tag-toggle ${hasKey ? 'on' : ''}" data-action="toggle-key-group" data-module-id="${moduleId}" data-report-id="${reportId}">重点</span>
              </h4>
              <ul>
                ${list.map(t => {
                  const isLinked = !!t.progress_task_id;
                  const linkedName = t.progress_task?.name || '';
                  return `
                    <li data-task-id="${t.id}" data-report-id="${reportId}">
                      <b>${App.escapeHtml(t.name || '')}</b>
                      ${isLinked ? ` <i>🔗 ${App.escapeHtml(linkedName)}</i>` : ''}
                      ${t.owner ? ` <i>👤 ${App.escapeHtml(t.owner)}</i>` : ''}
                      <span class="wr-item-edit" data-action="edit-plan" data-id="${t.id}" data-report-id="${reportId}">编辑</span>
                      <span class="wr-del-item" data-action="delete-plan" data-id="${t.id}" data-report-id="${reportId}">×</span>
                    </li>
                  `;
                }).join('')}
              </ul>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  /** 渲染风险表 (grid 48px/1fr/2fr/88px/70px) */
  renderRisks(risks, reportId) {
    if (!risks || risks.length === 0) {
      return App.renderEmpty('暂无风险记录', '点击右上角"新增风险"录入', '✅');
    }
    return `
      <div class="wr-risk-table">
        <div class="wr-risk-head">
          <span>序号</span>
          <span>标题</span>
          <span>需要协调的内容</span>
          <span>紧急程度</span>
          <span>操作</span>
        </div>
        ${risks.map((r, i) => {
          const urgency = r.urgency || '中';
          const uCls = urgency === '高' ? 'u-high' : urgency === '低' ? 'u-low' : 'u-mid';
          const rkCls = urgency === '高' ? '' : urgency === '低' ? 'rk-green' : 'rk-amber';
          return `
            <div class="wr-rk ${rkCls}">
              <span class="lv">${App.escapeHtml(r.seq || ('R' + (i+1)))}</span>
              <span class="wr-rk-title">${App.escapeHtml(r.title || '')}</span>
              <span class="wr-rk-content">${App.escapeHtml(r.coordination || r.content || '—')}</span>
              <span class="wr-urgency ${uCls}">${App.escapeHtml(urgency)}</span>
              <span class="wr-rk-actions">
                <span class="wr-item-edit" data-action="edit-risk" data-id="${r.id}" data-report-id="${reportId}">编辑</span>
                <span class="wr-del-item" data-action="delete-risk" data-id="${r.id}" data-report-id="${reportId}">×</span>
              </span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  /* ------------------------------------------------------------------
   * 事件绑定
   * ---------------------------------------------------------------- */
  bindReportEvents(report) {
    const detail = document.getElementById('wr-detail');
    if (!detail) return;

    detail.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const reportId = btn.getAttribute('data-report-id');

        switch (action) {
          case 'export-pdf':
            this.exportToPdf(report);
            break;
          case 'edit-kpi':
            this.editKpis(report);
            break;
          case 'edit-report':
            this.editReport(report);
            break;
          case 'delete':
            this.deleteReport(id);
            break;
          case 'add-plan':
            this.addPlanTask(id);
            break;
          case 'link-plan':
            this.linkPlanTask(id);
            break;
          case 'edit-plan':
            this.editPlanTask(report, id);
            break;
          case 'toggle-key-group': {
            // 切换整组任务的重点状态
            const moduleId = btn.getAttribute('data-module-id');
            const tasks = (report.plan_tasks || []).filter(t => String(t.module_id || 'other') === String(moduleId));
            const anyKey = tasks.some(t => t.is_key || t.is_important);
            // 批量切换, 不刷新, 全部完成后 reload 一次
            Promise.all(tasks.map(t => this.toggleKey(reportId, t.id, !anyKey, true)))
              .then(() => {
                App.showToast(anyKey ? '已取消整组重点' : '已标记整组重点', 'success');
                this.loadReport(reportId);
              })
              .catch(err => App.showToast(`更新失败: ${err.message}`, 'error'));
            break;
          }
          case 'delete-plan':
            this.deletePlanTask(reportId, id);
            break;
          case 'add-progress':
            this.addProgressItem(id);
            break;
          case 'edit-progress':
            this.editProgressItem(report, id);
            break;
          case 'delete-progress':
            this.deleteProgressItem(reportId, id);
            break;
          case 'add-risk':
            this.addRisk(id);
            break;
          case 'edit-risk':
            this.editRisk(report, id);
            break;
          case 'delete-risk':
            this.deleteRisk(reportId, id);
            break;
        }
      });
    });

    // 计划任务项点击 -> 右栏显示详情
    detail.querySelectorAll('.wr-nc li[data-task-id]').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const taskId = li.getAttribute('data-task-id');
        const task = (report.plan_tasks || []).find(t => String(t.id) === String(taskId));
        if (task) this.showTaskDetail(task);
      });
    });
  },

  /* ------------------------------------------------------------------
   * 新建周报表单
   * ---------------------------------------------------------------- */
  showCreateForm() {
    const modal = App.openModal({
      title: '新建周报',
      bodyHtml: `
        <div class="form-group">
          <label>周次</label>
          <input type="week" id="new-week" value="${App.state.currentWeek || ''}">
        </div>
        <div class="form-group">
          <label>标题 (可选)</label>
          <input type="text" id="new-title" placeholder="例如: 第29周周报">
        </div>
        <div class="form-group">
          <label>本周总结</label>
          <textarea id="new-summary" placeholder="本周整体完成情况..."></textarea>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="new-save-btn">创建</button>
      `
    });

    modal.querySelector('#new-save-btn').addEventListener('click', async () => {
      const weekStart = modal.querySelector('#new-week').value;
      const title = modal.querySelector('#new-title').value.trim();
      const summary = modal.querySelector('#new-summary').value.trim();

      if (!weekStart) {
        App.showToast('请选择周次', 'warning');
        return;
      }

      const monday = App.weekToDate(weekStart, 1);
      const sunday = App.weekToDate(weekStart, 7);

      try {
        await API.createWeeklyReport({
          week_start: monday,
          week_end: sunday,
          title: title || `${weekStart} 周报`,
          overview_summary: summary
        });
        App.showToast('周报创建成功', 'success');
        App.closeModal(modal);
        this.loadList();
      } catch (err) {
        App.showToast(`创建失败: ${err.message}`, 'error');
      }
    });
  },

  /** 编辑 KPI (按模块录入进度百分比与状态) */
  editKpis(report) {
    const existing = (report.kpis || []).slice();
    const existingMap = {};
    existing.forEach(k => { existingMap[k.module_id] = k; });

    const renderKpiRow = (kpi) => {
      const moduleId = kpi?.module_id || '';
      const progressPct = kpi?.progress_pct ?? 0;
      const status = kpi?.status || '正常';
      const kpiId = kpi?.id;
      return `
        <div class="form-row" data-kpi-row data-module-id="${moduleId}" data-kpi-id="${kpiId || ''}">
          <div class="form-group" style="flex:2;">
            <label>模块</label>
            <select data-kpi-module>
              <option value="">— 请选择 —</option>
              ${App.state.modules.map(m => `<option value="${m.id}" ${String(moduleId) === String(m.id) ? 'selected' : ''}>${App.escapeHtml(m.title)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label>进度 (%)</label>
            <input type="number" min="0" max="100" data-kpi-progress value="${progressPct}">
          </div>
          <div class="form-group" style="flex:1;">
            <label>状态</label>
            <select data-kpi-status>
              <option value="正常" ${status === '正常' ? 'selected' : ''}>正常</option>
              <option value="关注" ${status === '关注' ? 'selected' : ''}>关注</option>
              <option value="风险" ${status === '风险' ? 'selected' : ''}>风险</option>
            </select>
          </div>
          ${kpiId ? `
            <div class="form-group wr-kpi-row-del" style="flex:0 0 auto;align-self:flex-end;">
              <button type="button" class="btn btn-ghost btn-sm" data-kpi-del data-kpi-id="${kpiId}">删除</button>
            </div>
          ` : ''}
        </div>
      `;
    };

    const modal = App.openModal({
      title: '编辑 KPI (按模块)',
      bodyHtml: `
        <div id="kpi-editor">
          ${existing.length === 0 ? renderKpiRow(null) : existing.map(k => renderKpiRow(k)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="kpi-add-row" style="margin-top:8px;">＋ 添加模块 KPI</button>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="kpi-save-btn">保存</button>
      `
    });

    modal.querySelector('#kpi-add-row').addEventListener('click', () => {
      const editor = modal.querySelector('#kpi-editor');
      const wrap = document.createElement('div');
      wrap.innerHTML = renderKpiRow(null);
      editor.appendChild(wrap.firstElementChild);
    });

    // KPI 行删除 (事件委托, 覆盖初始行和动态新增行)
    modal.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('[data-kpi-del]');
      if (!delBtn) return;
      const kpiId = delBtn.getAttribute('data-kpi-id');
      if (!kpiId) return;
      if (!confirm('确认删除该 KPI?')) return;
      try {
        await API.deleteKpi(report.id, kpiId);
        App.showToast('KPI 已删除', 'success');
        const row = delBtn.closest('[data-kpi-row]');
        if (row) row.remove();
        // 同步更新本地数据, 避免重复保存
        if (report.kpis) {
          report.kpis = report.kpis.filter(k => String(k.id) !== String(kpiId));
        }
      } catch (err) {
        App.showToast(`删除失败: ${err.message}`, 'error');
      }
    });

    modal.querySelector('#kpi-save-btn').addEventListener('click', async () => {
      const rows = modal.querySelectorAll('[data-kpi-row]');
      const payload = [];
      rows.forEach(row => {
        const moduleId = row.querySelector('[data-kpi-module]')?.value;
        const progressPct = parseInt(row.querySelector('[data-kpi-progress]')?.value || '0', 10);
        const status = row.querySelector('[data-kpi-status]')?.value || '正常';
        if (moduleId) {
          payload.push({
            module_id: parseInt(moduleId, 10),
            progress_pct: isNaN(progressPct) ? 0 : progressPct,
            status
          });
        }
      });

      try {
        await API.saveKpis(report.id, payload);
        App.showToast('KPI 已保存', 'success');
        App.closeModal(modal);
        this.loadReport(report.id);
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /** 删除周报 */
  async deleteReport(id) {
    if (!confirm('确认删除该周报? 此操作不可撤销。')) return;
    try {
      await API.deleteWeeklyReport(id);
      App.showToast('已删除', 'success');
      this.current = null;
      this.loadList();
      document.getElementById('wr-detail').innerHTML = '';
    } catch (err) {
      App.showToast(`删除失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 下周任务操作
   * ---------------------------------------------------------------- */

  /** 新增下周任务 (输入任务名) */
  addPlanTask(reportId) {
    const modal = App.openModal({
      title: '新增下周任务',
      bodyHtml: `
        <div class="form-group">
          <label>任务名称 *</label>
          <input type="text" id="plan-task-name" placeholder="例如: 完成需求评审">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>所属模块</label>
            <select id="plan-task-module">
              <option value="">— 请选择 —</option>
              ${App.state.modules.map(m => `<option value="${m.id}">${App.escapeHtml(m.title)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>负责人</label>
            <input type="text" id="plan-task-owner" placeholder="姓名">
          </div>
        </div>
        <div class="form-group">
          <label>是否重点</label>
          <select id="plan-task-key">
            <option value="false">否</option>
            <option value="true">是</option>
          </select>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="plan-save-btn">添加</button>
      `
    });

    modal.querySelector('#plan-save-btn').addEventListener('click', async () => {
      const name = modal.querySelector('#plan-task-name').value.trim();
      const moduleId = modal.querySelector('#plan-task-module').value;
      const owner = modal.querySelector('#plan-task-owner').value.trim();
      const isKey = modal.querySelector('#plan-task-key').value === 'true';

      if (!name) {
        App.showToast('请输入任务名称', 'warning');
        return;
      }

      try {
        await API.addPlanTask(reportId, {
          name,
          module_id: moduleId ? parseInt(moduleId, 10) : null,
          owner,
          is_key: isKey
        });
        App.showToast('任务已添加', 'success');
        App.closeModal(modal);
        this.loadReport(reportId);
      } catch (err) {
        App.showToast(`添加失败: ${err.message}`, 'error');
      }
    });
  },

  /** 关联进度计划任务 (从进度计划选择) */
  async linkPlanTask(reportId) {
    let tasks = [];
    try {
      const data = await API.getProgressTasks({ status: 'ongoing' });
      tasks = Array.isArray(data) ? data : (data.items || []);
    } catch (err) {
      App.showToast(`加载进度计划任务失败: ${err.message}`, 'error');
      return;
    }

    if (tasks.length === 0) {
      App.showToast('当前没有可关联的进度计划任务', 'warning');
      return;
    }

    this.showProgressTaskPicker(async (selectedTask) => {
      try {
        let moduleId = selectedTask.module_id || null;
        if (!moduleId) {
          moduleId = await this.pickModule();
          if (!moduleId) {
            App.showToast('请选择所属模块', 'warning');
            return;
          }
        }
        await API.linkPlanTask(reportId, {
          progress_task_id: selectedTask.id,
          module_id: moduleId
        });
        App.showToast(`已关联: ${selectedTask.name}`, 'success');
        this.loadReport(reportId);
      } catch (err) {
        App.showToast(`关联失败: ${err.message}`, 'error');
      }
    }, tasks);
  },

  /** 选择模块 (返回 Promise<moduleId|null>) */
  pickModule() {
    return new Promise(resolve => {
      const modal = App.openModal({
        title: '选择所属模块',
        bodyHtml: `
          <div class="form-group">
            <label>该任务所属模块 *</label>
            <select id="link-module-id">
              <option value="">— 请选择 —</option>
              ${App.state.modules.map(m => `<option value="${m.id}">${App.escapeHtml(m.title)}</option>`).join('')}
            </select>
          </div>
        `,
        footerHtml: `
          <button class="btn btn-ghost" data-modal-close>取消</button>
          <button class="btn btn-primary" id="link-module-ok">确定</button>
        `
      });
      modal.querySelector('#link-module-ok').addEventListener('click', () => {
        const v = modal.querySelector('#link-module-id').value;
        App.closeModal(modal);
        resolve(v ? parseInt(v, 10) : null);
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.hasAttribute('data-modal-close')) {
          resolve(null);
        }
      });
    });
  },

  /**
   * 显示进度计划任务选择模态框
   * @param {function} callback - 选中后的回调
   * @param {Array} presetTasks - 预加载的任务列表 (可选)
   */
  showProgressTaskPicker(callback, presetTasks = null) {
    const modal = App.openModal({
      title: '选择进度计划任务',
      bodyHtml: `
        <div class="form-row" style="margin-bottom: 12px;">
          <div class="form-group" style="flex:1;">
            <label>阶段筛选</label>
            <select id="picker-phase">
              <option value="">全部阶段</option>
              ${App.state.phases.map(p => `<option value="${p.id}">${App.escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label>状态</label>
            <select id="picker-status">
              <option value="">全部状态</option>
              <option value="planned">待开始</option>
              <option value="ongoing">进行中</option>
              <option value="done">已完成</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>搜索</label>
          <input type="text" id="picker-search" placeholder="任务名称关键字">
        </div>
        <div id="picker-list" style="max-height: 320px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
          ${App.renderLoading('加载中...')}
        </div>
      `,
      size: 'lg'
    });

    const renderPickerList = (allTasks) => {
      const phase = modal.querySelector('#picker-phase').value;
      const status = modal.querySelector('#picker-status').value;
      const kw = modal.querySelector('#picker-search').value.trim().toLowerCase();

      const filtered = allTasks.filter(t => {
        if (phase && String(t.phase_id) !== String(phase)) return false;
        if (status && t.status !== status) return false;
        if (kw && !(t.name || '').toLowerCase().includes(kw)) return false;
        return true;
      });

      const list = modal.querySelector('#picker-list');
      if (filtered.length === 0) {
        list.innerHTML = App.renderEmpty('没有匹配的任务', '', '🔍');
        return;
      }

      list.innerHTML = filtered.map(t => {
        const phase = App.getPhase(t.phase_id);
        return `
          <div class="task-item" data-task-id="${t.id}" style="cursor:pointer;">
            <div class="task-item__header">
              <div class="task-item__name">${t.is_milestone ? '★ ' : ''}${App.escapeHtml(t.name || '')}</div>
              ${App.statusBadge(t.status)}
            </div>
            <div class="task-item__meta">
              ${phase ? `<span class="task-item__meta-item"><span class="tag tag--gray">${App.escapeHtml(phase.name)}</span></span>` : ''}
              ${t.owner ? `<span class="task-item__meta-item">👤 ${App.escapeHtml(t.owner)}</span>` : ''}
              ${t.start_date ? `<span class="task-item__meta-item">📅 ${App.escapeHtml(App.formatDate(t.start_date))}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

      list.querySelectorAll('.task-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.getAttribute('data-task-id');
          const task = filtered.find(t => String(t.id) === String(id));
          if (task) {
            App.closeModal(modal);
            callback(task);
          }
        });
      });
    };

    if (presetTasks) {
      renderPickerList(presetTasks);
    } else {
      API.getProgressTasks().then(data => {
        const tasks = Array.isArray(data) ? data : (data.items || []);
        renderPickerList(tasks);
      }).catch(err => {
        modal.querySelector('#picker-list').innerHTML = App.renderEmpty('加载失败', err.message, '⚠️');
      });
    }

    ['picker-phase', 'picker-status', 'picker-search'].forEach(id => {
      const usePreset = !!presetTasks;
      modal.querySelector(`#${id}`).addEventListener('input', () => {
        if (usePreset) {
          renderPickerList(presetTasks);
        } else {
          API.getProgressTasks().then(data => {
            const tasks = Array.isArray(data) ? data : (data.items || []);
            renderPickerList(tasks);
          });
        }
      });
    });
  },

  /**
   * 切换任务是否重点
   * @param {string|number} reportId
   * @param {string|number} taskId
   * @param {boolean} isKey
   * @param {boolean} skipReload - 批量场景下不刷新
   */
  async toggleKey(reportId, taskId, isKey, skipReload = false) {
    try {
      await API.updatePlanTask(reportId, taskId, { is_key: isKey });
      if (!skipReload) {
        App.showToast(isKey ? '已标记为重点' : '已取消重点', 'success');
        this.loadReport(reportId);
      }
    } catch (err) {
      App.showToast(`更新失败: ${err.message}`, 'error');
      throw err;
    }
  },

  /** 删除下周任务 */
  async deletePlanTask(reportId, taskId) {
    if (!confirm('确认删除该任务?')) return;
    try {
      await API.deletePlanTask(reportId, taskId);
      App.showToast('已删除', 'success');
      this.loadReport(reportId);
    } catch (err) {
      App.showToast(`删除失败: ${err.message}`, 'error');
    }
  },

  /** 编辑下周任务 (完整表单) */
  editPlanTask(report, taskId) {
    const task = (report.plan_tasks || []).find(t => String(t.id) === String(taskId));
    if (!task) {
      App.showToast('未找到该任务', 'warning');
      return;
    }
    const status = task.status || '待开始';
    const isKey = !!(task.is_key || task.is_important);
    const modal = App.openModal({
      title: '编辑下周任务',
      bodyHtml: `
        <div class="form-group">
          <label>任务名称 *</label>
          <input type="text" id="pt-name" value="${App.escapeHtml(task.name || '')}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>所属模块</label>
            <select id="pt-module">
              <option value="">— 请选择 —</option>
              ${App.state.modules.map(m => `<option value="${m.id}" ${String(task.module_id) === String(m.id) ? 'selected' : ''}>${App.escapeHtml(m.title)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>负责人</label>
            <input type="text" id="pt-owner" value="${App.escapeHtml(task.owner || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>计划周期</label>
            <input type="text" id="pt-period" value="${App.escapeHtml(task.plan_period || '')}" placeholder="如 2026-W30">
          </div>
          <div class="form-group">
            <label>状态</label>
            <select id="pt-status">
              <option value="待开始" ${status === '待开始' ? 'selected' : ''}>待开始</option>
              <option value="进行中" ${status === '进行中' ? 'selected' : ''}>进行中</option>
              <option value="已完成" ${status === '已完成' ? 'selected' : ''}>已完成</option>
              <option value="阻塞" ${status === '阻塞' ? 'selected' : ''}>阻塞</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>是否重点</label>
          <select id="pt-key">
            <option value="false" ${!isKey ? 'selected' : ''}>否</option>
            <option value="true" ${isKey ? 'selected' : ''}>是</option>
          </select>
        </div>
        <div class="form-group">
          <label>备注</label>
          <textarea id="pt-remark" rows="3" placeholder="可选...">${App.escapeHtml(task.remark || '')}</textarea>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="pt-save-btn">保存</button>
      `
    });

    modal.querySelector('#pt-save-btn').addEventListener('click', async () => {
      const name = modal.querySelector('#pt-name').value.trim();
      const moduleId = modal.querySelector('#pt-module').value;
      const owner = modal.querySelector('#pt-owner').value.trim();
      const planPeriod = modal.querySelector('#pt-period').value.trim();
      const taskStatus = modal.querySelector('#pt-status').value;
      const keyVal = modal.querySelector('#pt-key').value === 'true';
      const remark = modal.querySelector('#pt-remark').value.trim();

      if (!name) {
        App.showToast('请输入任务名称', 'warning');
        return;
      }

      const payload = {
        name,
        module_id: moduleId ? parseInt(moduleId, 10) : null,
        owner,
        plan_period: planPeriod,
        status: taskStatus,
        is_key: keyVal,
        remark
      };

      try {
        await API.updatePlanTask(report.id, task.id, payload);
        App.showToast('任务已更新', 'success');
        App.closeModal(modal);
        this.loadReport(report.id);
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /* ------------------------------------------------------------------
   * 周报主记录编辑
   * ---------------------------------------------------------------- */
  editReport(report) {
    const modal = App.openModal({
      title: '编辑周报',
      bodyHtml: `
        <div class="form-group">
          <label>标题</label>
          <input type="text" id="rpt-title" value="${App.escapeHtml(report.title || '')}">
        </div>
        <div class="form-group">
          <label>填报周期</label>
          <input type="text" id="rpt-week-range" value="${App.escapeHtml(report.week_range || '')}" placeholder="如 7月15日 - 7月21日">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>开始日期</label>
            <input type="date" id="rpt-week-start" value="${App.escapeHtml(report.week_start || '')}">
          </div>
          <div class="form-group">
            <label>结束日期</label>
            <input type="date" id="rpt-week-end" value="${App.escapeHtml(report.week_end || '')}">
          </div>
        </div>
        <div class="form-group">
          <label>概览总结</label>
          <textarea id="rpt-overview-summary" rows="4" placeholder="本周整体完成情况...">${App.escapeHtml(report.overview_summary || '')}</textarea>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="rpt-save-btn">保存</button>
      `
    });

    modal.querySelector('#rpt-save-btn').addEventListener('click', async () => {
      const title = modal.querySelector('#rpt-title').value.trim();
      const weekRange = modal.querySelector('#rpt-week-range').value.trim();
      const weekStart = modal.querySelector('#rpt-week-start').value;
      const weekEnd = modal.querySelector('#rpt-week-end').value;
      const overviewSummary = modal.querySelector('#rpt-overview-summary').value.trim();

      const payload = {
        title,
        week_range: weekRange,
        week_start: weekStart || null,
        week_end: weekEnd || null,
        overview_summary: overviewSummary
      };

      try {
        await API.updateWeeklyReport(report.id, payload);
        App.showToast('周报已更新', 'success');
        App.closeModal(modal);
        this.loadReport(report.id);
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /* ------------------------------------------------------------------
   * 本周进展项 CRUD
   * ---------------------------------------------------------------- */
  /** 新增本周进展项 */
  addProgressItem(reportId) {
    this._showProgressItemModal(reportId, null);
  },

  /** 编辑本周进展项 */
  editProgressItem(report, itemId) {
    const item = (report.progress_items || []).find(it => String(it.id) === String(itemId));
    if (!item) {
      App.showToast('未找到该进展项', 'warning');
      return;
    }
    this._showProgressItemModal(report.id, item);
  },

  /** 进展项模态框 (新增/编辑共用) */
  _showProgressItemModal(reportId, item) {
    const isEdit = !!item;
    const modal = App.openModal({
      title: isEdit ? '编辑进展项' : '新增进展项',
      bodyHtml: `
        <div class="form-group">
          <label>模块 *</label>
          <select id="pi-module">
            <option value="">— 请选择 —</option>
            ${App.state.modules.map(m => `<option value="${m.id}" ${item && String(item.module_id) === String(m.id) ? 'selected' : ''}>${App.escapeHtml(m.title)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>事项标题 *</label>
          <input type="text" id="pi-content" value="${App.escapeHtml(item?.content || '')}" placeholder="例如: 完成需求评审">
        </div>
        <div class="form-group">
          <label>补充说明</label>
          <textarea id="pi-detail" rows="3" placeholder="可选, 详细说明...">${App.escapeHtml(item?.detail || '')}</textarea>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="pi-save-btn">${isEdit ? '保存' : '添加'}</button>
      `
    });

    modal.querySelector('#pi-save-btn').addEventListener('click', async () => {
      const moduleId = modal.querySelector('#pi-module').value;
      const content = modal.querySelector('#pi-content').value.trim();
      const detail = modal.querySelector('#pi-detail').value.trim();

      if (!moduleId) {
        App.showToast('请选择模块', 'warning');
        return;
      }
      if (!content) {
        App.showToast('请输入事项标题', 'warning');
        return;
      }

      const payload = {
        module_id: parseInt(moduleId, 10),
        content,
        detail
      };

      try {
        if (isEdit) {
          await API.updateProgressItem(reportId, item.id, payload);
          App.showToast('进展项已更新', 'success');
        } else {
          await API.addProgressItem(reportId, payload);
          App.showToast('进展项已添加', 'success');
        }
        App.closeModal(modal);
        this.loadReport(reportId);
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /** 删除本周进展项 */
  async deleteProgressItem(reportId, itemId) {
    if (!confirm('确认删除该进展项?')) return;
    try {
      await API.deleteProgressItem(reportId, itemId);
      App.showToast('已删除', 'success');
      this.loadReport(reportId);
    } catch (err) {
      App.showToast(`删除失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 风险 CRUD
   * ---------------------------------------------------------------- */
  /** 新增风险 */
  addRisk(reportId) {
    this._showRiskModal(reportId, null);
  },

  /** 编辑风险 */
  editRisk(report, riskId) {
    const risk = (report.risks || []).find(r => String(r.id) === String(riskId));
    if (!risk) {
      App.showToast('未找到该风险', 'warning');
      return;
    }
    this._showRiskModal(report.id, risk);
  },

  /** 风险模态框 (新增/编辑共用) */
  _showRiskModal(reportId, risk) {
    const isEdit = !!risk;
    const urgency = risk?.urgency || '中';
    const modal = App.openModal({
      title: isEdit ? '编辑风险' : '新增风险',
      bodyHtml: `
        <div class="form-row">
          <div class="form-group">
            <label>编号 (如 R1)</label>
            <input type="text" id="risk-seq" value="${App.escapeHtml(risk?.seq || '')}" placeholder="R1">
          </div>
          <div class="form-group">
            <label>紧急程度</label>
            <select id="risk-urgency">
              <option value="高" ${urgency === '高' ? 'selected' : ''}>高</option>
              <option value="中" ${urgency === '中' ? 'selected' : ''}>中</option>
              <option value="低" ${urgency === '低' ? 'selected' : ''}>低</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>标题 *</label>
          <input type="text" id="risk-title" value="${App.escapeHtml(risk?.title || '')}" placeholder="风险标题">
        </div>
        <div class="form-group">
          <label>需要协调的内容</label>
          <textarea id="risk-coordination" rows="3" placeholder="需要协调的资源/人员/决策...">${App.escapeHtml(risk?.coordination || '')}</textarea>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="risk-save-btn">${isEdit ? '保存' : '添加'}</button>
      `
    });

    modal.querySelector('#risk-save-btn').addEventListener('click', async () => {
      const seq = modal.querySelector('#risk-seq').value.trim();
      const riskUrgency = modal.querySelector('#risk-urgency').value;
      const title = modal.querySelector('#risk-title').value.trim();
      const coordination = modal.querySelector('#risk-coordination').value.trim();

      if (!title) {
        App.showToast('请输入风险标题', 'warning');
        return;
      }

      const payload = {
        seq,
        title,
        coordination,
        urgency: riskUrgency
      };

      try {
        if (isEdit) {
          await API.updateRisk(reportId, risk.id, payload);
          App.showToast('风险已更新', 'success');
        } else {
          await API.addRisk(reportId, payload);
          App.showToast('风险已添加', 'success');
        }
        App.closeModal(modal);
        this.loadReport(reportId);
      } catch (err) {
        App.showToast(`保存失败: ${err.message}`, 'error');
      }
    });
  },

  /** 删除风险 */
  async deleteRisk(reportId, riskId) {
    if (!confirm('确认删除该风险?')) return;
    try {
      await API.deleteRisk(reportId, riskId);
      App.showToast('已删除', 'success');
      this.loadReport(reportId);
    } catch (err) {
      App.showToast(`删除失败: ${err.message}`, 'error');
    }
  },

  /* ------------------------------------------------------------------
   * 右栏详情: 显示下周任务的关联链路
   * ---------------------------------------------------------------- */
  showTaskDetail(task) {
    const mod = App.getModule(task.module_id);

    let progressTaskHtml = '';
    if (task.progress_task_id && task.progress_task) {
      const pt = task.progress_task;
      const phase = App.getPhase(pt.phase_id);
      progressTaskHtml = `
        <div class="detail-section">
          <div class="detail-section__label">关联的进度计划任务</div>
          <div class="detail-section__value">
            🔗 <strong>${App.escapeHtml(pt.name || '')}</strong>
            <div class="text-xs text-tertiary" style="margin-top:4px;">ID: ${App.escapeHtml(String(pt.id))} · UID: ${App.escapeHtml(pt.task_uid || '')}</div>
            ${phase ? `<div style="margin-top:4px;"><span class="tag tag--blue">${App.escapeHtml(phase.name)}</span></div>` : ''}
            ${pt.start_date ? `<div class="text-xs text-tertiary" style="margin-top:4px;">📅 ${App.escapeHtml(App.formatDate(pt.start_date))} ~ ${App.escapeHtml(App.formatDate(pt.end_date))}</div>` : ''}
            ${pt.owner ? `<div class="text-xs text-tertiary" style="margin-top:4px;">👤 ${App.escapeHtml(pt.owner)}</div>` : ''}
          </div>
        </div>
      `;
    } else if (task.progress_task_id) {
      progressTaskHtml = `
        <div class="detail-section">
          <div class="detail-section__label">关联的进度计划任务</div>
          <div class="detail-section__value">
            🔗 <strong>进度计划任务 #${App.escapeHtml(String(task.progress_task_id))}</strong>
          </div>
        </div>
      `;
    } else {
      progressTaskHtml = `
        <div class="detail-section">
          <div class="detail-section__label">关联的进度计划任务</div>
          <div class="detail-section__value text-tertiary">未关联 (临时下周任务)</div>
        </div>
      `;
    }

    App.showDetail(`
      <div class="detail-panel__header">
        <div class="detail-panel__title">📌 周报下周任务</div>
        <div class="detail-panel__meta">来自周报 #${App.escapeHtml(String(this.current?.id || ''))}</div>
      </div>
      <div class="detail-panel__body">
        <div class="detail-section">
          <div class="detail-section__label">任务名称</div>
          <div class="detail-section__value font-bold">${App.escapeHtml(task.name || '')}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">所属模块</div>
          <div class="detail-section__value">
            ${mod ? `<span class="tag" style="background:${mod.color_bg || '#FFF3E0'};color:${mod.color || '#E85D1C'};border-color:${(mod.color || '#E85D1C')}30;">${App.escapeHtml(mod.title)}</span>` : '<span class="text-tertiary">未指定</span>'}
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">负责人</div>
          <div class="detail-section__value">${App.escapeHtml(task.owner || '—')}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">状态</div>
          <div class="detail-section__value">${App.statusBadge(task.status || '待开始')}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__label">是否重点</div>
          <div class="detail-section__value">
            ${task.is_key || task.is_important
              ? '<span class="badge badge--primary">⭐ 重点任务</span>'
              : '<span class="text-tertiary">普通任务</span>'}
          </div>
        </div>
        ${progressTaskHtml}
      </div>
    `);
  }
};
