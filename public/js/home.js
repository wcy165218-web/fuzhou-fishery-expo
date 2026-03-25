// ================= js/home.js =================
window.homeCountdownTimer = null;
window.homeTabDefinitions = [
    { id: 'sales-summary', label: '目标与收款概览', adminOnly: false },
    { id: 'sales-list', label: '业务员销售情况', adminOnly: false },
    { id: 'hall', label: '馆别经营看板', adminOnly: true },
    { id: 'region-table', label: '地区分布表格', adminOnly: false }
];
window.homePeriodTabDefinitions = [
    { id: 'today', label: '今日' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'total', label: '总计' }
];
window.homeHallTabDefinitions = [
    { id: 'booth', label: '馆间展位概况' },
    { id: 'finance', label: '馆间财务概况' }
];

window.getCurrentProject = function() {
    const pid = document.getElementById('global-project-select')?.value;
    return (allProjects || []).find((project) => String(project.id) === String(pid)) || null;
}

window.formatHomeDate = function(date) {
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    }).format(date);
}

window.formatCountdownParts = function(diffMs) {
    const totalMinutes = Math.max(Math.floor(diffMs / 60000), 0);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    return `${days}天 ${hours}小时 ${minutes}分钟`;
}

window.updateHomeProjectHero = function() {
    const project = window.getCurrentProject();
    const dateEl = document.getElementById('home-today-date');
    const projectEl = document.getElementById('home-project-name');
    const countdownValueEl = document.getElementById('home-countdown-value');
    const countdownDescEl = document.getElementById('home-countdown-desc');
    if (!dateEl || !countdownValueEl || !countdownDescEl) return;

    const now = new Date();
    dateEl.innerText = window.formatHomeDate(now);
    if (projectEl) projectEl.innerText = project ? project.name : '未选择项目';

    if (!project || !project.start_date) {
        countdownValueEl.innerText = '--';
        countdownDescEl.innerText = '当前项目未设置开展日期';
        return;
    }

    const startDate = new Date(`${project.start_date}T00:00:00+08:00`);
    const endDate = project.end_date ? new Date(`${project.end_date}T23:59:59+08:00`) : startDate;

    if (now < startDate) {
        countdownValueEl.innerText = window.formatCountdownParts(startDate - now);
        countdownDescEl.innerText = `开展：${project.start_date}`;
        return;
    }

    if (now <= endDate) {
        countdownValueEl.innerText = window.formatCountdownParts(endDate - now);
        countdownDescEl.innerText = `展期：${project.start_date} ~ ${project.end_date || project.start_date}`;
        return;
    }

    countdownValueEl.innerText = window.formatCountdownParts(now - endDate);
    countdownDescEl.innerText = `已结束：${project.end_date || project.start_date}`;
}

window.renderMiniProgress = function(percent, colorClass = 'bg-blue-500') {
    const safePercent = Math.max(0, Math.min(Number(percent || 0), 100));
    return `
        <div class="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div class="h-full rounded-full ${colorClass}" style="width: ${safePercent}%"></div>
        </div>
    `;
}

window.getAvailableHomeTabs = function(isAdmin) {
    return window.homeTabDefinitions.filter((tab) => isAdmin || !tab.adminOnly);
}

window.renderHomeTabs = function(isAdmin) {
    const container = document.getElementById('home-tabs');
    if (!container) return;

    const tabs = window.getAvailableHomeTabs(isAdmin);
    const currentActive = window.activeHomeTab;
    const nextActive = tabs.some((tab) => tab.id === currentActive) ? currentActive : (tabs[0]?.id || '');
    window.activeHomeTab = nextActive;

    container.innerHTML = tabs.map((tab) => `
        <button
            onclick="window.switchHomeTab('${tab.id}')"
            class="px-4 py-2 rounded-full text-sm font-bold transition border ${tab.id === nextActive
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}"
        >${tab.label}</button>
    `).join('');

    window.switchHomeTab(nextActive, false);
}

window.switchHomeTab = function(tabId, rerenderTabs = true) {
    window.activeHomeTab = tabId;
    document.querySelectorAll('.home-tab-panel').forEach((panel) => panel.classList.add('hidden'));
    document.getElementById(`home-tab-${tabId}`)?.classList.remove('hidden');

    if (rerenderTabs && window.homeDashboardData) {
        window.renderHomeTabs(window.homeDashboardData.is_admin);
    }
}

window.renderHomeInnerTabs = function(activeId, switchFnName) {
    return window.homePeriodTabDefinitions.map((tab) => `
        <button
            onclick="${switchFnName}('${tab.id}')"
            class="px-3 py-1.5 rounded-full text-xs font-bold transition border ${tab.id === activeId
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'}"
        >${tab.label}</button>
    `).join('');
}

window.renderHomeProgressSummary = function(progress) {
    const container = document.getElementById('home-progress-summary');
    if (!container) return;

    const fmtCount = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');
    const fmtMoney = (value) => `¥${Number(value || 0).toLocaleString()}`;
    const fmtPercent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;
    const targetRate = Number(progress.target_total || 0) > 0
        ? ((Number(progress.deposit_booth_count || 0) + Number(progress.full_paid_booth_count || 0)) / Number(progress.target_total || 0)) * 100
        : 0;
    const renderMetricRow = (label, value, toneClass = 'text-white') => `
        <div class="flex items-center justify-between gap-4 rounded-2xl bg-white/8 border border-white/10 px-4 py-3">
            <div class="text-sm font-bold text-slate-200 leading-6">${label}</div>
            <div class="text-xl md:text-2xl font-black ${toneClass} text-right shrink-0">${value}</div>
        </div>
    `;

    container.innerHTML = `
        <div class="bg-white/10 border border-white/10 rounded-3xl p-5 backdrop-blur-sm">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="text-xs tracking-[0.2em] text-slate-200/80 font-bold">展位目标推进</div>
                    <div class="text-3xl font-black text-white mt-2">${fmtCount(Number(progress.deposit_booth_count || 0) + Number(progress.full_paid_booth_count || 0))} / ${fmtCount(progress.target_total)} 个</div>
                    <div class="text-xs text-slate-300 mt-1">剩余目标数 ${fmtCount(progress.remaining_target)} 个</div>
                </div>
                <div class="text-right">
                    <div class="text-xs text-slate-300">推进比例</div>
                    <div class="text-2xl font-black text-cyan-200 mt-1">${fmtPercent(targetRate)}</div>
                </div>
            </div>
            ${window.renderMiniProgress(targetRate, 'bg-gradient-to-r from-cyan-400 to-blue-500')}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                ${renderMetricRow('总计目标展位数', fmtCount(progress.target_total), 'text-blue-100')}
                ${renderMetricRow('已付定金展位数', fmtCount(progress.deposit_booth_count), 'text-amber-100')}
                ${renderMetricRow('已付全款展位数', fmtCount(progress.full_paid_booth_count), 'text-emerald-100')}
                ${renderMetricRow('剩余目标数', fmtCount(progress.remaining_target), 'text-orange-100')}
            </div>
        </div>
        <div class="bg-white/10 border border-white/10 rounded-3xl p-5 backdrop-blur-sm">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="text-xs tracking-[0.2em] text-slate-200/80 font-bold">应收与收款</div>
                    <div class="text-3xl font-black text-white mt-2">${fmtMoney(progress.receivable_total)}</div>
                    <div class="text-xs text-slate-300 mt-1">当前总计应收费用</div>
                </div>
                <div class="text-right">
                    <div class="text-xs text-slate-300">已收费用比例</div>
                    <div class="text-2xl font-black text-emerald-200 mt-1">${fmtPercent(progress.received_rate)}</div>
                </div>
            </div>
            ${window.renderMiniProgress(progress.received_rate, 'bg-gradient-to-r from-emerald-400 to-lime-400')}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                ${renderMetricRow('总计应收费用', fmtMoney(progress.receivable_total), 'text-rose-100')}
                ${renderMetricRow('已收费用', fmtMoney(progress.received_total), 'text-emerald-100')}
                ${renderMetricRow('未收费用', fmtMoney(progress.unpaid_total), 'text-orange-100')}
                ${renderMetricRow('已收费用比例', fmtPercent(progress.received_rate), 'text-cyan-100')}
            </div>
        </div>
    `;
}

window.switchHomeSalesSummaryPeriod = function(periodId) {
    window.activeHomeSalesSummaryPeriod = periodId;
    window.renderHomeSalesSummary(window.homeDashboardData?.sales_summary_periods || {});
}

window.renderHomeSalesSummary = function(periodMap) {
    const container = document.getElementById('home-sales-summary');
    if (!container) return;

    const activeId = window.homePeriodTabDefinitions.some((tab) => tab.id === window.activeHomeSalesSummaryPeriod)
        ? window.activeHomeSalesSummaryPeriod
        : 'total';
    window.activeHomeSalesSummaryPeriod = activeId;
    const current = periodMap?.[activeId] || {};
    const fixedTotal = periodMap?.total || {};
    const fixedTargetTotal = Number(fixedTotal.target_total || current.target_total || 0);
    const fixedCompletedBooths = Number((Number(fixedTotal.deposit_booth_count || 0) + Number(fixedTotal.full_paid_booth_count || 0)).toFixed(2));
    const fixedCompletionRate = fixedTargetTotal > 0 ? (fixedCompletedBooths / fixedTargetTotal) * 100 : 0;
    const fixedRemainingTarget = Math.max(fixedTargetTotal - fixedCompletedBooths, 0);
    const fixedReceivableTotal = Number(fixedTotal.receivable_total || 0);
    const fixedReceivedTotal = Number(fixedTotal.received_total || 0);
    const fixedCollectionRate = fixedReceivableTotal > 0 ? (fixedReceivedTotal / fixedReceivableTotal) * 100 : 0;
    const fixedUnpaidTotal = Math.max(fixedReceivableTotal - fixedReceivedTotal, 0);
    const fmtCount = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');
    const fmtMoney = (value) => `¥${Number(value || 0).toLocaleString()}`;
    const fmtPercent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;
    const currentPaidBooths = Number((Number(current.deposit_booth_count || 0) + Number(current.full_paid_booth_count || 0)).toFixed(2));
    const currentCompletionRate = fixedTargetTotal > 0 ? (currentPaidBooths / fixedTargetTotal) * 100 : 0;
    const currentUnpaidTotal = Math.max(Number(current.receivable_total || 0) - Number(current.received_total || 0), 0);
    const renderMetricCard = (label, value, hint = '', tone = 'text-slate-800') => `
        <div class="bg-white rounded-2xl border border-slate-200 px-4 py-4">
            <div class="text-xs text-slate-400 font-bold">${label}</div>
            <div class="text-2xl font-black mt-2 ${tone}">${value}</div>
            ${hint ? `<div class="text-[11px] text-slate-400 mt-2">${hint}</div>` : ''}
        </div>
    `;
    const periodLabel = window.homePeriodTabDefinitions.find((tab) => tab.id === activeId)?.label || '总计';

    container.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-end gap-4 mb-4">
            <div class="flex flex-wrap gap-2">
                ${window.renderHomeInnerTabs(activeId, 'window.switchHomeSalesSummaryPeriod')}
            </div>
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded-3xl p-5">
            <div class="grid grid-cols-1 xl:grid-cols-[290px_minmax(0,1fr)] gap-5 items-start">
                <div class="bg-slate-900 text-white rounded-3xl p-5 shadow-sm">
                    <div class="text-xs tracking-[0.2em] text-slate-300 font-bold">固定总览</div>
                    <div class="space-y-3 mt-4">
                        <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4">
                            <div class="text-xs text-slate-300 font-bold">总计目标展位数</div>
                            <div class="text-3xl font-black mt-2">${fmtCount(fixedTargetTotal)}</div>
                        </div>
                        <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4">
                            <div class="flex items-center justify-between gap-3">
                                <div>
                                    <div class="text-xs text-slate-300 font-bold">已完成展位数</div>
                                    <div class="text-3xl font-black text-emerald-300 mt-2">${fmtCount(fixedCompletedBooths)}</div>
                                </div>
                                <div class="text-right">
                                    <div class="text-xs text-slate-300">完成比例</div>
                                    <div class="text-xl font-black text-cyan-200 mt-1">${fmtPercent(fixedCompletionRate)}</div>
                                </div>
                            </div>
                            ${window.renderMiniProgress(fixedCompletionRate, 'bg-gradient-to-r from-cyan-400 to-blue-500')}
                        </div>
                        <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4">
                            <div class="text-xs text-slate-300 font-bold">剩余目标数</div>
                            <div class="text-3xl font-black text-orange-300 mt-2">${fmtCount(fixedRemainingTarget)}</div>
                            <div class="text-[11px] text-slate-400 mt-2">总计减去定金展位数和全款展位数</div>
                        </div>
                        <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4">
                            <div class="text-xs text-slate-300 font-bold">总计应收费用</div>
                            <div class="text-3xl font-black text-rose-200 mt-2">${fmtMoney(fixedReceivableTotal)}</div>
                        </div>
                        <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4">
                            <div class="flex items-center justify-between gap-3">
                                <div>
                                    <div class="text-xs text-slate-300 font-bold">总计已收费用</div>
                                    <div class="text-3xl font-black text-emerald-300 mt-2">${fmtMoney(fixedReceivedTotal)}</div>
                                </div>
                                <div class="text-right">
                                    <div class="text-xs text-slate-300">已收费用比例</div>
                                    <div class="text-xl font-black text-lime-200 mt-1">${fmtPercent(fixedCollectionRate)}</div>
                                </div>
                            </div>
                            ${window.renderMiniProgress(fixedCollectionRate, 'bg-gradient-to-r from-emerald-400 to-lime-400')}
                        </div>
                        <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4">
                            <div class="text-xs text-slate-300 font-bold">剩余未收费用</div>
                            <div class="text-3xl font-black text-orange-300 mt-2">${fmtMoney(fixedUnpaidTotal)}</div>
                        </div>
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
                        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                            <div>
                                <div class="text-xs tracking-[0.2em] text-slate-400 font-bold">${window.escapeHtml(periodLabel)} 周期</div>
                                <div class="text-2xl font-black text-slate-900 mt-2">当前目标与收款概览</div>
                                <div class="text-sm text-slate-500 mt-2">右侧数据会随时间周期切换，左侧固定总览保持不变。</div>
                            </div>
                            <div class="grid grid-cols-2 gap-3 min-w-[260px]">
                                <div class="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                                    <div class="text-xs font-bold text-blue-600">当前周期占总目标比例</div>
                                    <div class="text-2xl font-black text-blue-700 mt-2">${fmtPercent(currentCompletionRate)}</div>
                                </div>
                                <div class="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                                    <div class="text-xs font-bold text-emerald-600">当前周期收款比例</div>
                                    <div class="text-2xl font-black text-emerald-700 mt-2">${fmtPercent(current.collection_rate)}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                        <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
                            <div class="flex items-center justify-between gap-3">
                                <div>
                                    <div class="text-xs tracking-[0.2em] text-slate-400 font-bold">展位推进</div>
                                    <div class="text-xl font-black text-slate-900 mt-2">本周期展位状态</div>
                                </div>
                                <div class="text-right">
                                    <div class="text-xs text-slate-400">已完成展位</div>
                                    <div class="text-2xl font-black text-indigo-700 mt-1">${fmtCount(currentPaidBooths)}</div>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                                ${renderMetricCard('预留展位数', fmtCount(current.reserved_booth_count), '已提交订单但未任何付款', 'text-slate-700')}
                                ${renderMetricCard('定金展位数', fmtCount(current.deposit_booth_count), '已发生部分收款', 'text-amber-600')}
                                ${renderMetricCard('全款展位数', fmtCount(current.full_paid_booth_count), '已完成全部收款', 'text-emerald-700')}
                                ${renderMetricCard('企业数', current.company_count || 0, '按当前周期统计', 'text-violet-700')}
                            </div>
                            <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                <div class="flex items-center justify-between text-xs font-bold text-blue-700">
                                    <span>当前周期占总目标比例</span>
                                    <span>${fmtPercent(currentCompletionRate)}</span>
                                </div>
                                ${window.renderMiniProgress(currentCompletionRate, 'bg-gradient-to-r from-blue-500 to-indigo-500')}
                            </div>
                        </div>
                        <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
                            <div class="flex items-center justify-between gap-3">
                                <div>
                                    <div class="text-xs tracking-[0.2em] text-slate-400 font-bold">收款金额</div>
                                    <div class="text-xl font-black text-slate-900 mt-2">本周期金额情况</div>
                                </div>
                                <div class="text-right">
                                    <div class="text-xs text-slate-400">剩余未收费用</div>
                                    <div class="text-2xl font-black text-orange-600 mt-1">${fmtMoney(currentUnpaidTotal)}</div>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                                ${renderMetricCard('应收费用', fmtMoney(current.receivable_total), '随时间周期变化', 'text-rose-700')}
                                ${renderMetricCard('已收费用', fmtMoney(current.received_total), '当前周期实际收款', 'text-emerald-700')}
                                ${renderMetricCard('剩余未收费用', fmtMoney(currentUnpaidTotal), '当前周期应收减已收', 'text-orange-700')}
                            </div>
                            <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                <div class="flex items-center justify-between text-xs font-bold text-emerald-700">
                                    <span>当前周期收款比例</span>
                                    <span>${fmtPercent(current.collection_rate)}</span>
                                </div>
                                ${window.renderMiniProgress(current.collection_rate, 'bg-gradient-to-r from-emerald-400 to-lime-400')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.switchHomeSalesListPeriod = function(periodId) {
    window.activeHomeSalesListPeriod = periodId;
    window.renderHomeSalesList(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
}

window.renderHomeSalesList = function(periodMap, metaMap = {}) {
    const container = document.getElementById('home-sales-list');
    if (!container) return;

    const activeId = window.homePeriodTabDefinitions.some((tab) => tab.id === window.activeHomeSalesListPeriod)
        ? window.activeHomeSalesListPeriod
        : 'total';
    window.activeHomeSalesListPeriod = activeId;
    const rows = Array.isArray(periodMap?.[activeId]) ? periodMap[activeId] : [];
    const meta = metaMap?.[activeId] || {};

    if (!rows || rows.length === 0) {
        container.innerHTML = '<div class="text-sm text-gray-500 bg-slate-50 border border-slate-200 rounded-2xl p-5">当前项目暂无可展示的业务员销售数据。</div>';
        return;
    }

    const totals = rows.reduce((acc, row) => {
        acc.target += Number(row.target_booths || 0);
        acc.reservedBooths += Number(row.reserved_booth_count || 0);
        acc.depositBooths += Number(row.deposit_booth_count || 0);
        acc.fullPaidBooths += Number(row.full_paid_booth_count || 0);
        acc.remainingTarget += Number(row.remaining_target || 0);
        acc.receivable += Number(row.receivable_total || 0);
        acc.received += Number(row.received_total || 0);
        return acc;
    }, { target: 0, reservedBooths: 0, depositBooths: 0, fullPaidBooths: 0, remainingTarget: 0, receivable: 0, received: 0 });
    const totalProgressBooths = totals.reservedBooths + totals.depositBooths + totals.fullPaidBooths;
    const totalCompletionRate = totals.target > 0 ? (totalProgressBooths / totals.target) * 100 : 0;
    const totalCollectionRate = totals.receivable > 0 ? (totals.received / totals.receivable) * 100 : 0;
    const fmtCount = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');
    const fmtMoney = (value) => `¥${Number(value || 0).toLocaleString()}`;
    const fmtPercent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;

    container.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
            <div class="text-sm text-slate-500">切换周期后，业务员推进表和销售冠军都会一起变化。</div>
            <div class="flex flex-wrap gap-2">
                ${window.renderHomeInnerTabs(activeId, 'window.switchHomeSalesListPeriod')}
            </div>
        </div>
        <div class="mb-4 rounded-3xl border border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 px-5 py-4 shadow-lg shadow-slate-900/10">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div class="flex items-center gap-4">
                    <div class="h-14 w-14 rounded-2xl bg-amber-400/15 border border-amber-300/25 flex items-center justify-center">
                        <svg viewBox="0 0 64 64" class="w-8 h-8" aria-hidden="true">
                            <defs>
                                <linearGradient id="champion-crown-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stop-color="#fde68a"></stop>
                                    <stop offset="100%" stop-color="#f59e0b"></stop>
                                </linearGradient>
                            </defs>
                            <path d="M14 45h36l-4-23-11 10-7-14-7 14-11-10-4 23Z" fill="url(#champion-crown-gradient)" stroke="#fcd34d" stroke-width="2" stroke-linejoin="round"></path>
                            <rect x="14" y="45" width="36" height="7" rx="3.5" fill="#f59e0b"></rect>
                            <circle cx="21" cy="19" r="4" fill="#fef3c7"></circle>
                            <circle cx="32" cy="13" r="4" fill="#fef3c7"></circle>
                            <circle cx="43" cy="19" r="4" fill="#fef3c7"></circle>
                        </svg>
                    </div>
                    <div>
                        <div class="text-xs tracking-[0.24em] text-amber-200/90 font-bold">SALES CHAMPION</div>
                        <div class="text-2xl font-black text-white mt-1">${window.escapeHtml(meta.champion_name || '暂无')}</div>
                        <div class="text-sm text-slate-300 mt-1">当前所选周期内，新增收款展位数排名第一</div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3 min-w-[260px]">
                    <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <div class="text-[11px] tracking-wide text-slate-400 font-bold">新增收款展位数</div>
                        <div class="text-2xl font-black text-amber-200 mt-2">${fmtCount(meta.champion_booth_count || 0)}</div>
                    </div>
                    <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <div class="text-[11px] tracking-wide text-slate-400 font-bold">冠军说明</div>
                        <div class="text-sm font-bold text-slate-100 mt-2 leading-6">首次收款发生在当前周期的新增企业</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="border border-slate-200 rounded-3xl overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-sm min-w-[1450px]">
                    <thead class="bg-slate-100 text-slate-600">
                        <tr>
                            <th class="text-left px-4 py-3 font-bold">业务员</th>
                            <th class="text-right px-4 py-3 font-bold">目标展位数</th>
                            <th class="text-right px-4 py-3 font-bold">预留展位数</th>
                            <th class="text-right px-4 py-3 font-bold">定金展位数</th>
                            <th class="text-right px-4 py-3 font-bold">全款展位数</th>
                            <th class="text-right px-4 py-3 font-bold">剩余目标数</th>
                            <th class="text-left px-4 py-3 font-bold">完成比例</th>
                            <th class="text-right px-4 py-3 font-bold">总计应收费用</th>
                            <th class="text-right px-4 py-3 font-bold">总计已收费用</th>
                            <th class="text-left px-4 py-3 font-bold">已收费用占比</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white">
                        ${rows.map((row) => {
                            const completionRate = Number(row.completion_rate || 0);
                            const collectionRate = Number(row.collection_rate || 0);
                            const progressedBooths = Number(row.reserved_booth_count || 0) + Number(row.deposit_booth_count || 0) + Number(row.full_paid_booth_count || 0);
                            const roleBadge = row.role === 'admin'
                                ? '<span class="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">管理员</span>'
                                : '<span class="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">业务员</span>';
                            return `
                                <tr>
                                    <td class="px-4 py-3">
                                        <div class="flex items-center gap-2">
                                            <span class="font-black text-slate-800">${window.escapeHtml(row.staff_name)}</span>
                                            ${roleBadge}
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-right font-bold text-blue-700">${Number(row.target_booths || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-4 py-3 text-right font-bold text-slate-700">${Number(row.reserved_booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-4 py-3 text-right font-bold text-amber-700">${Number(row.deposit_booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-4 py-3 text-right font-bold text-emerald-700">${Number(row.full_paid_booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-4 py-3 text-right font-bold text-orange-700">${Number(row.remaining_target || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-4 py-3 min-w-[180px]">
                                        <div class="flex items-center justify-between text-xs font-bold text-blue-700">
                                            <span>${completionRate.toFixed(1).replace(/\.0$/, '')}%</span>
                                            <span class="text-slate-400 font-semibold">${fmtCount(progressedBooths)}/${fmtCount(row.target_booths)}</span>
                                        </div>
                                        ${window.renderMiniProgress(completionRate, 'bg-gradient-to-r from-blue-500 to-indigo-500')}
                                    </td>
                                    <td class="px-4 py-3 text-right font-bold text-rose-700">¥${Number(row.receivable_total || 0).toLocaleString()}</td>
                                    <td class="px-4 py-3 text-right font-bold text-emerald-700">¥${Number(row.received_total || 0).toLocaleString()}</td>
                                    <td class="px-4 py-3 min-w-[180px]">
                                        <div class="flex items-center justify-between text-xs font-bold text-emerald-700">
                                            <span>${collectionRate.toFixed(1).replace(/\.0$/, '')}%</span>
                                            <span class="text-slate-400 font-semibold">${fmtMoney(row.received_total || 0)}</span>
                                        </div>
                                        ${window.renderMiniProgress(collectionRate, 'bg-gradient-to-r from-emerald-400 to-emerald-600')}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                        <tr class="bg-gradient-to-r from-slate-100 via-blue-50 to-emerald-50 border-t-2 border-slate-300 shadow-inner">
                            <td class="px-4 py-4 font-black text-slate-950 text-base">总计</td>
                            <td class="px-4 py-4 text-right font-black text-blue-700">${fmtCount(totals.target)}</td>
                            <td class="px-4 py-4 text-right font-black text-slate-700">${fmtCount(totals.reservedBooths)}</td>
                            <td class="px-4 py-4 text-right font-black text-amber-700">${fmtCount(totals.depositBooths)}</td>
                            <td class="px-4 py-4 text-right font-black text-emerald-700">${fmtCount(totals.fullPaidBooths)}</td>
                            <td class="px-4 py-4 text-right font-black text-orange-700">${fmtCount(totals.remainingTarget)}</td>
                            <td class="px-4 py-4 min-w-[180px]">
                                <div class="flex items-center justify-between text-xs font-bold text-blue-700">
                                    <span>${fmtPercent(totalCompletionRate)}</span>
                                    <span class="text-slate-400 font-semibold">${fmtCount(totalProgressBooths)}/${fmtCount(totals.target)}</span>
                                </div>
                                ${window.renderMiniProgress(totalCompletionRate, 'bg-gradient-to-r from-blue-500 to-indigo-500')}
                            </td>
                            <td class="px-4 py-4 text-right font-black text-rose-700">${fmtMoney(totals.receivable)}</td>
                            <td class="px-4 py-4 text-right font-black text-emerald-700">${fmtMoney(totals.received)}</td>
                            <td class="px-4 py-4 min-w-[180px]">
                                <div class="flex items-center justify-between text-xs font-bold text-emerald-700">
                                    <span>${fmtPercent(totalCollectionRate)}</span>
                                    <span class="text-slate-400 font-semibold">${fmtMoney(totals.received)}</span>
                                </div>
                                ${window.renderMiniProgress(totalCollectionRate, 'bg-gradient-to-r from-emerald-400 to-emerald-600')}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.renderHomeRegionTable = function(regionOverview, isAdmin) {
    const container = document.getElementById('home-region-table');
    const note = document.getElementById('home-region-scope-note');
    if (!container || !note) return;

    note.innerText = isAdmin
        ? `当前显示全部业务员范围：企业 ${regionOverview.total_company_count || 0} 家，折合展位数 ${Number(regionOverview.total_booth_count || 0).toFixed(2).replace(/\.00$/, '')} 个。`
        : `当前仅显示本人名下企业：企业 ${regionOverview.total_company_count || 0} 家，折合展位数 ${Number(regionOverview.total_booth_count || 0).toFixed(2).replace(/\.00$/, '')} 个。`;

    if (!regionOverview.sections || regionOverview.sections.length === 0) {
        container.innerHTML = '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm text-gray-500">当前范围暂无企业地区数据。</div>';
        return;
    }

    container.innerHTML = regionOverview.sections.map((section) => `
        <div class="border border-slate-200 rounded-3xl overflow-hidden">
            <div class="bg-gradient-to-r from-slate-50 to-white px-5 py-4 border-b border-slate-200">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                        <div class="text-lg font-black text-slate-800">${window.escapeHtml(section.title)}</div>
                        <div class="text-xs text-slate-500 mt-1">${window.escapeHtml(section.description || '')}</div>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div class="bg-white rounded-xl border border-slate-200 px-3 py-2"><div class="text-slate-400">企业数</div><div class="font-black text-slate-700 mt-1">${section.summary.company_count || 0}</div></div>
                        <div class="bg-white rounded-xl border border-slate-200 px-3 py-2"><div class="text-slate-400">展位数</div><div class="font-black text-slate-700 mt-1">${Number(section.summary.booth_count || 0).toFixed(2).replace(/\.00$/, '')}</div></div>
                        <div class="bg-white rounded-xl border border-slate-200 px-3 py-2"><div class="text-slate-400">企业占比</div><div class="font-black text-blue-700 mt-1">${Number(section.summary.company_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</div></div>
                        <div class="bg-white rounded-xl border border-slate-200 px-3 py-2"><div class="text-slate-400">展位占比</div><div class="font-black text-emerald-700 mt-1">${Number(section.summary.booth_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</div></div>
                    </div>
                </div>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-slate-100 text-slate-600">
                        <tr>
                            <th class="text-left px-5 py-3 font-bold">地区单元</th>
                            <th class="text-right px-5 py-3 font-bold">企业数</th>
                            <th class="text-right px-5 py-3 font-bold">展位数</th>
                            <th class="text-right px-5 py-3 font-bold">企业占比</th>
                            <th class="text-right px-5 py-3 font-bold">展位占比</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white">
                        ${section.rows.map((row) => `
                            <tr>
                                <td class="px-5 py-3 font-bold text-slate-800">${window.escapeHtml(row.label)}</td>
                                <td class="px-5 py-3 text-right text-slate-700">${row.company_count || 0}</td>
                                <td class="px-5 py-3 text-right text-slate-700">${Number(row.booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                <td class="px-5 py-3 text-right text-blue-700 font-bold">${Number(row.company_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</td>
                                <td class="px-5 py-3 text-right text-emerald-700 font-bold">${Number(row.booth_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `).join('');
}

window.renderHomeRegionChart = function(regionOverview) {
    const container = document.getElementById('home-region-chart');
    if (!container) return;

    const pieItems = Array.isArray(regionOverview?.pie_items) ? regionOverview.pie_items : [];
    if (pieItems.length === 0) {
        container.innerHTML = '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm text-gray-500">当前范围暂无已成交企业地区分布数据。</div>';
        return;
    }

    const colors = ['#2563eb', '#14b8a6', '#f97316', '#8b5cf6', '#e11d48', '#0f766e', '#ca8a04', '#334155', '#06b6d4', '#4f46e5', '#16a34a', '#f59e0b'];
    const total = pieItems.reduce((sum, item) => sum + Number(item.company_count || 0), 0);
    const radius = 68;
    const centerX = 150;
    const centerY = 100;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    let cumulativeRatio = 0;

    const circles = pieItems.map((item, index) => {
        const value = Number(item.company_count || 0);
        const ratio = total > 0 ? value / total : 0;
        const length = ratio * circumference;
        const circle = `
            <circle
                cx="${centerX}"
                cy="${centerY}"
                r="${radius}"
                fill="none"
                stroke="${colors[index % colors.length]}"
                stroke-width="26"
                stroke-dasharray="${length} ${circumference - length}"
                stroke-dashoffset="${-offset}"
                stroke-linecap="butt"
                transform="rotate(-90 ${centerX} ${centerY})"
            ></circle>
        `;
        offset += length;
        return circle;
    }).join('');

    const labels = pieItems.map((item, index) => {
        const value = Number(item.company_count || 0);
        const ratio = total > 0 ? value / total : 0;
        if (ratio <= 0) return '';

        const midRatio = cumulativeRatio + ratio / 2;
        cumulativeRatio += ratio;
        const angle = (midRatio * Math.PI * 2) - (Math.PI / 2);
        const lineStartX = centerX + Math.cos(angle) * (radius + 2);
        const lineStartY = centerY + Math.sin(angle) * (radius + 2);
        const lineMidX = centerX + Math.cos(angle) * (radius + 16);
        const lineMidY = centerY + Math.sin(angle) * (radius + 16);
        const isRightSide = Math.cos(angle) >= 0;
        const lineEndX = lineMidX + (isRightSide ? 20 : -20);
        const rawLabel = String(item.label || '');
        const shortLabel = rawLabel.length > 10 ? `${rawLabel.slice(0, 10)}…` : rawLabel;
        const pillWidth = Math.max(72, Math.min(140, 24 + (shortLabel.length * 16)));
        const pillHeight = 28;
        const pillX = isRightSide
            ? Math.min(lineEndX + 8, 320 - pillWidth - 8)
            : Math.max(lineEndX - pillWidth - 8, 8);
        const pillY = Math.max(8, Math.min(lineMidY - (pillHeight / 2), 240 - pillHeight - 8));
        const textX = pillX + (pillWidth / 2);
        const textY = pillY + (pillHeight / 2) + 1;
        const lineStopX = isRightSide ? pillX - 8 : pillX + pillWidth + 8;

        return `
            <path d="M ${lineStartX.toFixed(2)} ${lineStartY.toFixed(2)} L ${lineMidX.toFixed(2)} ${lineMidY.toFixed(2)} L ${lineEndX.toFixed(2)} ${lineMidY.toFixed(2)} L ${lineStopX.toFixed(2)} ${(pillY + (pillHeight / 2)).toFixed(2)}"
                fill="none"
                stroke="${colors[index % colors.length]}"
                stroke-width="1.5"
                stroke-linecap="round"></path>
            <rect
                x="${pillX.toFixed(2)}"
                y="${pillY.toFixed(2)}"
                width="${pillWidth.toFixed(2)}"
                height="${pillHeight}"
                rx="14"
                fill="white"
                fill-opacity="0.96"
                stroke="${colors[index % colors.length]}"
                stroke-opacity="0.25"
            ></rect>
            <text
                x="${textX.toFixed(2)}"
                y="${textY.toFixed(2)}"
                text-anchor="middle"
                dominant-baseline="middle"
                font-size="10"
                font-weight="700"
                fill="#334155"
            >${window.escapeHtml(shortLabel)}</text>
        `;
    }).join('');

    const legend = pieItems.map((item, index) => `
        <div class="flex items-start gap-3 bg-slate-50 rounded-2xl border border-slate-100 px-4 py-3">
            <span class="w-3 h-3 rounded-full mt-1 shrink-0" style="background:${colors[index % colors.length]}"></span>
            <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-3">
                    <span class="font-bold text-slate-800 truncate">${window.escapeHtml(item.label)}</span>
                    <span class="text-xs font-black text-slate-500">${Number(item.company_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</span>
                </div>
                <div class="text-xs text-slate-500 mt-1">企业 ${item.company_count || 0} 家，展位 ${Number(item.booth_count || 0).toFixed(2).replace(/\.00$/, '')} 个</div>
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="flex flex-col items-center">
            <div class="relative">
                <svg viewBox="0 0 320 240" class="w-[34rem] max-w-full h-80">
                    <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="#e2e8f0" stroke-width="26"></circle>
                    ${circles}
                    ${labels}
                    <text x="${centerX}" y="${centerY - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="#64748b">成交企业</text>
                    <text x="${centerX}" y="${centerY + 20}" text-anchor="middle" font-size="34" font-weight="900" fill="#1e293b">${total}</text>
                    <text x="${centerX}" y="${centerY + 48}" text-anchor="middle" font-size="12" font-weight="700" fill="#94a3b8">分布占比</text>
                </svg>
            </div>
            <div class="w-full space-y-3 mt-4">${legend}</div>
        </div>
    `;
}

window.switchHomeHallInnerTab = function(tabId) {
    window.activeHomeHallTab = tabId;
    window.renderHomeHallTable(window.homeDashboardData?.hall_overview || [], window.homeDashboardData?.is_admin);
}

window.renderHomeHallTable = function(halls, isAdmin) {
    const section = document.getElementById('home-hall-section');
    const container = document.getElementById('home-hall-table');
    if (!section || !container) return;

    if (!isAdmin) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');

    if (!halls || halls.length === 0) {
        container.innerHTML = '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm text-gray-500">当前项目暂无馆别经营数据。</div>';
        return;
    }

    const activeId = window.homeHallTabDefinitions.some((tab) => tab.id === window.activeHomeHallTab)
        ? window.activeHomeHallTab
        : 'booth';
    window.activeHomeHallTab = activeId;
    const fmtCount = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');
    const fmtMoney = (value) => `¥${Number(value || 0).toLocaleString()}`;
    const fmtPercent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;

    const totals = halls.reduce((acc, hall) => {
        acc.configuredStandard += Number(hall.configured_standard_booth_count || 0);
        acc.configuredGround += Number(hall.configured_ground_booth_count || 0);
        acc.receivedStandard += Number(hall.received_standard_booth_count || 0);
        acc.receivedGround += Number(hall.received_ground_booth_count || 0);
        acc.receivedBooths += Number(hall.received_booth_count || 0);
        acc.remainingUnsold += Number(hall.remaining_unsold_booth_count || 0);
        acc.receivedCompanies += Number(hall.received_company_count || 0);
        acc.configuredTotal += Number(hall.configured_total_booth_count || 0);
        acc.chargedBooths += Number(hall.charged_booth_count || 0);
        acc.receivableBoothFee += Number(hall.receivable_booth_fee || 0);
        acc.receivedBoothFee += Number(hall.received_booth_fee || 0);
        acc.freeBooths += Number(hall.free_booth_count || 0);
        return acc;
    }, {
        configuredStandard: 0,
        configuredGround: 0,
        receivedStandard: 0,
        receivedGround: 0,
        receivedBooths: 0,
        remainingUnsold: 0,
        receivedCompanies: 0,
        configuredTotal: 0,
        chargedBooths: 0,
        receivableBoothFee: 0,
        receivedBoothFee: 0,
        freeBooths: 0
    });
    const totalReceivedRate = totals.configuredTotal > 0 ? (totals.receivedBooths / totals.configuredTotal) * 100 : 0;
    const totalCollectionRate = totals.receivableBoothFee > 0 ? (totals.receivedBoothFee / totals.receivableBoothFee) * 100 : 0;
    const totalChargedAvg = totals.chargedBooths > 0 ? (totals.receivableBoothFee / totals.chargedBooths) : 0;
    const totalOverallAvg = totals.configuredTotal > 0 ? (totals.receivableBoothFee / totals.configuredTotal) : 0;

    const boothTable = `
        <div class="border border-slate-200 rounded-3xl overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-[13px] table-fixed">
                    <thead class="bg-slate-100 text-slate-600">
                        <tr>
                            <th class="text-left px-3 py-2.5 font-bold">馆号</th>
                            <th class="text-right px-3 py-2.5 font-bold">总计设置展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">设置标摊展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">设置光地展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">已收款标摊展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">已收款光地展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">已收款展位数占比</th>
                            <th class="text-right px-3 py-2.5 font-bold">剩余未售展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">已收款企业数</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white">
                        ${halls.map((hall) => `
                            <tr>
                                <td class="px-3 py-3 font-black text-slate-800 whitespace-nowrap">${window.escapeHtml(hall.hall)}</td>
                                <td class="px-3 py-3 text-right font-bold text-blue-700">${fmtCount(hall.configured_total_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-indigo-700">${fmtCount(hall.configured_standard_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-cyan-700">${fmtCount(hall.configured_ground_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-emerald-700">${fmtCount(hall.received_standard_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-teal-700">${fmtCount(hall.received_ground_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-emerald-700">${fmtPercent(hall.received_booth_rate)}</td>
                                <td class="px-3 py-3 text-right font-bold text-orange-700">${fmtCount(hall.remaining_unsold_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-violet-700">${hall.received_company_count || 0}</td>
                            </tr>
                        `).join('')}
                        <tr class="bg-gradient-to-r from-slate-100 via-blue-50 to-emerald-50 border-t-2 border-slate-300">
                            <td class="px-3 py-3 font-black text-slate-950 text-base">总计</td>
                            <td class="px-3 py-3 text-right font-black text-blue-700">${fmtCount(totals.configuredTotal)}</td>
                            <td class="px-3 py-3 text-right font-black text-indigo-700">${fmtCount(totals.configuredStandard)}</td>
                            <td class="px-3 py-3 text-right font-black text-cyan-700">${fmtCount(totals.configuredGround)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700">${fmtCount(totals.receivedStandard)}</td>
                            <td class="px-3 py-3 text-right font-black text-teal-700">${fmtCount(totals.receivedGround)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700">${fmtPercent(totalReceivedRate)}</td>
                            <td class="px-3 py-3 text-right font-black text-orange-700">${fmtCount(totals.remainingUnsold)}</td>
                            <td class="px-3 py-3 text-right font-black text-violet-700">${totals.receivedCompanies}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const financeTable = `
        <div class="border border-slate-200 rounded-3xl overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-[13px] table-fixed">
                    <thead class="bg-slate-100 text-slate-600">
                        <tr>
                            <th class="text-left px-3 py-2.5 font-bold">馆号</th>
                            <th class="text-right px-3 py-2.5 font-bold">设置展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">收费展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">应收展位费</th>
                            <th class="text-right px-3 py-2.5 font-bold">已收展位费</th>
                            <th class="text-right px-3 py-2.5 font-bold">收款比例</th>
                            <th class="text-right px-3 py-2.5 font-bold">免费展位数</th>
                            <th class="text-right px-3 py-2.5 font-bold">收费展位平均单价</th>
                            <th class="text-right px-3 py-2.5 font-bold">总体平均单价</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white">
                        ${halls.map((hall) => `
                            <tr>
                                <td class="px-3 py-3 font-black text-slate-800 whitespace-nowrap">${window.escapeHtml(hall.hall)}</td>
                                <td class="px-3 py-3 text-right font-bold text-blue-700">${fmtCount(hall.configured_total_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-indigo-700">${fmtCount(hall.charged_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-rose-700">${fmtMoney(hall.receivable_booth_fee)}</td>
                                <td class="px-3 py-3 text-right font-bold text-emerald-700">${fmtMoney(hall.received_booth_fee)}</td>
                                <td class="px-3 py-3 text-right font-bold text-emerald-700">${fmtPercent(hall.collection_rate)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-700">${fmtCount(hall.free_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-violet-700">${fmtMoney(hall.charged_avg_unit_price)}</td>
                                <td class="px-3 py-3 text-right font-bold text-cyan-700">${fmtMoney(hall.overall_avg_unit_price)}</td>
                            </tr>
                        `).join('')}
                        <tr class="bg-gradient-to-r from-slate-100 via-blue-50 to-emerald-50 border-t-2 border-slate-300">
                            <td class="px-3 py-3 font-black text-slate-950 text-base">总计</td>
                            <td class="px-3 py-3 text-right font-black text-blue-700">${fmtCount(totals.configuredTotal)}</td>
                            <td class="px-3 py-3 text-right font-black text-indigo-700">${fmtCount(totals.chargedBooths)}</td>
                            <td class="px-3 py-3 text-right font-black text-rose-700">${fmtMoney(totals.receivableBoothFee)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700">${fmtMoney(totals.receivedBoothFee)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700">${fmtPercent(totalCollectionRate)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700">${fmtCount(totals.freeBooths)}</td>
                            <td class="px-3 py-3 text-right font-black text-violet-700">${fmtMoney(totalChargedAvg)}</td>
                            <td class="px-3 py-3 text-right font-black text-cyan-700">${fmtMoney(totalOverallAvg)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
            <div class="text-sm text-slate-500">该板块仅超级管理员和管理员可查看，按馆号拆分展位概况与财务概况。</div>
            <div class="flex flex-wrap gap-2">
                ${window.homeHallTabDefinitions.map((tab) => `
                    <button
                        onclick="window.switchHomeHallInnerTab('${tab.id}')"
                        class="px-3 py-1.5 rounded-full text-xs font-bold transition border ${tab.id === activeId
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-100'}"
                    >${tab.label}</button>
                `).join('')}
            </div>
        </div>
        ${activeId === 'booth' ? boothTable : financeTable}
    `;
}

window.loadHomeDashboard = async function() {
    const pid = document.getElementById('global-project-select')?.value;
    if (!pid) return;

    if (window.homeCountdownTimer) clearInterval(window.homeCountdownTimer);
    window.updateHomeProjectHero();
    window.homeCountdownTimer = setInterval(() => {
        if (document.getElementById('sec-home')?.classList.contains('active')) {
            window.updateHomeProjectHero();
        }
    }, 60000);

    try {
        const res = await window.apiFetch(`/api/home-dashboard?projectId=${pid}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '首页数据加载失败');
        }
        const data = await res.json();
        window.homeDashboardData = data;
        window.renderHomeTabs(data.is_admin);
        window.renderHomeProgressSummary(data.home_progress || {});
        window.renderHomeSalesSummary(data.sales_summary_periods || {});
        window.renderHomeSalesList(data.sales_list_periods || {}, data.sales_list_meta || {});
        window.renderHomeRegionTable(data.region_overview || {}, data.is_admin);
        window.renderHomeRegionChart(data.region_overview || {});
        window.renderHomeHallTable(data.hall_overview || [], data.is_admin);
    } catch (e) {
        window.showToast(e.message, 'error');
    }
}
