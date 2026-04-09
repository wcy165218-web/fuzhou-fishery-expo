// ================= js/app.js =================
document.addEventListener('DOMContentLoaded', () => {
    // 绑定基础事件
    document.getElementById('nav-change-pass')?.addEventListener('click', window.openPasswordModal);
    document.getElementById('logout-btn')?.addEventListener('click', window.handleLogout);
    
    // 启动时统一走共享认证恢复逻辑，避免各处各自解析缓存用户。
    const savedUser = window.getCurrentAuthUser?.();
    if (savedUser) {
        window.enterMainView();
    }
});
