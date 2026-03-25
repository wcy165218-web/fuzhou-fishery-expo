// ================= js/config.js =================
// -- 项目管理 --
window.loadProjects = async function() {
    allProjects = await (await window.apiFetch('/api/projects')).json();
    const sel = document.getElementById('global-project-select');
    const tbody = document.getElementById('project-list-tbody');
    if (sel) sel.innerHTML = '';
    if (tbody) tbody.innerHTML = '';

    allProjects.forEach((p) => {
        const safeName = window.escapeHtml(p.name);
        const safeDateText = window.escapeHtml(p.start_date ? `${p.start_date} 至 ${p.end_date}` : '未设');
        if (sel) {
            sel.innerHTML += `<option value="${p.id}">${safeName}</option>`;
        }
        if (tbody) {
            tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold text-blue-600">${safeName}</td><td class="p-2 text-gray-500">${safeDateText}</td><td class="p-2 text-right"><button onclick="window.openEditProjectModalById(${Number(p.id)})" class="text-indigo-600 hover:underline text-xs">编辑</button></td></tr>`;
        }
    });

    window.onProjectChange();
};

window.onProjectChange = function() {
    if (document.getElementById('sec-home')?.classList.contains('active') && window.loadHomeDashboard) {
        window.loadHomeDashboard();
    }
    if (document.getElementById('sec-config')?.classList.contains('active')) {
        window.loadStaff();
        window.loadAccounts();
        window.loadIndustries();
        window.loadErpConfig?.();
    }
    if (document.getElementById('sec-booth')?.classList.contains('active')) {
        window.loadPrices();
        window.loadBooths();
    }
    if (document.getElementById('sec-order-entry')?.classList.contains('active')) {
        window.initOrderForm();
    }
    if (document.getElementById('sec-order-list')?.classList.contains('active')) {
        window.loadOrderList();
    }
};

window.createProject = async function() {
    const data = {
        name: document.getElementById('new-proj-name').value,
        year: document.getElementById('new-proj-year').value,
        start_date: document.getElementById('new-proj-start').value,
        end_date: document.getElementById('new-proj-end').value
    };
    if (!data.name) return window.showToast('请输入项目名称', 'error');
    window.toggleBtnLoading('btn-create-proj', true);
    try {
        await window.apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(data) });
        document.getElementById('new-proj-name').value = '';
        window.showToast('项目创建成功');
        window.loadProjects();
    } catch (e) {
        window.showToast(e.message || '项目创建失败', 'error');
    } finally {
        window.toggleBtnLoading('btn-create-proj', false);
    }
};

window.openEditProjectModalById = function(projectId) {
    const project = allProjects.find((item) => Number(item.id) === Number(projectId));
    if (!project) {
        window.showToast('找不到项目数据', 'error');
        return;
    }
    window.openEditProjectModal(project);
};

window.openEditProjectModal = function(project) {
    document.getElementById('edit-p-id').value = project.id;
    document.getElementById('edit-p-name').value = project.name;
    document.getElementById('edit-p-year').value = project.year;
    document.getElementById('edit-p-start').value = project.start_date;
    document.getElementById('edit-p-end').value = project.end_date;
    document.getElementById('edit-project-modal').classList.remove('hidden');
};

window.submitEditProject = async function() {
    const data = {
        id: document.getElementById('edit-p-id').value,
        name: document.getElementById('edit-p-name').value,
        year: document.getElementById('edit-p-year').value,
        start_date: document.getElementById('edit-p-start').value,
        end_date: document.getElementById('edit-p-end').value
    };
    window.toggleBtnLoading('btn-save-project', true);
    try {
        await window.apiFetch('/api/update-project', { method: 'POST', body: JSON.stringify(data) });
        window.closeModal('edit-project-modal');
        window.showToast('项目更新成功');
        window.loadProjects();
    } catch (e) {
        window.showToast(e.message || '项目更新失败', 'error');
    } finally {
        window.toggleBtnLoading('btn-save-project', false);
    }
};

// -- 人员管理 --
window.loadStaff = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;

    const staff = await (await window.apiFetch(`/api/staff?projectId=${pid}`)).json();
    const tbody = document.getElementById('staff-list-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    staff.forEach((member) => {
        const isSuperAdmin = member.name === 'admin';
        const safeMemberName = window.escapeHtml(member.name);
        const targetHtml = member.target > 0
            ? `<button onclick='window.setTarget(${JSON.stringify(member.name)}, ${JSON.stringify(String(member.target))})' class="text-blue-600 font-bold hover:underline">${member.target} 个</button>`
            : `<button onclick='window.setTarget(${JSON.stringify(member.name)}, "100")' class="text-gray-400 hover:underline">未设</button>`;
        const roleHtml = isSuperAdmin
            ? '<span class="text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded">超级管理员</span>'
            : `<select onchange='window.updateStaffRole(${JSON.stringify(member.name)}, this.value)' class="border border-gray-300 p-1 text-xs rounded bg-white text-gray-700"><option value="user" ${member.role === 'user' ? 'selected' : ''}>业务员</option><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>管理员</option></select>`;
        const actionHtml = isSuperAdmin
            ? '<span class="text-gray-300 text-xs">系统保护</span>'
            : `<button onclick='window.resetStaffPassword(${JSON.stringify(member.name)})' class="text-orange-500 hover:text-orange-700 text-xs font-bold mr-2">重置密码</button><button onclick='window.deleteStaff(${JSON.stringify(member.name)})' class="text-red-500 hover:text-red-700 text-xs font-bold">删除</button>`;

        tbody.innerHTML += `<tr class="hover:bg-gray-50 border-b transition"><td class="p-2 font-bold text-gray-700">${safeMemberName}</td><td class="p-2">${roleHtml}</td><td class="p-2">${targetHtml}</td><td class="p-2 text-right">${actionHtml}</td></tr>`;
    });
};

window.createStaff = async function() {
    const payload = {
        name: document.getElementById('new-staff-name').value.trim(),
        role: document.getElementById('new-staff-role').value
    };
    if (!payload.name) return window.showToast('请输入姓名', 'error');

    window.toggleBtnLoading('btn-add-staff', true);
    try {
        const res = await window.apiFetch('/api/staff', { method: 'POST', body: JSON.stringify(payload) });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '添加失败');
        }
        document.getElementById('new-staff-name').value = '';
        window.showToast('添加员工成功');
        window.loadStaff();
    } catch (e) {
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-add-staff', false);
    }
};

window.setTarget = async function(staffName, currentTarget = '100') {
    const targetInput = prompt('设置本项目目标展位数（按展位个数填写；面积换算标准为 9㎡ = 1 个展位）：', currentTarget || '100');
    if (targetInput === null) return;
    if (targetInput === '' || isNaN(targetInput)) return window.showToast('请输入有效数字', 'error');

    await window.apiFetch('/api/set-target', {
        method: 'POST',
        body: JSON.stringify({ staffName, target: parseFloat(targetInput) })
    });
    window.showToast('目标设置成功');
    window.loadStaff();
};

window.updateStaffRole = async function(staffName, role) {
    await window.apiFetch('/api/update-staff-role', {
        method: 'POST',
        body: JSON.stringify({ staffName, role })
    });
    window.showToast('权限修改成功');
    window.loadStaff();
};

window.deleteStaff = async function(staffName) {
    if (!confirm('确定删除该员工吗？')) return;
    await window.apiFetch('/api/delete-staff', {
        method: 'POST',
        body: JSON.stringify({ staffName })
    });
    window.showToast('员工已删除');
    window.loadStaff();
};

window.resetStaffPassword = async function(staffName) {
    if (!confirm(`确定要将业务员 [${staffName}] 的密码重置为默认的 123456 吗？`)) return;

    try {
        const res = await window.apiFetch('/api/reset-password', {
            method: 'POST',
            body: JSON.stringify({ staffName })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '重置失败');
        }
        window.showToast(`已成功将 [${staffName}] 的密码重置为 123456`);
    } catch (e) {
        window.showToast(e.message, 'error');
    }
};

// -- 产品分类管理 --
window.renderCategorySelect = function(selectId, selectedValue = '', allowLegacyValue = false) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const industries = Array.isArray(window.projectIndustries) ? window.projectIndustries : [];
    const existingValues = new Set();
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = industries.length > 0 ? '-- 请选择产品分类 --' : '-- 请先在系统配置中新增产品分类 --';
    select.appendChild(placeholder);

    industries.forEach((industry) => {
        const option = document.createElement('option');
        option.value = industry.industry_name;
        option.textContent = industry.industry_name;
        select.appendChild(option);
        existingValues.add(industry.industry_name);
    });

    if (selectedValue && allowLegacyValue && !existingValues.has(selectedValue)) {
        const legacyOption = document.createElement('option');
        legacyOption.value = selectedValue;
        legacyOption.textContent = `${selectedValue}（旧值）`;
        select.appendChild(legacyOption);
    }

    select.disabled = industries.length === 0;
    select.value = selectedValue && (allowLegacyValue || existingValues.has(selectedValue)) ? selectedValue : '';
};

window.loadIndustries = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;

    try {
        const res = await window.apiFetch(`/api/industries?projectId=${pid}`);
        window.projectIndustries = await res.json();

        const tbody = document.getElementById('industry-list-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            window.projectIndustries.forEach((industry) => {
                tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold text-gray-700">${window.escapeHtml(industry.industry_name)}</td><td class="p-2 text-right"><button onclick="window.deleteIndustry(${Number(industry.id)})" class="text-red-500 hover:underline text-xs">删除</button></td></tr>`;
            });
        }

        window.renderCategorySelect('order-category');
        window.renderCategorySelect('edit-dt-category');
    } catch (e) {
        console.error('加载产品分类失败:', e);
        window.showToast('加载产品分类失败', 'error');
    }
};

window.createIndustry = async function() {
    const pid = document.getElementById('global-project-select').value;
    const name = document.getElementById('new-industry-name').value.trim();
    if (!name) return window.showToast('请填写分类名称！', 'error');

    const alreadyExists = (window.projectIndustries || []).some((industry) => industry.industry_name === name);
    if (alreadyExists) return window.showToast('该产品分类已存在', 'error');

    window.toggleBtnLoading('btn-add-ind', true);
    try {
        await window.apiFetch('/api/add-industry', {
            method: 'POST',
            body: JSON.stringify({ project_id: pid, industry_name: name })
        });
        document.getElementById('new-industry-name').value = '';
        window.showToast('产品分类添加成功');
        await window.loadIndustries();
    } catch (e) {
        window.showToast(e.message || '产品分类添加失败', 'error');
    } finally {
        window.toggleBtnLoading('btn-add-ind', false);
    }
};

window.deleteIndustry = async function(id) {
    if (!confirm('确定删除该分类吗？已录入订单不会被修改。')) return;
    await window.apiFetch('/api/delete-industry', {
        method: 'POST',
        body: JSON.stringify({ industry_id: id })
    });
    window.showToast('删除成功');
    window.loadIndustries();
};

// -- 账户配置管理 --
window.loadAccounts = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;

    const res = await window.apiFetch(`/api/accounts?projectId=${pid}`);
    projectAccounts = await res.json();
    const tbody = document.getElementById('account-list-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    projectAccounts.forEach((account) => {
        tbody.innerHTML += `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold">${window.escapeHtml(account.account_name)}</td><td class="p-2 text-gray-600">${window.escapeHtml(account.bank_name || '-')}</td><td class="p-2 text-gray-600">${window.escapeHtml(account.account_no || '-')}</td><td class="p-2 text-right"><button onclick="window.deleteAccount(${Number(account.id)})" class="text-red-500 hover:underline text-xs">删除</button></td></tr>`;
    });
};

window.createAccount = async function() {
    const pid = document.getElementById('global-project-select').value;
    const name = document.getElementById('new-acc-name').value.trim();
    const bank = document.getElementById('new-acc-bank').value.trim();
    const no = document.getElementById('new-acc-no').value.trim();
    if (!name || !bank) return window.showToast('户名和开户行(或渠道)为必填！', 'error');

    window.toggleBtnLoading('btn-add-acc', true);
    try {
        await window.apiFetch('/api/add-account', {
            method: 'POST',
            body: JSON.stringify({ project_id: pid, account_name: name, bank_name: bank, account_no: no })
        });
        document.getElementById('new-acc-name').value = '';
        document.getElementById('new-acc-bank').value = '';
        document.getElementById('new-acc-no').value = '';
        window.showToast('账户配置成功');
        window.loadAccounts();
    } catch (e) {
        window.showToast(e.message || '账户配置失败', 'error');
    } finally {
        window.toggleBtnLoading('btn-add-acc', false);
    }
};

window.deleteAccount = async function(id) {
    if (!confirm('确定删除这个收款配置吗？')) return;
    await window.apiFetch('/api/delete-account', {
        method: 'POST',
        body: JSON.stringify({ account_id: id })
    });
    window.showToast('删除成功');
    window.loadAccounts();
};

window.renderErpSyncResult = function(payload, title = 'ERP 同步结果') {
    const box = document.getElementById('erp-sync-result');
    if (!box) return;

    const summary = payload?.summary || {};
    const preview = Array.isArray(payload?.preview) ? payload.preview : [];
    const lines = [
        `${title}`,
        '',
        `总返回记录：${summary.total_rows || 0}`,
        `可同步：${summary.importable_count || 0}`,
        `已匹配订单：${summary.matched_count || 0}`,
        `已重复跳过：${summary.duplicate_count || 0}`,
        `非已认领状态：${summary.skipped_not_closed || 0}`,
        `项目名不匹配：${summary.skipped_project_mismatch || 0}`,
        `金额无效：${summary.skipped_invalid_amount || 0}`,
        `超出订单应收：${summary.skipped_overpaid || 0}`,
        `未匹配企业：${summary.unmatched_company || 0}`,
        `匹配到多个同名企业：${summary.ambiguous_company || 0}`
    ];

    if (preview.length > 0) {
        lines.push('', '预览明细（最多显示前 50 条）：');
        preview.forEach((item, index) => {
            lines.push(
                `${index + 1}. [${item.result}] ERP#${item.erp_id} | ${item.company_name} | ${item.project_name} | ¥${Number(item.amount || 0).toLocaleString()} | ${item.reason}`
            );
        });
    }

    box.textContent = lines.join('\n');
    box.classList.remove('hidden');
};

window.loadErpConfig = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;

    const box = document.getElementById('erp-sync-result');
    if (box) box.classList.add('hidden');

    try {
        const res = await window.apiFetch(`/api/erp-config?projectId=${pid}`);
        const data = await res.json();
        window.projectErpConfig = data;

        document.getElementById('erp-enabled').checked = Number(data.enabled || 0) === 1;
        document.getElementById('erp-endpoint-url').value = data.endpoint_url || '';
        document.getElementById('erp-water-id').value = data.water_id || '';
        document.getElementById('erp-expected-project').value = data.expected_project_name || '';
        document.getElementById('erp-session-cookie').value = data.session_cookie || '';
        document.getElementById('erp-last-sync-at').innerText = data.last_sync_at || '未同步';

        let summaryText = '暂无记录';
        if (data.last_sync_summary) {
            try {
                const parsed = JSON.parse(data.last_sync_summary);
                summaryText = `上次同步 ${parsed.synced_count || 0} 条，可同步 ${parsed.summary?.importable_count || 0} 条`;
            } catch (e) {
                summaryText = data.last_sync_summary;
            }
        }
        document.getElementById('erp-last-sync-summary').innerText = summaryText;
    } catch (e) {
        console.error('加载 ERP 配置失败:', e);
        window.showToast('加载 ERP 配置失败', 'error');
    }
};

window.saveErpConfig = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return window.showToast('请先选择项目', 'error');

    const payload = {
        project_id: Number(pid),
        enabled: document.getElementById('erp-enabled').checked ? 1 : 0,
        endpoint_url: document.getElementById('erp-endpoint-url').value.trim(),
        water_id: document.getElementById('erp-water-id').value.trim(),
        expected_project_name: document.getElementById('erp-expected-project').value.trim(),
        session_cookie: document.getElementById('erp-session-cookie').value.trim()
    };

    window.toggleBtnLoading('btn-save-erp-config', true);
    try {
        const res = await window.apiFetch('/api/save-erp-config', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || '保存失败');
        window.showToast('ERP 配置已保存');
        await window.loadErpConfig();
    } catch (e) {
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-save-erp-config', false);
    }
};

window.previewErpSync = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return window.showToast('请先选择项目', 'error');

    window.toggleBtnLoading('btn-preview-erp-sync', true);
    try {
        const res = await window.apiFetch('/api/erp-sync-preview', {
            method: 'POST',
            body: JSON.stringify({ project_id: Number(pid) })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || '预检查失败');
        window.renderErpSyncResult(result, 'ERP 预检查完成');
        window.showToast(result.can_sync ? '预检查完成，可执行正式同步' : '预检查完成，请先处理未匹配项', 'success');
    } catch (e) {
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-preview-erp-sync', false);
    }
};

window.runErpSync = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return window.showToast('请先选择项目', 'error');
    if (!confirm('确定要把 ERP 已认领收款正式同步入账吗？同步后会真实写入当前项目收款流水。')) return;

    window.toggleBtnLoading('btn-run-erp-sync', true);
    try {
        const res = await window.apiFetch('/api/erp-sync', {
            method: 'POST',
            body: JSON.stringify({ project_id: Number(pid) })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || '同步失败');

        window.renderErpSyncResult(result, `ERP 正式同步完成，本次成功入账 ${result.synced_count || 0} 条`);
        window.showToast(`ERP 同步完成，已入账 ${result.synced_count || 0} 条`);
        await window.loadErpConfig();
        if (document.getElementById('sec-order-list')?.classList.contains('active')) {
            await window.loadOrderList?.();
        }
        if (document.getElementById('sec-home')?.classList.contains('active')) {
            await window.loadHomeDashboard?.();
        }
    } catch (e) {
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-run-erp-sync', false);
    }
};
