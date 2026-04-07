// ================= js/auth.js =================
const navConfig = [
    { id: 'home', label: '数据看板', roles: ['admin', 'user'], icon: 'home' }, 
    { id: 'order-entry', label: '订单信息录入', roles: ['admin', 'user'], icon: 'clipboard' }, 
    { id: 'order-list', label: '订单与财务管理', roles: ['admin', 'user'], icon: 'wallet' }, 
    { id: 'booth-map', label: '展位图管理', roles: ['admin'], icon: 'layout' },
    { id: 'booth', label: '展位库管理', roles: ['admin'], icon: 'layout' }, 
    { id: 'config', label: '系统配置', roles: ['admin'], superAdminOnly: true, icon: 'settings' }
];
const dashboardNavItems = [
    { key: 'sales-summary', label: '目标与收款概览', icon: 'home' },
    { key: 'sales-list', label: '业务员销售情况', icon: 'users' },
    { key: 'hall', label: '馆别经营看板', icon: 'layout', adminOnly: true },
    { key: 'region-table', label: '地区分布表格', icon: 'fields' }
];
const configNavItems = [
    { key: 'basic', label: '基础配置', icon: 'folders' },
    { key: 'staff', label: '业务员与目标管理', icon: 'users' },
    { key: 'order-fields', label: '订单字段设置', icon: 'fields' }
];
const boothMapNavItems = [
    { key: 'canvas', label: '管理画布', icon: 'folders' },
    { key: 'editor', label: '编辑展位图', icon: 'layout' },
    { key: 'preview', label: '终版预览', icon: 'search' }
];
window.isConfigNavExpanded = window.isConfigNavExpanded ?? false;
window.isHomeNavExpanded = window.isHomeNavExpanded ?? false;
window.isBoothMapNavExpanded = window.isBoothMapNavExpanded ?? false;
window.currentBoothMapPanel = window.currentBoothMapPanel || 'editor';

window.isSuperAdmin = function(user = window.currentUser) {
    return !!user && user.role === 'admin' && user.name === 'admin';
}

window.canAccessSection = function(sectionId, user = window.currentUser) {
    const section = navConfig.find((item) => item.id === sectionId);
    if (!section || !user) return false;
    if (!section.roles.includes(user.role)) return false;
    if (section.superAdminOnly && !window.isSuperAdmin(user)) return false;
    return true;
}

window.handleLogin = async function() { 
    const u = document.getElementById('login-user').value; 
    const p = document.getElementById('login-pass').value; 
    if(!u || !p) return window.showToast('请输入账号和密码', 'error');

    window.toggleBtnLoading('login-btn', true);
    try {
        const res = await fetch('/api/login', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({username: u, password: p}) 
        }); 
        if (res.ok) { 
            currentUser = (await res.json()).user; 
            window.setStoredUser(currentUser); 
            window.showToast('登录成功！');
            window.enterMainView(); 
        } else { 
            let errorMessage = '登录失败，账号或密码错误';
            try {
                const err = await res.json();
                errorMessage = err.error || errorMessage;
            } catch (e) { /* ignore */ }
            window.showToast(errorMessage, 'error'); 
        } 
    } catch(e) {
        window.showToast('网络请求失败', 'error');
    } finally {
        window.toggleBtnLoading('login-btn', false);
    }
}

window.handleLogout = function() { 
    window.clearStoredUser(); 
    location.reload(); 
}

window.enterMainView = function() { 
    document.getElementById('login-view').classList.add('hidden'); 
    document.getElementById('main-view').classList.remove('hidden'); 
    const roleLabel = window.isSuperAdmin(currentUser)
        ? '超级管理员'
        : (currentUser.role === 'admin' ? '管理员' : '业务员');
    document.getElementById('user-info').innerText = `${currentUser.name} (${roleLabel})`; 
    window.renderNav(); 
    window.openSection('home', '数据看板');
    window.loadProjects(); 
    if (currentUser?.must_change_password) {
        window.showToast('当前账号仍在使用默认密码，请先修改为至少 6 位的新密码', 'error');
        setTimeout(() => window.openPasswordModal(true), 100);
    }
}

window.openSection = function(sectionId, label) {
    if (!window.canAccessSection(sectionId)) {
        window.showToast('该页面仅超级管理员可访问', 'error');
        return;
    }
    window.currentSectionId = sectionId;
    if (sectionId === 'config') {
        window.isConfigNavExpanded = true;
    }
    if (sectionId === 'home') {
        window.isHomeNavExpanded = true;
    }
    if (sectionId === 'booth-map') {
        window.isBoothMapNavExpanded = true;
    }
    window.renderNav();
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.getElementById(`sec-${sectionId}`).classList.add('active');
    document.getElementById('current-page-title').innerText = label;

    if(sectionId === 'home' && window.loadHomeDashboard) window.loadHomeDashboard();
    if(sectionId === 'config') {
        window.openConfigPanel?.(window.currentConfigPanel || 'basic');
        window.loadStaff();
        window.loadAccounts();
        window.loadIndustries();
        window.loadErpConfig?.();
        window.loadOrderFieldSettings?.();
    }
    if(sectionId === 'booth-map') {
        window.initBoothMapPage?.(window.currentBoothMapPanel || 'editor');
    }
    if(sectionId === 'booth') { window.loadPrices(); window.loadBooths(); }
    if(sectionId === 'order-entry') window.initOrderForm();
    if(sectionId === 'order-list') window.loadOrderList();
}

window.renderNav = function() {
    const container = document.getElementById('nav-buttons'); container.innerHTML = '';
    navConfig.forEach(item => {
        if (!window.canAccessSection(item.id)) return;

        if (item.id !== 'config' && item.id !== 'home' && item.id !== 'booth-map') {
            const isActive = window.currentSectionId === item.id;
            const btn = document.createElement('button');
            btn.className = `${isActive ? 'btn-primary text-white shadow-sm' : 'btn-nav-muted shadow-sm'} w-full justify-start px-4 py-3 text-sm mb-1`;
            btn.innerHTML = `
                <span class="inline-flex items-center gap-3">
                    <span class="nav-icon-shell ${isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-200'}">
                        ${window.renderIcon(item.icon, 'h-4 w-4', 2)}
                    </span>
                    <span>${item.label}</span>
                </span>
            `;
            btn.onclick = () => { 
                window.openSection(item.id, item.label);
            }; 
            container.appendChild(btn);
            return;
        }

        const isActive = window.currentSectionId === item.id;
        const isHomeItem = item.id === 'home';
        const isBoothMapItem = item.id === 'booth-map';
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-1';

        const btn = document.createElement('button');
        btn.className = `${isActive ? 'btn-primary text-white shadow-sm' : 'btn-nav-muted shadow-sm'} w-full justify-between px-4 py-3 text-sm`;
        btn.innerHTML = `
            <span class="inline-flex items-center gap-3">
                <span class="nav-icon-shell ${isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-200'}">
                    ${window.renderIcon(item.icon, 'h-4 w-4', 2)}
                </span>
                <span>${item.label}</span>
            </span>
            <span class="inline-flex items-center justify-center text-slate-200 transition-transform duration-200 ${(isHomeItem ? window.isHomeNavExpanded : (isBoothMapItem ? window.isBoothMapNavExpanded : window.isConfigNavExpanded)) ? 'rotate-90' : ''}">
                ${window.renderIcon('chevronRight', 'h-4 w-4', 2)}
            </span>
        `;
        btn.onclick = () => {
            if (window.currentSectionId === item.id) {
                if (isHomeItem) {
                    window.isHomeNavExpanded = !window.isHomeNavExpanded;
                } else if (isBoothMapItem) {
                    window.isBoothMapNavExpanded = !window.isBoothMapNavExpanded;
                } else {
                    window.isConfigNavExpanded = !window.isConfigNavExpanded;
                }
                window.renderNav();
                return;
            }
            if (isHomeItem) {
                window.isHomeNavExpanded = true;
            } else if (isBoothMapItem) {
                window.isBoothMapNavExpanded = true;
            } else {
                window.isConfigNavExpanded = true;
            }
            window.openSection(item.id, item.label);
        };
        wrapper.appendChild(btn);

        const shouldShowChildren = isHomeItem
            ? window.isHomeNavExpanded
            : (isBoothMapItem ? window.isBoothMapNavExpanded : window.isConfigNavExpanded);
        if (shouldShowChildren) {
            const childWrap = document.createElement('div');
            childWrap.className = 'mt-2 ml-2 space-y-1 rounded-2xl bg-slate-100/80 p-2 border border-slate-200';

            const childItems = isHomeItem
                ? dashboardNavItems.filter((subItem) => !subItem.adminOnly || window.isSuperAdmin())
                : (isBoothMapItem ? boothMapNavItems : configNavItems);

            childItems.forEach((subItem) => {
                const isCurrentPanel = isHomeItem
                    ? (isActive && window.activeHomeTab === subItem.key)
                    : (isBoothMapItem
                        ? (isActive && window.currentBoothMapPanel === subItem.key)
                        : (isActive && window.currentConfigPanel === subItem.key));
                const childBtn = document.createElement('button');
                childBtn.className = `w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                    isCurrentPanel
                        ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`;
                childBtn.innerHTML = `
                    <span class="inline-flex items-center gap-2.5">
                        <span class="text-slate-400">${window.renderIcon(subItem.icon, 'h-4 w-4', 1.9)}</span>
                        <span>${subItem.label}</span>
                    </span>
                `;
                childBtn.onclick = () => {
                    if (isHomeItem) {
                        window.activeHomeTab = subItem.key;
                        window.isHomeNavExpanded = true;
                        if (window.currentSectionId !== 'home') {
                            window.openSection('home', `数据看板 · ${subItem.label}`);
                        } else {
                            document.getElementById('current-page-title').innerText = `数据看板 · ${subItem.label}`;
                            window.switchHomeTab?.(subItem.key, false);
                            window.renderNav();
                        }
                    } else if (isBoothMapItem) {
                        window.currentBoothMapPanel = subItem.key;
                        window.isBoothMapNavExpanded = true;
                        if (window.currentSectionId !== 'booth-map') {
                            window.openSection('booth-map', `展位图管理 · ${subItem.label}`);
                        } else {
                            document.getElementById('current-page-title').innerText = `展位图管理 · ${subItem.label}`;
                            window.switchBoothMapTab?.(subItem.key, { syncNav: false });
                            window.renderNav();
                        }
                    } else {
                        window.currentConfigPanel = subItem.key;
                        window.isConfigNavExpanded = true;
                        if (window.currentSectionId !== 'config') {
                            window.openSection('config', item.label);
                        } else {
                            window.openConfigPanel?.(subItem.key);
                        }
                    }
                };
                childWrap.appendChild(childBtn);
            });

            wrapper.appendChild(childWrap);
        }

        container.appendChild(wrapper);
    });
}

window.openPasswordModal = function(force = false) {
    const modal = document.getElementById('password-modal');
    const oldPassInput = document.getElementById('modal-old-pass');
    const newPassInput = document.getElementById('modal-new-pass');
    const hint = document.getElementById('password-modal-hint');
    const cancelBtn = document.getElementById('password-modal-cancel');
    if (oldPassInput) oldPassInput.value = '';
    if (newPassInput) newPassInput.value = '';
    if (hint) {
        hint.innerText = force || window.currentUser?.must_change_password
            ? '当前账号仍在使用默认密码 123456，请立即修改为至少 6 位的新密码。'
            : '新密码长度至少 6 位，且不能继续使用默认密码 123456。';
    }
    if (cancelBtn) {
        cancelBtn.classList.toggle('hidden', !!(force || window.currentUser?.must_change_password));
    }
    modal.classList.remove('hidden');
}

window.submitPasswordChange = async function() { 
    const op = document.getElementById('modal-old-pass').value; const np = document.getElementById('modal-new-pass').value; 
    if(!op || !np) return window.showToast("请填写完整", 'error'); 
    window.toggleBtnLoading('btn-change-pass', true);
    try {
        const res = await window.apiFetch('/api/change-password', { method: 'POST', body: JSON.stringify({staffName: currentUser.name, oldPass: op, newPass: np}) }); 
        if(res.ok) { 
            currentUser.must_change_password = false;
            window.setStoredUser(currentUser);
            window.showToast("修改成功，请重新登录"); 
            window.closeModal('password-modal'); 
            setTimeout(() => window.handleLogout(), 1500); 
        } 
        else {
            const err = await res.json();
            window.showToast(err.error || err.message || "原密码错误", 'error');
        } 
    } finally {
        window.toggleBtnLoading('btn-change-pass', false);
    }
}
