// ================= js/finance.js =================
window.isOwnOrder = function(order) {
    return order && order.sales_name === window.currentUser.name;
}

window.canManageOrder = function(order) {
    return !!order && (window.currentUser.role === 'admin' || Number(order.can_manage) === 1);
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

    const fmtMoney = (value) => `¥${Number(value || 0).toLocaleString()}`;
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
    const statusFilter = document.getElementById('order-status-filter').value;
    
    const batchBtn = document.querySelector('button[onclick="window.batchDownloadContracts()"]');
    if(batchBtn) {
        batchBtn.style.display = window.currentUser.role === 'admin' ? 'inline-flex' : 'none';
    }

    const filtered = (window.allOrders || []).filter(o => {
        if(searchTxt && !(o.company_name.toLowerCase().includes(searchTxt) || o.booth_id.toLowerCase().includes(searchTxt))) return false;
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

    const ownCount = filtered.filter((order) => window.isOwnOrder(order)).length;
    document.getElementById('order-total-stats').innerText = `共 ${filtered.length} 笔订单，本人录入 ${ownCount} 笔`;
    const tbody = document.getElementById('order-list-tbody'); tbody.innerHTML = '';
    
    const checkAllBox = document.getElementById('check-all-orders');
    if(checkAllBox) checkAllBox.checked = false;

    filtered.forEach(o => {
        const canManage = window.canManageOrder(o);
        const isOwn = window.isOwnOrder(o);
        let payBadge = `<span class="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">🔴 未付款</span>`;
        if(o.paid_amount > 0 && o.paid_amount < o.total_amount) {
            let ratio = ((o.paid_amount / o.total_amount) * 100).toFixed(1);
            let remain = o.total_amount - o.paid_amount;
            payBadge = `<div class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold flex flex-col items-center leading-tight"><span>🟡 已付定金 (${ratio}%)</span><span class="text-yellow-600 mt-1">剩¥${remain}</span></div>`;
        }
        if(o.paid_amount >= o.total_amount) payBadge = `<span class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">🟢 已付全款</span>`;

        const safeCompany = window.escapeHtml ? window.escapeHtml(o.company_name) : o.company_name;
        const safeHall = window.escapeHtml(o.hall || '');
        const safeBoothId = window.escapeHtml(o.booth_id || '');
        const safeRegion = window.escapeHtml(o.region || '未填');
        const safeBoothType = window.escapeHtml(o.booth_type || '');
        const safeSalesName = window.escapeHtml(o.sales_name || '');

        // 【核心优化】：合同状态 UI 升级，明确展示状态，仅保留预览和重新上传
        let contractBtn = '';
        if (canManage && o.contract_url) {
            contractBtn = `
                <div class="flex flex-col items-center justify-center gap-1.5">
                    <span class="text-green-700 text-xs font-bold bg-green-100 px-2 py-0.5 rounded shadow-sm">✅ 已上传</span>
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick='window.previewSingleContract(${JSON.stringify(String(o.contract_url))}, ${JSON.stringify(String(o.id))})' class="text-blue-600 hover:text-blue-800 text-xs font-bold underline">预览</button>
                        <span class="text-gray-300">|</span>
                        <button onclick='window.triggerSilentUpload(${JSON.stringify(String(o.id))})' class="text-orange-500 hover:text-orange-700 text-xs font-bold underline">重新上传</button>
                    </div>
                </div>
            `;
        } else if (canManage) {
            contractBtn = `
                <div class="flex flex-col items-center justify-center gap-1.5">
                    <span class="text-gray-500 text-xs font-bold bg-gray-100 px-2 py-0.5 rounded shadow-sm">❌ 暂未上传</span>
                    <button onclick='window.triggerSilentUpload(${JSON.stringify(String(o.id))})' class="text-blue-600 hover:text-blue-800 text-xs font-bold underline">点击上传</button>
                </div>
            `;
        } else {
            contractBtn = `
                <div class="flex flex-col items-center justify-center gap-1.5">
                    <span class="text-gray-500 text-xs font-bold bg-gray-100 px-2 py-0.5 rounded shadow-sm">${Number(o.has_contract) === 1 ? '✅ 已上传' : '❌ 暂未上传'}</span>
                    <span class="text-gray-300 text-xs font-bold">${Number(o.has_contract) === 1 ? '预览受限' : '无权限查看'}</span>
                </div>
            `;
        }

        const checkboxHtml = `<input type="checkbox" class="order-check cursor-pointer" value="${o.id}" ${canManage ? '' : 'disabled'}>`;
        const companyLabel = isOwn ? '<span class="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">本人录入</span>' : '<span class="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">他人录入</span>';
        const stickyActionCellClass = 'p-3 text-center whitespace-nowrap align-middle sticky right-0 bg-white shadow-[-10px_0_14px_-14px_rgba(15,23,42,0.5)]';
        const actionHtml = canManage
            ? `
                <button onclick='window.openFinanceDirectById(${JSON.stringify(String(o.id))}, "pay")' class="bg-blue-600 text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-blue-700 shadow-sm">💰 收款</button>
                <button onclick='window.openFinanceDirectById(${JSON.stringify(String(o.id))}, "adj")' class="bg-orange-500 text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-orange-600 shadow-sm mx-1">🛠️ 变更</button>
                <button onclick='window.openFinanceDirectById(${JSON.stringify(String(o.id))}, "exp")' class="bg-purple-600 text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-purple-700 shadow-sm mr-2">📤 代付</button>
                ${window.currentUser.role==='admin' ? `<button onclick='window.cancelOrder(${JSON.stringify(String(o.id))}, ${JSON.stringify(String(o.booth_id))})' class="text-red-500 hover:text-red-700 text-xs border border-red-200 px-2 py-1.5 rounded bg-white font-bold shadow-sm">退订</button>` : ''}
            `
            : `
                <button class="bg-gray-200 text-gray-400 px-2 py-1.5 rounded text-xs font-bold cursor-not-allowed">💰 收款</button>
                <button class="bg-gray-200 text-gray-400 px-2 py-1.5 rounded text-xs font-bold cursor-not-allowed mx-1">🛠️ 变更</button>
                <button class="bg-gray-200 text-gray-400 px-2 py-1.5 rounded text-xs font-bold cursor-not-allowed mr-2">📤 代付</button>
            `;

        tbody.innerHTML += `
            <tr class="border-b hover:bg-blue-50 transition">
                <td class="p-3 text-center">${checkboxHtml}</td>
                <td class="p-3 text-center align-middle">${payBadge}</td>
                <td class="p-3 font-bold text-gray-600">${safeHall}</td>
                <td class="p-3 font-bold text-blue-700 text-lg">${safeBoothId}</td>
                <td class="p-3 text-xs text-gray-500 truncate max-w-[120px]" title="${safeRegion}">${safeRegion}</td>
                <td class="p-3 font-bold text-gray-800 cursor-pointer hover:text-blue-600 hover:underline max-w-[220px] truncate" onclick='window.showOrderDetailById(${JSON.stringify(String(o.id))})' title="点击查看详情">${safeCompany}${companyLabel}</td>
                <td class="p-3">${o.area} ㎡</td>
                <td class="p-3 text-xs text-gray-500">${safeBoothType}</td>
                <td class="p-3 text-xs text-gray-600 font-bold">${safeSalesName}</td>
                <td class="p-3 text-right font-bold text-gray-800">¥${o.total_amount}</td>
                <td class="p-3 text-right font-bold text-green-600">¥${o.paid_amount}</td>
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
        window.showToast("✅ 合同打包下载成功！");
    } catch (error) {
        window.showToast("打包下载过程中出现网络错误", "error");
    } finally {
        btn.innerHTML = originalHtml; btn.disabled = false; btn.classList.remove('opacity-70', 'cursor-wait');
    }
}

window.exportToExcel = async function() {
    if(!window.allOrders || window.allOrders.length === 0) return window.showToast("当前无数据可导出", 'error');

    const safeWrap = (val) => `"${(val ?? '').toString().replace(/"/g, '""')}"`;
    const fmtMoney = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');
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

    const buildPaymentSummary = (payments) => (payments || []).map((payment) => {
        const pieces = [
            `金额¥${fmtMoney(payment.amount)}`,
            `时间${payment.payment_time || ''}`,
            `付款人${payment.payer_name || '未填'}`,
            `收款银行${payment.bank_name || '未填'}`
        ];
        if (payment.remarks) pieces.push(`备注${payment.remarks}`);
        if (payment.source) pieces.push(`来源${payment.source}`);
        return pieces.join(' / ');
    }).join('；');

    const buildExpenseSummary = (expenses) => (expenses || []).map((expense) => {
        const pieces = [
            `事由${expense.reason || '未填'}`,
            `渠道${expense.payee_channel || '未填'}`,
            `收款人/供应商${expense.payee_name || '未填'}`,
            `金额¥${fmtMoney(expense.amount)}`,
            `账号${expense.payee_account || '未填'}`,
            `开户行${expense.payee_bank || '未填'}`,
            `申请人${expense.applicant || '未填'}`
        ];
        if (expense.created_at) pieces.push(`时间${expense.created_at}`);
        return pieces.join(' / ');
    }).join('；');

    window.showToast("正在整理导出数据，请稍候...", "info");

    try {
        const detailRows = await Promise.all(window.allOrders.map(async (order) => {
            const [paymentRes, expenseRes] = await Promise.all([
                window.apiFetch(`/api/payments?orderId=${encodeURIComponent(order.id)}`),
                window.apiFetch(`/api/expenses?orderId=${encodeURIComponent(order.id)}`)
            ]);

            const payments = paymentRes.ok ? await paymentRes.json() : [];
            const expenses = expenseRes.ok ? await expenseRes.json() : [];
            const otherFeeDetails = parseFeeDetails(order.fees_json);
            let status = order.paid_amount >= order.total_amount ? '已付全款' : (order.paid_amount > 0 ? '已付定金' : '未付款');
            if(order.status === '已退订' || order.status === '已作废') status = '已退订';

            return [
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
                payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
                buildPaymentSummary(payments),
                expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
                buildExpenseSummary(expenses),
                order.created_at || ''
            ];
        }));

        let csvContent = "\uFEFF内部状态,馆号,展位号,展位面积,类型,客户名称,信用代码/代号,地区,联系人,电话,产品分类,主营业务/展品,企业简介,业务员,应收展位费,应收其他费用,其他收费明细,总计应收金额,订单已收金额,收款流水总额,收款流水明细,代付/返佣总额,代付/返佣明细,录入时间\n";
        detailRows.forEach((row) => {
            csvContent += row.map((value) => safeWrap(value)).join(',') + "\n";
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
    window.currentViewOrder = o; 
    document.getElementById('dt-company').innerText = o.company_name; document.getElementById('dt-code').innerText = o.no_code_checked ? `无代码 (代号: ${o.credit_code})` : o.credit_code; document.getElementById('dt-booth').innerText = `${o.hall} - ${o.booth_id}`; document.getElementById('dt-sales').innerText = o.sales_name; document.getElementById('dt-time').innerText = o.created_at || '未知'; document.getElementById('dt-region').innerText = o.region || '未填'; document.getElementById('dt-contact').innerText = o.contact_person; document.getElementById('dt-phone').innerText = o.phone; document.getElementById('dt-category').innerText = o.category || '未填'; document.getElementById('dt-business').innerText = o.main_business || '未填'; document.getElementById('dt-profile').innerText = o.profile || '暂无简介'; document.getElementById('dt-agent').innerText = o.is_agent ? `由代理商 [${o.agent_name}] 代招` : '直招入驻';
    document.getElementById('edit-dt-contact').value = o.contact_person; document.getElementById('edit-dt-phone').value = o.phone; document.getElementById('edit-dt-region').value = o.region || ''; if (window.renderCategorySelect) { window.renderCategorySelect('edit-dt-category', o.category || '', true); } document.getElementById('edit-dt-business').value = o.main_business || ''; document.getElementById('edit-dt-profile').value = o.profile || ''; 
    document.querySelector(`input[name="edit_is_agent"][value="${o.is_agent ? 1 : 0}"]`).checked = true; 
    document.getElementById('edit-dt-agent-name').value = o.agent_name || '';
    
    document.querySelectorAll('input[name="edit_is_agent"]').forEach(el => el.onchange = window.toggleDtAgent);
    window.toggleDtAgent();

    const actionView = document.getElementById('dt-action-view');
    if (canManage) {
        actionView.innerHTML = '<button onclick="window.toggleDetailEditMode(true)" class="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded font-bold hover:bg-gray-100 shadow-sm flex items-center gap-2">✏️ 进入编辑模式</button>';
    } else {
        actionView.innerHTML = '<span class="text-xs text-gray-500 bg-gray-100 px-3 py-2 rounded font-bold">非本人录入，仅可查看受限信息</span>';
    }

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
    const updatedData = { project_id: pid, order_id: window.currentViewOrder.id, contact_person: document.getElementById('edit-dt-contact').value.trim(), phone: document.getElementById('edit-dt-phone').value.trim(), region: document.getElementById('edit-dt-region').value.trim(), category: document.getElementById('edit-dt-category').value.trim(), main_business: document.getElementById('edit-dt-business').value.trim(), profile: document.getElementById('edit-dt-profile').value.trim(), is_agent: isAgent, agent_name: document.getElementById('edit-dt-agent-name').value.trim() };
    if(!updatedData.contact_person || !updatedData.phone) return window.showToast("联系人和电话不能为空！", 'error');
    if(isAgent && !updatedData.agent_name) return window.showToast("请填写代理商名称！", 'error');
    window.toggleBtnLoading('btn-save-detail', true);
    try {
        const res = await window.apiFetch('/api/update-customer-info', { method: 'POST', body: JSON.stringify(updatedData) });
        if(!res.ok) throw new Error("修改失败，请重试");
        window.showToast("资料更新成功！"); Object.assign(window.currentViewOrder, updatedData); window.currentViewOrder.is_agent = updatedData.is_agent ? 1 : 0; window.showOrderDetail(window.currentViewOrder); window.loadOrderList();
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
            group.label = "🏢 系统配置对公账户";
            window.projectAccounts.forEach(a => { 
                const option = document.createElement('option');
                option.value = `${a.account_name} - ${a.bank_name || ''}`;
                option.textContent = `🏦 ${a.account_name} - ${a.bank_name || ''} (账号: ${a.account_no || '未配置'})`;
                group.appendChild(option);
            });
            sel.appendChild(group); 
        }
        
        const otherGroup = document.createElement('optgroup');
        otherGroup.label = "📱 其他常规方式";
        otherGroup.innerHTML = `<option value="微信">💬 微信</option><option value="支付宝">🔵 支付宝</option><option value="现金">💵 现金</option>`;
        sel.appendChild(otherGroup);
        
        window.openFinanceModal(order, tab);
    } catch (e) {
        window.showToast("拉取自定义账户失败，已启用基础收款模式", "info");
        window.openFinanceModal(order, tab);
    }
}

window.openFinanceModal = async function(order, forcedTab = null) {
    window.currentModalOrderId = order.id; 
    const targetTab = forcedTab || window.lastFmTab || 'pay';
    
    document.getElementById('fm-order-title').innerText = `当前客户：${order.company_name} (展位: ${order.booth_id})`;
    document.getElementById('fm-total').innerText = `¥${order.total_amount}`; 
    document.getElementById('fm-paid').innerText = `¥${order.paid_amount}`; 
    document.getElementById('fm-unpaid').innerText = `¥${order.total_amount - order.paid_amount}`;
    document.getElementById('fm-order-id').value = order.id; 
    
    document.getElementById('pay-amount').value = ''; document.getElementById('pay-time').value = new Date().toISOString().split('T')[0]; document.getElementById('pay-payer').value = order.company_name; document.getElementById('pay-remark').value = ''; document.getElementById('pay-account-select').value = '';
    document.getElementById('adj-actual-fee').value = order.total_booth_fee; document.getElementById('adj-reason').value = '';
    
    try { window.fmDynamicFees = JSON.parse(order.fees_json || '[]'); } catch(e) { window.fmDynamicFees = []; } 
    window.renderFmDynamicFees();
    
    document.getElementById('exp-total-paid-display').innerText = `¥ ${order.paid_amount.toLocaleString()}`; document.getElementById('exp-amount').value = ''; document.getElementById('exp-payee').value = ''; document.getElementById('exp-bank').value = ''; document.getElementById('exp-account').value = ''; document.getElementById('exp-reason').value = ''; 
    
    window.switchFmTab(targetTab);
    await window.loadPaymentHistory(order.id); 
    await window.loadExpenseHistory(order.id); 
    
    document.getElementById('finance-modal').classList.remove('hidden');
}

window.switchFmTab = function(tab) {
    window.lastFmTab = tab; 
    const mainTitle = document.getElementById('fm-main-title');
    const titles = { 'pay': '💰 收款流水管理', 'adj': '🛠️ 变更费用信息', 'exp': '📤 代付与返佣申请' };
    mainTitle.innerText = titles[tab] || titles['pay'];
    document.getElementById('fm-tab-pay').classList.add('hidden'); document.getElementById('fm-tab-adj').classList.add('hidden'); document.getElementById('fm-tab-exp').classList.add('hidden');
    document.getElementById(`fm-tab-${tab}`).classList.remove('hidden');
}

window.refreshFinanceModalStats = function() {
    const updatedOrder = window.allOrders.find(o => String(o.id) === String(window.currentModalOrderId));
    if (updatedOrder) {
        document.getElementById('fm-total').innerText = `¥${updatedOrder.total_amount}`;
        document.getElementById('fm-paid').innerText = `¥${updatedOrder.paid_amount}`;
        document.getElementById('fm-unpaid').innerText = `¥${updatedOrder.total_amount - updatedOrder.paid_amount}`;
        document.getElementById('exp-total-paid-display').innerText = `¥${updatedOrder.paid_amount.toLocaleString()}`;
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
            const actionHtml = isErpSync
                ? `<span class="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">ERP 同步只读</span>`
                : `<div><button onclick="window.openEditPaymentModal('${p.id}', ${p.amount}, '${safePayer}', '${safeBank}', '${safeRem}', '${p.payment_time}')" class="text-indigo-500 hover:text-indigo-700 text-xs font-bold mr-2">修改</button><button onclick="window.deletePayment('${p.id}')" class="text-red-500 hover:text-red-700 text-xs font-bold">删除</button></div>`;
            const sourceBadge = isErpSync
                ? '<span class="ml-2 text-[11px] font-bold text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full">ERP同步</span>'
                : '';
            listDiv.innerHTML += `<div class="bg-white border rounded p-3 flex justify-between items-center hover:bg-gray-50 transition"><div><div class="font-bold text-green-600 text-lg">到账 ¥${p.amount}${sourceBadge}</div><div class="text-xs text-gray-600 mt-1">👤 户名: ${safePayerText}</div><div class="text-xs text-gray-500">🏦 途径: ${safeBankText} | 📝 备注: ${safeRemarkText}</div></div><div class="text-right flex flex-col justify-between h-full"><div class="text-xs font-bold text-gray-700 mb-2">📅 ${window.escapeHtml(p.payment_time)}</div>${actionHtml}</div></div>`;
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
window.calculateFmAdjustTotal = function() { const af = parseFloat(document.getElementById('adj-actual-fee').value) || 0; let ot = 0; window.fmDynamicFees.forEach(f => { ot += parseFloat(f.amount) || 0; }); document.getElementById('fm-adjust-calc-total').innerText = `¥ ${(af + ot).toLocaleString()}`; }

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
            listDiv.innerHTML += `<div class="bg-white border rounded p-3 mb-2 flex justify-between items-center hover:bg-gray-50"><div><div class="font-bold text-purple-700">金额: ¥${e.amount} <span class="text-sm font-normal text-gray-500 ml-2">(${safePayeeName})</span></div><div class="text-xs text-gray-600 mt-1">📝 事由: <span class="font-bold">${safeReason}</span></div><div class="text-xs text-gray-400 mt-1">${safeCreatedAt} | 渠道: ${safeChannel} | 申请人: ${safeApplicant}</div></div><div class="text-right"><button onclick='window.printExpense(${safeE})' class="bg-gray-800 text-white hover:bg-black text-xs font-bold px-3 py-1.5 rounded mr-2">🖨️ 打印单据</button><button onclick="window.deleteExpense('${e.id}')" class="text-red-500 hover:text-red-700 text-xs font-bold">撤销</button></div></div>`;
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
    const content = `<div class="text-center mb-6"><h2 class="text-2xl font-bold tracking-widest border-b-2 border-black pb-2 inline-block">支出确认单</h2></div><div class="flex justify-between text-sm mb-2 font-bold"><span>单据编号：EXP-${e.id}-${Date.now().toString().slice(-4)}</span><span>申请日期：${e.created_at ? e.created_at.split(' ')[0] : '即日'}</span></div><table class="w-full text-left border-collapse border border-black mb-6 text-sm"><tr><th class="border border-black p-3 bg-gray-100 w-1/4">项目名称</th><td class="border border-black p-3 font-bold" colspan="3">${document.getElementById('global-project-select').options[document.getElementById('global-project-select').selectedIndex].text}</td></tr><tr><th class="border border-black p-3 bg-gray-100">关联展商/展位</th><td class="border border-black p-3 font-bold text-blue-800" colspan="3">${order.company_name} (展位: ${order.booth_id})</td></tr><tr><th class="border border-black p-3 bg-gray-100">代付/返佣事由</th><td class="border border-black p-3 font-bold text-purple-800" colspan="3">${e.reason || '无说明'}</td></tr><tr><th class="border border-black p-3 bg-gray-100">申请支付金额</th><td class="border border-black p-3 font-bold text-xl text-red-600" colspan="3">¥ ${e.amount.toLocaleString()}</td></tr><tr><th class="border border-black p-3 bg-gray-100">收款单位全称</th><td class="border border-black p-3 font-bold" colspan="3">${e.payee_name} <span class="text-gray-500 font-normal">(${e.payee_channel || '转账'})</span></td></tr><tr><th class="border border-black p-3 bg-gray-100">收款账号</th><td class="border border-black p-3 tracking-widest font-bold" colspan="3">${e.payee_account || '未提供'}</td></tr><tr><th class="border border-black p-3 bg-gray-100">开户行详情</th><td class="border border-black p-3" colspan="3">${e.payee_bank || '未提供'}</td></tr></table><div class="text-sm font-bold mt-10 pt-6">申请人：${e.applicant || ''}</div>`;
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
