import { errorResponse } from './response.mjs';

async function getOrderSalesOwner(env, orderId) {
    if (!orderId) return null;
    return env.DB.prepare('SELECT sales_name FROM Orders WHERE id = ?')
        .bind(Number(orderId))
        .first();
}

export async function getStaffAuthState(env, staffName) {
    return env.DB.prepare(`
      SELECT name, role, COALESCE(token_index, 0) AS token_index
      FROM Staff
      WHERE name = ?
    `).bind(String(staffName || '').trim()).first();
}

export function isSuperAdmin(user) {
    return !!user && user.role === 'admin' && user.name === 'admin';
}

export function requireSuperAdmin(currentUser, corsHeaders) {
    if (!isSuperAdmin(currentUser)) {
        return errorResponse('仅超级管理员可操作', 403, corsHeaders);
    }
    return null;
}

export async function canManageOrder(env, currentUser, orderId) {
    if (currentUser?.role === 'admin') return true;
    const order = await getOrderSalesOwner(env, orderId);
    return !!order && order.sales_name === currentUser?.name;
}

export async function canViewSensitiveOrderFields(env, currentUser, orderId) {
    if (isSuperAdmin(currentUser)) return true;
    const order = await getOrderSalesOwner(env, orderId);
    return !!order && order.sales_name === currentUser?.name;
}

export async function canHandleOverpayment(env, currentUser, orderId) {
    if (isSuperAdmin(currentUser)) return true;
    const order = await getOrderSalesOwner(env, orderId);
    return !!order && order.sales_name === currentUser?.name;
}
