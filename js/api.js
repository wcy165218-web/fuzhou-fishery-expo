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
var currentViewOrder = null; 
var projectAccounts = []; 
var projectIndustries = []; 
var lastFmTab = 'pay';
var currentSilentOrderId = null; 

// 通用弹窗关闭函数
window.closeModal = function(id) { 
    document.getElementById(id).classList.add('hidden'); 
}

// 体验升级：全局 Toast 提示系统
window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500' : (type === 'error' ? 'bg-red-500' : 'bg-blue-500');
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    
    toast.className = `toast-enter text-white px-6 py-3 rounded shadow-lg flex items-center gap-2 ${bgColor}`;
    toast.innerHTML = `<span>${icon}</span><span class="font-bold">${message}</span>`;
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
        localStorage.removeItem('exhibition_user');
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