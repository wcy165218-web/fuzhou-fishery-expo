// ================= js/finance.js =================
window.isOwnOrder = function(order) {
    return order && order.sales_name === window.currentUser.name;
}

window.canViewSensitiveOrderFields = function(order) {
    return !!order && (window.isSuperAdmin() || window.isOwnOrder(order));
}

window.canManageOrder = function(order) {
    return !!order && (window.currentUser.role === 'admin' || Number(order.can_manage) === 1);
}

window.getOverpaidAmount = function(order) {
    if (!order) return 0;
    const explicit = Number(order.overpaid_amount || 0);
    if (explicit > 0) return explicit;
    return Math.max(0, Number(order.paid_amount || 0) - Number(order.total_amount || 0));
}

window.hasOverpaymentIssue = function(order) {
    return window.getOverpaidAmount(order) > 0.01;
}

window.canHandleOverpayment = function(order) {
    return !!order && (window.isSuperAdmin() || window.isOwnOrder(order));
}

window.getOverpaymentStatusLabel = function(order) {
    switch (order?.overpayment_status) {
        case 'resolved_as_fx_diff':
            return '已按汇率差确认';
        case 'on_hold':
            return '已暂挂待核销';
        case 'resolved_by_fee_update':
            return '已通过补录应收解除';
        default:
            return '超收异常待处理';
    }
}

window.formatOverpaymentMeta = function(order) {
    const handledBy = order?.overpayment_handled_by || '';
    const handledAt = order?.overpayment_handled_at || '';
    const note = String(order?.overpayment_note || '').trim();
    if (order?.overpayment_status === 'resolved_as_fx_diff') {
        return `${handledBy ? `处理人：${handledBy}` : '已确认汇率差'}${handledAt ? ` | 时间：${handledAt}` : ''}${note ? ` | 说明：${note}` : ''}`;
    }
    if (order?.overpayment_status === 'on_hold') {
        return `${handledBy ? `处理人：${handledBy}` : '已暂挂处理'}${handledAt ? ` | 时间：${handledAt}` : ''}${note ? ` | 说明：${note}` : ''}`;
    }
    if (order?.overpayment_status === 'resolved_by_fee_update') {
        return '已通过补录其他应收自动解除超收异常。';
    }
    return '请业务员尽快处理：补录应收、确认汇率差或暂挂说明。';
}

window.buildOverpaymentActionsHtml = function(order, context = 'detail') {
    if (!window.canHandleOverpayment(order)) {
        return '<span class="badge-readonly">待所属业务员处理</span>';
    }
    const safeOrderId = JSON.stringify(String(order.id));
    const adjustBtn = `<button onclick='window.openOverpaymentModalById(${safeOrderId}, "fx_diff", "${context}")' class="btn-secondary px-3 py-1.5 text-xs shadow-sm">去处理</button>`;
    if (order?.overpayment_status === 'resolved_as_fx_diff' || order?.overpayment_status === 'on_hold') {
        return `${adjustBtn}<button onclick='window.openOverpaymentModalById(${safeOrderId}, ${JSON.stringify(order.overpayment_reason === 'on_hold' ? 'on_hold' : 'fx_diff')}, "${context}")' class="btn-soft-primary px-3 py-1.5 text-xs'>调整说明</button>`;
    }
    return `
        <button onclick='window.openFinanceDirectById(${safeOrderId}, "adj")' class="btn-soft-amber px-3 py-1.5 text-xs shadow-sm">去订单变更补录应收</button>
        <button onclick='window.openOverpaymentModalById(${safeOrderId}, "fx_diff", "${context}")' class="btn-soft-primary px-3 py-1.5 text-xs'>确认汇率差</button>
        <button onclick='window.openOverpaymentModalById(${safeOrderId}, "on_hold", "${context}")' class="btn-secondary px-3 py-1.5 text-xs'>填写说明并暂挂</button>
    `;
}

window.renderOverpaymentAlert = function(order, config) {
    const root = document.getElementById(config.rootId);
    const summaryEl = document.getElementById(config.summaryId);
    const metaEl = document.getElementById(config.metaId);
    const actionsEl = document.getElementById(config.actionsId);
    if (!root || !summaryEl || !metaEl || !actionsEl) return;
    const overpaidAmount = window.getOverpaidAmount(order);
    if (overpaidAmount <= 0.01) {
        root.classList.add('hidden');
        summaryEl.textContent = '';
        metaEl.textContent = '';
        actionsEl.innerHTML = '';
        return;
    }
    root.classList.remove('hidden');
    const totalAmount = Number(order.total_amount || 0);
    const paidAmount = Number(order.paid_amount || 0);
    summaryEl.textContent = `当前应收 ${window.formatCurrency(totalAmount)}，已收 ${window.formatCurrency(paidAmount)}，超收 ${window.formatCurrency(overpaidAmount)}`;
    metaEl.textContent = window.formatOverpaymentMeta(order);
    actionsEl.innerHTML = window.buildOverpaymentActionsHtml(order, config.context || 'detail');
}

window.refreshVisibleOrderContexts = function() {
    if (window.currentViewOrder) {
        const latest = (window.allOrders || []).find((item) => String(item.id) === String(window.currentViewOrder.id));
        if (latest && !document.getElementById('order-detail-modal').classList.contains('hidden')) {
            window.currentViewOrder = latest;
            window.showOrderDetail(latest);
        }
    }
    if (window.currentModalOrderId) {
        const latest = (window.allOrders || []).find((item) => String(item.id) === String(window.currentModalOrderId));
        if (latest && !document.getElementById('finance-modal').classList.contains('hidden')) {
            window.currentFinanceOrder = latest;
            window.refreshFinanceModalStats();
        }
    }
}

window.ensureDetailRegionOptions = function() {
    const detailProv = document.getElementById('edit-dt-reg-prov');
    const detailCity = document.getElementById('edit-dt-reg-city-sel');
    const detailDist = document.getElementById('edit-dt-reg-dist');
    const sourceProv = document.getElementById('reg-prov');
    const sourceCity = document.getElementById('reg-city-sel');
    const sourceDist = document.getElementById('reg-dist');
    if (!detailProv || !detailCity || !detailDist || !sourceProv || !sourceCity || !sourceDist) return;
    if (detailProv.options.length <= 1) detailProv.innerHTML = sourceProv.innerHTML;
    if (detailCity.options.length <= 1) detailCity.innerHTML = sourceCity.innerHTML;
    if (detailDist.options.length <= 1) detailDist.innerHTML = sourceDist.innerHTML;
}

window.onDetailProvinceChange = function() {
    const prov = document.getElementById('edit-dt-reg-prov').value;
    const intlInput = document.getElementById('edit-dt-reg-intl');
    const citySel = document.getElementById('edit-dt-reg-city-sel');
    const cityInp = document.getElementById('edit-dt-reg-city-inp');
    const distSel = document.getElementById('edit-dt-reg-dist');

    intlInput.classList.add('hidden');
    citySel.classList.add('hidden');
    cityInp.classList.add('hidden');
    distSel.classList.add('hidden');

    intlInput.value = '';
    citySel.value = '';
    cityInp.value = '';
    distSel.value = '';

    if (prov === '国际') {
        intlInput.classList.remove('hidden');
    } else if (prov === '福建') {
        citySel.classList.remove('hidden');
        window.onDetailCityChange();
    } else if (prov !== '') {
        cityInp.classList.remove('hidden');
    }
}

window.onDetailCityChange = function() {
    const prov = document.getElementById('edit-dt-reg-prov').value;
    const city = document.getElementById('edit-dt-reg-city-sel').value;
    const distSel = document.getElementById('edit-dt-reg-dist');
    if (prov === '福建' && city === '福州') {
        distSel.classList.remove('hidden');
        distSel.value = '';
    } else {
        distSel.classList.add('hidden');
        distSel.value = '';
    }
}

window.populateDetailRegionFields = function(region) {
    window.ensureDetailRegionOptions();
    const provSelect = document.getElementById('edit-dt-reg-prov');
    const intlInput = document.getElementById('edit-dt-reg-intl');
    const citySel = document.getElementById('edit-dt-reg-city-sel');
    const cityInp = document.getElementById('edit-dt-reg-city-inp');
    const distSel = document.getElementById('edit-dt-reg-dist');
    const rawRegion = String(region || '').trim();

    provSelect.value = '';
    intlInput.value = '';
    citySel.value = '';
    cityInp.value = '';
    distSel.value = '';
    window.onDetailProvinceChange();

    if (!rawRegion) return;

    if (rawRegion.startsWith('国际 - ')) {
        provSelect.value = '国际';
        window.onDetailProvinceChange();
        intlInput.value = rawRegion.replace(/^国际 - /, '').trim();
        return;
    }

    const parts = rawRegion.split(' - ').map((item) => item.trim()).filter(Boolean);
    if (parts.length === 0) return;

    const provincePart = parts[0].replace(/省$|市$|自治区$|特别行政区$/g, '');
    provSelect.value = provincePart;
    window.onDetailProvinceChange();

    if (provincePart === '福建') {
        const cityPart = (parts[1] || '').replace(/市$/g, '').trim();
        if (cityPart) {
            citySel.value = cityPart;
            window.onDetailCityChange();
        }
        if (cityPart === '福州' && parts[2]) {
            distSel.value = parts[2];
        }
        return;
    }

    if (parts[1]) {
        cityInp.value = parts[1];
    }
}

window.getDetailRegionValue = function() {
    const prov = document.getElementById('edit-dt-reg-prov').value;
    if (!prov) return '';
    if (prov === '国际') {
        const intl = document.getElementById('edit-dt-reg-intl').value.trim();
        return intl ? `国际 - ${intl}` : '';
    }
    if (prov === '福建') {
        const city = document.getElementById('edit-dt-reg-city-sel').value;
        if (!city) return '';
        let finalRegion = `${prov}省 - ${city}市`;
        if (city === '福州') {
            const dist = document.getElementById('edit-dt-reg-dist').value;
            if (!dist) return '';
            finalRegion += ` - ${dist}`;
        }
        return finalRegion;
    }
    const city = document.getElementById('edit-dt-reg-city-inp').value.trim();
    return city ? `${prov} - ${city}` : '';
}

window.toggleDetailCreditCode = function() {
    const input = document.getElementById('edit-dt-code');
    const checkbox = document.getElementById('edit-dt-no-code');
    if (!input || !checkbox) return;
    if (checkbox.checked) {
        input.placeholder = "无代码请输入护照号等";
        input.classList.add('bg-gray-100');
        input.classList.remove('bg-white');
    } else {
        input.placeholder = "防止重复，请准确填写";
        input.classList.remove('bg-gray-100');
        input.classList.add('bg-white');
    }
}

window.getSelectedSalesFilter = function() {
    const select = document.getElementById('order-sales-filter');
    if (!select || window.currentUser.role !== 'admin') return '';
    return select.value;
}

window.loadOrderSalesFilterOptions = async function() {
    const select = document.getElementById('order-sales-filter');
    if (!select) return;

    if (window.currentUser.role !== 'admin') {
        select.classList.add('hidden');
        return;
    }

    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;

    const previousValue = select.value;
    const staff = await (await window.apiFetch(`/api/staff?projectId=${pid}`)).json();
    select.innerHTML = '<option value="">全部业务员</option>';
    staff.forEach((member) => {
        const option = document.createElement('option');
        option.value = member.name;
        option.textContent = member.name;
        select.appendChild(option);
    });
    select.value = staff.some((member) => member.name === previousValue) ? previousValue : '';
    select.classList.remove('hidden');
}

window.renderOrderDashboardStats = function(stats) {
    const panel = document.getElementById('order-dashboard-panel');
    if (!panel) return;

    const fmtMoney = (value) => window.formatCurrency(value);
    const fmtCount = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');
    const fmtPercent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;
    const clampPercent = (value) => Math.max(0, Math.min(Number(value || 0), 100));
    const renderProgressBar = (value, colorClass) => `
        <div class="mt-2 h-2.5 rounded-full bg-white/80 overflow-hidden">
            <div class="h-full rounded-full ${colorClass}" style="width: ${clampPercent(value)}%"></div>
        </div>
    `;
    const receivableTotal = Number(stats.receivable_total || 0);
    const unpaidTotal = Number(stats.unpaid_total || 0);
    const depositBooths = Number(stats.deposit_booth_count || 0);
    const fullPaidBooths = Number(stats.full_paid_booth_count || 0);
    const advancedRate = Number(stats.target_total || 0) > 0 ? ((depositBooths + fullPaidBooths) / Number(stats.target_total || 0)) * 100 : 0;

    panel.innerHTML = `
        <div class="bg-gradient-to-br from-blue-50 to-indigo-50 p-5 border border-blue-100 rounded-2xl shadow-sm md:col-span-2 xl:col-span-2">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <div class="text-xs tracking-wide text-blue-500 font-bold">目标展位推进</div>
                    <div class="text-3xl font-black text-blue-800 mt-2">${fmtCount(depositBooths + fullPaidBooths)} 个</div>
                    <div class="text-xs text-gray-500 mt-1">已进入定金或全款阶段的展位数</div>
                </div>
                <div class="text-right">
                    <div class="text-xs text-gray-500">推进比例</div>
                    <div class="text-2xl font-black text-indigo-700 mt-1">${fmtPercent(advancedRate)}</div>
                </div>
            </div>
            ${renderProgressBar(advancedRate, 'bg-gradient-to-r from-blue-500 to-indigo-500')}
            <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm text-gray-700 mt-4">
                <div class="bg-white/80 rounded-xl p-3 border border-blue-100">
                    <div class="text-xs text-gray-500">目标展位数</div>
                    <div class="text-xl font-bold text-blue-700 mt-1">${fmtCount(stats.target_total)}</div>
                </div>
                <div class="bg-white/80 rounded-xl p-3 border border-blue-100">
                    <div class="text-xs text-gray-500">已付定金展位数</div>
                    <div class="text-xl font-bold text-amber-600 mt-1">${fmtCount(depositBooths)}</div>
                </div>
                <div class="bg-white/80 rounded-xl p-3 border border-blue-100">
                    <div class="text-xs text-gray-500">全款展位数</div>
                    <div class="text-xl font-bold text-emerald-700 mt-1">${fmtCount(fullPaidBooths)}</div>
                </div>
                <div class="bg-white/80 rounded-xl p-3 border border-blue-100">
                    <div class="text-xs text-gray-500">剩余目标数</div>
                    <div class="text-xl font-bold text-orange-600 mt-1">${fmtCount(stats.remaining_target)}</div>
                </div>
            </div>
        </div>
        <div class="bg-gradient-to-br from-rose-50 to-emerald-50 p-5 border border-rose-100 rounded-2xl shadow-sm md:col-span-2 xl:col-span-2">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <div class="text-xs tracking-wide text-rose-500 font-bold">应收费用与未收情况</div>
                    <div class="text-3xl font-black text-rose-800 mt-2">${fmtMoney(receivableTotal)}</div>
                    <div class="text-xs text-gray-500 mt-1">总计应收费用</div>
                </div>
                <div class="text-right">
                    <div class="text-xs text-gray-500">已收费用占比</div>
                    <div class="text-2xl font-black text-emerald-700 mt-1">${fmtPercent(stats.collection_rate)}</div>
                </div>
            </div>
            ${renderProgressBar(stats.collection_rate, 'bg-gradient-to-r from-emerald-400 to-emerald-600')}
            <div class="grid grid-cols-2 xl:grid-cols-3 gap-3 text-sm text-gray-700 mt-4">
                <div class="bg-white/85 rounded-xl p-3 border border-rose-100">
                    <div class="text-xs text-gray-500">总计应收费用</div>
                    <div class="text-lg font-bold text-rose-700 mt-1">${fmtMoney(receivableTotal)}</div>
                </div>
                <div class="bg-white/85 rounded-xl p-3 border border-rose-100">
                    <div class="text-xs text-gray-500">应收展位费</div>
                    <div class="text-lg font-bold text-rose-700 mt-1">${fmtMoney(stats.receivable_booth_fee)}</div>
                </div>
                <div class="bg-white/85 rounded-xl p-3 border border-rose-100">
                    <div class="text-xs text-gray-500">应收其他费用</div>
                    <div class="text-lg font-bold text-rose-700 mt-1">${fmtMoney(stats.receivable_other_fee)}</div>
                </div>
                <div class="bg-white/85 rounded-xl p-3 border border-emerald-100">
                    <div class="text-xs text-gray-500">已收费用总计</div>
                    <div class="text-lg font-bold text-emerald-700 mt-1">${fmtMoney(stats.received_total)}</div>
                </div>
                <div class="bg-white/85 rounded-xl p-3 border border-red-100">
                    <div class="text-xs text-gray-500">剩余未收费用</div>
                    <div class="text-lg font-bold text-red-600 mt-1">${fmtMoney(unpaidTotal)}</div>
                </div>
                <div class="bg-white/85 rounded-xl p-3 border border-red-100">
                    <div class="text-xs text-gray-500">已收费用占比</div>
                    <div class="text-lg font-bold text-emerald-700 mt-1">${fmtPercent(stats.collection_rate)}</div>
                </div>
            </div>
        </div>
    `;
}

window.loadOrderDashboardStats = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;
    const salesName = window.getSelectedSalesFilter();
    const query = salesName ? `&salesName=${encodeURIComponent(salesName)}` : '';
    const res = await window.apiFetch(`/api/order-dashboard-stats?projectId=${pid}${query}`);
    const stats = await res.json();
    window.renderOrderDashboardStats(stats);
}

window.loadOrderList = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    await window.loadOrderSalesFilterOptions();
    const salesName = window.getSelectedSalesFilter();
    const query = salesName ? `&salesName=${encodeURIComponent(salesName)}` : '';
    const res = await window.apiFetch(`/api/orders?projectId=${pid}${query}`);
    window.allOrders = await res.json();
    await window.loadOrderDashboardStats();
    window.renderOrderList();
}

window.renderOrderList = function() {
    const searchTxt = document.getElementById('order-search').value.toLowerCase();
    const businessSearchTxt = document.getElementById('order-business-search')?.value.toLowerCase().trim() || '';
    const statusFilter = document.getElementById('order-status-filter').value;
    
    const batchBtn = document.querySelector('button[onclick="window.batchDownloadContracts()"]');
    if(batchBtn) {
        batchBtn.style.display = window.isSuperAdmin() ? 'inline-flex' : 'none';
    }

    const filtered = (window.allOrders || []).filter(o => {
        if(searchTxt && !(o.company_name.toLowerCase().includes(searchTxt) || o.booth_id.toLowerCase().includes(searchTxt))) return false;
        if (businessSearchTxt && !String(o.main_business || '').toLowerCase().includes(businessSearchTxt)) return false;
        let payStatus = '未付';
        if(o.paid_amount > 0 && o.paid_amount < o.total_amount) payStatus = '定金';
        if(o.paid_amount >= o.total_amount) payStatus = '全款';
        if(statusFilter && payStatus !== statusFilter) return false;
        return true;
    }).sort((a, b) => {
        const ownDiff = Number(window.isOwnOrder(b)) - Number(window.isOwnOrder(a));
        if (ownDiff !== 0) return ownDiff;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    document.getElementById('order-total-stats').innerText = `共 ${filtered.length} 笔订单`;
    const tbody = document.getElementById('order-list-tbody'); tbody.innerHTML = '';
    
    const checkAllBox = document.getElementById('check-all-orders');
    if(checkAllBox) checkAllBox.checked = false;

    filtered.forEach(o => {
        const canManage = window.canManageOrder(o);
        const hasOverpayment = window.hasOverpaymentIssue(o);
        const overpaidAmount = window.getOverpaidAmount(o);
        let payBadge = `<span class="badge-danger">未付款</span>`;
        if(o.paid_amount > 0 && o.paid_amount < o.total_amount) {
            let ratio = ((o.paid_amount / o.total_amount) * 100).toFixed(1);
            let remain = o.total_amount - o.paid_amount;
            payBadge = `<div class="badge-warning flex flex-col items-center leading-tight rounded-xl"><span>已付定金 (${ratio}%)</span><span class="mt-1 tabular-data text-amber-700">剩${window.formatCurrency(remain)}</span></div>`;
        }
        if(o.paid_amount >= o.total_amount) payBadge = `<span class="badge-success">已付全款</span>`;
        if (hasOverpayment) {
            const statusTone = o.overpayment_status === 'resolved_as_fx_diff'
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : o.overpayment_status === 'on_hold'
                    ? 'bg-slate-100 text-slate-700 border border-slate-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200';
            const overpaymentActions = window.canHandleOverpayment(o)
                ? `<button onclick='window.openOverpaymentModalById(${JSON.stringify(String(o.id))}, "fx_diff", "list")' class="mt-1 btn-secondary px-2.5 py-1 text-[11px] shadow-sm">${window.renderIcon('chevronRight', 'h-3.5 w-3.5', 2.1)}<span>去处理</span></button>`
                : '<span class="mt-1 badge-readonly">待业务员处理</span>';
            payBadge = `
                <div class="flex flex-col items-center gap-1">
                    ${payBadge}
                    <div class="rounded-xl px-2.5 py-1 text-[11px] font-bold leading-tight text-center ${statusTone}">
                        <div>${window.getOverpaymentStatusLabel(o)}</div>
                        <div class="mt-0.5 tabular-data">超 ${window.formatCurrency(overpaidAmount)}</div>
                    </div>
                    ${overpaymentActions}
                </div>
            `;
        }

        const safeCompany = window.escapeHtml ? window.escapeHtml(o.company_name) : o.company_name;
        const safeHall = window.escapeHtml(o.hall || '');
        const safeBoothId = window.escapeHtml(o.booth_id || '');
        const safeRegion = window.escapeHtml(o.region || '未填');
        const safeBoothType = window.escapeHtml(o.booth_type || '');
        // 【核心优化】：合同状态 UI 升级，明确展示状态，仅保留预览和重新上传
        let contractBtn = '';
        if (canManage && o.contract_url) {
            contractBtn = `
                <div class="flex flex-col items-center justify-center gap-1.5">
                    <span class="badge-success shadow-sm">已上传</span>
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick='window.previewSingleContract(${JSON.stringify(String(o.contract_url))}, ${JSON.stringify(String(o.id))})' class="btn-soft-primary px-3 py-1 text-xs">预览</button>
                        <span class="text-gray-300">|</span>
                        <button onclick='window.triggerSilentUpload(${JSON.stringify(String(o.id))})' class="btn-soft-amber px-3 py-1 text-xs">重新上传</button>
                    </div>
                </div>
            `;
        } else if (canManage) {
            contractBtn = `
                <div class="flex flex-col items-center justify-center gap-1.5">
                    <span class="badge-neutral shadow-sm">暂未上传</span>
                    <button onclick='window.triggerSilentUpload(${JSON.stringify(String(o.id))})' class="btn-soft-primary px-3 py-1 text-xs">点击上传</button>
                </div>
            `;
        } else {
            contractBtn = `
                <div class="flex flex-col items-center justify-center gap-1.5">
                    <span class="${Number(o.has_contract) === 1 ? 'badge-success' : 'badge-neutral'} shadow-sm">${Number(o.has_contract) === 1 ? '已上传' : '暂未上传'}</span>
                    <span class="badge-readonly">${Number(o.has_contract) === 1 ? '预览受限' : '无权限查看'}</span>
                </div>
            `;
        }

        const checkboxHtml = `<input type="checkbox" class="order-check cursor-pointer" value="${o.id}" ${canManage ? '' : 'disabled'}>`;
        const stickyActionCellClass = 'p-3 text-center whitespace-nowrap align-middle sticky right-0 bg-white sticky-action-shadow';
        const actionHtml = canManage
            ? `
                <button onclick='window.openFinanceDirectById(${JSON.stringify(String(o.id))}, "pay")' class="btn-primary px-3 py-1.5 text-xs shadow-sm">${window.renderIcon('wallet', 'h-3.5 w-3.5', 2)}<span>收款</span></button>
                <button onclick='window.openFinanceDirectById(${JSON.stringify(String(o.id))}, "adj")' class="btn-soft-amber px-3 py-1.5 text-xs mx-1">${window.renderIcon('settings', 'h-3.5 w-3.5', 2)}<span>变更</span></button>
                <button onclick='window.openFinanceDirectById(${JSON.stringify(String(o.id))}, "swap")' class="btn-secondary px-3 py-1.5 text-xs mr-1">${window.renderIcon('swap', 'h-3.5 w-3.5', 2)}<span>换展位</span></button>
                <button onclick='window.openFinanceDirectById(${JSON.stringify(String(o.id))}, "exp")' class="btn-dark px-3 py-1.5 text-xs mr-2">${window.renderIcon('download', 'h-3.5 w-3.5', 2)}<span>代付</span></button>
                ${(window.currentUser.role === 'admin' || window.isOwnOrder(o)) ? `<button onclick='window.cancelOrder(${JSON.stringify(String(o.id))}, ${JSON.stringify(String(o.booth_id))})' class="btn-soft-danger px-3 py-1.5 text-xs shadow-sm">${window.renderIcon('close', 'h-3.5 w-3.5', 2.2)}<span>退订</span></button>` : ''}
            `
            : `
                <button class="btn-muted px-3 py-1.5 text-xs">${window.renderIcon('wallet', 'h-3.5 w-3.5', 2)}<span>收款</span></button>
                <button class="btn-muted px-3 py-1.5 text-xs mx-1">${window.renderIcon('settings', 'h-3.5 w-3.5', 2)}<span>变更</span></button>
                <button class="btn-muted px-3 py-1.5 text-xs mr-1">${window.renderIcon('swap', 'h-3.5 w-3.5', 2)}<span>换展位</span></button>
                <button class="btn-muted px-3 py-1.5 text-xs mr-2">${window.renderIcon('download', 'h-3.5 w-3.5', 2)}<span>代付</span></button>
            `;

        tbody.innerHTML += `
            <tr class="border-b hover:bg-blue-50 transition">
                <td class="p-3 text-center">${checkboxHtml}</td>
                <td class="p-3 text-center align-middle">${payBadge}</td>
                <td class="p-3 font-bold text-gray-600">${safeHall}</td>
                <td class="p-3 font-bold text-blue-700 text-lg">${safeBoothId}</td>
                <td class="p-3 text-xs text-gray-500 truncate max-w-[120px]" title="${safeRegion}">${safeRegion}</td>
                <td class="p-3 font-bold text-gray-800 cursor-pointer hover:text-blue-600 hover:underline max-w-[220px] truncate" onclick='window.showOrderDetailById(${JSON.stringify(String(o.id))})' title="点击查看详情">${safeCompany}</td>
                <td class="p-3 tabular-data">${o.area} ㎡</td>
                <td class="p-3 text-xs text-gray-500">${safeBoothType}</td>
                <td class="p-3 text-right font-bold text-gray-800 tabular-data">${window.formatCurrency(o.total_amount)}</td>
                <td class="p-3 text-right font-bold text-green-600 tabular-data">${window.formatCurrency(o.paid_amount)}</td>
                <td class="p-3 text-center align-middle">${contractBtn}</td>
                <td class="${stickyActionCellClass}">${actionHtml}</td>
            </tr>
        `;
    });
}

window.showOrderDetailById = function(id) {
    try {
        const order = window.allOrders.find(o => String(o.id) === String(id));
        if (order) window.showOrderDetail(order);
        else window.showToast('找不到对应的订单数据', 'error');
    } catch (e) { window.showToast("打开详情出错: " + e.message, 'error'); }
}

window.openFinanceDirectById = function(id, tab) {
    try {
        const order = window.allOrders.find(o => String(o.id) === String(id));
        if (order) window.openFinanceDirect(order, tab);
        else window.showToast('找不到对应的订单数据', 'error');
    } catch (e) { window.showToast("打开面板出错: " + e.message, 'error'); }
}

window.toggleAllOrderChecks = function(source) {
    document.querySelectorAll('.order-check').forEach(cb => cb.checked = source.checked);
}

// 预览合同 (新标签页打开)
window.previewSingleContract = async function(fileKey, orderId) {
    try {
        window.showToast("正在获取云端合同，准备预览...", "info");
        const response = await window.apiFetch(`/api/file/${fileKey}?orderId=${encodeURIComponent(orderId)}`);
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "获取失败或无预览权限");
        }
        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        window.open(objectUrl, '_blank');
    } catch (e) { window.showToast(e.message, 'error'); }
}

window.batchDownloadContracts = async function() {
    if (!window.isSuperAdmin()) return window.showToast("权限不足：仅超级管理员可批量打包合同", "error");
    const checkedBoxes = document.querySelectorAll('.order-check:checked');
    if (checkedBoxes.length === 0) return window.showToast("请先勾选需要下载合同的订单", "error");

    const selectedIds = Array.from(checkedBoxes).map(cb => String(cb.value));
    const selectedOrders = window.allOrders.filter(o => selectedIds.includes(String(o.id)));
    const ordersWithContracts = selectedOrders.filter(o => o.contract_url);
    
    if (ordersWithContracts.length === 0) return window.showToast("您勾选的订单均未上传合同！", "error");
    if (ordersWithContracts.length < selectedOrders.length) {
        window.showToast(`部分订单未上传合同，将打包已上传的 ${ordersWithContracts.length} 份`, "info");
    } else {
        window.showToast(`开始打包 ${ordersWithContracts.length} 份合同，请稍候...`, "info");
    }

    const btn = document.querySelector('button[onclick="window.batchDownloadContracts()"]');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> 打包中...`;
    btn.disabled = true;
    btn.classList.add('opacity-70', 'cursor-wait');

    try {
        const zip = new JSZip();
        const folder = zip.folder("参展企业合同打包");

        const concurrency = 5;
        for (let i = 0; i < ordersWithContracts.length; i += concurrency) {
            const chunk = ordersWithContracts.slice(i, i + concurrency);
            await Promise.all(chunk.map(async (order) => {
                try {
                    const response = await window.apiFetch(`/api/file/${order.contract_url}?orderId=${encodeURIComponent(order.id)}`);
                    if (response.ok) {
                        const blob = await response.blob();
                        const safeCompanyName = order.company_name.replace(/[\\/:*?"<>|]/g, "_");
                        const safeHall = order.hall.replace(/[\\/:*?"<>|馆号]/g, ""); 
                        const fileName = `${safeHall}馆 ${safeCompanyName} 参展合同.pdf`;
                        folder.file(fileName, blob);
                    }
                } catch (err) { console.error(`拉取合同失败: ${order.company_name}`, err); }
            }));
        }

        const content = await zip.generateAsync({ type: "blob" });
        const url = window.URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = `展位合同批量打包_${new Date().toLocaleDateString().replace(/\//g, '-')}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        window.showToast("合同打包下载成功！");
    } catch (error) {
        window.showToast("打包下载过程中出现网络错误", "error");
    } finally {
        btn.innerHTML = originalHtml; btn.disabled = false; btn.classList.remove('opacity-70', 'cursor-wait');
    }
}

window.exportToExcel = async function() {
    const exportOrders = window.isSuperAdmin()
        ? (window.allOrders || [])
        : (window.allOrders || []).filter((order) => window.isOwnOrder(order));
    if(!exportOrders || exportOrders.length === 0) return window.showToast("当前无可导出的本人数据", 'error');

    const safeWrap = (val) => `"${(val ?? '').toString().replace(/"/g, '""')}"`;
    const fmtMoney = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');
    const parseJsonSafe = (value) => {
        try {
            return value ? JSON.parse(value) : null;
        } catch (e) {
            return null;
        }
    };
    const normalizePaymentDetails = (payments) => (payments || []).map((payment) => {
        const raw = parseJsonSafe(payment.raw_payload);
        return {
            amount: payment.amount || 0,
            paymentDate: payment.payment_time || '',
            payerName: raw?.receivablesUnit || raw?.payerName || payment.payer_name || '',
            receiveBank: raw?.bank || raw?.bankName || raw?.bank_name || payment.bank_name || '',
            receiveCompany: raw?.corporateAccount || raw?.corporate_account || ''
        };
    });
    const normalizeExpenseDetails = (expenses) => (expenses || []).map((expense) => ({
        reason: expense.reason || '',
        channel: expense.payee_channel || '',
        payeeName: expense.payee_name || '',
        amount: expense.amount || 0,
        createdAt: expense.created_at || ''
    }));
    const parseFeeDetails = (feesJson) => {
        try {
            const items = JSON.parse(feesJson || '[]');
            if (!Array.isArray(items) || items.length === 0) return '';
            return items
                .map((item) => `${item.name || '未命名收费'}: ¥${fmtMoney(item.amount)}`)
                .join('；');
        } catch (e) {
            return '';
        }
    };

    window.showToast("正在整理导出数据，请稍候...", "info");

    try {
        const detailRows = await Promise.all(exportOrders.map(async (order) => {
            const [paymentRes, expenseRes] = await Promise.all([
                window.apiFetch(`/api/payments?orderId=${encodeURIComponent(order.id)}`),
                window.apiFetch(`/api/expenses?orderId=${encodeURIComponent(order.id)}`)
            ]);

            const payments = paymentRes.ok ? await paymentRes.json() : [];
            const expenses = expenseRes.ok ? await expenseRes.json() : [];
            const paymentDetails = normalizePaymentDetails(payments);
            const expenseDetails = normalizeExpenseDetails(expenses);
            const otherFeeDetails = parseFeeDetails(order.fees_json);
            let status = order.paid_amount >= order.total_amount ? '已付全款' : (order.paid_amount > 0 ? '已付定金' : '未付款');
            if(order.status === '已退订' || order.status === '已作废') status = '已退订';

            return {
                base: [
                    status,
                    order.hall || '',
                    order.booth_id || '',
                    order.area || '',
                    order.booth_type || '',
                    order.company_name || '',
                    order.credit_code || '',
                    order.region || '',
                    order.contact_person || '',
                    order.phone || '',
                    order.category || '',
                    order.main_business || '',
                    order.profile || '',
                    order.sales_name || '',
                    order.total_booth_fee || 0,
                    order.other_income || 0,
                    otherFeeDetails,
                    order.total_amount || 0,
                    order.paid_amount || 0,
                    paymentDetails.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
                ],
                payments: paymentDetails,
                expenseTotal: expenseDetails.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
                expenses: expenseDetails,
                createdAt: order.created_at || ''
            };
        }));

        const maxPaymentCount = detailRows.reduce((max, row) => Math.max(max, row.payments.length), 0);
        const maxExpenseCount = detailRows.reduce((max, row) => Math.max(max, row.expenses.length), 0);
        const headers = [
            '内部状态',
            '馆号',
            '展位号',
            '展位面积',
            '类型',
            '客户名称',
            '信用代码/代号',
            '地区',
            '联系人',
            '电话',
            '产品分类',
            '主营业务/展品',
            '企业简介',
            '业务员',
            '应收展位费',
            '应收其他费用',
            '其他收费明细',
            '总计应收金额',
            '订单已收金额',
            '收款流水总额'
        ];
        for (let i = 1; i <= maxPaymentCount; i += 1) {
            headers.push(
                `收款${i}金额`,
                `收款${i}日期`,
                `收款${i}付款人`,
                `收款${i}收款银行`,
                `收款${i}收款至我司户名`
            );
        }
        headers.push('代付/返佣总额');
        for (let i = 1; i <= maxExpenseCount; i += 1) {
            headers.push(
                `代付/返佣${i}事由`,
                `代付/返佣${i}渠道`,
                `代付/返佣${i}收款人/供应商`,
                `代付/返佣${i}金额`,
                `代付/返佣${i}时间`
            );
        }
        headers.push('录入时间');

        let csvContent = `\uFEFF${headers.join(',')}\n`;
        detailRows.forEach((row) => {
            const paymentCells = [];
            for (let i = 0; i < maxPaymentCount; i += 1) {
                const payment = row.payments[i];
                paymentCells.push(
                    payment ? payment.amount : '',
                    payment ? payment.paymentDate : '',
                    payment ? payment.payerName : '',
                    payment ? payment.receiveBank : '',
                    payment ? payment.receiveCompany : ''
                );
            }

            const expenseCells = [];
            for (let i = 0; i < maxExpenseCount; i += 1) {
                const expense = row.expenses[i];
                expenseCells.push(
                    expense ? expense.reason : '',
                    expense ? expense.channel : '',
                    expense ? expense.payeeName : '',
                    expense ? expense.amount : '',
                    expense ? expense.createdAt : ''
                );
            }

            const flatRow = [
                ...row.base,
                ...paymentCells,
                row.expenseTotal,
                ...expenseCells,
                row.createdAt
            ];
            csvContent += flatRow.map((value) => safeWrap(value)).join(',') + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `展位订单大盘导出_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
        link.click();
        window.showToast("数据大盘导出成功！");
    } catch (e) {
        window.showToast(`导出失败: ${e.message}`, 'error');
    }
}

window.triggerSilentUpload = function(orderId) {
    const order = window.allOrders.find(o => String(o.id) === String(orderId));
    if (!window.canManageOrder(order)) return window.showToast('权限不足：不能上传他人合同', 'error');
    window.currentSilentOrderId = orderId;
    document.getElementById('silent-file-upload').click();
}
window.handleSilentUpload = async function(input) {
    if(!input.files[0] || !window.currentSilentOrderId) return;
    window.showToast("正在上传合同并更新单据...");
    const formData = new FormData(); formData.append('file', input.files[0]);
    try {
        const upRes = await window.apiFetch('/api/upload', {method:'POST', body: formData});
        if (!upRes.ok) throw new Error("云端存储失败");
        const upData = await upRes.json();
        const order = window.allOrders.find(o => String(o.id) === String(window.currentSilentOrderId));
        const data = { project_id: document.getElementById('global-project-select').value, order_id: window.currentSilentOrderId, contact_person: order.contact_person, phone: order.phone, region: order.region, main_business: order.main_business, profile: order.profile, category: order.category, is_agent: order.is_agent === 1, agent_name: order.agent_name, contract_url: upData.fileKey };
        const updateRes = await window.apiFetch('/api/update-customer-info', {method:'POST', body: JSON.stringify(data)});
        if (!updateRes.ok) throw new Error("数据库更新失败");
        window.showToast("合同处理成功！"); window.loadOrderList();
    } catch (e) { window.showToast("上传失败: " + e.message, 'error'); } finally { input.value = ''; window.currentSilentOrderId = null; }
}

window.toggleDtAgent = function() {
    const checkedRadio = document.querySelector('input[name="edit_is_agent"]:checked');
    if (!checkedRadio) return;
    const isAgent = checkedRadio.value === '1';
    const box = document.getElementById('edit-dt-agent-name');
    if (box) {
        if (isAgent) { box.classList.remove('hidden'); } 
        else { box.classList.add('hidden'); box.value = ''; }
    }
}

window.showOrderDetail = function(o) {
    const canManage = window.canManageOrder(o);
    const isSuperAdmin = window.isSuperAdmin();
    const canViewSensitive = window.canViewSensitiveOrderFields(o);
    const editContactInput = document.getElementById('edit-dt-contact');
    const editPhoneInput = document.getElementById('edit-dt-phone');
    window.currentViewOrder = o; 
    document.getElementById('dt-company').innerText = o.company_name; document.getElementById('dt-code').innerText = o.no_code_checked ? `无代码 (代号: ${o.credit_code})` : o.credit_code; document.getElementById('dt-booth').innerText = `${o.hall} - ${o.booth_id}`; document.getElementById('dt-sales').innerText = o.sales_name; document.getElementById('dt-time').innerText = o.created_at || '未知'; document.getElementById('dt-region').innerText = o.region || '未填'; document.getElementById('dt-contact').innerText = o.contact_person; document.getElementById('dt-phone').innerText = o.phone; document.getElementById('dt-category').innerText = o.category || '未填'; document.getElementById('dt-business').innerText = o.main_business || '未填'; document.getElementById('dt-profile').innerText = o.profile || '暂无简介'; document.getElementById('dt-agent').innerText = o.is_agent ? `由代理商 [${o.agent_name}] 代招` : '直招入驻';
    editContactInput.value = o.contact_person;
    editPhoneInput.value = o.phone;
    editContactInput.disabled = !canViewSensitive;
    editPhoneInput.disabled = !canViewSensitive;
    editContactInput.classList.toggle('bg-gray-100', !canViewSensitive);
    editPhoneInput.classList.toggle('bg-gray-100', !canViewSensitive);
    editContactInput.classList.toggle('cursor-not-allowed', !canViewSensitive);
    editPhoneInput.classList.toggle('cursor-not-allowed', !canViewSensitive);
    document.getElementById('edit-dt-company').value = o.company_name || '';
    document.getElementById('edit-dt-code').value = o.credit_code || '';
    document.getElementById('edit-dt-no-code').checked = Number(o.no_code_checked) === 1;
    window.toggleDetailCreditCode();
    window.populateDetailRegionFields(o.region || '');
    if (window.renderCategorySelect) { window.renderCategorySelect('edit-dt-category', o.category || '', true); }
    document.getElementById('edit-dt-business').value = o.main_business || '';
    document.getElementById('edit-dt-profile').value = o.profile || '';
    document.querySelector(`input[name="edit_is_agent"][value="${o.is_agent ? 1 : 0}"]`).checked = true; 
    document.getElementById('edit-dt-agent-name').value = o.agent_name || '';
    document.getElementById('dt-sensitive-edit-tip').classList.toggle('hidden', !isSuperAdmin);
    document.getElementById('dt-superadmin-company-group').classList.toggle('hidden', !isSuperAdmin);
    document.getElementById('dt-superadmin-code-group').classList.toggle('hidden', !isSuperAdmin);
    
    document.querySelectorAll('input[name="edit_is_agent"]').forEach(el => el.onchange = window.toggleDtAgent);
    document.getElementById('edit-dt-no-code').onchange = window.toggleDetailCreditCode;
    window.toggleDtAgent();

    const actionView = document.getElementById('dt-action-view');
    if (canManage) {
        actionView.innerHTML = '<button onclick="window.toggleDetailEditMode(true)" class="btn-secondary px-4 py-2 shadow-sm">进入编辑模式</button>';
    } else {
        actionView.innerHTML = '<span class="text-xs text-gray-500 bg-gray-100 px-3 py-2 rounded font-bold">非本人录入，仅可查看受限信息</span>';
    }

    window.renderOverpaymentAlert(o, {
        rootId: 'dt-overpayment-alert',
        summaryId: 'dt-overpayment-summary',
        metaId: 'dt-overpayment-meta',
        actionsId: 'dt-overpayment-actions',
        context: 'detail'
    });

    window.toggleDetailEditMode(false); document.getElementById('order-detail-modal').classList.remove('hidden');
}

window.toggleDetailEditMode = function(isEditing) {
    if (isEditing && !window.canManageOrder(window.currentViewOrder)) return window.showToast('权限不足：不能修改他人客户资料', 'error');
    if(isEditing) { document.getElementById('dt-view-mode').classList.add('hidden'); document.getElementById('dt-action-view').classList.add('hidden'); document.getElementById('dt-edit-mode').classList.remove('hidden'); document.getElementById('dt-action-edit').classList.remove('hidden'); } 
    else { document.getElementById('dt-edit-mode').classList.add('hidden'); document.getElementById('dt-action-edit').classList.add('hidden'); document.getElementById('dt-view-mode').classList.remove('hidden'); document.getElementById('dt-action-view').classList.remove('hidden'); }
}

window.saveDetailEdit = async function() {
    if (!window.canManageOrder(window.currentViewOrder)) return window.showToast('权限不足：不能修改他人客户资料', 'error');
    const pid = document.getElementById('global-project-select').value;
    const isAgent = document.querySelector('input[name="edit_is_agent"]:checked').value === '1';
    const canEditSensitive = window.canViewSensitiveOrderFields(window.currentViewOrder);
    const updatedData = { project_id: pid, order_id: window.currentViewOrder.id, region: window.getDetailRegionValue(), category: document.getElementById('edit-dt-category').value.trim(), main_business: document.getElementById('edit-dt-business').value.trim(), profile: document.getElementById('edit-dt-profile').value.trim(), is_agent: isAgent, agent_name: document.getElementById('edit-dt-agent-name').value.trim() };
    if (canEditSensitive) {
        updatedData.contact_person = document.getElementById('edit-dt-contact').value.trim();
        updatedData.phone = document.getElementById('edit-dt-phone').value.trim();
    }
    if (window.isSuperAdmin()) {
        updatedData.company_name = document.getElementById('edit-dt-company').value.trim();
        updatedData.credit_code = document.getElementById('edit-dt-code').value.trim();
        updatedData.no_code_checked = document.getElementById('edit-dt-no-code').checked;
    }
    if(canEditSensitive && (!updatedData.contact_person || !updatedData.phone)) return window.showToast("联系人和电话不能为空！", 'error');
    if(!updatedData.region) return window.showToast("请按录单规则完整选择所在地区！", 'error');
    if(isAgent && !updatedData.agent_name) return window.showToast("请填写代理商名称！", 'error');
    if (window.isSuperAdmin() && !updatedData.company_name) return window.showToast("参展企业全称不能为空！", 'error');
    if (window.isSuperAdmin() && !updatedData.no_code_checked && !updatedData.credit_code) return window.showToast("请填写统一社会信用代码！", 'error');
    window.toggleBtnLoading('btn-save-detail', true);
    try {
        const res = await window.apiFetch('/api/update-customer-info', { method: 'POST', body: JSON.stringify(updatedData) });
        if(!res.ok) throw new Error("修改失败，请重试");
        window.showToast("资料更新成功！");
        Object.assign(window.currentViewOrder, updatedData);
        window.currentViewOrder.is_agent = updatedData.is_agent ? 1 : 0;
        if (window.isSuperAdmin()) {
            window.currentViewOrder.no_code_checked = updatedData.no_code_checked ? 1 : 0;
        }
        window.showOrderDetail(window.currentViewOrder);
        window.loadOrderList();
    } catch (e) { window.showToast(e.message, 'error'); } finally { window.toggleBtnLoading('btn-save-detail', false); }
}

window.openFinanceDirect = async function(order, tab) {
    if (!window.canManageOrder(order)) return window.showToast('权限不足：不能办理他人订单财务', 'error');
    try {
        const pid = document.getElementById('global-project-select').value;
        const res = await window.apiFetch(`/api/accounts?projectId=${pid}`);
        const data = await res.json();
        window.projectAccounts = Array.isArray(data) ? data : [];
        
        const sel = document.getElementById('pay-account-select'); 
        sel.innerHTML = '<option value="">-- 请选择收款方式 --</option>';
        
        if (window.projectAccounts.length > 0) {
            const group = document.createElement('optgroup'); 
            group.label = "系统配置对公账户";
            window.projectAccounts.forEach(a => { 
                const option = document.createElement('option');
                option.value = `${a.account_name} - ${a.bank_name || ''}`;
                option.textContent = `${a.account_name} - ${a.bank_name || ''} (账号: ${a.account_no || '未配置'})`;
                group.appendChild(option);
            });
            sel.appendChild(group); 
        }
        
        const otherGroup = document.createElement('optgroup');
        otherGroup.label = "📱 其他常规方式";
        otherGroup.innerHTML = `<option value="微信">微信</option><option value="支付宝">支付宝</option><option value="现金">现金</option>`;
        sel.appendChild(otherGroup);
        
        window.openFinanceModal(order, tab);
    } catch (e) {
        window.showToast("拉取自定义账户失败，已启用基础收款模式", "info");
        window.openFinanceModal(order, tab);
    }
}

window.openFinanceModal = async function(order, forcedTab = null) {
    window.currentModalOrderId = order.id; 
    window.currentFinanceOrder = order;
    const targetTab = forcedTab || window.lastFmTab || 'pay';
    
    document.getElementById('fm-order-title').innerText = `当前客户：${order.company_name} (展位: ${order.booth_id})`;
    document.getElementById('fm-total').innerText = window.formatCurrency(order.total_amount); 
    document.getElementById('fm-paid').innerText = window.formatCurrency(order.paid_amount); 
    document.getElementById('fm-unpaid').innerText = window.formatCurrency(Number(order.total_amount || 0) - Number(order.paid_amount || 0));
    document.getElementById('fm-order-id').value = order.id; 
    
    document.getElementById('pay-amount').value = ''; document.getElementById('pay-time').value = new Date().toISOString().split('T')[0]; document.getElementById('pay-payer').value = order.company_name; document.getElementById('pay-remark').value = ''; document.getElementById('pay-account-select').value = '';
    document.getElementById('adj-actual-fee').value = order.total_booth_fee; document.getElementById('adj-reason').value = '';
    
    try { window.fmDynamicFees = JSON.parse(order.fees_json || '[]'); } catch(e) { window.fmDynamicFees = []; } 
    window.renderFmDynamicFees();
    window.resetFmSwapDraft(order);
    
    document.getElementById('exp-total-paid-display').innerText = window.formatCurrency(order.paid_amount, '¥ '); document.getElementById('exp-amount').value = ''; document.getElementById('exp-payee').value = ''; document.getElementById('exp-bank').value = ''; document.getElementById('exp-account').value = ''; document.getElementById('exp-reason').value = ''; 
    window.renderOverpaymentAlert(order, {
        rootId: 'fm-overpayment-alert',
        summaryId: 'fm-overpayment-summary',
        metaId: 'fm-overpayment-meta',
        actionsId: 'fm-overpayment-actions',
        context: 'finance'
    });
    
    window.switchFmTab(targetTab);
    await window.loadPaymentHistory(order.id); 
    await window.loadExpenseHistory(order.id); 
    
    document.getElementById('finance-modal').classList.remove('hidden');
}

window.switchFmTab = function(tab) {
    window.lastFmTab = tab; 
    const mainTitle = document.getElementById('fm-main-title');
    const titles = { 'pay': '收款流水管理', 'adj': '变更费用信息', 'swap': '换展位办理', 'exp': '代付与返佣申请' };
    mainTitle.innerText = titles[tab] || titles['pay'];
    document.getElementById('fm-tab-pay').classList.add('hidden'); document.getElementById('fm-tab-adj').classList.add('hidden'); document.getElementById('fm-tab-swap').classList.add('hidden'); document.getElementById('fm-tab-exp').classList.add('hidden');
    document.getElementById(`fm-tab-${tab}`).classList.remove('hidden');
}

window.refreshFinanceModalStats = function() {
    const updatedOrder = window.allOrders.find(o => String(o.id) === String(window.currentModalOrderId));
    if (updatedOrder) {
        window.currentFinanceOrder = updatedOrder;
        document.getElementById('fm-order-title').innerText = `当前客户：${updatedOrder.company_name} (展位: ${updatedOrder.booth_id})`;
        document.getElementById('fm-total').innerText = window.formatCurrency(updatedOrder.total_amount);
        document.getElementById('fm-paid').innerText = window.formatCurrency(updatedOrder.paid_amount);
        document.getElementById('fm-unpaid').innerText = window.formatCurrency(Number(updatedOrder.total_amount || 0) - Number(updatedOrder.paid_amount || 0));
        document.getElementById('exp-total-paid-display').innerText = window.formatCurrency(updatedOrder.paid_amount);
        window.resetFmSwapDraft(updatedOrder);
        window.renderOverpaymentAlert(updatedOrder, {
            rootId: 'fm-overpayment-alert',
            summaryId: 'fm-overpayment-summary',
            metaId: 'fm-overpayment-meta',
            actionsId: 'fm-overpayment-actions',
            context: 'finance'
        });
    }
}

window.ensureSwapInventoryLoaded = async function(projectId) {
    const normalizedProjectId = String(projectId || '');
    if (!normalizedProjectId) return;
    if (window.swapInventoryProjectId === normalizedProjectId && Array.isArray(window.allBooths) && window.allBooths.length > 0) return;
    const [priceRes, boothRes] = await Promise.all([
        window.apiFetch(`/api/prices?projectId=${encodeURIComponent(normalizedProjectId)}`),
        window.apiFetch(`/api/booths?projectId=${encodeURIComponent(normalizedProjectId)}`)
    ]);
    const priceData = await priceRes.json();
    globalPrices = {
        '标摊': priceData['标摊'] || 0,
        '豪标': priceData['豪标'] || 0,
        '光地': priceData['光地'] || 0
    };
    allBooths = await boothRes.json();
    window.swapInventoryProjectId = normalizedProjectId;
}

window.normalizeSwapFeeDraft = function(rawFees) {
    let parsed = [];
    try {
        parsed = Array.isArray(rawFees) ? rawFees : JSON.parse(rawFees || '[]');
    } catch (e) {
        parsed = [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .map((item) => ({
            name: String(item?.name || '').trim(),
            amount: Number(item?.amount || 0)
        }))
        .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0);
}

window.fmSwapAddFeeRow = function() {
    window.fmSwapFees.push({ name: '', amount: '' });
    window.fmSwapRenderFees();
}

window.fmSwapRemoveFeeRow = function(idx) {
    window.fmSwapFees.splice(idx, 1);
    window.fmSwapRenderFees();
}

window.fmSwapUpdateFeeData = function(idx, field, value) {
    if (!window.fmSwapFees[idx]) return;
    window.fmSwapFees[idx][field] = value;
    window.calculateSwapDraftTotal();
}

window.fmSwapRenderFees = function() {
    const container = document.getElementById('fm-swap-fees-container');
    if (!container) return;
    const feeRows = window.fmSwapFees || [];
    if (feeRows.length === 0) {
        container.innerHTML = '<div class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-400">当前没有其他收费项，可按需新增</div>';
        window.calculateSwapDraftTotal();
        return;
    }
    container.innerHTML = feeRows.map((fee, idx) => {
        const safeName = window.escapeAttr ? window.escapeAttr(fee.name || '') : String(fee.name || '');
        const amountValue = fee.amount === '' ? '' : Number(fee.amount || 0);
        return `
            <div class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
                <input type="text" value="${safeName}" placeholder="收费名称 (如：搭建费)" oninput="window.fmSwapUpdateFeeData(${idx}, 'name', this.value)" class="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                <span class="text-sm font-bold text-slate-400">¥</span>
                <input type="number" value="${amountValue}" placeholder="金额" oninput="window.fmSwapUpdateFeeData(${idx}, 'amount', this.value)" class="w-28 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 tabular-data focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                <button type="button" onclick="window.fmSwapRemoveFeeRow(${idx})" class="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-100">${window.renderIcon('close', 'h-3.5 w-3.5', 2.1)}<span>删除</span></button>
            </div>
        `;
    }).join('');
    window.calculateSwapDraftTotal();
}

window.calculateSwapDraftTotal = function() {
    const actualFee = parseFloat(document.getElementById('fm-swap-actual-fee')?.value || 0) || 0;
    const otherTotal = (window.fmSwapFees || []).reduce((sum, fee) => sum + (parseFloat(fee.amount || 0) || 0), 0);
    const nextTotal = actualFee + otherTotal;
    const boothFeePreview = document.getElementById('fm-swap-booth-fee-preview');
    const otherFeePreview = document.getElementById('fm-swap-other-fee-preview');
    const totalPreview = document.getElementById('fm-swap-total-preview');
    const nextTotalEl = document.getElementById('fm-swap-next-total');
    if (boothFeePreview) boothFeePreview.innerText = window.formatCurrency(actualFee);
    if (otherFeePreview) otherFeePreview.innerText = window.formatCurrency(otherTotal);
    if (totalPreview) totalPreview.innerText = window.formatCurrency(nextTotal);
    if (nextTotalEl) nextTotalEl.innerText = window.fmSwapCandidateBooth ? window.formatCurrency(nextTotal) : '-';
}

window.resetFmSwapDraft = function(order) {
    const currentOrder = order || window.currentFinanceOrder;
    if (!currentOrder) return;
    window.fmSwapCandidateBooth = null;
    window.fmSwapFees = window.normalizeSwapFeeDraft(currentOrder.fees_json);
    document.getElementById('fm-swap-current-booth').innerText = `${currentOrder.hall || ''} - ${currentOrder.booth_id || '-'}`;
    document.getElementById('fm-swap-current-area').innerText = `${Number(currentOrder.area || 0).toLocaleString()}㎡`;
    document.getElementById('fm-swap-current-total').innerText = window.formatCurrency(currentOrder.total_amount || 0);
    document.getElementById('fm-swap-current-paid').innerText = window.formatCurrency(currentOrder.paid_amount || 0);
    document.getElementById('fm-swap-next-booth').innerText = '待选择';
    document.getElementById('fm-swap-next-area').innerText = '-';
    document.getElementById('fm-swap-next-total').innerText = '-';
    document.getElementById('fm-swap-booth-search').value = '';
    document.getElementById('fm-swap-actual-fee').value = Number(currentOrder.total_booth_fee || 0);
    document.getElementById('fm-swap-price-reason').value = '';
    document.getElementById('fm-swap-reason').value = '';
    document.getElementById('fm-swap-target-name').innerText = '-';
    document.getElementById('fm-swap-target-meta').innerText = '-';
    document.getElementById('fm-swap-target-standard').innerText = '¥0';
    document.getElementById('fm-swap-target-card').classList.add('hidden');
    window.fmSwapRenderFees();
}

window.searchSwapBooth = async function() {
    const projectId = document.getElementById('global-project-select').value;
    const currentOrder = window.currentFinanceOrder;
    const searchValue = document.getElementById('fm-swap-booth-search').value.trim().toUpperCase();
    if (!currentOrder || !projectId) return window.showToast('未找到当前订单，无法换展位', 'error');
    if (!searchValue) return window.showToast('请先输入准确展位号', 'error');
    window.toggleBtnLoading('btn-search-swap-booth', true, '搜索新展位');
    try {
        await window.ensureSwapInventoryLoaded(projectId);
        const targetBooth = (window.allBooths || []).find((item) => String(item.id || '').trim().toUpperCase() === searchValue);
        if (!targetBooth) throw new Error(`未找到展位：${searchValue}`);
        if (String(targetBooth.id || '') === String(currentOrder.booth_id || '')) {
            throw new Error('目标展位与当前展位相同，无需换展位');
        }
        if (String(targetBooth.status || '') === '已锁定') {
            throw new Error('目标展位已被临时锁定，请稍后再试');
        }
        if (String(targetBooth.status || '') === '已预订' || String(targetBooth.status || '') === '已成交') {
            throw new Error('目标展位当前已被其他订单占用，请重新选择');
        }
        const area = Number(targetBooth.area || 0);
        if (!Number.isFinite(area) || area <= 0) throw new Error('目标展位面积异常，无法换展位');
        const boothPricing = window.calculateBoothStandardFee(targetBooth, area);
        window.fmSwapCandidateBooth = {
            id: String(targetBooth.id || ''),
            hall: String(targetBooth.hall || ''),
            type: String(targetBooth.type || ''),
            area,
            price_unit: String(targetBooth.price_unit || (String(targetBooth.type || '') === '光地' ? '平米' : '个')),
            unit_price: Number(boothPricing.priceUnit || 0),
            standard_fee: Number(boothPricing.standardFee || 0)
        };
        document.getElementById('fm-swap-target-name').innerText = `${window.fmSwapCandidateBooth.hall} - ${window.fmSwapCandidateBooth.id}`;
        document.getElementById('fm-swap-target-meta').innerText = `${window.fmSwapCandidateBooth.type} | 面积 ${area.toLocaleString()}㎡ | ${window.fmSwapCandidateBooth.price_unit === '平米' ? `${window.formatCurrency(window.fmSwapCandidateBooth.unit_price)}/平米` : `${window.formatCurrency(window.fmSwapCandidateBooth.unit_price)}/个(9㎡)`}`;
        document.getElementById('fm-swap-target-standard').innerText = window.formatCurrency(window.fmSwapCandidateBooth.standard_fee);
        document.getElementById('fm-swap-target-card').classList.remove('hidden');
        document.getElementById('fm-swap-next-booth').innerText = `${window.fmSwapCandidateBooth.hall} - ${window.fmSwapCandidateBooth.id}`;
        document.getElementById('fm-swap-next-area').innerText = `${area.toLocaleString()}㎡`;
        document.getElementById('fm-swap-actual-fee').value = window.fmSwapCandidateBooth.standard_fee;
        document.getElementById('fm-swap-price-reason').value = '';
        window.calculateSwapDraftTotal();
        window.showToast(`已选中目标展位：${window.fmSwapCandidateBooth.id}`);
    } catch (e) {
        window.fmSwapCandidateBooth = null;
        document.getElementById('fm-swap-target-card').classList.add('hidden');
        document.getElementById('fm-swap-next-booth').innerText = '待选择';
        document.getElementById('fm-swap-next-area').innerText = '-';
        document.getElementById('fm-swap-next-total').innerText = '-';
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-search-swap-booth', false, '搜索新展位');
    }
}

window.submitBoothSwap = async function() {
    const projectId = document.getElementById('global-project-select').value;
    const currentOrder = window.currentFinanceOrder;
    const candidate = window.fmSwapCandidateBooth;
    if (!currentOrder || !projectId) return window.showToast('未找到当前订单，无法换展位', 'error');
    if (!candidate) return window.showToast('请先搜索并选中目标展位', 'error');
    const actualFee = parseFloat(document.getElementById('fm-swap-actual-fee').value || 0);
    const priceReason = document.getElementById('fm-swap-price-reason').value.trim();
    const swapReason = document.getElementById('fm-swap-reason').value.trim();
    if (!Number.isFinite(actualFee) || actualFee < 0) return window.showToast('请输入正确的新展位成交展位费', 'error');
    if (actualFee < Number(candidate.standard_fee || 0) && !priceReason) return window.showToast('新展位成交价低于系统原价时，请填写价格说明', 'error');
    if (!swapReason) return window.showToast('请填写换展位原因', 'error');
    const feeRows = [];
    for (const fee of (window.fmSwapFees || [])) {
        const name = String(fee?.name || '').trim();
        const rawAmount = String(fee?.amount ?? '').trim();
        if (!name && !rawAmount) continue;
        const amount = Number(rawAmount || 0);
        if (!name) return window.showToast('其他收费明细存在未填写名称的行', 'error');
        if (!Number.isFinite(amount) || amount < 0) return window.showToast(`其他收费 [${name}] 的金额无效`, 'error');
        if (amount <= 0) continue;
        feeRows.push({ name, amount });
    }
    window.toggleBtnLoading('btn-submit-swap', true, '确认换展位并更新订单');
    try {
        const res = await window.apiFetch('/api/change-order-booth', {
            method: 'POST',
            body: JSON.stringify({
                project_id: projectId,
                order_id: currentOrder.id,
                target_booth_id: candidate.id,
                actual_fee: actualFee,
                price_reason: priceReason,
                swap_reason: swapReason,
                fees_json: feeRows
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '换展位失败，请稍后再试');
        }
        window.showToast('换展位成功，订单与统计已同步更新');
        await window.loadOrderList();
        await window.loadPaymentHistory(window.currentModalOrderId);
        await window.loadExpenseHistory(window.currentModalOrderId);
        window.refreshFinanceModalStats();
        window.switchFmTab('swap');
        window.refreshVisibleOrderContexts();
    } catch (e) {
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-submit-swap', false, '确认换展位并更新订单');
    }
}

window.openOverpaymentModalById = function(orderId, action = 'fx_diff', returnContext = 'detail') {
    const order = (window.allOrders || []).find((item) => String(item.id) === String(orderId));
    if (!order) return window.showToast('找不到对应订单，无法处理超收', 'error');
    if (!window.canHandleOverpayment(order)) return window.showToast('仅超级管理员或订单所属业务员可处理超收', 'error');
    window.currentOverpaymentOrderId = order.id;
    window.currentOverpaymentProjectId = Number(order.project_id || document.getElementById('global-project-select').value || 0);
    window.currentOverpaymentReturnContext = returnContext;
    document.getElementById('overpayment-action').value = action;
    document.getElementById('overpayment-note').value = order.overpayment_note || '';
    document.getElementById('overpayment-order-title').innerText = `${order.company_name} (${order.booth_id})`;
    const overpaidAmount = window.getOverpaidAmount(order);
    document.getElementById('overpayment-order-summary').innerText = `当前应收 ${window.formatCurrency(order.total_amount || 0)}，已收 ${window.formatCurrency(order.paid_amount || 0)}，超收 ${window.formatCurrency(overpaidAmount)}。若选择下方“确认汇率差”或“暂挂并填写说明”，系统会自动把本次差额补录为一条其他应收明细并自动平账。`;
    document.getElementById('overpayment-modal').classList.remove('hidden');
}

window.handleOverpaymentGoAdjust = function() {
    const orderId = window.currentOverpaymentOrderId;
    if (!orderId) return;
    window.closeModal('overpayment-modal');
    window.openFinanceDirectById(String(orderId), 'adj');
}

window.submitOverpaymentHandling = async function() {
    const orderId = Number(window.currentOverpaymentOrderId || 0);
    const projectId = Number(window.currentOverpaymentProjectId || 0);
    const action = document.getElementById('overpayment-action').value;
    const note = document.getElementById('overpayment-note').value.trim();
    if (!orderId || !projectId) return window.showToast('订单信息缺失，无法保存处理结果', 'error');
    if (!note) return window.showToast(action === 'fx_diff' ? '请填写汇率差说明' : '请填写暂挂说明', 'error');
    window.toggleBtnLoading('btn-submit-overpayment', true);
    try {
        const res = await window.apiFetch('/api/resolve-overpayment', {
            method: 'POST',
            body: JSON.stringify({ order_id: orderId, project_id: projectId, action, note })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '保存处理结果失败');
        }
        window.showToast('超收处理结果已保存，并已自动补录其他应收明细');
        window.closeModal('overpayment-modal');
        await window.loadOrderList();
        window.refreshVisibleOrderContexts();
    } catch (e) {
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-submit-overpayment', false);
    }
}

window.loadPaymentHistory = async function(orderId) {
    const listDiv = document.getElementById('fm-pay-list'); listDiv.innerHTML = '<span class="text-gray-400">加载中...</span>';
    try {
        const response = await window.apiFetch(`/api/payments?orderId=${orderId}`); 
        if(!response.ok) throw new Error("获取历史记录失败");
        const pays = await response.json();
        if(pays.length === 0) { listDiv.innerHTML = '<p class="text-gray-400 italic">暂无收款记录</p>'; return; }
        listDiv.innerHTML = '';
        pays.forEach(p => {
            const safePayer = String(p.payer_name || '').replace(/'/g, "\\'");
            const safeBank = String(p.bank_name || '').replace(/'/g, "\\'");
            const safeRem = String(p.remarks || '').replace(/'/g, "\\'");
            const safePayerText = window.escapeHtml(p.payer_name || '');
            const safeBankText = window.escapeHtml(p.bank_name || '未填');
            const safeRemarkText = window.escapeHtml(p.remarks || '无');
            const isErpSync = p.source === 'ERP_SYNC';
            let detailsHtml = `<div class="text-xs text-gray-600 mt-1">付款户名: ${safePayerText}</div><div class="text-xs text-gray-500">收款途径: ${safeBankText} | 备注: ${safeRemarkText}</div>`;
            if (isErpSync) {
                let raw = null;
                try { raw = p.raw_payload ? JSON.parse(p.raw_payload) : null; } catch (e) { raw = null; }
                const safeProject = window.escapeHtml(raw?.extensionName || raw?.project_name || raw?.projectName || '未提供');
                const safeReceivablesUnit = window.escapeHtml(raw?.receivablesUnit || raw?.payerName || p.payer_name || '未提供');
                const safeAccountCompany = window.escapeHtml(raw?.accountCompany || raw?.account_company || '');
                const safeCorporateAccount = window.escapeHtml(raw?.corporateAccount || raw?.corporate_account || '未提供');
                const safeAccount = window.escapeHtml(raw?.account || raw?.account_no || '未提供');
                const safeReceiveBank = window.escapeHtml(raw?.bank || raw?.bankName || raw?.bank_name || p.bank_name || '未提供');
                const showAccountCompany = safeAccountCompany && safeAccountCompany !== safeReceivablesUnit;
                const extraRemarkText = String(p.remarks || '').trim();
                const extraRemarkHtml = extraRemarkText && !extraRemarkText.startsWith('ERP同步导入：')
                    ? `<div class="text-xs text-slate-500">备注: ${window.escapeHtml(extraRemarkText)}</div>`
                    : '';
                const partyLine = [
                    showAccountCompany ? `入账企业: ${safeAccountCompany}` : '',
                    `付款名: ${safeReceivablesUnit}`,
                    `收至银行: ${safeReceiveBank}`
                ].filter(Boolean).join(' | ');
                const accountLine = [
                    safeCorporateAccount && safeCorporateAccount !== '未提供' ? safeCorporateAccount : '',
                    safeAccount && safeAccount !== '未提供' ? safeAccount : ''
                ].filter(Boolean).join(' | ');
                detailsHtml = `
                    <div class="mt-1 space-y-1 text-xs">
                        <div class="font-medium text-slate-700">ERP项目: ${safeProject}</div>
                        <div class="text-slate-500">${partyLine}</div>
                        ${accountLine ? `<div class="text-slate-500">收款账户: ${accountLine}</div>` : ''}
                        ${extraRemarkHtml}
                    </div>
                `;
            }
            const actionHtml = isErpSync
                ? `<span class="badge-readonly">ERP 同步只读</span>`
                : `<div><button onclick="window.openEditPaymentModal('${p.id}', ${p.amount}, '${safePayer}', '${safeBank}', '${safeRem}', '${p.payment_time}')" class="btn-soft-primary px-3 py-1 text-xs mr-2">修改</button><button onclick="window.deletePayment('${p.id}')" class="btn-soft-danger px-3 py-1 text-xs">删除</button></div>`;
            const sourceBadge = isErpSync
                ? '<span class="ml-2 badge-readonly">ERP同步</span>'
                : '';
            listDiv.innerHTML += `<div class="bg-white border rounded p-3 flex justify-between items-start gap-4 hover:bg-gray-50 transition"><div class="min-w-0 flex-1"><div class="font-bold text-green-600 text-lg">到账 ¥${p.amount}${sourceBadge}</div>${detailsHtml}</div><div class="text-right flex shrink-0 flex-col items-end gap-2"><div class="text-xs font-bold text-gray-700 tabular-data">${window.escapeHtml(p.payment_time)}</div>${actionHtml}</div></div>`;
        });
    } catch (e) { listDiv.innerHTML = `<p class="text-red-500">加载失败: ${e.message}</p>`; }
}

window.submitPayment = async function() {
    const pid = document.getElementById('global-project-select').value; const amt = parseFloat(document.getElementById('pay-amount').value); const time = document.getElementById('pay-time').value; const payer = document.getElementById('pay-payer').value.trim(); const bank = document.getElementById('pay-account-select').value; const orderId = document.getElementById('fm-order-id').value;
    if(!amt || amt <= 0) return window.showToast("请输入正确的收款金额", 'error'); if(!time || !payer) return window.showToast("时间和打款户名为必填项！", 'error'); if(!bank) return window.showToast("请选择途径！", 'error');
    window.toggleBtnLoading('btn-submit-payment', true);
    try { 
        const res = await window.apiFetch('/api/add-payment', { method: 'POST', body: JSON.stringify({ project_id: pid, order_id: orderId, amount: amt, payment_time: time, payer_name: payer, bank_name: bank, remarks: document.getElementById('pay-remark').value }) }); 
        if(!res.ok) { const err = await res.json(); throw new Error(err.error || "写入流水失败"); }
        window.showToast("收款入账成功！"); 
        
        await window.loadOrderList(); 
        await window.loadPaymentHistory(orderId);
        window.refreshFinanceModalStats();
        window.refreshVisibleOrderContexts();
        
        document.getElementById('pay-amount').value = '';
        document.getElementById('pay-remark').value = '';
    } catch (e) { window.showToast(e.message, 'error'); } finally { window.toggleBtnLoading('btn-submit-payment', false); }
}

window.openEditPaymentModal = function(id, amt, payer, bank, remark, time) { document.getElementById('ep-id').value = id; document.getElementById('ep-amount').value = amt; document.getElementById('ep-payer').value = payer; document.getElementById('ep-bank').value = bank; document.getElementById('ep-time').value = time; document.getElementById('ep-remark').value = remark; document.getElementById('edit-payment-modal').classList.remove('hidden'); }

window.submitEditPayment = async function() {
    const pid = document.getElementById('global-project-select').value; const data = { project_id: pid, order_id: window.currentModalOrderId, payment_id: document.getElementById('ep-id').value, amount: parseFloat(document.getElementById('ep-amount').value), payer_name: document.getElementById('ep-payer').value.trim(), bank_name: document.getElementById('ep-bank').value, payment_time: document.getElementById('ep-time').value, remarks: document.getElementById('ep-remark').value };
    if(!data.amount || !data.payer_name) return window.showToast("金额和户名必填", 'error');
    window.toggleBtnLoading('btn-save-payment', true); 
    try {
        const res = await window.apiFetch('/api/edit-payment', { method: 'POST', body: JSON.stringify(data) }); 
        if(!res.ok) throw new Error("流水修改失败");
        window.closeModal('edit-payment-modal'); 
        window.showToast("流水修改成功！"); 
        
        await window.loadOrderList();
        await window.loadPaymentHistory(window.currentModalOrderId); 
        window.refreshFinanceModalStats();
        window.refreshVisibleOrderContexts();
    } catch (e) { window.showToast(e.message, 'error'); } finally { window.toggleBtnLoading('btn-save-payment', false); }
}

window.deletePayment = async function(payId) { 
    if(!confirm("确定要删除这条收款记录吗？")) return; 
    try {
        const res = await window.apiFetch('/api/delete-payment', { method: 'POST', body: JSON.stringify({ project_id: document.getElementById('global-project-select').value, order_id: window.currentModalOrderId, payment_id: payId }) }); 
        if(!res.ok) throw new Error("删除失败");
        window.showToast("删除成功"); 
        await window.loadOrderList();
        await window.loadPaymentHistory(window.currentModalOrderId); 
        window.refreshFinanceModalStats();
        window.refreshVisibleOrderContexts();
    } catch (e) { window.showToast(e.message, 'error'); }
}

window.fmAddFeeRow = function() { window.fmDynamicFees.push({ name: '', amount: '' }); window.renderFmDynamicFees(); }
window.fmRemoveFeeRow = function(idx) { window.fmDynamicFees.splice(idx, 1); window.renderFmDynamicFees(); }
window.fmUpdateFeeData = function(idx, field, val) { window.fmDynamicFees[idx][field] = val; window.calculateFmAdjustTotal(); }
window.renderFmDynamicFees = function() {
    const container = document.getElementById('fm-dynamic-fees-container'); container.innerHTML = '';
    window.fmDynamicFees.forEach((fee, idx) => { container.innerHTML += `<div class="flex gap-2 items-center bg-white p-2 rounded border border-orange-100 shadow-sm"><input type="text" placeholder="名称" value="${fee.name}" oninput="window.fmUpdateFeeData(${idx}, 'name', this.value)" class="border p-1.5 rounded flex-1 text-sm bg-gray-50"><span class="text-gray-500 font-bold">¥</span><input type="number" placeholder="金额" value="${fee.amount}" oninput="window.fmUpdateFeeData(${idx}, 'amount', this.value)" class="border p-1.5 rounded w-24 text-sm bg-gray-50 font-bold text-gray-700"><button onclick="window.fmRemoveFeeRow(${idx})" class="text-red-500 hover:bg-red-100 font-bold px-2 py-1 rounded text-xs">删</button></div>`; });
    window.calculateFmAdjustTotal();
}
window.calculateFmAdjustTotal = function() { const af = parseFloat(document.getElementById('adj-actual-fee').value) || 0; let ot = 0; window.fmDynamicFees.forEach(f => { ot += parseFloat(f.amount) || 0; }); document.getElementById('fm-adjust-calc-total').innerText = window.formatCurrency(af + ot, '¥ '); }

window.submitAdjustment = async function() {
    const pid = document.getElementById('global-project-select').value; const af = parseFloat(document.getElementById('adj-actual-fee').value); const r = document.getElementById('adj-reason').value.trim();
    if(isNaN(af)) return window.showToast("金额错误", 'error'); if(!r) return window.showToast("必须填写原因！", 'error');
    let ot = 0; let validFees = []; window.fmDynamicFees.forEach(f => { if(f.name && parseFloat(f.amount)) { ot += parseFloat(f.amount); validFees.push(f); } });
    window.toggleBtnLoading('btn-submit-adj', true); 
    try {
        const res = await window.apiFetch('/api/update-order-fees', { method: 'POST', body: JSON.stringify({ project_id: pid, order_id: window.currentModalOrderId, actual_fee: af, other_fee_total: ot, fees_json: JSON.stringify(validFees), reason: r }) }); 
        if(!res.ok) throw new Error("账单变更失败");
        window.showToast("账单变更成功！"); 
        
        await window.loadOrderList(); 
        window.refreshFinanceModalStats();
        window.refreshVisibleOrderContexts();
    } catch (e) { window.showToast(e.message, 'error'); } finally { window.toggleBtnLoading('btn-submit-adj', false); }
}

window.loadExpenseHistory = async function(orderId) {
    const listDiv = document.getElementById('fm-exp-list'); listDiv.innerHTML = '<span class="text-gray-400">加载中...</span>';
    try {
        const response = await window.apiFetch(`/api/expenses?orderId=${orderId}`); 
        if(!response.ok) throw new Error("拉取数据失败");
        const exps = await response.json();
        if(exps.length === 0) { listDiv.innerHTML = '<p class="text-gray-400 italic">暂无代付记录</p>'; return; }
        listDiv.innerHTML = '';
        exps.forEach(e => {
            const safeE = JSON.stringify(e).replace(/'/g, "&#39;");
            const safePayeeName = window.escapeHtml(e.payee_name || '');
            const safeReason = window.escapeHtml(e.reason || '无说明');
            const safeCreatedAt = window.escapeHtml(e.created_at ? e.created_at.split(' ')[0] : '');
            const safeChannel = window.escapeHtml(e.payee_channel || '转账');
            const safeApplicant = window.escapeHtml(e.applicant || '');
            listDiv.innerHTML += `<div class="bg-white border rounded p-3 mb-2 flex justify-between items-center hover:bg-gray-50"><div><div class="font-bold text-purple-700 tabular-data">金额: ¥${e.amount} <span class="text-sm font-normal text-gray-500 ml-2">(${safePayeeName})</span></div><div class="text-xs text-gray-600 mt-1">事由: <span class="font-bold">${safeReason}</span></div><div class="text-xs text-gray-400 mt-1">${safeCreatedAt} | 渠道: ${safeChannel} | 申请人: ${safeApplicant}</div></div><div class="text-right"><button onclick='window.printExpense(${safeE})' class="bg-gray-800 text-white hover:bg-black text-xs font-bold px-3 py-1.5 rounded mr-2">打印单据</button><button onclick="window.deleteExpense('${e.id}')" class="text-red-500 hover:text-red-700 text-xs font-bold">撤销</button></div></div>`;
        });
    } catch (err) { listDiv.innerHTML = `<p class="text-red-500 font-bold">解析异常: ${err.message}</p>`; }
}

window.submitExpense = async function() {
    const pid = document.getElementById('global-project-select').value; const channel = document.getElementById('exp-channel').value; const payee = document.getElementById('exp-payee').value.trim(); const bank = document.getElementById('exp-bank').value.trim(); const acc = document.getElementById('exp-account').value.trim(); const amt = parseFloat(document.getElementById('exp-amount').value); const reason = document.getElementById('exp-reason').value.trim(); 
    if(!payee || !amt || amt <= 0 || !reason) return window.showToast("事由、收款方和金额为必填！", 'error');
    window.toggleBtnLoading('btn-submit-exp', true);
    try {
        const data = { project_id: pid, order_id: window.currentModalOrderId, fee_item_name: '总收款抵扣', payee_name: payee, payee_channel: channel, payee_bank: bank, payee_account: acc, amount: amt, applicant: window.currentUser.name, reason: reason };
        const res = await window.apiFetch('/api/add-expense', { method: 'POST', body: JSON.stringify(data) }); 
        if(!res.ok) { const err = await res.json(); throw new Error(err.error || "写入失败"); }
        window.showToast("支出申请已记录！"); 
        document.getElementById('exp-reason').value = ''; document.getElementById('exp-payee').value = ''; document.getElementById('exp-amount').value = ''; 
        
        window.loadExpenseHistory(window.currentModalOrderId); 
    } catch(err) { window.showToast(err.message, 'error'); } finally { window.toggleBtnLoading('btn-submit-exp', false); }
}

window.deleteExpense = async function(expId) { 
    if(!confirm("确定撤销该笔申请吗？")) return; 
    try {
        const res = await window.apiFetch('/api/delete-expense', { method: 'POST', body: JSON.stringify({ expense_id: expId }) }); 
        if(!res.ok) throw new Error("撤销失败");
        window.showToast("撤销成功！"); 
        window.loadExpenseHistory(window.currentModalOrderId); 
    } catch (e) { window.showToast(e.message, 'error'); }
}

window.printExpense = function(e) {
    const order = window.allOrders.find(o => String(o.id) === String(e.order_id));
    const content = `<div class="text-center mb-6"><h2 class="text-2xl font-bold tracking-widest border-b-2 border-black pb-2 inline-block">支出确认单</h2></div><div class="flex justify-between text-sm mb-2 font-bold"><span>单据编号：EXP-${e.id}-${Date.now().toString().slice(-4)}</span><span>申请日期：${e.created_at ? e.created_at.split(' ')[0] : '即日'}</span></div><table class="w-full text-left border-collapse border border-black mb-6 text-sm"><tr><th class="border border-black p-3 bg-gray-100 w-1/4">项目名称</th><td class="border border-black p-3 font-bold" colspan="3">${document.getElementById('global-project-select').options[document.getElementById('global-project-select').selectedIndex].text}</td></tr><tr><th class="border border-black p-3 bg-gray-100">关联展商/展位</th><td class="border border-black p-3 font-bold text-blue-800" colspan="3">${order.company_name} (展位: ${order.booth_id})</td></tr><tr><th class="border border-black p-3 bg-gray-100">代付/返佣事由</th><td class="border border-black p-3 font-bold text-purple-800" colspan="3">${e.reason || '无说明'}</td></tr><tr><th class="border border-black p-3 bg-gray-100">申请支付金额</th><td class="border border-black p-3 font-bold text-xl text-red-600" colspan="3">${window.formatCurrency(e.amount, '¥ ')}</td></tr><tr><th class="border border-black p-3 bg-gray-100">收款单位全称</th><td class="border border-black p-3 font-bold" colspan="3">${e.payee_name} <span class="text-gray-500 font-normal">(${e.payee_channel || '转账'})</span></td></tr><tr><th class="border border-black p-3 bg-gray-100">收款账号</th><td class="border border-black p-3 tracking-widest font-bold" colspan="3">${e.payee_account || '未提供'}</td></tr><tr><th class="border border-black p-3 bg-gray-100">开户行详情</th><td class="border border-black p-3" colspan="3">${e.payee_bank || '未提供'}</td></tr></table><div class="text-sm font-bold mt-10 pt-6">申请人：${e.applicant || ''}</div>`;
    document.getElementById('print-content').innerHTML = content; document.getElementById('print-modal').classList.remove('hidden');
}

window.cancelOrder = async function(orderId, boothId) {
    const pid = document.getElementById('global-project-select').value;
    if(!confirm(`🚨 危险操作：确定要退订订单吗？\n如果该展位没有其他正常订单，它将被释放回可售状态！\n(内部流水号将跳过不复用)`)) return;
    try {
        const res = await window.apiFetch('/api/cancel-order', { method: 'POST', body: JSON.stringify({ project_id: pid, order_id: orderId, booth_id: boothId }) });
        if(res.ok) { window.showToast("退订成功！"); window.loadOrderList(); } 
        else { const err = await res.json(); window.showToast(err.error || "退订失败", 'error'); }
    } catch (e) { /* handled */ }
}
