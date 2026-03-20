// ================= js/config.js =================
// -- 项目管理 --
window.loadProjects = async function() {
    allProjects = await (await window.apiFetch('/api/projects')).json(); 
    const sel = document.getElementById('global-project-select'); sel.innerHTML = ''; 
    const tbody = document.getElementById('project-list-tbody'); if(tbody) tbody.innerHTML = '';
    allProjects.forEach(p => { 
        sel.innerHTML += `<option value="${p.id}">${p.name}</option>`; 
        if(tbody) { 
            const d = (p.start_date) ? `${p.start_date} 至 ${p.end_date}` : '未设'; 
            tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold text-blue-600">${p.name}</td><td class="p-2 text-gray-500">${d}</td><td class="p-2 text-right"><button onclick='window.openEditProjectModal(${JSON.stringify(p)})' class="text-indigo-600 hover:underline text-xs">编辑</button></td></tr>`; 
        }
    });
    window.onProjectChange();
}

window.onProjectChange = function() { 
    if(document.getElementById('sec-config').classList.contains('active')) { window.loadStaff(); window.loadAccounts(); window.loadIndustries(); } 
    if(document.getElementById('sec-booth').classList.contains('active')) { window.loadPrices(); window.loadBooths(); } 
    if(document.getElementById('sec-order-entry').classList.contains('active')) window.initOrderForm(); 
    if(document.getElementById('sec-order-list').classList.contains('active')) window.loadOrderList(); 
}

window.createProject = async function() { 
    const data = { name: document.getElementById('new-proj-name').value, year: document.getElementById('new-proj-year').value, start_date: document.getElementById('new-proj-start').value, end_date: document.getElementById('new-proj-end').value }; 
    if(!data.name) return window.showToast("请输入项目名称", 'error'); 
    window.toggleBtnLoading('btn-create-proj', true);
    await window.apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(data) }); 
    document.getElementById('new-proj-name').value = ''; 
    window.showToast("项目创建成功");
    window.loadProjects(); 
    window.toggleBtnLoading('btn-create-proj', false);
}

window.openEditProjectModal = function(p) { document.getElementById('edit-p-id').value = p.id; document.getElementById('edit-p-name').value = p.name; document.getElementById('edit-p-year').value = p.year; document.getElementById('edit-p-start').value = p.start_date; document.getElementById('edit-p-end').value = p.end_date; document.getElementById('edit-project-modal').classList.remove('hidden'); }

window.submitEditProject = async function() { 
    const data = { id: document.getElementById('edit-p-id').value, name: document.getElementById('edit-p-name').value, year: document.getElementById('edit-p-year').value, start_date: document.getElementById('edit-p-start').value, end_date: document.getElementById('edit-p-end').value }; 
    window.toggleBtnLoading('btn-save-project', true);
    await window.apiFetch('/api/update-project', { method: 'POST', body: JSON.stringify(data) }); 
    window.closeModal('edit-project-modal'); 
    window.showToast("项目更新成功");
    window.loadProjects(); 
    window.toggleBtnLoading('btn-save-project', false);
}

// -- 人员管理 --
window.loadStaff = async function() { 
    const pid = document.getElementById('global-project-select').value; if(!pid) return; 
    const staff = await (await window.apiFetch(`/api/staff?projectId=${pid}`)).json(); 
    const tbody = document.getElementById('staff-list-tbody'); tbody.innerHTML = ''; 
    staff.forEach(s => { 
        const isSA = s.name === 'admin'; 
        const ts = s.target > 0 ? `<span class="text-green-600 font-bold">${s.target}</span>` : '<span class="text-gray-400">未设</span>'; 
        let rh = isSA ? '<span class="text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded">超级管理员</span>' : `<select onchange="window.updateStaffRole('${s.name}', this.value)" class="border border-gray-300 p-1 text-xs rounded bg-white text-gray-700"><option value="user" ${s.role==='user'?'selected':''}>业务员</option><option value="admin" ${s.role==='admin'?'selected':''}>管理员</option></select>`; 
        let ah = isSA ? '<span class="text-gray-300 text-xs">系统保护</span>' : `<button onclick="window.setTarget('${s.name}')" class="text-indigo-600 hover:text-indigo-800 text-xs mr-2">设目标</button><button onclick="window.deleteStaff('${s.name}')" class="text-red-500 hover:text-red-700 text-xs">删除</button>`; 
        tbody.innerHTML += `<tr class="hover:bg-gray-50 border-b transition"><td class="p-2 font-bold text-gray-700">${s.name}</td><td class="p-2">${rh}</td><td class="p-2">${ts}</td><td class="p-2">${ah}</td></tr>`; 
    }); 
}

window.createStaff = async function() { 
    const d = { name: document.getElementById('new-staff-name').value.trim(), role: document.getElementById('new-staff-role').value }; 
    if(!d.name) return window.showToast("请输入姓名", 'error'); 
    window.toggleBtnLoading('btn-add-staff', true);
    const res = await window.apiFetch('/api/staff', { method: 'POST', body: JSON.stringify(d) }); 
    if(res.ok) { document.getElementById('new-staff-name').value = ''; window.showToast("添加员工成功"); window.loadStaff(); } 
    else { const err = await res.json(); window.showToast(err.message || "添加失败", 'error'); } 
    window.toggleBtnLoading('btn-add-staff', false);
}
window.setTarget = async function(n) { const pid = document.getElementById('global-project-select').value; const t = prompt(`设置目标:`, "100"); if(t && !isNaN(t)) { await window.apiFetch('/api/set-target', { method: 'POST', body: JSON.stringify({projectId: pid, staffName: n, target: parseFloat(t)}) }); window.showToast("目标设置成功"); window.loadStaff(); } }
window.updateStaffRole = async function(n, r) { await window.apiFetch('/api/update-staff-role', { method: 'POST', body: JSON.stringify({staffName: n, role: r}) }); window.showToast("权限修改成功"); window.loadStaff(); }
window.deleteStaff = async function(n) { if(confirm(`确定删除该员工吗？`)) { await window.apiFetch('/api/delete-staff', { method: 'POST', body: JSON.stringify({staffName: n}) }); window.showToast("员工已删除"); window.loadStaff(); } }

// -- 行业字典管理 --
window.loadIndustries = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const res = await window.apiFetch(`/api/industries?projectId=${pid}`);
    projectIndustries = await res.json();
    
    const tbody = document.getElementById('industry-list-tbody'); if(tbody) tbody.innerHTML = '';
    const datalist = document.getElementById('industry-list'); datalist.innerHTML = '';
    
    projectIndustries.forEach(ind => {
        if(tbody) tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold text-gray-700">${ind.industry_name}</td><td class="p-2 text-right">
    ${s.name !== 'admin' ? `
        <button onclick="window.resetStaffPassword('${s.name}')" class="text-orange-500 hover:text-orange-700 text-xs font-bold mr-3">重置密码</button>
        <button onclick="window.deleteStaff('${s.name}')" class="text-red-500 hover:text-red-700 text-xs font-bold">删除</button>
    ` : '<span class="text-gray-400 text-xs">-</span>'}
</td></tr>`;
        datalist.innerHTML += `<option value="${ind.industry_name}">`;
    });
}
window.createIndustry = async function() {
    const pid = document.getElementById('global-project-select').value;
    const name = document.getElementById('new-industry-name').value.trim();
    if(!name) return window.showToast("请填写分类名称！", 'error');
    window.toggleBtnLoading('btn-add-ind', true);
    await window.apiFetch('/api/add-industry', { method: 'POST', body: JSON.stringify({ project_id: pid, industry_name: name }) });
    document.getElementById('new-industry-name').value = '';
    window.showToast("行业分类添加成功");
    window.loadIndustries();
    window.toggleBtnLoading('btn-add-ind', false);
}
window.deleteIndustry = async function(id) {
    if(!confirm("确定删除该分类吗？（不影响已录入的订单）")) return;
    await window.apiFetch('/api/delete-industry', { method: 'POST', body: JSON.stringify({ industry_id: id }) });
    window.showToast("删除成功");
    window.loadIndustries();
}

// -- 账户配置管理 --
window.loadAccounts = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const res = await window.apiFetch(`/api/accounts?projectId=${pid}`);
    projectAccounts = await res.json();
    const tbody = document.getElementById('account-list-tbody'); tbody.innerHTML = '';
    projectAccounts.forEach(a => {
        tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold">${a.account_name}</td><td class="p-2 text-gray-600">${a.bank_name || '-'}</td><td class="p-2 text-gray-600">${a.account_no || '-'}</td><td class="p-2 text-right"><button onclick="window.deleteAccount(${a.id})" class="text-red-500 hover:underline text-xs">删除</button></td></tr>`;
    });
}
window.createAccount = async function() {
    const pid = document.getElementById('global-project-select').value;
    const name = document.getElementById('new-acc-name').value.trim();
    const bank = document.getElementById('new-acc-bank').value.trim();
    const no = document.getElementById('new-acc-no').value.trim();
    if(!name || !bank) return window.showToast("户名和开户行(或渠道)为必填！", 'error');
    window.toggleBtnLoading('btn-add-acc', true);
    await window.apiFetch('/api/add-account', { method: 'POST', body: JSON.stringify({ project_id: pid, account_name: name, bank_name: bank, account_no: no }) });
    document.getElementById('new-acc-name').value = ''; document.getElementById('new-acc-bank').value = ''; document.getElementById('new-acc-no').value = '';
    window.showToast("账户配置成功");
    window.loadAccounts();
    window.toggleBtnLoading('btn-add-acc', false);
}
window.deleteAccount = async function(id) {
    if(!confirm("确定删除这个收款配置吗？")) return;
    await window.apiFetch('/api/delete-account', { method: 'POST', body: JSON.stringify({ account_id: id }) });
    window.showToast("删除成功");
    window.loadAccounts();
}
window.resetStaffPassword = async function(name) {
    if(!confirm(`🚨 确定要将业务员 [${name}] 的密码重置为默认的 123456 吗？`)) return;
    
    try {
        const res = await window.apiFetch('/api/reset-password', { 
            method: 'POST', 
            body: JSON.stringify({ staffName: name }) 
        });
        if(!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "重置失败");
        }
        window.showToast(`✅ 已成功将 [${name}] 的密码重置为 123456`);
    } catch (e) {
        window.showToast(e.message, 'error');
    }
}
