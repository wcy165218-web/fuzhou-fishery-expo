// ================= js/config.js =================
window.currentConfigPanel = window.currentConfigPanel || 'basic';
window.orderFieldDefinitions = [
    { key: 'is_agent', label: '招展渠道分类', desc: '控制直招/代理商招展切换，核心字段，始终显示。', immutable: true },
    { key: 'agent_name', label: '代理商公司名称', desc: '仅当选择“代理商招展”时显示输入框。' },
    { key: 'company_name', label: '参展企业全称', desc: '订单企业主体名称。' },
    { key: 'credit_code', label: '统一社会信用代码', desc: '包含“无代码”勾选逻辑。' },
    { key: 'contact_person', label: '联系人', desc: '企业联系人字段。' },
    { key: 'phone', label: '联系电话', desc: '企业联系电话字段。' },
    { key: 'region', label: '所在地区', desc: '省/市/区三级地区选择。' },
    { key: 'category', label: '产品分类', desc: '从项目产品分类下拉中选择。' },
    { key: 'main_business', label: '主营业务/详细展品', desc: '录入主营业务或展品说明。' },
    { key: 'profile', label: '企业简介', desc: '用于会刊/企业介绍。' },
    { key: 'booth_selection', label: '展位选定与锁定', desc: '订单核心流程字段，始终显示。', immutable: true },
    { key: 'actual_booth_fee', label: '最终成交展位费', desc: '实际成交展位金额。' },
    { key: 'extra_fees', label: '其他代收/杂费明细', desc: '可录入搭建费、广告费等附加费用。' },
    { key: 'contract_upload', label: '合同附件上传', desc: '控制第三步合同 PDF 上传。' }
];

window.renderConfigSubnav = function() {
    ['basic', 'staff', 'order-fields'].forEach((panelKey) => {
        const btn = document.getElementById(`config-tab-${panelKey}`);
        const panel = document.getElementById(`config-panel-${panelKey}`);
        const active = window.currentConfigPanel === panelKey;
        if (btn) {
            btn.className = `config-subnav-btn w-full text-left rounded-xl px-4 py-3 text-sm font-bold transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200'}`;
        }
        if (panel) {
            panel.classList.toggle('hidden', !active);
        }
    });
};

window.openConfigPanel = function(panelKey) {
    window.currentConfigPanel = panelKey || 'basic';
    window.renderConfigSubnav();
    window.renderNav?.();
    if (window.currentConfigPanel === 'staff') {
        window.loadStaff();
    }
    if (window.currentConfigPanel === 'order-fields') {
        window.loadOrderFieldSettings?.();
    }
};

// -- 项目管理 --
window.loadProjects = async function() {
    try {
        allProjects = await window.readApiJson(
            await window.apiFetch('/api/projects'),
            '加载项目失败',
            []
        );
        const sel = document.getElementById('global-project-select');
        const tbody = document.getElementById('project-list-tbody');
        if (sel) {
            sel.innerHTML = window.renderHtmlCollection(
                allProjects,
                (project) => `<option value="${project.id}">${window.escapeHtml(project.name)}</option>`
            );
        }
        if (tbody) {
            tbody.innerHTML = window.renderHtmlCollection(
                allProjects,
                (project) => {
                    const safeName = window.escapeHtml(project.name);
                    const safeDateText = window.escapeHtml(project.start_date ? `${project.start_date} 至 ${project.end_date}` : '未设');
                    return `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold text-blue-600">${safeName}</td><td class="p-2 text-gray-500">${safeDateText}</td><td class="p-2 text-right"><button onclick="window.openEditProjectModalById(${Number(project.id)})" class="btn-soft-primary px-3 py-1 text-xs">编辑</button></td></tr>`;
                },
                '<tr><td colspan="3" class="p-4 text-center text-slate-400">暂无项目</td></tr>'
            );
        }

        window.onProjectChange();
    } catch (e) {
        window.showToast(e.message || '加载项目失败', 'error');
    }
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
        window.loadOrderFieldSettings?.();
    }
    if (document.getElementById('sec-booth')?.classList.contains('active')) {
        window.loadPrices();
        window.loadBooths();
    }
    if (document.getElementById('sec-booth-map')?.classList.contains('active')) {
        window.initBoothMapPage?.();
    }
    if (document.getElementById('sec-order-entry')?.classList.contains('active')) {
        window.initOrderForm();
    }
    if (document.getElementById('sec-order-list')?.classList.contains('active')) {
        if (window.getOrderListState) {
            window.getOrderListState().page = 1;
        }
        window.orderSalesFilterProjectId = '';
        window.markOrderDashboardDirty?.();
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
        await window.ensureApiSuccess(
            await window.apiFetch('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
            '项目创建失败'
        );
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
        await window.ensureApiSuccess(
            await window.apiFetch('/api/update-project', { method: 'POST', body: JSON.stringify(data) }),
            '项目更新失败'
        );
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

    try {
        const staff = await window.readApiJson(
            await window.apiFetch(`/api/staff?projectId=${pid}`),
            '加载人员失败',
            []
        );
        const tbody = document.getElementById('staff-list-tbody');
        if (!tbody) return;
        tbody.innerHTML = window.renderHtmlCollection(
            staff,
            (member) => {
                const isSuperAdmin = member.name === 'admin';
                const safeMemberName = window.escapeHtml(member.name);
                const sortControls = isSuperAdmin
                    ? '<span class="badge-readonly">固定首位</span>'
                    : `<div class="inline-flex items-center gap-1">
                            <button onclick='window.moveStaffOrder(${JSON.stringify(member.name)}, "up")' class="btn-outline px-2 py-1 text-xs leading-none">上移</button>
                            <button onclick='window.moveStaffOrder(${JSON.stringify(member.name)}, "down")' class="btn-outline px-2 py-1 text-xs leading-none">下移</button>
                       </div>`;
                const targetHtml = member.target > 0
                    ? `<button onclick='window.setTarget(${JSON.stringify(member.name)}, ${JSON.stringify(String(member.target))})' class="btn-soft-primary px-3 py-1 text-xs">${member.target} 个</button>`
                    : `<button onclick='window.setTarget(${JSON.stringify(member.name)}, "100")' class="btn-outline px-3 py-1 text-xs text-slate-500">未设</button>`;
                const roleHtml = isSuperAdmin
                    ? '<span class="badge-danger">超级管理员</span>'
                    : `<select onchange='window.updateStaffRole(${JSON.stringify(member.name)}, this.value)' class="border border-gray-300 p-1 text-xs rounded bg-white text-gray-700"><option value="user" ${member.role === 'user' ? 'selected' : ''}>业务员</option><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>管理员</option></select>`;
                const salesRankingHtml = `<label class="inline-flex items-center gap-2 text-xs font-bold ${Number(member.exclude_from_sales_ranking || 0) ? 'text-slate-400' : 'text-emerald-700'}">
                        <input type="checkbox" ${Number(member.exclude_from_sales_ranking || 0) ? '' : 'checked'} onchange='window.updateStaffSalesRanking(${JSON.stringify(member.name)}, this.checked)' class="accent-emerald-600">
                        <span>${Number(member.exclude_from_sales_ranking || 0) ? '不参与' : '参与'}</span>
                   </label>`;
                const actionHtml = isSuperAdmin
                    ? '<span class="badge-readonly">系统保护</span>'
                    : `<button onclick='window.resetStaffPassword(${JSON.stringify(member.name)})' class="btn-soft-amber px-3 py-1 text-xs mr-2">重置密码</button><button onclick='window.deleteStaff(${JSON.stringify(member.name)})' class="btn-soft-danger px-3 py-1 text-xs">删除</button>`;

                return `<tr class="hover:bg-gray-50 border-b transition"><td class="p-2 font-bold text-gray-700">${safeMemberName}</td><td class="p-2">${roleHtml}</td><td class="p-2">${targetHtml}</td><td class="p-2 text-center">${salesRankingHtml}</td><td class="p-2 text-center">${sortControls}</td><td class="p-2 text-right">${actionHtml}</td></tr>`;
            },
            '<tr><td colspan="6" class="p-4 text-center text-slate-400">暂无人员</td></tr>'
        );
    } catch (e) {
        window.showToast(e.message || '加载人员失败', 'error');
    }
};

window.moveStaffOrder = async function(staffName, direction) {
    try {
        await window.readApiJson(
            await window.apiFetch('/api/update-staff-order', {
                method: 'POST',
                body: JSON.stringify({ staffName, direction })
            }),
            '排序调整失败',
            {}
        );
        window.showToast('人员顺序已更新');
        await window.loadStaff();
        if (document.getElementById('sec-home')?.classList.contains('active')) {
            window.loadHomeDashboard?.();
        }
    } catch (e) {
        window.showToast(e.message, 'error');
    }
};

window.updateStaffSalesRanking = async function(staffName, shouldParticipate) {
    try {
        await window.readApiJson(
            await window.apiFetch('/api/update-staff-sales-ranking', {
                method: 'POST',
                body: JSON.stringify({
                    staffName,
                    excludeFromSalesRanking: shouldParticipate ? 0 : 1
                })
            }),
            '更新失败',
            {}
        );
        window.showToast('销售全景参与设置已更新');
        await window.loadStaff();
        if (document.getElementById('sec-home')?.classList.contains('active')) {
            window.loadHomeDashboard?.();
        }
    } catch (e) {
        window.showToast(e.message, 'error');
        await window.loadStaff();
    }
};

window.createStaff = async function() {
    const payload = {
        name: document.getElementById('new-staff-name').value.trim(),
        role: document.getElementById('new-staff-role').value
    };
    if (!payload.name) return window.showToast('请输入姓名', 'error');

    try {
        await window.withButtonLoading('btn-add-staff', async () => {
            await window.ensureApiSuccess(
                await window.apiFetch('/api/staff', { method: 'POST', body: JSON.stringify(payload) }),
                '添加失败'
            );
            document.getElementById('new-staff-name').value = '';
            window.showToast('添加员工成功');
            await window.loadStaff();
        });
    } catch (e) {
        window.showToast(e.message, 'error');
    }
};

window.setTarget = async function(staffName, currentTarget = '100') {
    const targetInput = prompt('设置本项目目标展位数（按展位个数填写；面积换算标准为 9㎡ = 1 个展位）：', currentTarget || '100');
    if (targetInput === null) return;
    if (targetInput === '' || isNaN(targetInput)) return window.showToast('请输入有效数字', 'error');

    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/set-target', {
                method: 'POST',
                body: JSON.stringify({ staffName, target: parseFloat(targetInput) })
            }),
            '目标设置失败'
        );
        window.showToast('目标设置成功');
        window.loadStaff();
    } catch (e) {
        window.showToast(e.message || '目标设置失败', 'error');
    }
};

window.updateStaffRole = async function(staffName, role) {
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/update-staff-role', {
                method: 'POST',
                body: JSON.stringify({ staffName, role })
            }),
            '权限修改失败'
        );
        window.showToast('权限修改成功');
        window.loadStaff();
    } catch (e) {
        window.showToast(e.message || '权限修改失败', 'error');
        window.loadStaff();
    }
};

window.deleteStaff = async function(staffName) {
    if (!confirm('确定删除该员工吗？')) return;
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/delete-staff', {
                method: 'POST',
                body: JSON.stringify({ staffName })
            }),
            '删除失败'
        );
        window.showToast('员工已删除');
        window.loadStaff();
    } catch (e) {
        window.showToast(e.message || '删除失败', 'error');
    }
};

window.resetStaffPassword = async function(staffName) {
    if (!confirm(`确定要将业务员 [${staffName}] 的密码重置为默认的 123456 吗？`)) return;

    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/reset-password', {
                method: 'POST',
                body: JSON.stringify({ staffName })
            }),
            '重置失败'
        );
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
        window.projectIndustries = await window.readApiJson(
            await window.apiFetch(`/api/industries?projectId=${pid}`),
            '加载产品分类失败',
            []
        );

        const tbody = document.getElementById('industry-list-tbody');
        if (tbody) {
            tbody.innerHTML = window.renderHtmlCollection(
                window.projectIndustries,
                (industry) => `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold text-gray-700">${window.escapeHtml(industry.industry_name)}</td><td class="p-2 text-right"><button onclick="window.deleteIndustry(${Number(industry.id)})" class="btn-soft-danger px-3 py-1 text-xs">删除</button></td></tr>`,
                '<tr><td colspan="2" class="p-4 text-center text-slate-400">暂无分类</td></tr>'
            );
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

    try {
        await window.withButtonLoading('btn-add-ind', async () => {
            await window.ensureApiSuccess(
                await window.apiFetch('/api/add-industry', {
                    method: 'POST',
                    body: JSON.stringify({ project_id: pid, industry_name: name })
                }),
                '产品分类添加失败'
            );
            document.getElementById('new-industry-name').value = '';
            window.showToast('产品分类添加成功');
            await window.loadIndustries();
        });
    } catch (e) {
        window.showToast(e.message || '产品分类添加失败', 'error');
    }
};

window.deleteIndustry = async function(id) {
    if (!confirm('确定删除该分类吗？已录入订单不会被修改。')) return;
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/delete-industry', {
                method: 'POST',
                body: JSON.stringify({ industry_id: id })
            }),
            '删除失败'
        );
        window.showToast('删除成功');
        window.loadIndustries();
    } catch (e) {
        window.showToast(e.message || '删除失败', 'error');
    }
};

// -- 账户配置管理 --
window.loadAccounts = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;

    try {
        projectAccounts = await window.readApiJson(
            await window.apiFetch(`/api/accounts?projectId=${pid}`),
            '加载收款账户失败',
            []
        );
        const tbody = document.getElementById('account-list-tbody');
        if (!tbody) return;

        tbody.innerHTML = window.renderHtmlCollection(
            projectAccounts,
            (account) => `<tr class="border-b hover:bg-gray-50"><td class="p-2 font-bold">${window.escapeHtml(account.account_name)}</td><td class="p-2 text-gray-600">${window.escapeHtml(account.bank_name || '-')}</td><td class="p-2 text-gray-600">${window.escapeHtml(account.account_no || '-')}</td><td class="p-2 text-right"><button onclick="window.deleteAccount(${Number(account.id)})" class="btn-soft-danger px-3 py-1 text-xs">删除</button></td></tr>`,
            '<tr><td colspan="4" class="p-4 text-center text-slate-400">暂无收款账户</td></tr>'
        );
    } catch (e) {
        window.showToast(e.message || '加载收款账户失败', 'error');
    }
};

window.createAccount = async function() {
    const pid = document.getElementById('global-project-select').value;
    const name = document.getElementById('new-acc-name').value.trim();
    const bank = document.getElementById('new-acc-bank').value.trim();
    const no = document.getElementById('new-acc-no').value.trim();
    if (!name || !bank) return window.showToast('户名和开户行(或渠道)为必填！', 'error');

    window.toggleBtnLoading('btn-add-acc', true);
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/add-account', {
                method: 'POST',
                body: JSON.stringify({ project_id: pid, account_name: name, bank_name: bank, account_no: no })
            }),
            '账户配置失败'
        );
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
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/delete-account', {
                method: 'POST',
                body: JSON.stringify({ account_id: id })
            }),
            '删除失败'
        );
        window.showToast('删除成功');
        window.loadAccounts();
    } catch (e) {
        window.showToast(e.message || '删除失败', 'error');
    }
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
        `超收待处理：${summary.overpaid_pending_count || summary.skipped_overpaid || 0}`,
        `未匹配企业：${summary.unmatched_company || 0}`,
        `匹配到多个同名企业：${summary.ambiguous_company || 0}`
    ];

    if (preview.length > 0) {
        lines.push('', '预览明细（最多显示前 50 条）：');
        preview.forEach((item, index) => {
            lines.push(
                `${index + 1}. [${item.result}] ERP#${item.erp_id} | ${item.company_name} | ${item.project_name} | ${window.formatCurrency(item.amount || 0)} | ${item.reason}`
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
        const data = await window.readApiJson(
            await window.apiFetch(`/api/erp-config?projectId=${pid}`),
            '加载 ERP 配置失败',
            {}
        );
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

    try {
        await window.withButtonLoading('btn-save-erp-config', async () => {
            await window.readApiJson(
                await window.apiFetch('/api/save-erp-config', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                }),
                '保存失败',
                {}
            );
            window.showToast('ERP 配置已保存');
            await window.loadErpConfig();
        });
    } catch (e) {
        window.showToast(e.message, 'error');
    }
};

window.previewErpSync = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return window.showToast('请先选择项目', 'error');

    try {
        await window.withButtonLoading('btn-preview-erp-sync', async () => {
            const result = await window.readApiJson(
                await window.apiFetch('/api/erp-sync-preview', {
                    method: 'POST',
                    body: JSON.stringify({ project_id: Number(pid) })
                }),
                '预检查失败',
                {}
            );
            window.renderErpSyncResult(result, 'ERP 预检查完成');
            window.showToast(result.can_sync ? '预检查完成，可执行正式同步' : '预检查完成，请先处理未匹配项', 'success');
        });
    } catch (e) {
        window.showToast(e.message, 'error');
    }
};

window.runErpSync = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return window.showToast('请先选择项目', 'error');
    if (!confirm('确定要把 ERP 已认领收款正式同步入账吗？同步后会真实写入当前项目收款流水。')) return;

    try {
        await window.withButtonLoading('btn-run-erp-sync', async () => {
            const result = await window.readApiJson(
                await window.apiFetch('/api/erp-sync', {
                    method: 'POST',
                    body: JSON.stringify({ project_id: Number(pid) })
                }),
                '同步失败',
                {}
            );

            window.renderErpSyncResult(result, `ERP 正式同步完成，本次成功入账 ${result.synced_count || 0} 条`);
            window.showToast(`ERP 同步完成，已入账 ${result.synced_count || 0} 条`);
            await window.loadErpConfig();
            if (document.getElementById('sec-order-list')?.classList.contains('active')) {
                await window.loadOrderList?.();
            }
            if (document.getElementById('sec-home')?.classList.contains('active')) {
                await window.loadHomeDashboard?.();
            }
        });
    } catch (e) {
        window.showToast(e.message, 'error');
    }
};

window.clearProjectRolloutData = async function() {
    const pid = document.getElementById('global-project-select').value;
    const projectName = document.getElementById('global-project-select')?.selectedOptions?.[0]?.textContent?.trim() || `项目 ${pid}`;
    if (!pid) return window.showToast('请先选择项目', 'error');

    const firstConfirm = window.confirm(`将清空“${projectName}”下的订单、收款、展位图和展位库数据。此操作不可撤销，是否继续？`);
    if (!firstConfirm) return;
    const secondConfirm = window.confirm(`请再次确认：真的要清空“${projectName}”的业务数据吗？`);
    if (!secondConfirm) return;

    try {
        await window.withButtonLoading('btn-clear-project-rollout-data', async () => {
            const result = await window.readApiJson(
                await window.apiFetch('/api/clear-project-rollout-data', {
                    method: 'POST',
                    body: JSON.stringify({ project_id: Number(pid) })
                }),
                '清空失败',
                {}
            );

            const counts = result.deleted_counts || {};
            window.showToast(`项目业务数据已清空：订单 ${Number(counts.orders || 0)} 条，展位 ${Number(counts.booths || 0)} 条`);
            await Promise.allSettled([
                window.loadHomeDashboard?.(),
                window.loadBooths?.(),
                window.loadOrderList?.(),
                window.initOrderForm?.(),
                window.initBoothMapPage?.()
            ]);
        });
    } catch (e) {
        window.showToast(e.message || '清空失败', 'error');
    }
};

window.renderOrderFieldSettings = function() {
    const tbody = document.getElementById('order-field-settings-tbody');
    if (!tbody) return;
    const settings = Array.isArray(window.currentOrderFieldSettings) ? window.currentOrderFieldSettings : [];
    const rows = settings.map((setting) => {
        const definition = window.orderFieldDefinitions.find((item) => item.key === setting.key) || { label: setting.key, desc: '' };
        const locked = !!setting.immutable;
        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3">
                    <div class="font-bold text-slate-800">${window.escapeHtml(definition.label)}</div>
                    <div class="text-xs text-slate-500 mt-1">${window.escapeHtml(definition.key || setting.key)}</div>
                </td>
                <td class="p-3 text-center">
                    <input type="checkbox" ${setting.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''} onchange="window.updateOrderFieldSetting('${setting.key}', 'enabled', this.checked)" class="h-4 w-4 accent-slate-900">
                </td>
                <td class="p-3 text-center">
                    <input type="checkbox" ${setting.required ? 'checked' : ''} ${locked ? 'disabled' : ''} onchange="window.updateOrderFieldSetting('${setting.key}', 'required', this.checked)" class="h-4 w-4 accent-slate-900">
                </td>
                <td class="p-3 text-right text-xs text-slate-500">${window.escapeHtml(locked ? '核心字段，固定显示并必填' : (definition.desc || ''))}</td>
            </tr>
        `;
    }).join('');
    tbody.innerHTML = rows || '<tr><td colspan="4" class="p-6 text-center text-slate-400">暂无字段设置</td></tr>';
};

window.updateOrderFieldSetting = function(fieldKey, targetField, checked) {
    if (!Array.isArray(window.currentOrderFieldSettings)) return;
    window.currentOrderFieldSettings = window.currentOrderFieldSettings.map((item) => {
        if (item.key !== fieldKey || item.immutable) return item;
        const next = { ...item, [targetField]: checked ? 1 : 0 };
        if (targetField === 'enabled' && !checked) next.required = 0;
        if (targetField === 'required' && checked) next.enabled = 1;
        return next;
    });
    window.renderOrderFieldSettings();
};

window.loadOrderFieldSettings = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;
    try {
        window.currentOrderFieldSettings = await window.readApiJson(
            await window.apiFetch(`/api/order-field-settings?projectId=${pid}`),
            '加载订单字段设置失败',
            []
        );
        window.renderOrderFieldSettings();
        window.orderFieldSettingsMap = Object.fromEntries((window.currentOrderFieldSettings || []).map((item) => [item.key, item]));
        window.applyOrderFieldSettings?.();
    } catch (e) {
        console.error('加载订单字段设置失败', e);
        window.showToast('加载订单字段设置失败', 'error');
    }
};

window.saveOrderFieldSettings = async function() {
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return window.showToast('请先选择项目', 'error');
    window.toggleBtnLoading('btn-save-order-field-settings', true);
    try {
        await window.readApiJson(
            await window.apiFetch('/api/save-order-field-settings', {
                method: 'POST',
                body: JSON.stringify({ project_id: Number(pid), settings: window.currentOrderFieldSettings || [] })
            }),
            '保存失败',
            {}
        );
        window.showToast('订单字段设置已保存');
        await window.loadOrderFieldSettings();
    } catch (e) {
        window.showToast(e.message, 'error');
    } finally {
        window.toggleBtnLoading('btn-save-order-field-settings', false);
    }
};
