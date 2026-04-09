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
window.activeHomeSalesSummaryMonthNumber = '';
window.activeHomeSalesListMonthNumber = '';
window.activeHomeSalesSummaryYear = '';
window.activeHomeSalesListYear = '';
window.homeSalesListSortKey = window.homeSalesListSortKey || '';
window.homeSalesListSortDirection = window.homeSalesListSortDirection || 'asc';
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
        countdownDescEl.innerText = '当前项目未设置展期';
        return;
    }

    const startDate = new Date(`${project.start_date}T00:00:00+08:00`);
    const endDate = project.end_date ? new Date(`${project.end_date}T23:59:59+08:00`) : startDate;
    const exhibitionRangeLabel = `${project.start_date} ~ ${project.end_date || project.start_date}`;
    countdownValueEl.innerText = exhibitionRangeLabel;

    if (now < startDate) {
        countdownDescEl.innerText = `距开展还有 ${window.formatCountdownParts(startDate - now)}`;
        return;
    }

    if (now <= endDate) {
        countdownDescEl.innerText = `展会进行中，距闭展还有 ${window.formatCountdownParts(endDate - now)}`;
        return;
    }

    countdownDescEl.innerText = `展会已结束 ${window.formatCountdownParts(now - endDate)}`;
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
    const tabs = window.getAvailableHomeTabs(isAdmin);
    const currentActive = window.activeHomeTab;
    const nextActive = tabs.some((tab) => tab.id === currentActive) ? currentActive : (tabs[0]?.id || '');
    window.activeHomeTab = nextActive;
    window.switchHomeTab(nextActive, false);
}

window.switchHomeTab = function(tabId, rerenderTabs = true) {
    window.activeHomeTab = tabId;
    document.querySelectorAll('.home-tab-panel').forEach((panel) => panel.classList.add('hidden'));
    document.getElementById(`home-tab-${tabId}`)?.classList.remove('hidden');
    const label = window.homeTabDefinitions.find((tab) => tab.id === tabId)?.label;
    if (window.currentSectionId === 'home' && label) {
        const pageTitle = document.getElementById('current-page-title');
        if (pageTitle) pageTitle.innerText = `数据看板 · ${label}`;
    }

    if (rerenderTabs && window.homeDashboardData) {
        window.renderNav?.();
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

window.getHomeAvailableYears = function() {
    const years = Array.isArray(window.homeDashboardData?.sales_available_years)
        ? window.homeDashboardData.sales_available_years
        : [];
    if (years.length > 0) return years.map((year) => String(year));
    const fallbackYear = window.homeDashboardData?.sales_summary_year;
    return fallbackYear ? [String(fallbackYear)] : [];
}

window.getHomeDefaultYear = function() {
    const years = window.getHomeAvailableYears();
    if (years.length > 0) return years[0];
    const fallbackYear = window.homeDashboardData?.sales_summary_year;
    return fallbackYear ? String(fallbackYear) : '';
}

window.renderHomeMonthSelect = function(selectPrefix, selectedYear, selectedMonthNumber, yearChangeHandlerName, monthChangeHandlerName) {
    const selectedValue = selectedMonthNumber ? String(selectedMonthNumber) : '';
    const availableYears = window.getHomeAvailableYears();
    const selectedYearValue = selectedYear ? String(selectedYear) : window.getHomeDefaultYear();
    return `
        <label class="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 shadow-sm">
            <span class="whitespace-nowrap">月份筛选</span>
            <select
                id="${selectPrefix}-year-select"
                onchange="${yearChangeHandlerName}(this.value)"
                class="min-w-[88px] bg-transparent text-slate-700 focus:outline-none tabular-data"
            >
                ${availableYears.map((year) => `<option value="${year}" ${selectedYearValue === String(year) ? 'selected' : ''}>${year}年</option>`).join('')}
            </select>
            <select
                id="${selectPrefix}-month-select"
                onchange="${monthChangeHandlerName}(this.value)"
                class="min-w-[92px] bg-transparent text-slate-700 focus:outline-none tabular-data"
            >
                <option value="">全部月份</option>
                ${Array.from({ length: 12 }, (_, index) => {
                    const monthNumber = index + 1;
                    const value = String(monthNumber);
                    return `<option value="${value}" ${selectedValue === value ? 'selected' : ''}>${monthNumber}月</option>`;
                }).join('')}
            </select>
        </label>
    `;
}

window.resolveHomeFilteredBucket = function(periodMap, monthlyMap, activePeriodId, selectedYear, selectedMonthNumber) {
    if (selectedMonthNumber) {
        return monthlyMap?.[String(selectedYear || '')]?.[String(selectedMonthNumber)] || {};
    }
    return periodMap?.[activePeriodId] || {};
}

window.renderHomeProgressSummary = function(progress) {
    const container = document.getElementById('home-progress-summary');
    if (!container) return;

    const fmtCount = window.formatCompactCount;
    const fmtMoney = window.formatCurrency;
    const fmtPercent = window.formatCompactPercent;
    const targetRate = Number(progress.target_total || 0) > 0
        ? ((Number(progress.deposit_booth_count || 0) + Number(progress.full_paid_booth_count || 0)) / Number(progress.target_total || 0)) * 100
        : 0;
    const renderMetricRow = (label, value, hint = '', toneClass = 'text-slate-800') => `
        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div class="text-xs font-bold tracking-wide text-slate-400">${label}</div>
            <div class="text-xl md:text-2xl font-black ${toneClass} mt-2 tabular-data">${value}</div>
            ${hint ? `<div class="text-[11px] text-slate-400 mt-2">${hint}</div>` : ''}
        </div>
    `;

    container.innerHTML = `
        <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="text-xs tracking-[0.2em] text-slate-400 font-bold">展位目标推进</div>
                    <div class="text-3xl font-black text-slate-900 mt-2 tabular-data">${fmtCount(Number(progress.deposit_booth_count || 0) + Number(progress.full_paid_booth_count || 0))} / ${fmtCount(progress.target_total)} 个</div>
                    <div class="text-xs text-slate-500 mt-1">剩余目标数 ${fmtCount(progress.remaining_target)} 个</div>
                </div>
                <div class="text-right">
                    <div class="text-xs text-slate-400">推进比例</div>
                    <div class="text-2xl font-black text-slate-800 mt-1 tabular-data">${fmtPercent(targetRate)}</div>
                </div>
            </div>
            ${window.renderMiniProgress(targetRate, 'bg-gradient-to-r from-blue-500 to-blue-400')}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                ${renderMetricRow('总计目标展位数', fmtCount(progress.target_total), '当前目标总量', 'text-slate-900')}
                ${renderMetricRow('已付定金展位数', fmtCount(progress.deposit_booth_count), '已发生部分收款', 'text-amber-700')}
                ${renderMetricRow('已付全款展位数', fmtCount(progress.full_paid_booth_count), '已完成全部收款', 'text-emerald-700')}
                ${renderMetricRow('剩余目标数', fmtCount(progress.remaining_target), '仍需继续推进', 'text-slate-700')}
            </div>
        </div>
        <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="text-xs tracking-[0.2em] text-slate-400 font-bold">应收与收款</div>
                    <div class="text-3xl font-black text-slate-900 mt-2 tabular-data">${fmtMoney(progress.receivable_total)}</div>
                    <div class="text-xs text-slate-500 mt-1">当前总计应收费用</div>
                </div>
                <div class="text-right">
                    <div class="text-xs text-slate-400">已收费用比例</div>
                    <div class="text-2xl font-black text-slate-800 mt-1 tabular-data">${fmtPercent(progress.received_rate)}</div>
                </div>
            </div>
            ${window.renderMiniProgress(progress.received_rate, 'bg-gradient-to-r from-emerald-400 to-emerald-200')}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                ${renderMetricRow('总计应收费用', fmtMoney(progress.receivable_total), '当前项目累计应收', 'text-rose-700')}
                ${renderMetricRow('已收费用', fmtMoney(progress.received_total), '当前项目累计已收', 'text-emerald-700')}
                ${renderMetricRow('未收费用', fmtMoney(progress.unpaid_total), '应收减已收后的余额', 'text-slate-800')}
                ${renderMetricRow('已收费用比例', fmtPercent(progress.received_rate), '当前回款进度', 'text-slate-800')}
            </div>
        </div>
    `;
}

window.switchHomeSalesSummaryPeriod = function(periodId) {
    window.activeHomeSalesSummaryPeriod = periodId;
    window.renderHomeSalesSummary(window.homeDashboardData?.sales_summary_periods || {});
}

window.onHomeSalesSummaryYearChange = function(yearValue) {
    window.activeHomeSalesSummaryYear = yearValue ? String(yearValue) : window.getHomeDefaultYear();
    window.renderHomeSalesSummary(window.homeDashboardData?.sales_summary_periods || {});
}

window.onHomeSalesSummaryMonthChange = function(monthValue) {
    window.activeHomeSalesSummaryMonthNumber = monthValue ? String(monthValue) : '';
    window.renderHomeSalesSummary(window.homeDashboardData?.sales_summary_periods || {});
}

window.renderHomeSalesSummary = function(periodMap) {
    const container = document.getElementById('home-sales-summary');
    if (!container) return;

    const activeId = window.homePeriodTabDefinitions.some((tab) => tab.id === window.activeHomeSalesSummaryPeriod)
        ? window.activeHomeSalesSummaryPeriod
        : 'total';
    window.activeHomeSalesSummaryPeriod = activeId;
    const defaultYear = window.getHomeDefaultYear();
    const availableYears = window.getHomeAvailableYears();
    if (!availableYears.includes(String(window.activeHomeSalesSummaryYear || ''))) {
        window.activeHomeSalesSummaryYear = defaultYear;
    }
    const selectedYear = window.activeHomeSalesSummaryYear ? String(window.activeHomeSalesSummaryYear) : defaultYear;
    const selectedMonthNumber = window.activeHomeSalesSummaryMonthNumber ? String(window.activeHomeSalesSummaryMonthNumber) : '';
    const current = window.resolveHomeFilteredBucket(
        periodMap,
        window.homeDashboardData?.sales_summary_monthly_periods || {},
        activeId,
        selectedYear,
        selectedMonthNumber
    );
    const fixedTotal = periodMap?.total || {};
    const fixedTargetTotal = Number(fixedTotal.target_total || current.target_total || 0);
    const fixedCompletedBooths = Number((Number(fixedTotal.deposit_booth_count || 0) + Number(fixedTotal.full_paid_booth_count || 0)).toFixed(2));
    const fixedCompletionRate = fixedTargetTotal > 0 ? (fixedCompletedBooths / fixedTargetTotal) * 100 : 0;
    const fixedRemainingTarget = Math.max(fixedTargetTotal - fixedCompletedBooths, 0);
    const fixedReceivableTotal = Number(fixedTotal.receivable_total || 0);
    const fixedReceivedTotal = Number(fixedTotal.received_total || 0);
    const fixedCollectionRate = fixedReceivableTotal > 0 ? (fixedReceivedTotal / fixedReceivableTotal) * 100 : 0;
    const fixedUnpaidTotal = Math.max(fixedReceivableTotal - fixedReceivedTotal, 0);
    const fmtCount = window.formatCompactCount;
    const fmtMoney = window.formatCurrency;
    const fmtPercent = window.formatCompactPercent;
    const currentPaidBooths = Number((Number(current.deposit_booth_count || 0) + Number(current.full_paid_booth_count || 0)).toFixed(2));
    const currentCompletionRate = fixedTargetTotal > 0 ? (currentPaidBooths / fixedTargetTotal) * 100 : 0;
    const currentUnpaidTotal = Math.max(Number(current.receivable_total || 0) - Number(current.received_total || 0), 0);
    const renderMetricCard = (label, value, hint = '', tone = 'text-slate-800') => `
        <div class="bg-white rounded-2xl border border-slate-200 px-4 py-4">
            <div class="text-xs text-slate-400 font-bold">${label}</div>
            <div class="text-2xl font-black mt-2 ${tone} tabular-data">${value}</div>
            ${hint ? `<div class="text-[11px] text-slate-400 mt-2">${hint}</div>` : ''}
        </div>
    `;
    const tabLabel = window.homePeriodTabDefinitions.find((tab) => tab.id === activeId)?.label || '总计';
    const periodLabel = selectedMonthNumber ? `${selectedMonthNumber}月` : tabLabel;
    const summaryYear = selectedYear || window.homeDashboardData?.sales_summary_year || '';

    container.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-end gap-4 mb-4">
            <div class="flex flex-wrap gap-2">
                ${window.renderHomeInnerTabs(activeId, 'window.switchHomeSalesSummaryPeriod')}
            </div>
            ${window.renderHomeMonthSelect('home-sales-summary', selectedYear, selectedMonthNumber, 'window.onHomeSalesSummaryYearChange', 'window.onHomeSalesSummaryMonthChange')}
        </div>
        <div class="bg-slate-50 border border-slate-200 rounded-3xl p-5">
            <div class="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
                <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
                    <div class="text-xs tracking-[0.2em] text-slate-400 font-bold">固定总览</div>
                    <div class="space-y-3 mt-4">
                        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div class="text-xs text-slate-400 font-bold">总计目标展位数</div>
                            <div class="summary-big-value text-slate-900 font-black mt-2 tabular-data">${fmtCount(fixedTargetTotal)}</div>
                        </div>
                        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div class="text-xs text-slate-400 font-bold">已完成展位数</div>
                            <div class="summary-big-value font-black text-emerald-700 mt-2 tabular-data">${fmtCount(fixedCompletedBooths)}</div>
                            <div class="mt-3 flex items-start justify-between gap-3">
                                <div class="text-[11px] text-slate-400 summary-caption">完成比例</div>
                                <div class="summary-side-value text-slate-800 font-black tabular-data text-right">${fmtPercent(fixedCompletionRate)}</div>
                            </div>
                            ${window.renderMiniProgress(fixedCompletionRate, 'bg-gradient-to-r from-blue-500 to-blue-400')}
                        </div>
                        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div class="text-xs text-slate-400 font-bold">剩余目标数</div>
                            <div class="summary-big-value font-black text-slate-800 mt-2 tabular-data">${fmtCount(fixedRemainingTarget)}</div>
                            <div class="text-[11px] text-slate-400 mt-2 summary-caption">总计减去定金展位数和全款展位数</div>
                        </div>
                        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div class="text-xs text-slate-400 font-bold">总计应收费用</div>
                            <div class="summary-big-value font-black text-rose-700 mt-2 tabular-data">${fmtMoney(fixedReceivableTotal)}</div>
                        </div>
                        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div class="text-xs text-slate-400 font-bold">总计已收费用</div>
                            <div class="summary-big-value font-black text-emerald-700 mt-2 tabular-data">${fmtMoney(fixedReceivedTotal)}</div>
                            <div class="mt-3 flex items-start justify-between gap-3">
                                <div class="text-[11px] text-slate-400 summary-caption">已收费用比例</div>
                                <div class="summary-side-value text-slate-800 font-black tabular-data text-right">${fmtPercent(fixedCollectionRate)}</div>
                            </div>
                            ${window.renderMiniProgress(fixedCollectionRate, 'bg-gradient-to-r from-emerald-400 to-lime-400')}
                        </div>
                        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <div class="text-xs text-slate-400 font-bold">剩余未收费用</div>
                            <div class="summary-big-value font-black text-slate-800 mt-2 tabular-data">${fmtMoney(fixedUnpaidTotal)}</div>
                        </div>
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
                        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                            <div>
                                <div class="text-xs tracking-[0.2em] text-slate-400 font-bold">${window.escapeHtml(periodLabel)} 周期</div>
                                <div class="text-2xl font-black text-slate-900 mt-2">当前目标与收款概览</div>
                                <div class="text-sm text-slate-500 mt-2">右侧数据会随时间周期或指定月份切换，左侧固定总览保持不变。</div>
                            </div>
                            <div class="grid grid-cols-2 gap-3 min-w-[260px]">
                                <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                    <div class="text-xs font-bold text-slate-500">当前周期占总目标比例</div>
                                    <div class="text-2xl font-black text-slate-800 mt-2 tabular-data">${fmtPercent(currentCompletionRate)}</div>
                                </div>
                                <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                    <div class="text-xs font-bold text-slate-500">当前周期收款比例</div>
                                    <div class="text-2xl font-black text-emerald-700 mt-2 tabular-data">${fmtPercent(current.collection_rate)}</div>
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
                                    <div class="text-2xl font-black text-slate-800 mt-1 tabular-data">${fmtCount(currentPaidBooths)}</div>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                                ${renderMetricCard('预留展位数', fmtCount(current.reserved_booth_count), '已提交订单但未任何付款', 'text-slate-700')}
                                ${renderMetricCard('定金展位数', fmtCount(current.deposit_booth_count), '已发生部分收款', 'text-slate-700')}
                                ${renderMetricCard('全款展位数', fmtCount(current.full_paid_booth_count), '已完成全部收款', 'text-emerald-700')}
                                ${renderMetricCard('企业数', current.company_count || 0, '按当前周期统计', 'text-slate-800')}
                            </div>
                            <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                <div class="flex items-center justify-between text-xs font-bold text-slate-600">
                                    <span>当前周期占总目标比例</span>
                                    <span>${fmtPercent(currentCompletionRate)}</span>
                                </div>
                                ${window.renderMiniProgress(currentCompletionRate, 'bg-gradient-to-r from-slate-500 to-slate-700')}
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
                                    <div class="text-2xl font-black text-slate-800 mt-1 tabular-data">${fmtMoney(currentUnpaidTotal)}</div>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                                ${renderMetricCard('应收费用', fmtMoney(current.receivable_total), '随时间周期变化', 'text-rose-700')}
                                ${renderMetricCard('已收费用', fmtMoney(current.received_total), '当前周期实际收款', 'text-emerald-700')}
                                ${renderMetricCard('剩余未收费用', fmtMoney(currentUnpaidTotal), '当前周期应收减已收', 'text-slate-800')}
                            </div>
                            <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                <div class="flex items-center justify-between text-xs font-bold text-slate-600">
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

window.onHomeSalesListYearChange = function(yearValue) {
    window.activeHomeSalesListYear = yearValue ? String(yearValue) : window.getHomeDefaultYear();
    window.renderHomeSalesList(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
}

window.onHomeSalesListMonthChange = function(monthValue) {
    window.activeHomeSalesListMonthNumber = monthValue ? String(monthValue) : '';
    window.renderHomeSalesList(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
}

window.toggleHomeSalesListSort = function(sortKey) {
    if (window.homeSalesListSortKey === sortKey) {
        if (window.homeSalesListSortDirection === 'desc') {
            window.homeSalesListSortDirection = 'asc';
        } else {
            window.homeSalesListSortKey = '';
            window.homeSalesListSortDirection = 'asc';
        }
    } else {
        window.homeSalesListSortKey = sortKey;
        window.homeSalesListSortDirection = 'desc';
    }
    window.renderHomeSalesList(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
}

window.resetHomeSalesListSort = function() {
    window.homeSalesListSortKey = '';
    window.homeSalesListSortDirection = 'asc';
    window.renderHomeSalesList(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
}

window.getSortedHomeSalesListRows = function(rows) {
    const list = Array.isArray(rows) ? [...rows] : [];
    const sortKey = window.homeSalesListSortKey;
    if (!sortKey) return list;
    const direction = window.homeSalesListSortDirection === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
        if (sortKey === 'staff_name') {
            return String(a.staff_name || '').localeCompare(String(b.staff_name || ''), 'zh-CN') * direction;
        }
        const aValue = Number(a?.[sortKey] || 0);
        const bValue = Number(b?.[sortKey] || 0);
        if (aValue !== bValue) return (aValue - bValue) * direction;
        return String(a.staff_name || '').localeCompare(String(b.staff_name || ''), 'zh-CN');
    });
}

window.renderHomeSalesListSortHeader = function(label, sortKey, align = 'left') {
    const active = window.homeSalesListSortKey === sortKey;
    const icon = active
        ? (window.homeSalesListSortDirection === 'asc'
            ? '<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>')
        : '<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true"><path d="M5 6l3-3 3 3M11 10l-3 3-3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const justifyClass = align === 'right' ? 'justify-end' : 'justify-start';
    return `
        <button
            onclick="window.toggleHomeSalesListSort('${sortKey}')"
            class="inline-flex items-center gap-1 ${justifyClass} text-inherit font-bold hover:text-slate-900 transition"
            title="点击按${label}排序，再点切换升降序，第三次恢复默认顺序"
        >
            <span>${label}</span>
            <span class="${active ? 'text-blue-600' : 'text-slate-400'}">${icon}</span>
        </button>
    `;
}

window.getHomeSalesListViewModel = function(periodMap, metaMap = {}) {
    const activeId = window.homePeriodTabDefinitions.some((tab) => tab.id === window.activeHomeSalesListPeriod)
        ? window.activeHomeSalesListPeriod
        : 'total';
    window.activeHomeSalesListPeriod = activeId;
    const defaultYear = window.getHomeDefaultYear();
    const availableYears = window.getHomeAvailableYears();
    if (!availableYears.includes(String(window.activeHomeSalesListYear || ''))) {
        window.activeHomeSalesListYear = defaultYear;
    }
    const selectedYear = window.activeHomeSalesListYear ? String(window.activeHomeSalesListYear) : defaultYear;
    const selectedMonthNumber = window.activeHomeSalesListMonthNumber ? String(window.activeHomeSalesListMonthNumber) : '';
    const monthlyPeriodMap = window.homeDashboardData?.sales_list_monthly_periods || {};
    const monthlyMetaMap = window.homeDashboardData?.sales_list_monthly_meta || {};
    const rows = window.getSortedHomeSalesListRows(selectedMonthNumber
        ? (Array.isArray(monthlyPeriodMap?.[selectedYear]?.[selectedMonthNumber]) ? monthlyPeriodMap[selectedYear][selectedMonthNumber] : [])
        : (Array.isArray(periodMap?.[activeId]) ? periodMap[activeId] : []));
    const meta = selectedMonthNumber
        ? (monthlyMetaMap?.[selectedYear]?.[selectedMonthNumber] || {})
        : (metaMap?.[activeId] || {});
    const summaryYear = selectedYear || window.homeDashboardData?.sales_summary_year || '';
    const periodLabel = selectedMonthNumber
        ? `${selectedMonthNumber}月`
        : (window.homePeriodTabDefinitions.find((tab) => tab.id === activeId)?.label || '总计');
    const championTitle = selectedMonthNumber
        ? `${selectedMonthNumber}月冠军`
        : ({
            today: '今日冠军',
            week: '本周冠军',
            month: '本月冠军',
            total: '总冠军'
        }[activeId] || '冠军');
    const isTotalChampion = !selectedMonthNumber && activeId === 'total';
    const championDescription = selectedMonthNumber
        ? `${selectedMonthNumber}月内，新增收款展位数排名第一`
        : (isTotalChampion ? '累计收款展位数排名第一' : `${window.escapeHtml(periodLabel)}内，新增收款展位数排名第一`);
    const championMetricLabel = isTotalChampion ? '累计收款展位数' : '新增收款展位数';
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
    return {
        activeId,
        selectedYear,
        selectedMonthNumber,
        summaryYear,
        periodLabel,
        championTitle,
        championDescription,
        championMetricLabel,
        isTotalChampion,
        rows,
        meta,
        totals,
        totalProgressBooths,
        totalCompletionRate,
        totalCollectionRate
    };
}

window.getHomeSalesListExportContext = function(view) {
    const projectSelect = document.getElementById('global-project-select');
    const projectName = projectSelect?.options?.[projectSelect.selectedIndex]?.text || '未选择项目';
    const exportTime = new Date().toLocaleString('zh-CN', { hour12: false });
    const fmtCount = window.formatCompactCount;
    const fmtMoney = window.formatCurrency;
    const fmtPercent = window.formatCompactPercent;
    const sortSummary = window.homeSalesListSortKey
        ? `当前排序：${({
            target_booths: '目标展位数',
            reserved_booth_count: '预留展位数',
            deposit_booth_count: '定金展位数',
            full_paid_booth_count: '全款展位数',
            remaining_target: '剩余目标数',
            completion_rate: '完成比例',
            receivable_total: '总计应收费用',
            received_total: '总计已收费用',
            collection_rate: '已收费用占比'
        }[window.homeSalesListSortKey] || '自定义')} ${window.homeSalesListSortDirection === 'asc' ? '升序' : '降序'}`
        : '当前排序：默认人员顺序';
    return { projectName, exportTime, fmtCount, fmtMoney, fmtPercent, sortSummary };
}

window.buildHomeSalesListReportHtml = function(view) {
    const { projectName, exportTime, fmtCount, fmtMoney, fmtPercent, sortSummary } = window.getHomeSalesListExportContext(view);
    return `
        <style>
            @page { size: A4 landscape; margin: 5mm; }
            .report-wrap { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; }
            .report-shell { border:1px solid #e2e8f0; border-radius:16px; padding:10px 12px 12px; background:#fff; }
            .report-header { display:flex; justify-content:space-between; gap:12px; margin-bottom:8px; align-items:flex-start; }
            .report-title { font-size:18px; font-weight:800; letter-spacing:-0.02em; margin:0; }
            .report-subtitle { margin-top:4px; font-size:9px; color:#64748b; line-height:1.35; }
            .report-badges { display:flex; gap:5px; flex-wrap:wrap; margin-top:6px; }
            .badge { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:999px; padding:2px 7px; font-size:8px; font-weight:700; }
            .report-focus { display:grid; grid-template-columns:1.3fr 1fr 1fr; gap:6px; margin-bottom:6px; }
            .focus-card, .summary-card { border:1px solid #e2e8f0; border-radius:10px; background:#fff; padding:7px 9px; }
            .focus-label, .summary-label { font-size:8px; color:#64748b; font-weight:700; letter-spacing:.05em; }
            .focus-value { font-size:16px; font-weight:800; margin-top:2px; line-height:1.1; }
            .focus-note, .summary-note { font-size:9px; color:#475569; margin-top:3px; line-height:1.2; }
            .summary-grid { display:grid; grid-template-columns:repeat(8, minmax(0, 1fr)); gap:6px; margin-bottom:8px; }
            .summary-value { font-size:14px; font-weight:800; margin-top:2px; line-height:1.1; }
            table { width:100%; border-collapse:collapse; font-size:8.5px; }
            thead th { background:#f8fafc; color:#475569; font-weight:800; padding:5px 4px; border:1px solid #e2e8f0; text-align:right; white-space:nowrap; }
            thead th:first-child, tbody td:first-child { text-align:left; }
            tbody td { padding:4px; border:1px solid #e2e8f0; text-align:right; vertical-align:top; line-height:1.15; }
            tbody tr:nth-child(even) { background:#fcfdff; }
            tbody tr.total-row { background:#f1f5f9; font-weight:800; }
            .num { font-variant-numeric: tabular-nums; }
        </style>
        <div class="report-wrap">
            <div class="report-shell">
                <div class="report-header">
                    <div>
                        <h1 class="report-title">业务员销售情况全景报告</h1>
                        <div class="report-subtitle">
                            项目：${window.escapeHtml(projectName)} ｜ 范围：${window.escapeHtml(view.periodLabel)}${view.selectedMonthNumber ? `（${window.escapeHtml(String(view.summaryYear || ''))}年）` : ''} ｜ 导出时间：${window.escapeHtml(exportTime)} ｜ 导出人：${window.escapeHtml(window.currentUser?.name || '')}
                        </div>
                        <div class="report-badges">
                            <span class="badge">${window.escapeHtml(view.championTitle)}</span>
                            <span class="badge">${window.escapeHtml(sortSummary)}</span>
                        </div>
                    </div>
                </div>
                <div class="report-focus">
                    <div class="focus-card">
                        <div class="focus-label">${window.escapeHtml(view.championTitle)}</div>
                        <div class="focus-value">${window.escapeHtml(view.meta.champion_name || '暂无')}</div>
                        <div class="focus-note">${window.escapeHtml(view.championDescription)}</div>
                    </div>
                    <div class="focus-card">
                        <div class="focus-label">${window.escapeHtml(view.championMetricLabel)}</div>
                        <div class="focus-value num">${fmtCount(view.meta.champion_booth_count || 0)}</div>
                        <div class="focus-note">当前页面冠军口径</div>
                    </div>
                    <div class="focus-card">
                        <div class="focus-label">总计已收费用</div>
                        <div class="focus-value num">${fmtMoney(view.totals.received)}</div>
                        <div class="focus-note">当前表格汇总</div>
                    </div>
                </div>
                <div class="summary-grid">
                    <div class="summary-card"><div class="summary-label">目标展位</div><div class="summary-value num">${fmtCount(view.totals.target)}</div></div>
                    <div class="summary-card"><div class="summary-label">预留展位</div><div class="summary-value num">${fmtCount(view.totals.reservedBooths)}</div></div>
                    <div class="summary-card"><div class="summary-label">定金展位</div><div class="summary-value num">${fmtCount(view.totals.depositBooths)}</div></div>
                    <div class="summary-card"><div class="summary-label">全款展位</div><div class="summary-value num">${fmtCount(view.totals.fullPaidBooths)}</div></div>
                    <div class="summary-card"><div class="summary-label">剩余目标</div><div class="summary-value num">${fmtCount(view.totals.remainingTarget)}</div></div>
                    <div class="summary-card"><div class="summary-label">总计应收费用</div><div class="summary-value num">${fmtMoney(view.totals.receivable)}</div></div>
                    <div class="summary-card"><div class="summary-label">完成比例</div><div class="summary-value num">${fmtPercent(view.totalCompletionRate)}</div></div>
                    <div class="summary-card"><div class="summary-label">已收费用占比</div><div class="summary-value num">${fmtPercent(view.totalCollectionRate)}</div></div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>业务员</th>
                            <th>目标展位数</th>
                            <th>预留展位数</th>
                            <th>定金展位数</th>
                            <th>全款展位数</th>
                            <th>剩余目标数</th>
                            <th>完成比例</th>
                            <th>总计应收费用</th>
                            <th>总计已收费用</th>
                            <th>已收费用占比</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${view.rows.map((row) => `
                            <tr>
                                <td>${window.escapeHtml(row.staff_name || '')}</td>
                                <td class="num">${fmtCount(row.target_booths || 0)}</td>
                                <td class="num">${fmtCount(row.reserved_booth_count || 0)}</td>
                                <td class="num">${fmtCount(row.deposit_booth_count || 0)}</td>
                                <td class="num">${fmtCount(row.full_paid_booth_count || 0)}</td>
                                <td class="num">${fmtCount(row.remaining_target || 0)}</td>
                                <td class="num">${fmtPercent(row.completion_rate || 0)}</td>
                                <td class="num">${fmtMoney(row.receivable_total || 0)}</td>
                                <td class="num">${fmtMoney(row.received_total || 0)}</td>
                                <td class="num">${fmtPercent(row.collection_rate || 0)}</td>
                            </tr>
                        `).join('')}
                        <tr class="total-row">
                            <td>总计</td>
                            <td class="num">${fmtCount(view.totals.target)}</td>
                            <td class="num">${fmtCount(view.totals.reservedBooths)}</td>
                            <td class="num">${fmtCount(view.totals.depositBooths)}</td>
                            <td class="num">${fmtCount(view.totals.fullPaidBooths)}</td>
                            <td class="num">${fmtCount(view.totals.remainingTarget)}</td>
                            <td class="num">${fmtPercent(view.totalCompletionRate)}</td>
                            <td class="num">${fmtMoney(view.totals.receivable)}</td>
                            <td class="num">${fmtMoney(view.totals.received)}</td>
                            <td class="num">${fmtPercent(view.totalCollectionRate)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.exportHomeSalesListReport = function() {
    if (!window.isSuperAdmin?.(window.currentUser)) return;
    const view = window.getHomeSalesListViewModel(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
    window.openPrintModal({
        title: 'A4报告预览',
        contentHtml: window.buildHomeSalesListReportHtml(view),
        shellClass: 'bg-white shadow-2xl w-full max-w-7xl flex flex-col max-h-[95vh]',
        contentClass: 'p-5 bg-white text-black overflow-y-auto flex-1',
        primaryText: '打印A4报告',
        primaryAction: () => window.print()
    });
}

window.escapeSvgText = function(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.buildHomeSalesListLongImageSvg = function(view) {
    const { projectName, exportTime, fmtCount, fmtMoney, fmtPercent } = window.getHomeSalesListExportContext(view);
    const width = 1640;
    const padding = 34;
    const tableStartY = 248;
    const rowHeight = 34;
    const headerHeight = 38;
    const footerHeight = 42;
    const totalRows = view.rows.length + 1;
    const height = tableStartY + headerHeight + (totalRows * rowHeight) + footerHeight;
    const columns = [
        { label: '业务员', key: 'staff_name', width: 190, align: 'left' },
        { label: '目标展位数', key: 'target_booths', width: 120 },
        { label: '预留展位数', key: 'reserved_booth_count', width: 120 },
        { label: '定金展位数', key: 'deposit_booth_count', width: 120 },
        { label: '全款展位数', key: 'full_paid_booth_count', width: 120 },
        { label: '剩余目标数', key: 'remaining_target', width: 120 },
        { label: '完成比例', key: 'completion_rate', width: 110 },
        { label: '总计应收费用', key: 'receivable_total', width: 160 },
        { label: '总计已收费用', key: 'received_total', width: 160 },
        { label: '已收费用占比', key: 'collection_rate', width: 120 }
    ];
    let xCursor = padding;
    const columnPositions = columns.map((col) => {
        const currentX = xCursor;
        xCursor += col.width;
        return { ...col, x: currentX };
    });
    const rows = [
        ...view.rows.map((row) => ({
            staff_name: row.staff_name || '',
            target_booths: fmtCount(row.target_booths || 0),
            reserved_booth_count: fmtCount(row.reserved_booth_count || 0),
            deposit_booth_count: fmtCount(row.deposit_booth_count || 0),
            full_paid_booth_count: fmtCount(row.full_paid_booth_count || 0),
            remaining_target: fmtCount(row.remaining_target || 0),
            completion_rate: fmtPercent(row.completion_rate || 0),
            receivable_total: fmtMoney(row.receivable_total || 0),
            received_total: fmtMoney(row.received_total || 0),
            collection_rate: fmtPercent(row.collection_rate || 0)
        })),
        {
            staff_name: '总计',
            target_booths: fmtCount(view.totals.target),
            reserved_booth_count: fmtCount(view.totals.reservedBooths),
            deposit_booth_count: fmtCount(view.totals.depositBooths),
            full_paid_booth_count: fmtCount(view.totals.fullPaidBooths),
            remaining_target: fmtCount(view.totals.remainingTarget),
            completion_rate: fmtPercent(view.totalCompletionRate),
            receivable_total: fmtMoney(view.totals.receivable),
            received_total: fmtMoney(view.totals.received),
            collection_rate: fmtPercent(view.totalCollectionRate),
            isTotal: true
        }
    ];
    const metricCards = [
        ['冠军', view.meta.champion_name || '暂无'],
        [view.championMetricLabel, fmtCount(view.meta.champion_booth_count || 0)],
        ['目标展位', fmtCount(view.totals.target)],
        ['总计应收', fmtMoney(view.totals.receivable)],
        ['总计已收', fmtMoney(view.totals.received)],
        ['完成比例', fmtPercent(view.totalCompletionRate)],
        ['已收占比', fmtPercent(view.totalCollectionRate)]
    ];
    const cardWidth = 212;
    const cardGap = 12;
    const cardSvgs = metricCards.map((card, index) => {
        const x = padding + (index * (cardWidth + cardGap));
        return `
            <g transform="translate(${x},118)">
                <rect x="0" y="0" width="${cardWidth}" height="78" rx="14" fill="#ffffff" stroke="#e2e8f0"/>
                <text x="16" y="26" font-size="11" font-weight="700" fill="#64748b">${window.escapeSvgText(card[0])}</text>
                <text x="16" y="56" font-size="24" font-weight="800" fill="#0f172a">${window.escapeSvgText(card[1])}</text>
            </g>
        `;
    }).join('');
    const tableHeaderSvg = columnPositions.map((col) => {
        const textX = col.align === 'left' ? col.x + 10 : col.x + col.width - 10;
        const anchor = col.align === 'left' ? 'start' : 'end';
        return `
            <rect x="${col.x}" y="${tableStartY}" width="${col.width}" height="${headerHeight}" fill="#f8fafc" stroke="#e2e8f0"/>
            <text x="${textX}" y="${tableStartY + 24}" font-size="12" font-weight="800" text-anchor="${anchor}" fill="#475569">${window.escapeSvgText(col.label)}</text>
        `;
    }).join('');
    const tableRowsSvg = rows.map((row, rowIndex) => {
        const y = tableStartY + headerHeight + (rowIndex * rowHeight);
        const rowFill = row.isTotal ? '#f1f5f9' : (rowIndex % 2 === 0 ? '#ffffff' : '#fcfdff');
        const cells = columnPositions.map((col) => {
            const rawValue = row[col.key] ?? '';
            const textX = col.align === 'left' ? col.x + 10 : col.x + col.width - 10;
            const anchor = col.align === 'left' ? 'start' : 'end';
            return `
                <rect x="${col.x}" y="${y}" width="${col.width}" height="${rowHeight}" fill="${rowFill}" stroke="#e2e8f0"/>
                <text x="${textX}" y="${y + 22}" font-size="12" font-weight="${row.isTotal ? '800' : (col.key === 'staff_name' ? '700' : '600')}" text-anchor="${anchor}" fill="${col.key === 'received_total' ? '#047857' : (col.key === 'receivable_total' ? '#be123c' : '#0f172a')}">${window.escapeSvgText(rawValue)}</text>
            `;
        }).join('');
        return cells;
    }).join('');
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <rect width="${width}" height="${height}" fill="#f8fafc"/>
            <text x="${padding}" y="44" font-size="28" font-weight="800" fill="#0f172a">业务员销售情况全景</text>
            <text x="${padding}" y="68" font-size="13" font-weight="600" fill="#64748b">项目：${window.escapeSvgText(projectName)} ｜ 范围：${window.escapeSvgText(view.periodLabel)}${view.selectedMonthNumber ? `（${window.escapeSvgText(String(view.summaryYear || ''))}年）` : ''}</text>
            <text x="${padding}" y="90" font-size="13" font-weight="600" fill="#64748b">导出时间：${window.escapeSvgText(exportTime)} ｜ 导出人：${window.escapeSvgText(window.currentUser?.name || '')}</text>
            ${cardSvgs}
            ${tableHeaderSvg}
            ${tableRowsSvg}
        </svg>
    `.trim();
}

window.downloadHomeSalesListPng = function(svgText, filenameBase) {
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(svgUrl);
        canvas.toBlob((blob) => {
            if (!blob) return;
            const pngUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = pngUrl;
            link.download = `${filenameBase}.png`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(pngUrl);
        }, 'image/png');
    };
    img.src = svgUrl;
}

window.exportHomeSalesListLongImage = function() {
    if (!window.isSuperAdmin?.(window.currentUser)) return;
    const view = window.getHomeSalesListViewModel(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
    const svg = window.buildHomeSalesListLongImageSvg(view);
    window.openPrintModal({
        title: '长图预览',
        contentHtml: `
            <div class="space-y-3">
                <div class="text-sm text-slate-500">下方为当前页面视角生成的长图预览，确认后可导出为 PNG。</div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 overflow-auto">
                    <img id="home-sales-list-long-image-preview" alt="业务员销售情况全景长图预览" class="w-full h-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                </div>
            </div>
        `,
        shellClass: 'bg-white shadow-2xl w-full max-w-7xl flex flex-col max-h-[95vh]',
        contentClass: 'p-5 bg-white text-black overflow-y-auto flex-1',
        primaryText: '下载PNG',
        primaryAction: () => {
            window.downloadHomeSalesListPng(svg, `业务员销售情况全景-${view.periodLabel}-${new Date().toISOString().slice(0, 10)}`);
        }
    });
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    currentPrintObjectUrl = URL.createObjectURL(blob);
    const previewEl = document.getElementById('home-sales-list-long-image-preview');
    if (previewEl) {
        previewEl.src = currentPrintObjectUrl;
    }
}

window.exportHomeSalesListExcel = function() {
    if (!window.isSuperAdmin?.(window.currentUser)) return;
    const view = window.getHomeSalesListViewModel(
        window.homeDashboardData?.sales_list_periods || {},
        window.homeDashboardData?.sales_list_meta || {}
    );
    const { projectName, exportTime, fmtCount, fmtMoney, fmtPercent, sortSummary } = window.getHomeSalesListExportContext(view);
    const escapeCell = (value) => window.escapeHtml(String(value ?? ''));
    const rowsHtml = view.rows.map((row) => `
        <tr>
            <td>${escapeCell(row.staff_name || '')}</td>
            <td>${escapeCell(fmtCount(row.target_booths || 0))}</td>
            <td>${escapeCell(fmtCount(row.reserved_booth_count || 0))}</td>
            <td>${escapeCell(fmtCount(row.deposit_booth_count || 0))}</td>
            <td>${escapeCell(fmtCount(row.full_paid_booth_count || 0))}</td>
            <td>${escapeCell(fmtCount(row.remaining_target || 0))}</td>
            <td>${escapeCell(fmtPercent(row.completion_rate || 0))}</td>
            <td>${escapeCell(fmtMoney(row.receivable_total || 0))}</td>
            <td>${escapeCell(fmtMoney(row.received_total || 0))}</td>
            <td>${escapeCell(fmtPercent(row.collection_rate || 0))}</td>
        </tr>
    `).join('');
    const workbookHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:x="urn:schemas-microsoft-com:office:excel"
              xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; }
                table { border-collapse: collapse; width: 100%; }
                td, th { border: 1px solid #d7dee7; padding: 6px 8px; font-size: 12px; }
                th { background: #f3f6fa; font-weight: 700; }
                .meta-label { background: #f8fafc; width: 120px; font-weight: 700; }
                .total-row td { background: #eef3f8; font-weight: 700; }
            </style>
        </head>
        <body>
            <table>
                <tr><td class="meta-label">报表</td><td colspan="9">业务员销售情况全景</td></tr>
                <tr><td class="meta-label">项目</td><td colspan="9">${escapeCell(projectName)}</td></tr>
                <tr><td class="meta-label">导出范围</td><td colspan="9">${escapeCell(`${view.periodLabel}${view.selectedMonthNumber ? `（${String(view.summaryYear || '')}年）` : ''}`)}</td></tr>
                <tr><td class="meta-label">导出时间</td><td colspan="9">${escapeCell(exportTime)}</td></tr>
                <tr><td class="meta-label">导出人</td><td colspan="9">${escapeCell(window.currentUser?.name || '')}</td></tr>
                <tr><td class="meta-label">冠军</td><td colspan="9">${escapeCell(view.meta.champion_name || '暂无')}</td></tr>
                <tr><td class="meta-label">冠军口径</td><td colspan="9">${escapeCell(view.championMetricLabel)}</td></tr>
                <tr><td class="meta-label">排序</td><td colspan="9">${escapeCell(sortSummary)}</td></tr>
            </table>
            <br />
            <table>
                <thead>
                    <tr>
                        <th>业务员</th>
                        <th>目标展位数</th>
                        <th>预留展位数</th>
                        <th>定金展位数</th>
                        <th>全款展位数</th>
                        <th>剩余目标数</th>
                        <th>完成比例</th>
                        <th>总计应收费用</th>
                        <th>总计已收费用</th>
                        <th>已收费用占比</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    <tr class="total-row">
                        <td>总计</td>
                        <td>${escapeCell(fmtCount(view.totals.target))}</td>
                        <td>${escapeCell(fmtCount(view.totals.reservedBooths))}</td>
                        <td>${escapeCell(fmtCount(view.totals.depositBooths))}</td>
                        <td>${escapeCell(fmtCount(view.totals.fullPaidBooths))}</td>
                        <td>${escapeCell(fmtCount(view.totals.remainingTarget))}</td>
                        <td>${escapeCell(fmtPercent(view.totalCompletionRate))}</td>
                        <td>${escapeCell(fmtMoney(view.totals.receivable))}</td>
                        <td>${escapeCell(fmtMoney(view.totals.received))}</td>
                        <td>${escapeCell(fmtPercent(view.totalCollectionRate))}</td>
                    </tr>
                </tbody>
            </table>
        </body>
        </html>
    `;
    const blob = new Blob(['\uFEFF', workbookHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `业务员销售情况全景-${view.periodLabel}-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

window.renderHomeSalesList = function(periodMap, metaMap = {}) {
    const container = document.getElementById('home-sales-list');
    if (!container) return;

    const view = window.getHomeSalesListViewModel(periodMap, metaMap);
    const { activeId, selectedYear, selectedMonthNumber, summaryYear, periodLabel, championTitle, championDescription, championMetricLabel, isTotalChampion, rows, meta, totals, totalProgressBooths, totalCompletionRate, totalCollectionRate } = view;

    if (!rows || rows.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
                <div class="text-sm text-slate-500">切换周期后，业务员推进表和销售冠军都会一起变化。</div>
                <div class="flex flex-wrap gap-2">
                    ${window.renderHomeInnerTabs(activeId, 'window.switchHomeSalesListPeriod')}
                    ${window.renderHomeMonthSelect('home-sales-list', selectedYear, selectedMonthNumber, 'window.onHomeSalesListYearChange', 'window.onHomeSalesListMonthChange')}
                    ${window.isSuperAdmin?.(window.currentUser) ? `<button onclick="window.exportHomeSalesListReport()" class="btn-outline px-3 py-1.5 text-xs font-bold">导出A4报告</button><button onclick="window.exportHomeSalesListLongImage()" class="btn-outline px-3 py-1.5 text-xs font-bold">预览长图</button><button onclick="window.exportHomeSalesListExcel()" class="btn-outline px-3 py-1.5 text-xs font-bold">导出Excel</button>` : ''}
                </div>
            </div>
            <div class="text-sm text-gray-500 bg-slate-50 border border-slate-200 rounded-2xl p-5">${window.escapeHtml(periodLabel)} 范围暂无可展示的业务员销售数据。</div>
        `;
        return;
    }

    const fmtCount = window.formatCompactCount;
    const fmtMoney = window.formatCurrency;
    const fmtPercent = window.formatCompactPercent;

    container.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
            <div class="text-sm text-slate-500">切换周期或指定月份后，业务员推进表和销售冠军都会一起变化。</div>
            <div class="flex flex-wrap gap-2">
                ${window.renderHomeInnerTabs(activeId, 'window.switchHomeSalesListPeriod')}
                ${window.renderHomeMonthSelect('home-sales-list', selectedYear, selectedMonthNumber, 'window.onHomeSalesListYearChange', 'window.onHomeSalesListMonthChange')}
                ${window.homeSalesListSortKey ? `<button onclick="window.resetHomeSalesListSort()" class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-100">恢复默认顺序</button>` : ''}
                ${window.isSuperAdmin?.(window.currentUser) ? `<button onclick="window.exportHomeSalesListReport()" class="btn-outline px-3 py-1.5 text-xs font-bold">导出A4报告</button><button onclick="window.exportHomeSalesListLongImage()" class="btn-outline px-3 py-1.5 text-xs font-bold">预览长图</button><button onclick="window.exportHomeSalesListExcel()" class="btn-outline px-3 py-1.5 text-xs font-bold">导出Excel</button>` : ''}
            </div>
        </div>
        <div class="mb-4 rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div class="flex items-center gap-4">
                    <div class="h-14 w-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                        <svg viewBox="0 0 64 64" class="w-8 h-8" aria-hidden="true">
                            <defs>
                                <linearGradient id="champion-crown-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stop-color="#60a5fa"></stop>
                                    <stop offset="100%" stop-color="#2563eb"></stop>
                                </linearGradient>
                            </defs>
                            <path d="M14 45h36l-4-23-11 10-7-14-7 14-11-10-4 23Z" fill="url(#champion-crown-gradient)" stroke="#60a5fa" stroke-width="2" stroke-linejoin="round"></path>
                            <rect x="14" y="45" width="36" height="7" rx="3.5" fill="#2563eb"></rect>
                            <circle cx="21" cy="19" r="4" fill="#dbeafe"></circle>
                            <circle cx="32" cy="13" r="4" fill="#dbeafe"></circle>
                            <circle cx="43" cy="19" r="4" fill="#dbeafe"></circle>
                        </svg>
                    </div>
                    <div>
                        <div class="text-xs tracking-[0.24em] text-blue-600 font-bold">${championTitle}</div>
                        <div class="text-2xl font-black text-slate-900 mt-1">${window.escapeHtml(meta.champion_name || '暂无')}</div>
                        <div class="text-sm text-slate-500 mt-1">${championDescription}</div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3 min-w-[260px]">
                    <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div class="text-[11px] tracking-wide text-slate-400 font-bold">${championMetricLabel}</div>
                        <div class="text-2xl font-black text-slate-900 mt-2 tabular-data">${fmtCount(meta.champion_booth_count || 0)}</div>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div class="text-[11px] tracking-wide text-slate-400 font-bold">冠军说明</div>
                        <div class="text-sm font-bold text-slate-700 mt-2 leading-6">${isTotalChampion ? '统计累计已发生收款的展位数' : '首次收款发生在当前周期的新增企业'}</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="border border-slate-200 rounded-3xl overflow-hidden">
            <div class="overflow-auto max-h-[70vh]">
                <table class="w-full text-[13px] min-w-[1450px]">
                    <thead class="bg-slate-100 text-slate-600 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th class="text-left px-3 py-2.5 font-bold">业务员</th>
                            <th class="text-right px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('目标展位数', 'target_booths', 'right')}</th>
                            <th class="text-right px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('预留展位数', 'reserved_booth_count', 'right')}</th>
                            <th class="text-right px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('定金展位数', 'deposit_booth_count', 'right')}</th>
                            <th class="text-right px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('全款展位数', 'full_paid_booth_count', 'right')}</th>
                            <th class="text-right px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('剩余目标数', 'remaining_target', 'right')}</th>
                            <th class="text-left px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('完成比例', 'completion_rate')}</th>
                            <th class="text-right px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('总计应收费用', 'receivable_total', 'right')}</th>
                            <th class="text-right px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('总计已收费用', 'received_total', 'right')}</th>
                            <th class="text-left px-3 py-2.5 font-bold">${window.renderHomeSalesListSortHeader('已收费用占比', 'collection_rate')}</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white">
                        ${rows.map((row) => {
                            const completionRate = Number(row.completion_rate || 0);
                            const collectionRate = Number(row.collection_rate || 0);
                            const progressedBooths = Number(row.reserved_booth_count || 0) + Number(row.deposit_booth_count || 0) + Number(row.full_paid_booth_count || 0);
                            return `
                                <tr>
                                    <td class="px-3 py-2.5">
                                        <div class="font-black text-slate-800 leading-5">${window.escapeHtml(row.staff_name)}</div>
                                    </td>
                                    <td class="px-3 py-2.5 text-right font-bold text-slate-800 tabular-data">${Number(row.target_booths || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-3 py-2.5 text-right font-bold text-slate-600 tabular-data">${Number(row.reserved_booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-3 py-2.5 text-right font-bold text-slate-700 tabular-data">${Number(row.deposit_booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-3 py-2.5 text-right font-bold text-emerald-700 tabular-data">${Number(row.full_paid_booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-3 py-2.5 text-right font-bold text-slate-500 tabular-data">${Number(row.remaining_target || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                    <td class="px-3 py-2.5 min-w-[170px]">
                                        <div class="flex items-center justify-between text-[11px] font-bold text-slate-700 leading-4">
                                            <span>${completionRate.toFixed(1).replace(/\.0$/, '')}%</span>
                                            <span class="text-slate-400 font-semibold">${fmtCount(progressedBooths)}/${fmtCount(row.target_booths)}</span>
                                        </div>
                                        <div class="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                            <div class="h-full rounded-full bg-gradient-to-r from-slate-500 to-slate-700" style="width: ${Math.max(0, Math.min(Number(completionRate || 0), 100))}%"></div>
                                        </div>
                                    </td>
                                    <td class="px-3 py-2.5 text-right font-bold text-rose-700 tabular-data">${window.formatCurrency(row.receivable_total || 0)}</td>
                                    <td class="px-3 py-2.5 text-right font-bold text-emerald-700 tabular-data">${window.formatCurrency(row.received_total || 0)}</td>
                                    <td class="px-3 py-2.5 min-w-[170px]">
                                        <div class="flex items-center justify-between text-[11px] font-bold text-slate-700 leading-4">
                                            <span>${collectionRate.toFixed(1).replace(/\.0$/, '')}%</span>
                                            <span class="text-slate-400 font-semibold">${fmtMoney(row.received_total || 0)}</span>
                                        </div>
                                        <div class="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                            <div class="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style="width: ${Math.max(0, Math.min(Number(collectionRate || 0), 100))}%"></div>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                        <tr class="bg-slate-100 border-t-2 border-slate-300 shadow-inner">
                            <td class="px-3 py-3 font-black text-slate-950">总计</td>
                            <td class="px-3 py-3 text-right font-black text-slate-800 tabular-data">${fmtCount(totals.target)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-600 tabular-data">${fmtCount(totals.reservedBooths)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700 tabular-data">${fmtCount(totals.depositBooths)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700 tabular-data">${fmtCount(totals.fullPaidBooths)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-500 tabular-data">${fmtCount(totals.remainingTarget)}</td>
                            <td class="px-3 py-3 min-w-[170px]">
                                <div class="flex items-center justify-between text-[11px] font-bold text-slate-700 leading-4">
                                    <span>${fmtPercent(totalCompletionRate)}</span>
                                    <span class="text-slate-400 font-semibold">${fmtCount(totalProgressBooths)}/${fmtCount(totals.target)}</span>
                                </div>
                                <div class="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                    <div class="h-full rounded-full bg-gradient-to-r from-slate-500 to-slate-700" style="width: ${Math.max(0, Math.min(Number(totalCompletionRate || 0), 100))}%"></div>
                                </div>
                            </td>
                            <td class="px-3 py-3 text-right font-black text-rose-700 tabular-data">${fmtMoney(totals.receivable)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700 tabular-data">${fmtMoney(totals.received)}</td>
                            <td class="px-3 py-3 min-w-[170px]">
                                <div class="flex items-center justify-between text-[11px] font-bold text-slate-700 leading-4">
                                    <span>${fmtPercent(totalCollectionRate)}</span>
                                    <span class="text-slate-400 font-semibold">${fmtMoney(totals.received)}</span>
                                </div>
                                <div class="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                    <div class="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style="width: ${Math.max(0, Math.min(Number(totalCollectionRate || 0), 100))}%"></div>
                                </div>
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
                        <div class="bg-white rounded-xl border border-slate-200 px-3 py-2"><div class="text-slate-400">企业占比</div><div class="font-black text-slate-700 mt-1 tabular-data">${Number(section.summary.company_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</div></div>
                        <div class="bg-white rounded-xl border border-slate-200 px-3 py-2"><div class="text-slate-400">展位占比</div><div class="font-black text-slate-700 mt-1 tabular-data">${Number(section.summary.booth_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</div></div>
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
                                <td class="px-5 py-3 text-right text-slate-700 tabular-data">${row.company_count || 0}</td>
                                <td class="px-5 py-3 text-right text-slate-700 tabular-data">${Number(row.booth_count || 0).toFixed(2).replace(/\.00$/, '')}</td>
                                <td class="px-5 py-3 text-right text-slate-700 font-bold tabular-data">${Number(row.company_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</td>
                                <td class="px-5 py-3 text-right text-slate-700 font-bold tabular-data">${Number(row.booth_ratio || 0).toFixed(1).replace(/\.0$/, '')}%</td>
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
    const fmtCount = window.formatCompactCount;
    const fmtMoney = window.formatCurrency;
    const fmtPercent = window.formatCompactPercent;

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
                                <td class="px-3 py-3 text-right font-bold text-slate-800 tabular-data">${fmtCount(hall.configured_total_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-700 tabular-data">${fmtCount(hall.configured_standard_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-600 tabular-data">${fmtCount(hall.configured_ground_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-emerald-700 tabular-data">${fmtCount(hall.received_standard_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-emerald-600 tabular-data">${fmtCount(hall.received_ground_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-700 tabular-data">${fmtPercent(hall.received_booth_rate)}</td>
                                <td class="px-3 py-3 text-right font-bold text-amber-700 tabular-data">${fmtCount(hall.remaining_unsold_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-700 tabular-data">${hall.received_company_count || 0}</td>
                            </tr>
                        `).join('')}
                        <tr class="bg-slate-100 border-t-2 border-slate-300">
                            <td class="px-3 py-3 font-black text-slate-950 text-base">总计</td>
                            <td class="px-3 py-3 text-right font-black text-slate-800 tabular-data">${fmtCount(totals.configuredTotal)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700 tabular-data">${fmtCount(totals.configuredStandard)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-600 tabular-data">${fmtCount(totals.configuredGround)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700 tabular-data">${fmtCount(totals.receivedStandard)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-600 tabular-data">${fmtCount(totals.receivedGround)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700 tabular-data">${fmtPercent(totalReceivedRate)}</td>
                            <td class="px-3 py-3 text-right font-black text-amber-700 tabular-data">${fmtCount(totals.remainingUnsold)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700 tabular-data">${totals.receivedCompanies}</td>
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
                                <td class="px-3 py-3 text-right font-bold text-slate-800 tabular-data">${fmtCount(hall.configured_total_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-700 tabular-data">${fmtCount(hall.charged_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-rose-700 tabular-data">${fmtMoney(hall.receivable_booth_fee)}</td>
                                <td class="px-3 py-3 text-right font-bold text-emerald-700 tabular-data">${fmtMoney(hall.received_booth_fee)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-700 tabular-data">${fmtPercent(hall.collection_rate)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-600 tabular-data">${fmtCount(hall.free_booth_count)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-700 tabular-data">${fmtMoney(hall.charged_avg_unit_price)}</td>
                                <td class="px-3 py-3 text-right font-bold text-slate-600 tabular-data">${fmtMoney(hall.overall_avg_unit_price)}</td>
                            </tr>
                        `).join('')}
                        <tr class="bg-slate-100 border-t-2 border-slate-300">
                            <td class="px-3 py-3 font-black text-slate-950 text-base">总计</td>
                            <td class="px-3 py-3 text-right font-black text-slate-800 tabular-data">${fmtCount(totals.configuredTotal)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700 tabular-data">${fmtCount(totals.chargedBooths)}</td>
                            <td class="px-3 py-3 text-right font-black text-rose-700 tabular-data">${fmtMoney(totals.receivableBoothFee)}</td>
                            <td class="px-3 py-3 text-right font-black text-emerald-700 tabular-data">${fmtMoney(totals.receivedBoothFee)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700 tabular-data">${fmtPercent(totalCollectionRate)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-600 tabular-data">${fmtCount(totals.freeBooths)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-700 tabular-data">${fmtMoney(totalChargedAvg)}</td>
                            <td class="px-3 py-3 text-right font-black text-slate-600 tabular-data">${fmtMoney(totalOverallAvg)}</td>
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
        const res = await window.ensureApiSuccess(
            await window.apiFetch(`/api/home-dashboard?projectId=${pid}`),
            '首页数据加载失败'
        );
        const data = await res.json();
        window.homeDashboardData = data;
        const defaultYear = window.getHomeDefaultYear();
        if (!window.activeHomeSalesSummaryYear) window.activeHomeSalesSummaryYear = defaultYear;
        if (!window.activeHomeSalesListYear) window.activeHomeSalesListYear = defaultYear;
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
