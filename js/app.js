// ================= js/app.js =================
// 等待 HTML 框架加载完毕后执行初始化验证
document.addEventListener('DOMContentLoaded', () => {
    // 页面刷新时重新附加 Navbar 事件监听
    document.getElementById('nav-change-pass')?.addEventListener('click', window.openPasswordModal);
    document.getElementById('logout-btn')?.addEventListener('click', window.handleLogout);
    
    // 如果本地有令牌（说明之前登录过），则直接渲染后台
    if (currentUser) { 
        window.enterMainView(); 
    } 
});