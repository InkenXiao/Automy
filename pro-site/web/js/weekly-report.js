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
          <button class="btn btn-ghost btn-sm" id="wr-copy-btn" title="复制最近一份周报到新周次">📋 复制上周周报</button>
          <button class="btn btn-primary btn-sm" id="wr-new-btn">＋ 新建周报</button>
        </div>
      </div>
      <div id="wr-list-loading">${App.renderLoading()}</div>
      <div id="wr-list"></div>
      <div id="wr-detail"></div>
    `;

    const newBtn = document.getElementById('wr-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => this.showCreateForm());
    const copyBtn = document.getElementById('wr-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => this.showCopyForm());

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

    // 默认仅显示最近 2 条, 展开后显示全部
    const expanded = !!this._listExpanded;
    const visible = expanded ? sorted : sorted.slice(0, 2);
    const hiddenCount = sorted.length - visible.length;

    // 状态切换徽章 (待汇报 / 已汇报)
    const renderStatusToggle = (r) => {
      const isSubmitted = (r.status || 'draft') === 'submitted';
      const label = isSubmitted ? '已汇报' : '待汇报';
      const cls = isSubmitted ? 'badge--success' : 'badge--gray';
      return `<span class="badge ${cls} wr-status-toggle" data-action="toggle-status" data-id="${r.id}" title="点击切换状态" style="cursor:pointer;">${label}</span>`;
    };

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
              ${visible.map(r => `
                <tr data-action="open" data-id="${r.id}">
                  <td><span class="tag tag--gold">${App.escapeHtml(r.week_start || '')}</span></td>
                  <td>${App.escapeHtml(r.week_start && r.week_end ? `${App.formatDate(r.week_start)} - ${App.formatDate(r.week_end)}` : r.week_start || '—')}</td>
                  <td>${(r.progress_items || []).length}</td>
                  <td>${(r.plan_tasks || []).length}</td>
                  <td>${(r.risks || []).length}</td>
                  <td>${renderStatusToggle(r)}</td>
                </tr>
              `).join('')}
              ${hiddenCount > 0 ? `
                <tr data-action="expand-list"><td colspan="6" class="wr-list-more">⋯ 显示其余 ${hiddenCount} 份周报 (共 ${sorted.length} 份)</td></tr>
              ` : (expanded && sorted.length > 2 ? `
                <tr data-action="collapse-list"><td colspan="6" class="wr-list-more">收起</td></tr>
              ` : '')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // 行点击 -> 加载详情 (避开状态切换)
    container.querySelectorAll('tr[data-action="open"]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="toggle-status"]')) return;
        this.loadReport(tr.getAttribute('data-id'));
      });
    });

    // 状态切换
    container.querySelectorAll('[data-action="toggle-status"]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        const r = this.list.find(x => String(x.id) === String(id));
        if (!r) return;
        const newStatus = (r.status || 'draft') === 'submitted' ? 'draft' : 'submitted';
        try {
          await API.updateWeeklyReport(id, { status: newStatus });
          r.status = newStatus;
          this.renderList();
          App.showToast(newStatus === 'submitted' ? '已标记为"已汇报"' : '已标记为"待汇报"', 'success', 1500);
        } catch (err) {
          App.showToast(`状态更新失败: ${err.message}`, 'error');
        }
      });
    });

    // 展开 / 收起
    const expandRow = container.querySelector('[data-action="expand-list"]');
    if (expandRow) expandRow.addEventListener('click', () => { this._listExpanded = true; this.renderList(); });
    const collapseRow = container.querySelector('[data-action="collapse-list"]');
    if (collapseRow) collapseRow.addEventListener('click', () => { this._listExpanded = false; this.renderList(); });
  },

  /* ------------------------------------------------------------------
   * 加载某份周报详情
   * ---------------------------------------------------------------- */
  async loadReport(id) {
    const detail = document.getElementById('wr-detail');
    if (!detail) return;

    // 刷新同一份周报时(编辑后重载)保持滚动位置, 不跳到顶部
    const isRefresh = this.current && String(this.current.id) === String(id);
    const scrollContainer = document.querySelector('.app-frame__main');
    const savedScrollTop = isRefresh && scrollContainer ? scrollContainer.scrollTop : null;

    if (!isRefresh) {
      // 首次加载: 滚动到详情区域
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      detail.innerHTML = App.renderLoading('加载周报详情...');
    }

    try {
      const report = await API.getWeeklyReport(id);
      this.current = report;
      this.renderReport(report);
      // 刷新后恢复滚动位置
      if (savedScrollTop !== null && scrollContainer) {
        scrollContainer.scrollTop = savedScrollTop;
      }
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
            <button class="btn btn-ghost btn-sm" data-action="edit-kpi" data-id="${report.id}">编辑模块</button>
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

  /** 导出当前周报详情为 PDF (使用浏览器原生打印, A4 多页, 格式正确, 内容不被裁切) */
  exportToPdf(report) {
    const html = this.buildPrintHtml(report);

    // 打开新窗口, 写入自包含 HTML, 触发浏览器原生打印 (另存为 PDF)
    // 原生打印可保证: A4 分页正确、文字矢量清晰、背景色保留、卡片不被裁切
    const printWin = window.open('', '_blank', 'width=900,height=1200');
    if (!printWin) {
      App.showToast('弹窗被浏览器拦截, 请允许本站弹窗后重试', 'error');
      return;
    }
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();

    // 等待新窗口渲染完成后触发打印
    const triggerPrint = () => {
      try {
        printWin.focus();
        printWin.print();
      } catch (e) {
        console.error('[打印失败]', e);
        App.showToast(`打印失败: ${e.message}`, 'error');
      }
    };
    // 兼容多种加载状态
    if (printWin.document.readyState === 'complete') {
      setTimeout(triggerPrint, 200);
    } else {
      printWin.onload = () => setTimeout(triggerPrint, 200);
    }
    App.showToast('已在新窗口打开打印预览, 选择"另存为PDF"即可导出', 'info', 5000);
  },

  /** 构建打印专用 HTML (自包含, A4 多页, 完整内容, 与页面渲染格式一致) */
  buildPrintHtml(report) {
    const formatRange = (r) => {
      if (r.week_start && r.week_end) return `${App.formatDate(r.week_start)} - ${App.formatDate(r.week_end)}`;
      return r.week_start || '—';
    };
    const title = report.title || `${report.week_start || ''} 周报`;
    const kpis = report.kpis || [];
    const progressItems = report.progress_items || [];
    const planTasks = report.plan_tasks || [];
    const risks = report.risks || [];

    // 使用 API 返回的内嵌 module 数据 (不依赖 App.state.modules 全局状态, 确保内容完整)
    const modInfo = (m) => {
      if (!m) return { idx: '', tag: '其他', title: '其他事项', owner: '—', color: '#FF8C00', color_bg: '#FFF3E0' };
      return {
        idx: m.idx || '',
        tag: m.tag || '',
        title: m.title || '未指定',
        owner: m.owner || '—',
        color: m.color || '#FF8C00',
        color_bg: m.color_bg || '#FFF3E0'
      };
    };

    // KPI 卡片 (3 列网格, 与页面一致: 模块色背景 + 进度条 + 状态徽章 + 百分比)
    const kpiCards = kpis.map(k => {
      const m = modInfo(k.module);
      const pct = Math.max(0, Math.min(100, k.progress_pct ?? 0));
      const status = k.status || '正常';
      const stCls = status === '风险' ? 'wr-sr' : status === '关注' ? 'wr-sy' : 'wr-sg';
      return `<div class="wr-kpi" style="background:${m.color_bg};color:${m.color};">
        <div class="n">${App.escapeHtml(m.idx + ' · ' + m.tag)}</div>
        <div class="t">${App.escapeHtml(m.title)}</div>
        <div class="pb"><div class="pf" style="width:${pct}%;background:${m.color};"></div></div>
        <div class="pv">
          <span class="st-static ${stCls}">${App.escapeHtml(status)}</span>
          <span class="pct-val" style="color:${m.color};">${pct}%</span>
        </div>
      </div>`;
    }).join('');

    // 进展事项 (按模块分组, 网格 230px/1fr/90px, 与页面一致)
    const progressGrouped = {};
    progressItems.forEach(item => {
      const mid = item.module_id || 'other';
      if (!progressGrouped[mid]) progressGrouped[mid] = { module: item.module, items: [] };
      progressGrouped[mid].items.push(item);
    });
    const progressRows = Object.entries(progressGrouped).map(([mid, group]) => {
      const m = modInfo(group.module);
      const kpi = kpis.find(k => String(k.module_id) === String(mid));
      const pct = Math.max(0, Math.min(100, kpi?.progress_pct ?? 0));
      const kpiStatus = kpi?.status || '正常';
      const stCls = kpiStatus === '风险' ? 'wr-sr' : kpiStatus === '关注' ? 'wr-sy' : 'wr-sg';
      const items = group.items.map(it =>
        `<li><b>${App.escapeHtml(it.content || '')}</b>${it.detail ? `<i>${App.escapeHtml(it.detail)}</i>` : ''}</li>`
      ).join('');
      return `<div class="wr-row" style="border-left:3px solid ${m.color};">
        <div class="wr-ri">
          <div class="idx" style="color:${m.color};">${App.escapeHtml(m.idx + ' · ' + m.tag)}</div>
          <div class="ti">${App.escapeHtml(m.title)}</div>
          <div class="ow">负责人：${App.escapeHtml(m.owner)}</div>
          <div class="bar"><div class="bf" style="width:${pct}%;background:${m.color};"></div></div>
        </div>
        <div class="wr-rb"><ul>${items}</ul></div>
        <div class="wr-rc">
          <span class="st-static ${stCls}">${App.escapeHtml(kpiStatus)}</span>
          <div class="pp"><span>${pct}</span><small>%</small></div>
        </div>
      </div>`;
    }).join('');

    // 下周计划 (按模块分组, 2 列卡片, 与页面一致)
    const planGrouped = {};
    planTasks.forEach(t => {
      const mid = t.module_id || 'other';
      if (!planGrouped[mid]) planGrouped[mid] = { module: t.module, items: [] };
      planGrouped[mid].items.push(t);
    });
    const planCards = Object.entries(planGrouped).map(([mid, group]) => {
      const m = modInfo(group.module);
      const items = group.items.map(t => {
        const linked = t.progress_task?.name ? ` <i>🔗 ${App.escapeHtml(t.progress_task.name)}</i>` : '';
        const owner = t.owner ? ` <i>👤 ${App.escapeHtml(t.owner)}</i>` : '';
        const key = t.is_key ? '<span class="wr-key">★重点</span> ' : '';
        return `<li>${key}<b>${App.escapeHtml(t.name || '')}</b>${linked}${owner}</li>`;
      }).join('');
      return `<div class="wr-nc" style="background:${m.color_bg};border-color:${m.color}20;">
        <h4 style="color:${m.color};">${App.escapeHtml(m.idx + ' ' + m.title)}</h4>
        <ul>${items}</ul>
      </div>`;
    }).join('');

    // 风险表 (4 列: 序号/标题/需要协调的内容/紧急程度, 无操作列)
    const riskRows = risks.map((r, i) => {
      const urgency = r.urgency || '中';
      const uCls = urgency === '高' ? 'u-high' : urgency === '低' ? 'u-low' : 'u-mid';
      const rkCls = urgency === '高' ? '' : urgency === '低' ? 'rk-green' : 'rk-amber';
      const seq = r.seq || ('R' + (i + 1));
      return `<div class="wr-rk ${rkCls}">
        <span class="lv">${App.escapeHtml(seq)}</span>
        <span class="wr-rk-title">${App.escapeHtml(r.title || '')}</span>
        <span class="wr-rk-content">${App.escapeHtml(r.coordination || r.content || '—')}</span>
        <span class="wr-urgency-static ${uCls}">${App.escapeHtml(urgency)}</span>
      </div>`;
    }).join('');

    // 返回完整 HTML 文档 (用于新窗口打印), 含 @page A4 规则与 print-color-adjust
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${App.escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #0F172A; font-size: 14px; line-height: 1.5; }
.wr-print-root { color: #0F172A; background: #fff; }
.wr-print-root .wr-week-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; overflow: hidden; }
.wr-print-root .wr-week-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 24px; background: #FFF8ED; border-bottom: 1px solid #FFD9A8; }
.wr-print-root .wr-week-bar-l { display: flex; align-items: center; gap: 10px; }
.wr-print-root .tag-no { font-size: 11px; color: #fff; background: #FF8C00; padding: 3px 10px; border-radius: 4px; font-weight: 600; letter-spacing: 0.5px; }
.wr-print-root .wr-week-title-static { font-size: 14px; font-weight: 600; color: #0F172A; padding: 4px 8px; }
.wr-print-root .wr-week-body { padding: 24px 36px 28px; }
.wr-print-root .wr-hd { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 14px; border-bottom: 1px solid #E2E8F0; }
.wr-print-root .wr-hd-l h2 { font-size: 18px; font-weight: 600; margin: 0 0 4px; color: #0F172A; }
.wr-print-root .wr-hd-l p { font-size: 12px; color: #475569; margin: 0; }
.wr-print-root .wr-hd-r { text-align: right; }
.wr-print-root .rk-label { font-size: 11px; color: #94A3B8; font-weight: 500; }
.wr-print-root .rk-value-static { font-size: 13px; font-weight: 600; margin-top: 3px; color: #FF8C00; }
.wr-print-root .wr-sec { margin-top: 24px; }
.wr-print-root .wr-sec-h { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.wr-print-root .wr-sec-h h3 { font-size: 15px; font-weight: 600; margin: 0; color: #0F172A; display: flex; align-items: center; gap: 8px; }
.wr-print-root .wr-sec-h h3::before { content: ''; width: 4px; height: 16px; background: #FF8C00; border-radius: 2px; display: inline-block; }
.wr-print-root .wr-sec-h .line { flex: 1; height: 1px; background: #E2E8F0; }
.wr-print-root .wr-sec-h .count { font-size: 11px; color: #94A3B8; }
.wr-print-root .wr-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.wr-print-root .wr-kpi { border-radius: 10px; padding: 12px 11px; border: 1px solid transparent; page-break-inside: avoid; }
.wr-print-root .wr-kpi .n { font-size: 11px; font-weight: 600; letter-spacing: 0.3px; }
.wr-print-root .wr-kpi .t { font-size: 13px; font-weight: 600; margin: 5px 0 8px; line-height: 1.3; min-height: 34px; color: #0F172A; }
.wr-print-root .wr-kpi .pb { height: 4px; background: rgba(0,0,0,0.08); border-radius: 2px; overflow: hidden; }
.wr-print-root .wr-kpi .pf { height: 100%; border-radius: 2px; }
.wr-print-root .wr-kpi .pv { margin-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.wr-print-root .wr-kpi .pct-val { font-size: 12px; font-weight: 700; }
.wr-print-root .st-static { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.wr-print-root .wr-sg { background: #ECFDF5; color: #10B981; }
.wr-print-root .wr-sy { background: #FFFBEB; color: #F59E0B; }
.wr-print-root .wr-sr { background: #FEF2F2; color: #EF4444; }
.wr-print-root .wr-panel { background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 4px 0; }
.wr-print-root .wr-row { display: grid; grid-template-columns: 230px 1fr 90px; align-items: start; padding: 14px 18px; border-bottom: 1px solid #EEF2F6; gap: 14px; page-break-inside: avoid; }
.wr-print-root .wr-row:last-child { border-bottom: none; }
.wr-print-root .wr-ri .idx { font-size: 11px; font-weight: 600; letter-spacing: 0.3px; }
.wr-print-root .wr-ri .ti { font-size: 13px; font-weight: 600; margin: 3px 0 6px; color: #0F172A; }
.wr-print-root .wr-ri .ow { font-size: 11px; color: #475569; }
.wr-print-root .wr-ri .bar { height: 4px; background: rgba(0,0,0,0.06); border-radius: 2px; margin-top: 6px; overflow: hidden; }
.wr-print-root .wr-ri .bf { height: 100%; border-radius: 2px; }
.wr-print-root .wr-rb ul { margin: 0; padding-left: 16px; font-size: 13px; line-height: 1.7; }
.wr-print-root .wr-rb li { margin-bottom: 2px; color: #0F172A; list-style: disc; }
.wr-print-root .wr-rb li b { font-weight: 600; }
.wr-print-root .wr-rb li i { font-style: normal; color: #94A3B8; font-size: 12px; margin-left: 6px; }
.wr-print-root .wr-rc { text-align: right; }
.wr-print-root .wr-rc .st-static { padding: 3px 8px; }
.wr-print-root .wr-rc .pp { font-size: 18px; font-weight: 600; margin-top: 6px; letter-spacing: -0.3px; color: #0F172A; }
.wr-print-root .wr-rc .pp small { font-size: 11px; color: #94A3B8; font-weight: 400; }
.wr-print-root .wr-nw { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.wr-print-root .wr-nc { border-radius: 8px; padding: 12px 14px; border: 1px solid transparent; page-break-inside: avoid; }
.wr-print-root .wr-nc h4 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
.wr-print-root .wr-nc ul { margin: 0; padding-left: 14px; font-size: 12px; line-height: 1.65; color: #475569; }
.wr-print-root .wr-nc li { list-style: disc; margin-bottom: 4px; }
.wr-print-root .wr-nc li b { font-weight: 600; color: #0F172A; }
.wr-print-root .wr-nc li i { font-style: normal; color: #94A3B8; font-size: 11px; margin-left: 4px; }
.wr-print-root .wr-key { font-size: 10px; background: #FFFBEB; color: #D97706; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.wr-print-root .wr-risk-table { display: flex; flex-direction: column; gap: 6px; }
.wr-print-root .wr-risk-head { display: grid; grid-template-columns: 48px 1fr 2fr 88px; gap: 10px; padding: 6px 10px; font-size: 11px; font-weight: 600; color: #475569; background: #F1F4F7; border-radius: 6px; }
.wr-print-root .wr-rk { display: grid; grid-template-columns: 48px 1fr 2fr 88px; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid #E2E8F0; border-left: 3px solid #EF4444; background: #FEF2F2; border-radius: 0 6px 6px 0; page-break-inside: avoid; }
.wr-print-root .wr-rk.rk-amber { border-left-color: #F59E0B; background: #FFFBEB; }
.wr-print-root .wr-rk.rk-amber .lv { background: #F59E0B; }
.wr-print-root .wr-rk.rk-green { border-left-color: #10B981; background: #ECFDF5; }
.wr-print-root .wr-rk.rk-green .lv { background: #10B981; }
.wr-print-root .wr-rk .lv { font-size: 10px; background: #EF4444; color: #fff; padding: 2px 8px; border-radius: 3px; font-weight: 600; letter-spacing: 0.3px; text-align: center; }
.wr-print-root .wr-rk-title { font-weight: 600; color: #0F172A; font-size: 13px; }
.wr-print-root .wr-rk-content { font-size: 12px; color: #475569; line-height: 1.5; }
.wr-print-root .wr-urgency-static { font-size: 11px; padding: 3px 10px; border-radius: 10px; font-weight: 600; text-align: center; }
.wr-print-root .wr-urgency-static.u-high { background: #FEF2F2; color: #EF4444; }
.wr-print-root .wr-urgency-static.u-mid { background: #FFFBEB; color: #F59E0B; }
.wr-print-root .wr-urgency-static.u-low { background: #ECFDF5; color: #10B981; }
.wr-print-root .wr-foot2 { margin-top: 14px; padding-top: 10px; border-top: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 11px; color: #94A3B8; }
/* 打印分页: 章节标题与其内容保持在一起, 卡片/行不被裁切 */
.wr-print-root .wr-sec { page-break-inside: auto; }
.wr-print-root .wr-sec-h { page-break-after: avoid; }
.wr-print-root .wr-hd { page-break-after: avoid; }
@media print {
  .wr-print-root .wr-week-card { border: none; }
}
</style>
</head>
<body>
<div class="wr-print-root">
  <div class="wr-week-card">
    <div class="wr-week-bar">
      <div class="wr-week-bar-l">
        <span class="tag-no">周报</span>
        <span class="wr-week-title-static">${App.escapeHtml(title)}</span>
      </div>
    </div>
    <div class="wr-week-body">
      <div class="wr-hd">
        <div class="wr-hd-l">
          <h2>信投 AI 2.0 项目建设 · 项目周报</h2>
          <p>上海信投 · AI 能力建设专项 · 周报</p>
        </div>
        <div class="wr-hd-r">
          <div class="rk-label">填报周期</div>
          <div class="rk-value-static">${App.escapeHtml(formatRange(report))}</div>
        </div>
      </div>
      <div class="wr-sec">
        <div class="wr-sec-h"><h3>本周概览</h3><span class="line"></span><span class="count">${kpis.length} 个模块</span></div>
        <div class="wr-kpis">${kpiCards || '<div style="grid-column:1/-1;color:#94A3B8;text-align:center;padding:20px;">暂无 KPI</div>'}</div>
      </div>
      <div class="wr-sec">
        <div class="wr-sec-h"><h3>本周进展</h3><span class="line"></span><span class="count">${progressItems.length} 项</span></div>
        <div class="wr-panel">${progressRows || '<div style="color:#94A3B8;text-align:center;padding:20px;">暂无进展记录</div>'}</div>
      </div>
      <div class="wr-sec">
        <div class="wr-sec-h"><h3>下周计划</h3><span class="line"></span><span class="count">${planTasks.length} 项</span></div>
        <div class="wr-nw">${planCards || '<div style="grid-column:1/-1;color:#94A3B8;text-align:center;padding:20px;">暂无下周计划</div>'}</div>
      </div>
      <div class="wr-sec">
        <div class="wr-sec-h"><h3>风险与应对</h3><span class="line"></span><span class="count">${risks.length} 项</span></div>
        <div class="wr-risk-table">
          <div class="wr-risk-head"><span>序号</span><span>标题</span><span>需要协调的内容</span><span>紧急程度</span></div>
          ${riskRows || '<div style="color:#94A3B8;text-align:center;padding:20px;">暂无风险记录</div>'}
        </div>
      </div>
      <div class="wr-foot2">
        <span>填报人：__________ · 归档日期：${App.escapeHtml(report.week_start || '—')}</span>
        <span>信投 AI 能力办 · PMO 归档</span>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
  },

  /** 渲染 KPI 网格: 模块卡片 (背景色+进度条+状态+百分比), 支持点击直接编辑 */
  renderKpis(kpis) {
    if (!kpis || kpis.length === 0) {
      return App.renderEmpty('暂无 KPI', '点击右上角"编辑模块"录入指标', '📊');
    }
    // 按 App.state.modules 的 sort_order 排序 KPI
    const moduleOrder = {};
    App.state.modules.forEach((m, i) => { moduleOrder[m.id] = m.sort_order ?? i; });
    kpis = [...kpis].sort((a, b) => {
      const oa = moduleOrder[a.module_id] ?? 999;
      const ob = moduleOrder[b.module_id] ?? 999;
      return oa - ob;
    });
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
                <span class="${stCls} wr-kpi-status" data-kpi-id="${k.id}" data-module-id="${k.module_id}" style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;" title="点击切换状态">${App.escapeHtml(k.status || '正常')}</span>
                <span class="pct-val wr-kpi-pct" data-kpi-id="${k.id}" data-module-id="${k.module_id}" style="color:${color};cursor:pointer;" title="点击编辑进度">${pct}%</span>
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
      return App.renderEmpty('暂无进展记录', '点击右上角"新增进展"或编辑模块后自动同步', '📝');
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
      <div class="wr-risk-table" id="wr-risk-list">
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
            <div class="wr-rk ${rkCls} wr-rk-draggable" draggable="true" data-risk-id="${r.id}" data-risk-idx="${i}">
              <span class="wr-drag-handle" title="拖拽排序">⠿</span>
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
            this.editModules(report);
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

    // KPI 状态点击切换 (正常→关注→风险→正常)
    detail.querySelectorAll('.wr-kpi-status').forEach(el => {
      el.addEventListener('click', async () => {
        const kpiId = el.getAttribute('data-kpi-id');
        const moduleId = el.getAttribute('data-module-id');
        const kpi = (report.kpis || []).find(k => String(k.id) === String(kpiId));
        if (!kpi) return;
        const cycle = ['正常', '关注', '风险'];
        const cur = kpi.status || '正常';
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
        try {
          await API.saveKpis(report.id, [{
            module_id: parseInt(moduleId, 10),
            progress_pct: kpi.progress_pct ?? 0,
            status: next
          }]);
          kpi.status = next;
          this.renderReport(report);
          this.preserveScroll();
        } catch (err) {
          App.showToast(`状态更新失败: ${err.message}`, 'error');
        }
      });
    });

    // KPI 进度百分比点击 → 卡片内联编辑 (不使用 prompt)
    detail.querySelectorAll('.wr-kpi-pct').forEach(el => {
      el.addEventListener('click', () => {
        // 避免重复进入编辑
        if (el.querySelector('input')) return;
        const kpiId = el.getAttribute('data-kpi-id');
        const moduleId = el.getAttribute('data-module-id');
        const kpi = (report.kpis || []).find(k => String(k.id) === String(kpiId));
        if (!kpi) return;
        const oldPct = Math.max(0, Math.min(100, kpi.progress_pct ?? 0));
        const cardColor = el.style.color || '#FF8C00';

        // 替换为内联输入框
        const input = document.createElement('input');
        input.type = 'number';
        input.min = 0;
        input.max = 100;
        input.value = oldPct;
        input.className = 'wr-kpi-pct-input';
        input.style.cssText = `width:48px;font-size:inherit;font-weight:inherit;color:${cardColor};background:#fff;border:1px solid ${cardColor};border-radius:6px;padding:1px 4px;text-align:center;outline:none;`;

        const suffix = document.createElement('span');
        suffix.textContent = '%';

        const oldHtml = el.innerHTML;
        el.innerHTML = '';
        el.appendChild(input);
        el.appendChild(suffix);
        el.style.cursor = 'text';
        input.focus();
        input.select();

        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          if (!commit) {
            // 取消: 还原显示
            el.innerHTML = oldHtml;
            el.style.cursor = 'pointer';
            return;
          }
          const pct = Math.max(0, Math.min(100, parseInt(input.value, 10) || 0));
          // 乐观更新 UI
          el.innerHTML = `${pct}%`;
          el.style.cursor = 'pointer';
          if (pct === oldPct) return;
          try {
            await API.saveKpis(report.id, [{
              module_id: parseInt(moduleId, 10),
              progress_pct: pct,
              status: kpi.status || '正常'
            }]);
            kpi.progress_pct = pct;
            // 仅刷新当前 KPI 卡片的进度条, 避免整页重渲染打断
            const card = el.closest('.wr-kpi');
            if (card) {
              const pf = card.querySelector('.pf');
              if (pf) pf.style.width = `${pct}%`;
            }
            this.preserveScroll();
          } catch (err) {
            // 失败回滚
            el.innerHTML = `${oldPct}%`;
            App.showToast(`进度更新失败: ${err.message}`, 'error');
          }
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
      });
    });

    // 风险拖拽排序
    this.bindRiskDragSort(report);
  },

  /** 保持滚动位置 (编辑后不跳顶) */
  preserveScroll() {
    // loadReport 会检测同一份周报并保持滚动, 这里仅触发刷新
    if (this.current) this.loadReport(this.current.id);
  },

  /** 绑定风险拖拽排序 */
  bindRiskDragSort(report) {
    const list = document.getElementById('wr-risk-list');
    if (!list) return;
    let dragSrc = null;

    list.querySelectorAll('.wr-rk-draggable').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        dragSrc = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.riskId);
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        list.querySelectorAll('.wr-rk-draggable').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSrc && dragSrc !== row) {
          row.classList.add('drag-over');
        }
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (!dragSrc || dragSrc === row) return;
        // 交换 DOM 位置
        const rows = [...list.querySelectorAll('.wr-rk-draggable')];
        const srcIdx = rows.indexOf(dragSrc);
        const tgtIdx = rows.indexOf(row);
        if (srcIdx < tgtIdx) {
          row.parentNode.insertBefore(dragSrc, row.nextSibling);
        } else {
          row.parentNode.insertBefore(dragSrc, row);
        }
        // 收集新顺序, 批量更新 sort_order
        const newRows = [...list.querySelectorAll('.wr-rk-draggable')];
        const promises = newRows.map((r, i) => {
          const riskId = r.dataset.riskId;
          return API.updateRisk(report.id, riskId, { sort_order: i });
        });
        try {
          await Promise.all(promises);
          // 更新本地数据顺序
          const riskMap = {};
          (report.risks || []).forEach(r => { riskMap[r.id] = r; });
          report.risks = newRows.map((r, i) => {
            const risk = riskMap[parseInt(r.dataset.riskId, 10)];
            if (risk) risk.sort_order = i;
            return risk;
          }).filter(Boolean);
          App.showToast('排序已保存', 'success', 1500);
        } catch (err) {
          App.showToast(`排序保存失败: ${err.message}`, 'error');
        }
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

  /** 复制上周周报 (复制最近一份周报到新周次, 含 KPI/进展/下周任务/风险 全部子表) */
  showCopyForm() {
    // 默认周次为当前周
    const currentWeek = App.state.currentWeek || '';

    // 找出最近一份周报作为参考显示
    const sorted = [...this.list].sort((a, b) =>
      (b.week_start || '').localeCompare(a.week_start || '')
    );
    const latest = sorted[0];
    const latestLabel = latest
      ? `${App.formatDate(latest.week_start)} - ${App.formatDate(latest.week_end)}`
      : '无';

    const modal = App.openModal({
      title: '复制上周周报',
      bodyHtml: `
        <div class="form-group">
          <label>新周报周次</label>
          <input type="week" id="copy-week" value="${currentWeek}">
          <small style="color: var(--color-text-secondary);">将作为新周报的周次范围</small>
        </div>
        <div class="form-group">
          <label>标题 (可选, 留空则按周次自动生成)</label>
          <input type="text" id="copy-title" placeholder="留空则自动生成: YYYY-MM-DD 周报">
        </div>
        <div class="form-group">
          <label>本周总结 (可选, 留空则不填)</label>
          <textarea id="copy-summary" placeholder="新周报的本周总结, 留空则不填, 后续可在编辑中补充..."></textarea>
        </div>
        <div class="form-group">
          <small style="color: var(--color-text-secondary);">
            📌 将复制最近一份周报 (当前最近: <strong>${latestLabel}</strong>) 的<b>子表内容</b>:<br>
            · 本周概览 KPI · 本周进展 · 下周任务 · 风险与应对<br>
            · 下周任务的状态将重置为"待开始"<br>
            · <b>主表信息 (标题/周次范围/本周总结) 将新生成, 不沿用源周报</b>
          </small>
        </div>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="copy-save-btn">复制创建</button>
      `
    });

    modal.querySelector('#copy-save-btn').addEventListener('click', async () => {
      const weekStart = modal.querySelector('#copy-week').value;
      const title = modal.querySelector('#copy-title').value.trim();
      const summary = modal.querySelector('#copy-summary').value.trim();

      if (!weekStart) {
        App.showToast('请选择周次', 'warning');
        return;
      }

      const monday = App.weekToDate(weekStart, 1);
      const sunday = App.weekToDate(weekStart, 7);

      try {
        const payload = {
          week_start: monday,
          week_end: sunday,
        };
        if (title) payload.title = title;
        if (summary) payload.overview_summary = summary;

        const created = await API.copyLastWeekReport(payload);
        App.showToast('已复制上周周报并创建新周报', 'success');
        App.closeModal(modal);
        this.loadList();
        // 自动加载新创建的周报详情
        if (created && created.id) {
          setTimeout(() => this.loadReport(created.id), 300);
        }
      } catch (err) {
        App.showToast(`复制失败: ${err.message}`, 'error');
      }
    });
  },

  /** 编辑模块 (仅模块字段: 编号/标签/名称/负责人/排序/颜色) */
  editModules(report) {
    const modules = App.state.modules.slice();

    const renderModuleRow = (mod) => {
      const id = mod?.id || '';
      return `
        <div class="form-row" data-mod-row data-mod-id="${id}" style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;border-bottom:1px solid #EEF2F6;padding-bottom:8px;margin-bottom:8px;">
          <div class="form-group" style="flex:0 0 50px;">
            <label>编号</label>
            <input type="text" data-mod-idx value="${App.escapeHtml(mod?.idx || '')}" placeholder="01" style="width:50px;">
          </div>
          <div class="form-group" style="flex:0 0 60px;">
            <label>排序</label>
            <input type="number" data-mod-sort value="${mod?.sort_order ?? 0}" style="width:60px;">
          </div>
          <div class="form-group" style="flex:0 0 80px;">
            <label>标签</label>
            <input type="text" data-mod-tag value="${App.escapeHtml(mod?.tag || '')}" placeholder="底座" style="width:80px;">
          </div>
          <div class="form-group" style="flex:3;">
            <label>模块名称</label>
            <input type="text" data-mod-title value="${App.escapeHtml(mod?.title || '')}" placeholder="模块标题">
          </div>
          <div class="form-group" style="flex:2;">
            <label>负责人</label>
            <input type="text" data-mod-owner value="${App.escapeHtml(mod?.owner || '')}" placeholder="负责人">
          </div>
          <div class="form-group" style="flex:0 0 auto;">
            <label>颜色</label>
            <input type="color" data-mod-color value="${mod?.color || '#FF8C00'}" style="width:32px;height:32px;padding:0;border:none;">
          </div>
          <div class="form-group" style="flex:0 0 auto;">
            <label>背景</label>
            <input type="color" data-mod-color-bg value="${mod?.color_bg || '#FFF3E0'}" style="width:32px;height:32px;padding:0;border:none;">
          </div>
          ${id ? `<div class="form-group" style="flex:0 0 auto;align-self:flex-end;">
            <button type="button" class="btn btn-ghost btn-sm" data-mod-del data-mod-id="${id}">删除</button>
          </div>` : ''}
        </div>
      `;
    };

    const modal = App.openModal({
      title: '编辑模块',
      size: 'lg',
      bodyHtml: `
        <div id="mod-editor">
          ${modules.length === 0 ? renderModuleRow(null) : modules.map(m => renderModuleRow(m)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="mod-add-row" style="margin-top:8px;">＋ 添加模块</button>
      `,
      footerHtml: `
        <button class="btn btn-ghost" data-modal-close>取消</button>
        <button class="btn btn-primary" id="mod-save-btn">保存</button>
      `
    });

    modal.querySelector('#mod-add-row').addEventListener('click', () => {
      const editor = modal.querySelector('#mod-editor');
      const wrap = document.createElement('div');
      wrap.innerHTML = renderModuleRow(null);
      editor.appendChild(wrap.firstElementChild);
    });

    // 模块删除
    modal.addEventListener('click', async (e) => {
      const delBtn = e.target.closest('[data-mod-del]');
      if (!delBtn) return;
      const modId = delBtn.getAttribute('data-mod-id');
      if (!modId) return;
      if (!confirm('确认删除该模块? 关联的 KPI/进展/计划将失去模块关联')) return;
      try {
        await API.deleteModule(modId);
        App.showToast('模块已删除', 'success');
        const row = delBtn.closest('[data-mod-row]');
        if (row) row.remove();
      } catch (err) {
        App.showToast(`删除失败: ${err.message}`, 'error');
      }
    });

    modal.querySelector('#mod-save-btn').addEventListener('click', async () => {
      const rows = modal.querySelectorAll('[data-mod-row]');
      const modulePromises = [];
      rows.forEach(row => {
        const modId = row.getAttribute('data-mod-id');
        const idx = row.querySelector('[data-mod-idx]')?.value?.trim();
        const tag = row.querySelector('[data-mod-tag]')?.value?.trim();
        const title = row.querySelector('[data-mod-title]')?.value?.trim();
        const owner = row.querySelector('[data-mod-owner]')?.value?.trim() || '';
        const sortOrder = parseInt(row.querySelector('[data-mod-sort]')?.value || '0', 10) || 0;
        const color = row.querySelector('[data-mod-color]')?.value || '#FF8C00';
        const colorBg = row.querySelector('[data-mod-color-bg]')?.value || '#FFF3E0';
        if (!title) return;
        const data = { idx, tag, title, owner, sort_order: sortOrder, color, color_bg: colorBg };
        if (modId) {
          modulePromises.push(API.updateModule(modId, data));
        } else {
          modulePromises.push(API.createModule(data));
        }
      });

      try {
        await Promise.all(modulePromises);
        // 重新加载模块列表
        await App.loadModules();
        App.showToast('模块已保存', 'success');
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
