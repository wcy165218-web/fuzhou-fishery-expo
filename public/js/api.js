// ================= js/api.js =================
// 声明全局共享变量 (使用 var 确保跨文件可访问)
var currentUser = null; 
var allProjects = []; 
var globalPrices = { '标摊': 0, '豪标': 0, '光地': 0 }; 
var allBooths = []; 
var currentStandardFee = 0; 
var isJointExhibition = false; 
var dynamicFees = []; 
var allOrders = []; 
var currentModalOrderId = null; 
var fmDynamicFees = [];
var fmSwapFees = [];
var fmSwapCandidateBooth = null;
var currentViewOrder = null; 
var projectAccounts = []; 
var projectIndustries = []; 
var lastFmTab = 'pay';
var currentSilentOrderId = null; 
var projectErpConfig = null;
var currentPrintObjectUrl = null;
var AUTH_STORAGE_KEY = 'exhibition_user';

window.formatMoneyNumber = function(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return '0';
    return amount.toLocaleString('zh-CN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

window.formatCurrency = function(value, prefix = '¥') {
    return `${prefix}${window.formatMoneyNumber(value)}`;
}

window.getStoredUser = function() {
    const sessionValue = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (sessionValue) return sessionValue;
    const legacyValue = localStorage.getItem(AUTH_STORAGE_KEY);
    if (legacyValue) {
        sessionStorage.setItem(AUTH_STORAGE_KEY, legacyValue);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return legacyValue;
    }
    return '';
}

window.setStoredUser = function(user) {
    const value = JSON.stringify(user || null);
    sessionStorage.setItem(AUTH_STORAGE_KEY, value);
    localStorage.removeItem(AUTH_STORAGE_KEY);
}

window.clearStoredUser = function() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
}

window.renderIcon = function(name, className = 'h-4 w-4', strokeWidth = 1.9) {
    const icons = {
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.25 9.75V20h13.5V9.75"/><path d="M9.75 20v-6.75h4.5V20"/>',
        clipboard: '<path d="M9 5.25h6"/><path d="M9.75 3h4.5a2.25 2.25 0 0 1 2.25 2.25v.75h1.5A2.25 2.25 0 0 1 20.25 8.25v10.5A2.25 2.25 0 0 1 18 21H6A2.25 2.25 0 0 1 3.75 18.75V8.25A2.25 2.25 0 0 1 6 6h1.5v-.75A2.25 2.25 0 0 1 9.75 3Z"/><path d="M12 10.5v6"/><path d="M9 13.5h6"/>',
        wallet: '<path d="M3.75 7.5h14.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V7.5Z"/><path d="M3.75 7.5V6a2 2 0 0 1 2-2h10"/><path d="M15.75 13.5h4.5"/><path d="M17.25 13.5a.75.75 0 1 1 0 0"/>',
        layout: '<rect x="3.75" y="4.5" width="16.5" height="15" rx="2.25"/><path d="M9 4.5v15"/><path d="M9 10.5h11.25"/>',
        settings: '<path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z"/><path d="M19.5 12a7.56 7.56 0 0 0-.09-1.14l1.8-1.41-1.8-3.12-2.22.63a7.63 7.63 0 0 0-1.98-1.14L14.25 3h-4.5l-.96 1.82c-.69.27-1.36.65-1.98 1.14l-2.22-.63-1.8 3.12 1.8 1.41A7.56 7.56 0 0 0 4.5 12c0 .39.03.77.09 1.14l-1.8 1.41 1.8 3.12 2.22-.63c.62.49 1.29.87 1.98 1.14L9.75 21h4.5l.96-1.82c.69-.27 1.36-.65 1.98-1.14l2.22.63 1.8-3.12-1.8-1.41c.06-.37.09-.75.09-1.14Z"/>',
        folders: '<path d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h4.19l1.5 1.5H18A2.25 2.25 0 0 1 20.25 9v8.25A2.25 2.25 0 0 1 18 19.5H6a2.25 2.25 0 0 1-2.25-2.25V7.5Z"/><path d="M3.75 10.5h16.5"/>',
        users: '<path d="M15.75 19.5v-1.5a3.75 3.75 0 0 0-3.75-3.75h-3A3.75 3.75 0 0 0 5.25 18v1.5"/><path d="M10.5 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M18 19.5v-1.5a3.75 3.75 0 0 0-2.25-3.43"/><path d="M14.25 4.8a3 3 0 0 1 0 5.4"/>',
        fields: '<rect x="4.5" y="5.25" width="15" height="13.5" rx="2.25"/><path d="M8.25 9h7.5"/><path d="M8.25 12h7.5"/><path d="M8.25 15h4.5"/>',
        chevronRight: '<path d="m9 6 6 6-6 6"/>',
        chevronDown: '<path d="m6 9 6 6 6-6"/>',
        close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
        plus: '<path d="M12 5.25v13.5"/><path d="M5.25 12h13.5"/>',
        download: '<path d="M12 4.5v10.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
        swap: '<path d="M7.5 7.5h10.5"/><path d="m14.25 4.5 3.75 3-3.75 3"/><path d="M16.5 16.5H6"/><path d="m9.75 13.5-3.75 3 3.75 3"/>'
    };
    const body = icons[name] || icons.chevronRight;
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

window.resetPrintModal = function() {
    const modal = document.getElementById('print-modal');
    const shell = modal?.firstElementChild;
    const titleEl = document.getElementById('print-modal-title');
    const contentEl = document.getElementById('print-content');
    const primaryBtn = document.getElementById('print-modal-primary');
    const secondaryBtn = document.getElementById('print-modal-secondary');
    if (titleEl) titleEl.innerText = '打印预览';
    if (contentEl) {
        contentEl.className = 'p-8 bg-white text-black overflow-y-auto flex-1';
        contentEl.innerHTML = '';
    }
    if (shell) {
        shell.className = 'bg-white shadow-2xl w-full max-w-3xl flex flex-col max-h-[95vh]';
    }
    if (primaryBtn) {
        primaryBtn.innerText = '打印本页';
        primaryBtn.className = 'px-4 py-1.5 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 shadow';
        primaryBtn.onclick = () => window.print();
    }
    if (secondaryBtn) {
        secondaryBtn.className = 'hidden px-4 py-1.5 bg-slate-700 text-white rounded font-bold hover:bg-slate-800 shadow';
        secondaryBtn.innerText = '次要操作';
        secondaryBtn.onclick = null;
    }
    if (currentPrintObjectUrl) {
        URL.revokeObjectURL(currentPrintObjectUrl);
        currentPrintObjectUrl = null;
    }
}

window.openPrintModal = function({
    title = '打印预览',
    contentHtml = '',
    shellClass = 'bg-white shadow-2xl w-full max-w-3xl flex flex-col max-h-[95vh]',
    contentClass = 'p-8 bg-white text-black overflow-y-auto flex-1',
    primaryText = '打印本页',
    primaryClass = 'px-4 py-1.5 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 shadow',
    primaryAction = null,
    secondaryText = '',
    secondaryClass = 'px-4 py-1.5 bg-slate-700 text-white rounded font-bold hover:bg-slate-800 shadow',
    secondaryAction = null
} = {}) {
    window.resetPrintModal();
    const modal = document.getElementById('print-modal');
    const shell = modal?.firstElementChild;
    const titleEl = document.getElementById('print-modal-title');
    const contentEl = document.getElementById('print-content');
    const primaryBtn = document.getElementById('print-modal-primary');
    const secondaryBtn = document.getElementById('print-modal-secondary');
    if (!modal || !contentEl || !primaryBtn) return;
    if (titleEl) titleEl.innerText = title;
    if (shell) shell.className = shellClass;
    contentEl.className = contentClass;
    contentEl.innerHTML = contentHtml;
    primaryBtn.innerText = primaryText;
    primaryBtn.className = primaryClass;
    primaryBtn.onclick = () => {
        if (typeof primaryAction === 'function') primaryAction();
    };
    if (secondaryBtn && secondaryText && typeof secondaryAction === 'function') {
        secondaryBtn.className = secondaryClass;
        secondaryBtn.innerText = secondaryText;
        secondaryBtn.onclick = () => secondaryAction();
    }
    modal.classList.remove('hidden');
}

// 通用弹窗关闭函数
window.closeModal = function(id) { 
    if (id === 'password-modal' && window.currentUser?.must_change_password) {
        window.showToast('当前账号仍在使用默认密码，请先完成修改', 'error');
        return;
    }
    if (id === 'print-modal') {
        window.resetPrintModal();
    }
    document.getElementById(id).classList.add('hidden'); 
}

// 体验升级：全局 Toast 提示系统
window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const iconEl = document.createElement('span');
    const textEl = document.createElement('span');
    const bgColor = type === 'success' ? 'bg-green-500' : (type === 'error' ? 'bg-red-500' : 'bg-blue-500');
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    
    toast.className = `toast-enter text-white px-6 py-3 rounded shadow-lg flex items-center gap-2 ${bgColor}`;
    iconEl.innerText = icon;
    textEl.className = 'font-bold';
    textEl.innerText = String(message || '');
    toast.appendChild(iconEl);
    toast.appendChild(textEl);
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-enter-active');
    });

    setTimeout(() => {
        toast.classList.remove('toast-enter-active');
        toast.classList.add('toast-leave-active');
        setTimeout(() => toast.remove(), 300); 
    }, 3000);
}

// 全局 API 拦截器 (携带 Token，处理过期)
window.apiFetch = async function(url, options = {}) {
    const headers = options.headers || {};
    if (currentUser && currentUser.token) {
        headers['Authorization'] = `Bearer ${currentUser.token}`;
    }
    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    options.headers = headers;

    const res = await fetch(url, options);
    if (res.status === 401) {
        window.showToast("登录状态已过期或被管理员修改，请重新登录！", 'error');
        window.clearStoredUser();
        window.currentUser = null; // 彻底清除内存中的用户信息
        setTimeout(() => location.reload(), 1500);
        throw new Error("Unauthorized");
    }
    return res;
}

// 按钮 Loading 状态防抖
window.toggleBtnLoading = function(btnId, isLoading, originalText = '') {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = `<span class="spinner"></span> 处理中...`;
        btn.classList.add('opacity-70', 'cursor-not-allowed');
    } else {
        btn.disabled = false;
        btn.innerHTML = originalText || btn.dataset.originalText;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
}

window.withButtonLoading = async function(btnId, task, originalText = '') {
    window.toggleBtnLoading(btnId, true, originalText);
    try {
        return await task();
    } finally {
        window.toggleBtnLoading(btnId, false, originalText);
    }
}
// 前端 XSS 防护：HTML 字符转义
window.escapeHtml = function(text) {
    if (!text) return "";
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

window.escapeAttr = function(text) {
    return window.escapeHtml(text).replace(/`/g, '&#096;');
}

window.renderHtmlCollection = function(items, renderItem, emptyHtml = '') {
    if (!Array.isArray(items) || items.length === 0) return emptyHtml;
    return items.map((item, index) => renderItem(item, index)).join('');
}
