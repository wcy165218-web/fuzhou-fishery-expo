export async function syncBoothStatusForOrder(env, orderId, projectId) {
    const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ? AND project_id = ?')
        .bind(Number(orderId), Number(projectId)).first();
    if (!order) return;
    await syncBoothStatusByBoothId(env, Number(projectId), String(order.booth_id || ''));
}

export async function syncBoothStatusByBoothId(env, projectId, boothId) {
    const normalizedBoothId = String(boothId || '').trim();
    if (!projectId || !normalizedBoothId) return;
    const boothRow = await env.DB.prepare(`
        SELECT status
        FROM Booths
        WHERE id = ? AND project_id = ?
    `).bind(normalizedBoothId, Number(projectId)).first();
    if (!boothRow) return;
    const activeOrders = ((await env.DB.prepare(`
        SELECT paid_amount, total_amount
        FROM Orders
        WHERE project_id = ? AND booth_id = ? AND status = '正常'
    `).bind(Number(projectId), normalizedBoothId).all()).results || []);
    if (activeOrders.length === 0) {
        const nextStatus = String(boothRow.status || '').trim() === '已锁定' ? '已锁定' : '可售';
        await env.DB.prepare('UPDATE Booths SET status = ? WHERE id = ? AND project_id = ?')
            .bind(nextStatus, normalizedBoothId, Number(projectId)).run();
        return;
    }
    const hasFullyPaidOrder = activeOrders.some((order) => Number(order.total_amount || 0) > 0 && Number(order.paid_amount || 0) >= Number(order.total_amount || 0));
    const hasDepositOrder = activeOrders.some((order) => Number(order.paid_amount || 0) > 0);
    await env.DB.prepare("UPDATE Booths SET status = ? WHERE id = ? AND project_id = ?")
        .bind(hasFullyPaidOrder ? '已付全款' : (hasDepositOrder ? '已付定金' : '已预定'), normalizedBoothId, Number(projectId)).run();
}
