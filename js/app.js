// ================= js/app.js =================
document.addEventListener('DOMContentLoaded', () => {
    // 绑定基础事件
    document.getElementById('nav-change-pass')?.addEventListener('click', window.openPasswordModal);
    document.getElementById('logout-btn')?.addEventListener('click', window.handleLogout);
    
    // 【核心修复】：从本地缓存恢复用户状态，并挂载到 window 全局对象上
    const savedUser = localStorage.getItem('exhibition_user');
    if (savedUser) { 
        window.currentUser = JSON.parse(savedUser);
        window.enterMainView(); 
    } 
});
