// ================= js/finance.js =================
window.loadOrderList = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const res = await window.apiFetch(`/api/orders?projectId=${pid}&role=${currentUser.role}&salesName=${currentUser.name}`);
    allOrders = await res.json();
    window.renderOrderList();
}

window.renderOrderList = function() {
    const searchTxt = document.getElementById('order-search').value.toLowerCase();
    const statusFilter = document.getElementById('order-status-filter').value;
    
    const filtered = allOrders.filter(o => {
        if(searchTxt && !(o.company_name.toLowerCase().includes(searchTxt) || o.booth_id.toLowerCase().includes(searchTxt))) return false;
        let payStatus = '未付';
        if(o.paid_amount > 0 && o.paid_amount < o.total_amount) payStatus = '定金';
        if(o.paid_amount >= o.total_amount) payStatus = '全款';
        if(statusFilter && payStatus !== statusFilter) return false;
        return true;
    });

    document.getElementById('order-total-stats').innerText = `共 ${filtered.length} 笔订单`;
    const tbody = document.getElementById('order-list-tbody'); tbody.innerHTML = '';
    
    filtered.forEach(o => {
        let payBadge = `<span class="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">🔴 未付款</span>`;
        if(o.paid_amount > 0 && o.paid_amount < o.total_amount) {
            let ratio = ((o.paid_amount / o.total_amount) * 100).toFixed(1);
            let remain = o.total_amount - o.paid_amount;
            payBadge = `<div class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold flex flex-col items-center leading-tight"><span>🟡 已付定金 (${ratio}%)</span><span class="text-yellow-600 mt-1">剩¥${remain}</span></div>`;
        }
        if(o.paid_amount >= o.total_amount) payBadge = `<span class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">🟢 已付全款</span>`;

        const contractBtn = o.contract_url ? `<a href="/api/file/${o.contract_url}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs font-bold underline">已传/预览</a>` : `<button onclick="window.triggerSilentUpload(${o.id})" class="text-red-500 hover:text-red-700 text-xs font-bold underline">未传/补传</button>`;
        
        const safeCompany = o.company_name.replace(/'/g, "&#39;");
        const safeOrderObj = JSON.stringify(o).replace(/'/g, "&#39;");

        tbody.innerHTML += `
            <tr class="border-b hover:bg-blue-50 transition">
                <td class="p-3 font-bold text-gray-600">${o.hall}</td>
                <td class="p-3 font-bold text-blue-700 text-lg">${o.booth_id}</td>
                <td class="p-3 text-xs text-gray-500 truncate max-w-[120px]" title="${o.region || '未填'}">${o.region || '未填'}</td>
                <td class="p-3 font-bold text-gray-800 cursor-pointer hover:text-blue-600 hover:underline max-w-[180px] truncate" onclick='window.showOrderDetail(${safeOrderObj})' title="点击查看详情与编辑">${safeCompany}</td>
                <td class="p-3">${o.area} ㎡</td>
                <td class="p-3 text-xs text-gray-500">${o.booth_type}</td>
                <td class="p-3 text-xs text-gray-600 font-bold">${o.sales_name}</td>
                <td class="p-3 text-right font-bold text-gray-800">¥${o.total_amount}</td>
                <td class="p-3 text-right font-bold text-green-600">¥${o.paid_amount}</td>
                <td class="p-3 text-center align-middle">${payBadge}</td>
                <td class="p-3 text-center align-middle">${contractBtn}</td>
                <td class="p-3 text-center whitespace-nowrap align-middle">
                    <button onclick='window.openFinanceDirect(${safeOrderObj}, "pay")' class="bg-blue-600 text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-blue-700 shadow-sm">💰 收款</button>
                    <button onclick='window.openFinanceDirect(${safeOrderObj}, "adj")' class="bg-orange-500 text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-orange-600 shadow-sm mx-1">🛠️ 变更</button>
                    <button onclick='window.openFinanceDirect(${safeOrderObj}, "exp")' class="bg-purple-600 text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-purple-700 shadow-sm mr-2">📤 代付</button>
                    ${currentUser.role==='admin' ? `<button onclick="window.cancelOrder(${o.id}, '${o.booth_id}')" class="text-red-500 hover:text-red-700 text-xs border border-red-200 px-2 py-1.5 rounded bg-white font-bold shadow-sm">作废</button>` : ''}
                </td>
            </tr>
        `;
    });
}

window.exportToExcel = function() {
    if(allOrders.length === 0) return window.showToast("当前无数据可导出", 'error');
    let csvContent = "\uFEFF"; 
    csvContent += "内部状态,馆号,展位号,展位面积,类型,客户名称,信用代码/代号,地区,联系人,电话,产品分类,主营业务/展品,业务员,总应收(元),已收(元),录入时间,合同云端链接\n";
    
    allOrders.forEach(o => {
        let status = o.paid_amount >= o.total_amount ? '已付全款' : (o.paid_amount > 0 ? '已付定金' : '未付款');
        if(o.status === '已作废') status = '已作废';
        let contractLink = o.contract_url ? `${window.location.origin}/api/file/${o.contract_url}` : '未上传';
        
        const safeWrap = (val) => `"${(val || '').toString().replace(/"/g, '""')}"`;
        let row = [
            status, o.hall, o.booth_id, o.area, o.booth_type,
            safeWrap(o.company_name), safeWrap(o.credit_code), safeWrap(o.region), safeWrap(o.contact_person), safeWrap(o.phone), safeWrap(o.category), safeWrap(o.main_business),
            o.sales_name, o.total_amount, o.paid_amount, o.created_at, safeWrap(contractLink)
        ].join(',');
        csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `展位订单大盘导出_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
    link.click();
    window.showToast("数据大盘导出成功！");
}

window.triggerSilentUpload = function(orderId) {
    currentSilentOrderId = orderId;
    document.getElementById('silent-file-upload').click();
}

window.handleSilentUpload = async function(input) {
    if(!input.files[0] || !currentSilentOrderId) return;
    window.showToast("正在上传合同并更新单据...");
    const formData = new FormData();
    formData.append('file', input.files[0]);
    try {
        const upRes = await window.apiFetch('/api/upload', {method:'POST', body: formData});
        const upData = await upRes.json();
        
        const order = allOrders.find(o => o.id === currentSilentOrderId);
        const data = {
            project_id: document.getElementById('global-project-select').value,
            order_id: currentSilentOrderId,
            contact_person: order.contact_person, phone: order.phone, region: order.region,
            main_business: order.main_business, profile: order.profile, category: order.category,
            is_agent: order.is_agent === 1, agent_name: order.agent_name,
            contract_url: upData.fileKey 
        };
        
        await window.apiFetch('/api/update-customer-info', {method:'POST', body: JSON.stringify(data)});
        window.showToast("合同补传成功！");
        window.loadOrderList();
    } catch (e) { window.showToast("上传失败", 'error'); }
    finally { input.value = ''; currentSilentOrderId = null; }
}

// 订单全景档案与编辑
window.showOrderDetail = function(o) {
    currentViewOrder = o; 
    document.getElementById('dt-company').innerText = o.company_name;
    document.getElementById('dt-code').innerText = o.no_code_checked ? `无代码 (代号: ${o.credit_code})` : o.credit_code;
    document.getElementById('dt-booth').innerText = `${o.hall} - ${o.booth_id}`;
    document.getElementById('dt-sales').innerText = o.sales_name;
    document.getElementById('dt-time').innerText = o.created_at || '未知';
    document.getElementById('dt-region').innerText = o.region || '未填';
    document.getElementById('dt-contact').innerText = o.contact_person;
    document.getElementById('dt-phone').innerText = o.phone;
    document.getElementById('dt-category').innerText = o.category || '未填';
    document.getElementById('dt-business').innerText = o.main_business || '未填';
    document.getElementById('dt-profile').innerText = o.profile || '暂无简介';
    document.getElementById('dt-agent').innerText = o.is_agent ? `由代理商 [${o.agent_name}] 代招` : '直招入驻';
    
    document.getElementById('edit-dt-contact').value = o.contact_person;
    document.getElementById('edit-dt-phone').value = o.phone;
    document.getElementById('edit-dt-region').value = o.region || '';
    document.getElementById('edit-dt-category').value = o.category || '';
    document.getElementById('edit-dt-business').value = o.main_business || '';
    document.getElementById('edit-dt-profile').value = o.profile || '';
    document.querySelector(`input[name="edit_is_agent"][value="${o.is_agent ? 1 : 0}"]`).checked = true;
    document.getElementById('edit-dt-agent-name').value = o.agent_name || '';
    window.toggleDtAgent();

    window.toggleDetailEditMode(false); 
    document.getElementById('order-detail-modal').classList.remove('hidden');
}

window.toggleDetailEditMode = function(isEditing) {
    if(isEditing) {
        document.getElementById('dt-view-mode').classList.add('hidden');
        document.getElementById('dt-action-view').classList.add('hidden');
        document.getElementById('dt-edit-mode').classList.remove('hidden');
        document.getElementById('dt-action-edit').classList.remove('hidden');
    } else {
        document.getElementById('dt-edit-mode').classList.add('hidden');
        document.getElementById('dt-action-edit').classList.add('hidden');
        document.getElementById('dt-view-mode').classList.remove('hidden');
        document.getElementById('dt-action-view').classList.remove('hidden');
    }
}

window.saveDetailEdit = async function() {
    const pid = document.getElementById('global-project-select').value;
    const isAgent = document.querySelector('input[name="edit_is_agent"]:checked').value === '1';
    const updatedData = {
        project_id: pid, order_id: currentViewOrder.id,
        contact_person: document.getElementById('edit-dt-contact').value.trim(),
        phone: document.getElementById('edit-dt-phone').value.trim(),
        region: document.getElementById('edit-dt-region').value.trim(),
        category: document.getElementById('edit-dt-category').value.trim(),
        main_business: document.getElementById('edit-dt-business').value.trim(),
        profile: document.getElementById('edit-dt-profile').value.trim(),
        is_agent: isAgent, agent_name: document.getElementById('edit-dt-agent-name').value.trim()
    };

    if(!updatedData.contact_person || !updatedData.phone) return window.showToast("联系人和电话不能为空！", 'error');
    if(isAgent && !updatedData.agent_name) return window.showToast("请填写代理商名称！", 'error');

    window.toggleBtnLoading('btn-save-detail', true);
    try {
        const res = await window.apiFetch('/api/update-customer-info', { method: 'POST', body: JSON.stringify(updatedData) });
        if(res.ok) {
            window.showToast("客户资料更新成功！");
            Object.assign(currentViewOrder, updatedData);
            currentViewOrder.is_agent = updatedData.is_agent ? 1 : 0;
            window.showOrderDetail(currentViewOrder);
            window.loadOrderList(); 
        } else { window.showToast("修改失败，请重试。", 'error'); }
    } catch (e) { window.showToast(e.message, 'error'); }
    finally { window.toggleBtnLoading('btn-save-detail', false); }
}

// --- 财务模态框核心逻辑 ---
window.openFinanceDirect = async function(order, tab) {
    const pid = document.getElementById('global-project-select').value;
    const res = await window.apiFetch(`/api/accounts?projectId=${pid}`);
    projectAccounts = await res.json();
    
    const sel = document.getElementById('pay-account-select');
    sel.innerHTML = '<option value="">-- 请选择收款方式 --</option>';
    const group = document.createElement('optgroup');
    group.label = "🏢 系统配置对公账户";
    projectAccounts.forEach(a => {
        const textStr = `${a.account_name} - ${a.bank_name || ''} ${a.account_no ? '('+a.account_no+')' : ''}`;
        group.innerHTML += `<option value="${textStr}">🏦 ${textStr}</option>`;
    });
    sel.appendChild(group);
    sel.innerHTML += `<optgroup label="📱 其他常规方式"><option value="微信">💬 微信</option><option value="支付宝">🔵 支付宝</option><option value="现金">💵 现金</option><option value="其他">其他</option></optgroup>`;

    window.openFinanceModal(order, tab);
}

window.openFinanceModal = async function(order, forcedTab = null) {
    currentModalOrderId = order.id;
    const targetTab = forcedTab || lastFmTab || 'pay';

    document.getElementById('fm-order-title').innerText = `当前客户：${order.company_name} (展位: ${order.booth_id})`;
    document.getElementById('fm-total').innerText = `¥${order.total_amount}`;
    document.getElementById('fm-paid').innerText = `¥${order.paid_amount}`;
    document.getElementById('fm-unpaid').innerText = `¥${order.total_amount - order.paid_amount}`;
    
    document.getElementById('fm-order-id').value = order.id;
    document.getElementById('pay-amount').value = '';  
    document.getElementById('pay-time').value = new Date().toISOString().split('T')[0]; 
    document.getElementById('pay-payer').value = order.company_name; 
    document.getElementById('pay-remark').value = '';
    document.getElementById('pay-account-select').value = '';

    document.getElementById('adj-actual-fee').value = order.total_booth_fee;
    document.getElementById('adj-reason').value = '';
    try { fmDynamicFees = JSON.parse(order.fees_json || '[]'); } catch(e) { fmDynamicFees = []; }
    window.renderFmDynamicFees();

    document.getElementById('exp-total-paid-display').innerText = `¥ ${order.paid_amount.toLocaleString()}`;
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-payee').value = '';
    document.getElementById('exp-bank').value = '';
    document.getElementById('exp-account').value = '';
    document.getElementById('exp-reason').value = ''; 

    window.switchFmTab(targetTab);
    await window.loadPaymentHistory(order.id);
    await window.loadExpenseHistory(order.id); 
    document.getElementById('finance-modal').classList.remove('hidden');
}

window.switchFmTab = function(tab) {
    lastFmTab = tab; 
    const mainTitle = document.getElementById('fm-main-title');
    if(tab === 'pay') mainTitle.innerText = "💰 收款流水管理";
    if(tab === 'adj') mainTitle.innerText = "🛠️ 变更费用信息";
    if(tab === 'exp') mainTitle.innerText = "📤 代付与返佣申请";

    document.getElementById('fm-tab-pay').classList.add('hidden'); 
    document.getElementById('fm-tab-adj').classList.add('hidden');
    document.getElementById('fm-tab-exp').classList.add('hidden');
    
    document.getElementById('tab-pay').className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
    document.getElementById('tab-adjust').className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';
    document.getElementById('tab-expense').className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300';

    if(tab === 'pay') {
        document.getElementById('fm-tab-pay').classList.remove('hidden'); 
        document.getElementById('tab-pay').className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-blue-500 text-blue-600';
    }
    else if(tab === 'adj') {
        document.getElementById('fm-tab-adj').classList.remove('hidden'); 
        document.getElementById('tab-adjust').className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-orange-500 text-orange-600';
    }
    else {
        document.getElementById('fm-tab-exp').classList.remove('hidden'); 
        document.getElementById('tab-expense').className = 'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm border-purple-500 text-purple-600';
    }

    document.querySelector('.border-b.border-gray-200.hidden')?.classList.remove('hidden');
}

// 财务流水明细加载与提交
window.loadPaymentHistory = async function(orderId) {
    const listDiv = document.getElementById('fm-pay-list'); listDiv.innerHTML = '<span class="text-gray-400">加载中...</span>';
    try {
        const response = await window.apiFetch(`/api/payments?orderId=${orderId}`);
        const pays = await response.json();
        if(pays.length === 0) { listDiv.innerHTML = '<p class="text-gray-400 italic">暂无收款记录</p>'; return; }
        listDiv.innerHTML = '';
        pays.forEach(p => {
            const safePayer = (p.payer_name || '').replace(/'/g, "\\'");
            const safeBank = (p.bank_name || '').replace(/'/g, "\\'");
            const safeRem = (p.remarks || '').replace(/'/g, "\\'");
            listDiv.innerHTML += `
                <div class="bg-white border rounded p-3 flex justify-between items-center hover:bg-gray-50 transition">
                    <div>
                        <div class="font-bold text-green-600 text-lg">到账 ¥${p.amount}</div>
                        <div class="text-xs text-gray-600 mt-1">👤 户名: ${p.payer_name}</div>
                        <div class="text-xs text-gray-500">🏦 途径: ${p.bank_name || '未填'} | 📝 备注: ${p.remarks || '无'}</div>
                    </div>
                    <div class="text-right flex flex-col justify-between h-full">
                        <div class="text-xs font-bold text-gray-700 mb-2">📅 ${p.payment_time}</div>
                        <div>
                            <button onclick="window.openEditPaymentModal(${p.id}, ${p.amount}, '${safePayer}', '${safeBank}', '${safeRem}', '${p.payment_time}')" class="text-indigo-500 hover:text-indigo-700 text-xs font-bold mr-2">修改</button>
                            <button onclick="window.deletePayment(${p.id})" class="text-red-500 hover:text-red-700 text-xs font-bold">删除</button>
                        </div>
                    </div>
                </div>`;
        });
    } catch (e) { listDiv.innerHTML = '<p class="text-red-500">加载失败</p>'; }
}

window.submitPayment = async function() {
    const pid = document.getElementById('global-project-select').value;
    const amt = parseFloat(document.getElementById('pay-amount').value);
    const time = document.getElementById('pay-time').value;
    const payer = document.getElementById('pay-payer').value.trim();
    const bank = document.getElementById('pay-account-select').value;
    const orderId = document.getElementById('fm-order-id').value;
    
    if(!amt || amt <= 0) return window.showToast("请输入正确的收款金额", 'error');
    if(!time || !payer) return window.showToast("时间和打款户名为必填项！", 'error');
    if(!bank) return window.showToast("请选择收款银行/途径！", 'error');

    window.toggleBtnLoading('btn-submit-payment', true);
    try {
        await window.apiFetch('/api/add-payment', { method: 'POST', body: JSON.stringify({ project_id: pid, order_id: orderId, amount: amt, payment_time: time, payer_name: payer, bank_name: bank, remarks: document.getElementById('pay-remark').value }) });
        window.showToast("收款入账成功！"); 
        window.closeModal('finance-modal'); 
        window.loadOrderList(); 
    } finally { window.toggleBtnLoading('btn-submit-payment', false); }
}

window.openEditPaymentModal = function(id, amt, payer, bank, remark, time) {
    document.getElementById('ep-id').value = id; document.getElementById('ep-amount').value = amt; document.getElementById('ep-payer').value = payer; document.getElementById('ep-bank').value = bank; document.getElementById('ep-time').value = time; document.getElementById('ep-remark').value = remark; document.getElementById('edit-payment-modal').classList.remove('hidden');
}

window.submitEditPayment = async function() {
    const pid = document.getElementById('global-project-select').value;
    const data = { project_id: pid, order_id: currentModalOrderId, payment_id: document.getElementById('ep-id').value, amount: parseFloat(document.getElementById('ep-amount').value), payer_name: document.getElementById('ep-payer').value.trim(), bank_name: document.getElementById('ep-bank').value, payment_time: document.getElementById('ep-time').value, remarks: document.getElementById('ep-remark').value };
    if(!data.amount || !data.payer_name) return window.showToast("金额和户名必填", 'error');
    
    window.toggleBtnLoading('btn-save-payment', true);
    await window.apiFetch('/api/edit-payment', { method: 'POST', body: JSON.stringify(data) });
    window.closeModal('edit-payment-modal'); 
    window.showToast("收款记录修改成功！");
    window.loadPaymentHistory(currentModalOrderId); window.loadOrderList();
    window.toggleBtnLoading('btn-save-payment', false);
}

window.deletePayment = async function(payId) {
    const pid = document.getElementById('global-project-select').value;
    if(!confirm("确定要删除这条收款记录吗？相关的已收金额会自动扣减！")) return;
    await window.apiFetch('/api/delete-payment', { method: 'POST', body: JSON.stringify({ project_id: pid, order_id: currentModalOrderId, payment_id: payId }) });
    window.showToast("删除成功，流水已回退");
    window.loadPaymentHistory(currentModalOrderId); window.loadOrderList();
}

// 费用调整
window.fmAddFeeRow = function() { fmDynamicFees.push({ name: '', amount: '' }); window.renderFmDynamicFees(); }
window.fmRemoveFeeRow = function(idx) { fmDynamicFees.splice(idx, 1); window.renderFmDynamicFees(); }
window.fmUpdateFeeData = function(idx, field, val) { fmDynamicFees[idx][field] = val; window.calculateFmAdjustTotal(); }
window.renderFmDynamicFees = function() {
    const container = document.getElementById('fm-dynamic-fees-container'); container.innerHTML = '';
    fmDynamicFees.forEach((fee, idx) => {
        container.innerHTML += `
            <div class="flex gap-2 items-center bg-white p-2 rounded border border-orange-100 shadow-sm">
                <input type="text" placeholder="名称" value="${fee.name}" oninput="window.fmUpdateFeeData(${idx}, 'name', this.value)" class="border p-1.5 rounded flex-1 text-sm bg-gray-50 focus:bg-white">
                <span class="text-gray-500 font-bold">¥</span>
                <input type="number" placeholder="金额" value="${fee.amount}" oninput="window.fmUpdateFeeData(${idx}, 'amount', this.value)" class="border p-1.5 rounded w-24 text-sm bg-gray-50 focus:bg-white font-bold text-gray-700">
                <button onclick="window.fmRemoveFeeRow(${idx})" class="text-red-500 hover:bg-red-100 font-bold px-2 py-1 rounded text-xs">删</button>
            </div>`;
    });
    window.calculateFmAdjustTotal();
}
window.calculateFmAdjustTotal = function() {
    const af = parseFloat(document.getElementById('adj-actual-fee').value) || 0;
    let ot = 0; fmDynamicFees.forEach(f => { ot += parseFloat(f.amount) || 0; });
    document.getElementById('fm-adjust-calc-total').innerText = `¥ ${(af + ot).toLocaleString()}`;
}
window.submitAdjustment = async function() {
    const pid = document.getElementById('global-project-select').value;
    const af = parseFloat(document.getElementById('adj-actual-fee').value);
    const r = document.getElementById('adj-reason').value.trim();
    if(isNaN(af)) return window.showToast("金额格式错误", 'error');
    if(!r) return window.showToast("修改账目必须填写原因！", 'error');

    let ot = 0; let validFees = [];
    fmDynamicFees.forEach(f => { if(f.name && parseFloat(f.amount)) { ot += parseFloat(f.amount); validFees.push(f); } });
    
    window.toggleBtnLoading('btn-submit-adj', true);
    await window.apiFetch('/api/update-order-fees', { method: 'POST', body: JSON.stringify({ project_id: pid, order_id: currentModalOrderId, actual_fee: af, other_fee_total: ot, fees_json: JSON.stringify(validFees), reason: r }) });
    window.showToast("合同金额变更成功！系统已重算尾款状态。"); 
    window.closeModal('finance-modal'); window.loadOrderList();
    window.toggleBtnLoading('btn-submit-adj', false);
}

// 代付业务
window.loadExpenseHistory = async function(orderId) {
    const listDiv = document.getElementById('fm-exp-list'); listDiv.innerHTML = '<span class="text-gray-400">加载中...</span>';
    try {
        const response = await window.apiFetch(`/api/expenses?orderId=${orderId}`);
        const exps = await response.json();
        if(exps.length === 0) { listDiv.innerHTML = '<p class="text-gray-400 italic">暂无记录</p>'; return; }
        listDiv.innerHTML = '';
        exps.forEach(e => {
            const safeE = JSON.stringify(e).replace(/'/g, "&#39;");
            listDiv.innerHTML += `
                <div class="bg-white border rounded p-3 mb-2 flex justify-between items-center hover:bg-gray-50">
                    <div>
                        <div class="font-bold text-purple-700">金额: ¥${e.amount} <span class="text-sm font-normal text-gray-500 ml-2">(${e.payee_name})</span></div>
                        <div class="text-xs text-gray-600 mt-1">📝 事由: <span class="font-bold">${e.reason || '无说明'}</span></div>
                        <div class="text-xs text-gray-400 mt-1">${e.created_at ? e.created_at.split(' ')[0] : ''} | 渠道: ${e.payee_channel || '转账'} | 申请人: ${e.applicant}</div>
                    </div>
                    <div class="text-right">
                        <button onclick='window.printExpense(${safeE})' class="bg-gray-800 text-white hover:bg-black text-xs font-bold px-3 py-1.5 rounded mr-2">🖨️ 打印单据</button>
                        <button onclick="window.deleteExpense(${e.id})" class="text-red-500 hover:text-red-700 text-xs font-bold">撤销</button>
                    </div>
                </div>`;
        });
    } catch (err) { listDiv.innerHTML = `<p class="text-red-500 font-bold">解析异常</p>`; }
}
window.submitExpense = async function() {
    const pid = document.getElementById('global-project-select').value;
    const channel = document.getElementById('exp-channel').value;
    const payee = document.getElementById('exp-payee').value.trim();
    const bank = document.getElementById('exp-bank').value.trim();
    const acc = document.getElementById('exp-account').value.trim();
    const amt = parseFloat(document.getElementById('exp-amount').value);
    const reason = document.getElementById('exp-reason').value.trim(); 

    if(!payee || !amt || amt <= 0 || !reason) return window.showToast("代付事由、收款方全称和支付金额均为必填！", 'error');

    const order = allOrders.find(o => o.id === currentModalOrderId);
    if(amt > order.paid_amount) {
        if(!confirm(`⚠️ 警告：您申请的金额 (¥${amt}) 大于该订单当前的【已收总额】 (¥${order.paid_amount})。\n是否坚持超额支付？`)) return;
    }

    window.toggleBtnLoading('btn-submit-exp', true);
    try {
        const data = { project_id: pid, order_id: currentModalOrderId, fee_item_name: '总收款抵扣', payee_name: payee, payee_channel: channel, payee_bank: bank, payee_account: acc, amount: amt, applicant: currentUser.name, reason: reason };
        const res = await window.apiFetch('/api/add-expense', { method: 'POST', body: JSON.stringify(data) });
        if(res.ok) {
            window.showToast("支出申请已成功记录！");
            document.getElementById('exp-reason').value = ''; document.getElementById('exp-payee').value = ''; document.getElementById('exp-amount').value = '';
            window.loadExpenseHistory(currentModalOrderId);
        } else throw new Error("后台写入失败");
    } catch(err) { window.showToast(err.message, 'error'); } 
    finally { window.toggleBtnLoading('btn-submit-exp', false); }
}
window.deleteExpense = async function(expId) {
    if(!confirm("确定撤销该笔代付/返佣申请吗？")) return;
    await window.apiFetch('/api/delete-expense', { method: 'POST', body: JSON.stringify({ expense_id: expId }) });
    window.showToast("撤销成功！");
    window.loadExpenseHistory(currentModalOrderId);
}
window.printExpense = function(e) {
    const order = allOrders.find(o => o.id === e.order_id);
    const content = `
        <div class="text-center mb-6"><h2 class="text-2xl font-bold tracking-widest border-b-2 border-black pb-2 inline-block">项目款项支付/返佣申请单</h2></div>
        <div class="flex justify-between text-sm mb-2 font-bold"><span>单据编号：EXP-${e.id}-${Date.now().toString().slice(-4)}</span><span>申请日期：${e.created_at ? e.created_at.split(' ')[0] : '即日'}</span></div>
        <table class="w-full text-left border-collapse border border-black mb-6 text-sm">
            <tr><th class="border border-black p-3 bg-gray-100 w-1/4">项目名称</th><td class="border border-black p-3 font-bold" colspan="3">${document.getElementById('global-project-select').options[document.getElementById('global-project-select').selectedIndex].text}</td></tr>
            <tr><th class="border border-black p-3 bg-gray-100">关联展商/展位</th><td class="border border-black p-3 font-bold text-blue-800" colspan="3">${order.company_name} (展位: ${order.booth_id})</td></tr>
            <tr><th class="border border-black p-3 bg-gray-100">代付/返佣事由</th><td class="border border-black p-3 font-bold text-purple-800" colspan="3">${e.reason || '无说明'}</td></tr>
            <tr><th class="border border-black p-3 bg-gray-100">申请支付金额</th><td class="border border-black p-3 font-bold text-xl text-red-600" colspan="3">¥ ${e.amount.toLocaleString()}</td></tr>
            <tr><th class="border border-black p-3 bg-gray-100">收款单位/个人全称</th><td class="border border-black p-3 font-bold" colspan="3">${e.payee_name} <span class="text-gray-500 font-normal">(${e.payee_channel || '转账'})</span></td></tr>
            <tr><th class="border border-black p-3 bg-gray-100">收款账号</th><td class="border border-black p-3 tracking-widest font-bold" colspan="3">${e.payee_account || '未提供'}</td></tr>
            <tr><th class="border border-black p-3 bg-gray-100">开户行详情</th><td class="border border-black p-3" colspan="3">${e.payee_bank || '未提供'}</td></tr>
        </table>
        <div class="grid grid-cols-2 gap-4 text-center mt-12 pt-8 text-sm"><div>申请人签字：<span class="font-bold border-b border-black px-6">${e.applicant}</span></div><div>上级审批签字：__________________</div></div>
    `;
    document.getElementById('print-content').innerHTML = content; document.getElementById('print-modal').classList.remove('hidden');
}

window.cancelOrder = async function(orderId, boothId) {
    const pid = document.getElementById('global-project-select').value;
    if(!confirm(`🚨 危险操作：确定要作废订单吗？\n作废后，展位 [${boothId}] 将被释放回可售状态！\n(内部流水号将跳过不复用)`)) return;
    try {
        const res = await window.apiFetch('/api/cancel-order', { method: 'POST', body: JSON.stringify({ project_id: pid, order_id: orderId, booth_id: boothId }) });
        if(res.ok) { window.showToast("退单成功！展位已释放。"); window.loadOrderList(); } 
        else { const err = await res.json(); window.showToast(err.error || "作废失败", 'error'); }
    } catch (e) { /* handled */ }
}