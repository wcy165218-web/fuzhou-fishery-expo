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
var boothMaps = [];
var currentBoothMap = null;
var currentBoothMapItems = [];
var currentBoothMapRuntimeItems = [];
var currentBoothMapId = null;
var boothMapDirty = false;
var AUTH_STORAGE_KEY = 'exhibition_user';
var assetObjectUrlCache = {};
var pendingAssetObjectUrlRequests = {};
var assetDataUrlCache = {};
var pendingAssetDataUrlRequests = {};

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

window.formatCompactCount = function(value) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, '');
}

window.formatCompactPercent = function(value) {
    return `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;
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

window.setCurrentAuthUser = function(user) {
    const normalizedUser = user && typeof user === 'object' ? user : null;
    window.currentUser = normalizedUser;
    currentUser = normalizedUser;
    if (normalizedUser) {
        window.setStoredUser(normalizedUser);
    } else {
        window.clearStoredUser();
    }
    return normalizedUser;
}

window.clearCurrentAuthUser = function() {
    return window.setCurrentAuthUser(null);
}

window.getCurrentAuthUser = function() {
    if (window.currentUser?.token) return window.currentUser;
    if (currentUser?.token) return currentUser;
    const savedUser = window.getStoredUser?.();
    if (!savedUser) return null;
    try {
        const parsed = JSON.parse(savedUser);
        if (parsed?.token) {
            return window.setCurrentAuthUser(parsed);
        }
    } catch (error) {
        window.clearCurrentAuthUser();
        return null;
    }
    return null;
}

window.fetchWithAuth = async function(url, options = {}) {
    const requestOptions = { ...options };
    const headers = { ...(requestOptions.headers || {}) };
    const authUser = window.getCurrentAuthUser();
    if (authUser?.token) {
        headers['Authorization'] = `Bearer ${authUser.token}`;
    }
    if (!headers['Content-Type'] && !(requestOptions.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    requestOptions.headers = headers;
    return fetch(url, requestOptions);
}

function getOrderAuthUser(user = null) {
    return user || window.getCurrentAuthUser?.() || window.currentUser || currentUser || null;
}

// Shared order helpers live here so finance/home/order pages follow one client-side rule set.
window.isOwnOrder = function(order, user = null) {
    const authUser = getOrderAuthUser(user);
    return !!order && !!authUser && String(order.sales_name || '') === String(authUser.name || '');
}

window.canViewSensitiveOrderFields = function(order, user = null) {
    const authUser = getOrderAuthUser(user);
    return !!order && (!!window.isSuperAdmin?.(authUser) || window.isOwnOrder(order, authUser));
}

window.canManageOrder = function(order, user = null) {
    const authUser = getOrderAuthUser(user);
    return !!order && !!authUser && (String(authUser.role || '') === 'admin' || Number(order.can_manage) === 1);
}

window.getOrderBoothDisplay = function(order) {
    if (!order) return '无展位订单';
    const hall = String(order.hall || '').trim();
    const boothId = String(order.booth_id || '').trim();
    if (!boothId) return '无展位订单';
    return hall ? `${hall} - ${boothId}` : boothId;
}

window.getOverpaidAmount = function(order) {
    if (!order) return 0;
    const explicit = Number(order.overpaid_amount || 0);
    if (explicit > 0) return explicit;
    return Math.max(0, Number((Number(order.paid_amount || 0) - Number(order.total_amount || 0)).toFixed(2)));
}

window.hasOverpaymentIssue = function(order) {
    return window.getOverpaidAmount(order) > 0.01;
}

window.canHandleOverpayment = function(order, user = null) {
    const authUser = getOrderAuthUser(user);
    return !!order && (!!window.isSuperAdmin?.(authUser) || window.isOwnOrder(order, authUser));
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

window.readApiErrorMessage = async function(response, fallback = '请求失败') {
    if (!response) return fallback;
    try {
        const data = await response.clone().json();
        if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
        if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
    } catch (error) {}
    try {
        const text = String(await response.clone().text() || '').trim();
        if (text) return text;
    } catch (error) {}
    return fallback;
}

window.ensureApiSuccess = async function(response, fallback = '请求失败') {
    if (response.ok) return response;
    throw new Error(await window.readApiErrorMessage(response, fallback));
}

window.readApiJson = async function(response, fallback = '请求失败', defaultValue = null) {
    await window.ensureApiSuccess(response, fallback);
    try {
        return await response.json();
    } catch (error) {
        return defaultValue;
    }
}

window.readApiSuccessJson = async function(response, fallback = '请求失败', defaultValue = null) {
    const data = await window.readApiJson(response, fallback, defaultValue);
    if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'success') && !data.success) {
        throw new Error(String(data.error || data.message || fallback));
    }
    return data;
}

window.revokeAuthorizedAssetUrl = function(rawUrl) {
    const normalizedUrl = String(rawUrl || '').trim();
    if (!normalizedUrl) return;
    if (assetObjectUrlCache[normalizedUrl]) {
        URL.revokeObjectURL(assetObjectUrlCache[normalizedUrl]);
        delete assetObjectUrlCache[normalizedUrl];
    }
    delete pendingAssetObjectUrlRequests[normalizedUrl];
    delete assetDataUrlCache[normalizedUrl];
    delete pendingAssetDataUrlRequests[normalizedUrl];
}

window.getAuthorizedAssetDataUrl = async function(rawUrl) {
    const normalizedUrl = String(rawUrl || '').trim();
    if (!normalizedUrl) return '';
    if (assetDataUrlCache[normalizedUrl]) return assetDataUrlCache[normalizedUrl];
    if (pendingAssetDataUrlRequests[normalizedUrl]) return pendingAssetDataUrlRequests[normalizedUrl];

    pendingAssetDataUrlRequests[normalizedUrl] = window.fetchWithAuth(normalizedUrl)
        .then(async (res) => {
            if (!res.ok) {
                let message = '资源加载失败';
                try {
                    const data = await res.clone().json();
                    if (data?.error) message = data.error;
                } catch (error) {
                    const text = await res.text().catch(() => '');
                    if (text) message = text;
                }
                throw new Error(message);
            }
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('资源读取失败'));
                reader.readAsDataURL(blob);
            });
            assetDataUrlCache[normalizedUrl] = dataUrl;
            return dataUrl;
        })
        .catch((error) => {
            console.error('Authorized asset data URL load failed:', normalizedUrl, error);
            return '';
        })
        .finally(() => {
            delete pendingAssetDataUrlRequests[normalizedUrl];
        });

    return pendingAssetDataUrlRequests[normalizedUrl];
}

window.getAuthorizedAssetUrl = function(rawUrl, onReady = null) {
    const normalizedUrl = String(rawUrl || '').trim();
    if (!normalizedUrl) return '';
    if (assetObjectUrlCache[normalizedUrl]) return assetObjectUrlCache[normalizedUrl];
    if (pendingAssetObjectUrlRequests[normalizedUrl]) return '';

    pendingAssetObjectUrlRequests[normalizedUrl] = window.fetchWithAuth(normalizedUrl)
        .then(async (res) => {
            if (!res.ok) {
                let message = '资源加载失败';
                try {
                    const data = await res.clone().json();
                    if (data?.error) message = data.error;
                } catch (error) {
                    const text = await res.text().catch(() => '');
                    if (text) message = text;
                }
                throw new Error(message);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            assetObjectUrlCache[normalizedUrl] = objectUrl;
            if (typeof onReady === 'function') onReady(objectUrl);
            return objectUrl;
        })
        .catch((error) => {
            console.error('Authorized asset load failed:', normalizedUrl, error);
            if (typeof onReady === 'function') onReady('');
            return '';
        })
        .finally(() => {
            delete pendingAssetObjectUrlRequests[normalizedUrl];
        });

    return '';
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
    const requestOptions = { ...options };
    const res = await window.fetchWithAuth(url, requestOptions);
    if (res.status === 401) {
        if (requestOptions.skipUnauthorizedHandler) {
            return res;
        }
        window.showToast("登录状态已过期或被管理员修改，请重新登录！", 'error');
        window.clearCurrentAuthUser();
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
