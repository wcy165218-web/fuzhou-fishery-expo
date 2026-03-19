// ================= js/auth.js =================
const navConfig = [
    { id: 'home', label: '📊 首页看板', roles: ['admin', 'user'] }, 
    { id: 'order-entry', label: '✍️ 订单信息录入', roles: ['admin', 'user'] }, 
    { id: 'order-list', label: '📁 订单与财务大盘', roles: ['admin', 'user'] }, 
    { id: 'booth', label: '🎪 展位库管理', roles: ['admin'] }, 
    { id: 'config', label: '⚙️ 系统与人员配置', roles: ['admin'] }
];

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
            localStorage.setItem('exhibition_user', JSON.stringify(currentUser)); 
            window.showToast('登录成功！');
            window.enterMainView(); 
        } else { 
            window.showToast('登录失败，账号或密码错误', 'error'); 
        } 
    } catch(e) {
        window.showToast('网络请求失败', 'error');
    } finally {
        window.toggleBtnLoading('login-btn', false);
    }
}

window.handleLogout = function() { 
    localStorage.removeItem('exhibition_user'); 
    location.reload(); 
}

window.enterMainView = function() { 
    document.getElementById('login-view').classList.add('hidden'); 
    document.getElementById('main-view').classList.remove('hidden'); 
    document.getElementById('user-info').innerText = `${currentUser.name} (${currentUser.role === 'admin' ? '管理员' : '业务员'})`; 
    window.renderNav(); 
    window.loadProjects(); 
}

window.renderNav = function() {
    const container = document.getElementById('nav-buttons'); container.innerHTML = '';
    navConfig.forEach(item => {
        if (item.roles.includes(currentUser.role)) {
            const btn = document.createElement('button'); btn.className = "w-full text-left px-4 py-3 rounded text-slate-300 hover:bg-blue-600 transition text-sm mb-1"; btn.innerText = item.label;
            btn.onclick = () => { 
                document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active')); 
                document.getElementById(`sec-${item.id}`).classList.add('active'); 
                document.getElementById('current-page-title').innerText = item.label.substring(3);
                
                if(item.id === 'config') { window.loadStaff(); window.loadAccounts(); window.loadIndustries(); } 
                if(item.id === 'booth') { window.loadPrices(); window.loadBooths(); } 
                if(item.id === 'order-entry') window.initOrderForm(); 
                if(item.id === 'order-list') window.loadOrderList();
            }; 
            container.appendChild(btn);
        }
    });
}

window.openPasswordModal = function() { document.getElementById('password-modal').classList.remove('hidden'); }

window.submitPasswordChange = async function() { 
    const op = document.getElementById('modal-old-pass').value; const np = document.getElementById('modal-new-pass').value; 
    if(!op || !np) return window.showToast("请填写完整", 'error'); 
    window.toggleBtnLoading('btn-change-pass', true);
    try {
        const res = await window.apiFetch('/api/change-password', { method: 'POST', body: JSON.stringify({staffName: currentUser.name, oldPass: op, newPass: np}) }); 
        if(res.ok) { 
            window.showToast("修改成功，请重新登录"); 
            window.closeModal('password-modal'); 
            setTimeout(() => window.handleLogout(), 1500); 
        } 
        else { const err = await res.json(); window.showToast(err.message || "原密码错误", 'error'); } 
    } finally {
        window.toggleBtnLoading('btn-change-pass', false);
    }
}