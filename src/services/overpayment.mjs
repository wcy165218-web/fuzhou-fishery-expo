import { getChinaTimestamp, getOverpaidAmount, hasMetaChanges } from '../utils/helpers.mjs';

export async function applyOrderPaidAmountDelta(env, orderId, delta, { preventOverpay = false } = {}) {
    const numericDelta = Number(delta || 0);
    if (!Number.isFinite(numericDelta)) {
        return { success: false, reason: 'invalid_delta' };
    }
    const result = await env.DB.prepare(`
        UPDATE Orders
        SET paid_amount = ROUND(paid_amount + ?, 2)
        WHERE id = ?
          AND paid_amount + ? >= 0
          AND (? = 0 OR paid_amount + ? <= total_amount)
    `).bind(
        numericDelta,
        Number(orderId),
        numericDelta,
        preventOverpay ? 1 : 0,
        numericDelta
    ).run();
    if (hasMetaChanges(result) > 0) {
        return { success: true };
    }
    const order = await env.DB.prepare('SELECT total_amount, paid_amount FROM Orders WHERE id = ?').bind(Number(orderId)).first();
    if (!order) return { success: false, reason: 'missing_order' };
    const nextPaidAmount = Number(order.paid_amount || 0) + numericDelta;
    if (nextPaidAmount < 0) return { success: false, reason: 'negative_paid_amount' };
    if (preventOverpay && nextPaidAmount > Number(order.total_amount || 0)) {
        return { success: false, reason: 'would_overpay' };
    }
    return { success: false, reason: 'conflict' };
}

export async function rollbackOrderPaidAmountDelta(env, orderId, delta) {
    const numericDelta = Number(delta || 0);
    if (!Number.isFinite(numericDelta) || numericDelta === 0) return;
    await env.DB.prepare(`
        UPDATE Orders
        SET paid_amount = ROUND(paid_amount - ?, 2)
        WHERE id = ?
    `).bind(numericDelta, Number(orderId)).run();
}

export async function refreshOrderOverpaymentIssue(env, orderId, projectId) {
    const order = await env.DB.prepare(`
        SELECT id, project_id, total_amount, paid_amount, status
        FROM Orders
        WHERE id = ? AND project_id = ?
    `).bind(Number(orderId), Number(projectId)).first();
    if (!order) return null;

    const nowText = getChinaTimestamp();
    const existing = await env.DB.prepare('SELECT * FROM OrderOverpaymentIssues WHERE order_id = ?').bind(Number(orderId)).first();
    const orderStatus = String(order.status || '');

    if (orderStatus === '已退订' || orderStatus === '已作废') {
        if (existing) {
            await env.DB.prepare(`
                UPDATE OrderOverpaymentIssues
                SET overpaid_amount = 0,
                    status = 'resolved_by_fee_update',
                    updated_at = ?
                WHERE order_id = ?
            `).bind(nowText, Number(orderId)).run();
        }

        return {
            overpaid_amount: 0,
            status: 'resolved_by_fee_update',
            reason: existing?.reason || '',
            note: existing?.note || ''
        };
    }

    const overpaidAmount = getOverpaidAmount(order.total_amount, order.paid_amount);

    if (overpaidAmount > 0.01) {
        const shouldResetToPending = !existing || !existing.status || existing.status === 'resolved_by_fee_update' || Number(existing.overpaid_amount || 0) <= 0;
        const nextStatus = shouldResetToPending ? 'pending' : String(existing.status || 'pending');
        const nextReason = shouldResetToPending ? '' : String(existing.reason || '');
        const nextNote = shouldResetToPending ? '' : String(existing.note || '');
        const nextHandledBy = shouldResetToPending ? '' : String(existing.handled_by || '');
        const nextHandledAt = shouldResetToPending ? '' : String(existing.handled_at || '');
        const detectedAt = existing?.detected_at || nowText;

        await env.DB.prepare(`
            INSERT INTO OrderOverpaymentIssues (
                order_id, project_id, overpaid_amount, status, reason, note,
                handled_by, handled_at, detected_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                project_id = excluded.project_id,
                overpaid_amount = excluded.overpaid_amount,
                status = excluded.status,
                reason = excluded.reason,
                note = excluded.note,
                handled_by = excluded.handled_by,
                handled_at = excluded.handled_at,
                detected_at = excluded.detected_at,
                updated_at = excluded.updated_at
        `).bind(
            Number(orderId),
            Number(projectId),
            overpaidAmount,
            nextStatus,
            nextReason,
            nextNote,
            nextHandledBy,
            nextHandledAt,
            detectedAt,
            nowText
        ).run();

        return {
            overpaid_amount: overpaidAmount,
            status: nextStatus,
            reason: nextReason,
            note: nextNote
        };
    }

    if (existing) {
        await env.DB.prepare(`
            UPDATE OrderOverpaymentIssues
            SET overpaid_amount = 0,
                status = 'resolved_by_fee_update',
                updated_at = ?
            WHERE order_id = ?
        `).bind(nowText, Number(orderId)).run();
    }

    return {
        overpaid_amount: 0,
        status: 'resolved_by_fee_update',
        reason: existing?.reason || '',
        note: existing?.note || ''
    };
}
