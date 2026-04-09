import { getChinaTimestamp, getOverpaidAmount, hasMetaChanges } from '../utils/helpers.mjs';

const SQL_IN_CHUNK_SIZE = 80;
const BATCH_CHUNK_SIZE = 40;

function chunkItems(items = [], chunkSize = SQL_IN_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

function normalizeOrderProjectPairs(rawPairs = []) {
    const normalizedPairs = [];
    const pairKeys = new Set();
    (Array.isArray(rawPairs) ? rawPairs : []).forEach((pair) => {
        let projectId = 0;
        let orderId = 0;
        if (typeof pair === 'string') {
            const [rawProjectId, rawOrderId] = String(pair).split('::');
            projectId = Number(rawProjectId || 0);
            orderId = Number(rawOrderId || 0);
        } else if (pair && typeof pair === 'object') {
            projectId = Number(pair.projectId || pair.project_id || 0);
            orderId = Number(pair.orderId || pair.order_id || 0);
        }
        if (!projectId || !orderId) return;
        const pairKey = `${projectId}::${orderId}`;
        if (pairKeys.has(pairKey)) return;
        pairKeys.add(pairKey);
        normalizedPairs.push({ projectId, orderId, pairKey });
    });
    return normalizedPairs;
}

function buildRefreshResult(existing, overpaidAmount, status = 'resolved_by_fee_update') {
    return {
        overpaid_amount: overpaidAmount,
        status,
        reason: existing?.reason || '',
        note: existing?.note || ''
    };
}

function buildOverpaymentMutation(env, order, existing, nowText) {
    const orderId = Number(order.id || 0);
    const projectId = Number(order.project_id || 0);
    const orderStatus = String(order.status || '');

    if (orderStatus === '已退订' || orderStatus === '已作废') {
        if (!existing) {
            return {
                statement: null,
                result: buildRefreshResult(null, 0)
            };
        }
        return {
            statement: env.DB.prepare(`
                UPDATE OrderOverpaymentIssues
                SET overpaid_amount = 0,
                    status = 'resolved_by_fee_update',
                    updated_at = ?
                WHERE order_id = ?
            `).bind(nowText, orderId),
            result: buildRefreshResult(existing, 0)
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
        return {
            statement: env.DB.prepare(`
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
                orderId,
                projectId,
                overpaidAmount,
                nextStatus,
                nextReason,
                nextNote,
                nextHandledBy,
                nextHandledAt,
                detectedAt,
                nowText
            ),
            result: {
                overpaid_amount: overpaidAmount,
                status: nextStatus,
                reason: nextReason,
                note: nextNote
            }
        };
    }

    if (!existing) {
        return {
            statement: null,
            result: buildRefreshResult(null, 0)
        };
    }

    return {
        statement: env.DB.prepare(`
            UPDATE OrderOverpaymentIssues
            SET overpaid_amount = 0,
                status = 'resolved_by_fee_update',
                updated_at = ?
            WHERE order_id = ?
        `).bind(nowText, orderId),
        result: buildRefreshResult(existing, 0)
    };
}

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

export async function refreshOrderOverpaymentIssues(env, rawPairs = []) {
    const normalizedPairs = normalizeOrderProjectPairs(rawPairs);
    const resultsMap = new Map();
    if (normalizedPairs.length === 0) return resultsMap;
    const nowText = getChinaTimestamp();
    const groupedPairs = normalizedPairs.reduce((accumulator, pair) => {
        if (!accumulator.has(pair.projectId)) {
            accumulator.set(pair.projectId, []);
        }
        accumulator.get(pair.projectId).push(pair);
        return accumulator;
    }, new Map());
    const statements = [];

    for (const [projectId, pairs] of groupedPairs.entries()) {
        const orderIds = pairs.map((pair) => pair.orderId);
        const ordersMap = new Map();
        const existingIssuesMap = new Map();

        for (const orderIdChunk of chunkItems(orderIds)) {
            const placeholders = orderIdChunk.map(() => '?').join(',');
            const orderRows = ((await env.DB.prepare(`
                SELECT id, project_id, total_amount, paid_amount, status
                FROM Orders
                WHERE project_id = ? AND id IN (${placeholders})
            `).bind(Number(projectId), ...orderIdChunk).all()).results || []);
            orderRows.forEach((order) => {
                ordersMap.set(Number(order.id || 0), order);
            });

            const existingRows = ((await env.DB.prepare(`
                SELECT *
                FROM OrderOverpaymentIssues
                WHERE project_id = ? AND order_id IN (${placeholders})
            `).bind(Number(projectId), ...orderIdChunk).all()).results || []);
            existingRows.forEach((issue) => {
                existingIssuesMap.set(Number(issue.order_id || 0), issue);
            });
        }

        pairs.forEach((pair) => {
            const order = ordersMap.get(pair.orderId);
            if (!order) {
                resultsMap.set(pair.pairKey, null);
                return;
            }
            const mutation = buildOverpaymentMutation(env, order, existingIssuesMap.get(pair.orderId), nowText);
            if (mutation.statement) {
                statements.push(mutation.statement);
            }
            resultsMap.set(pair.pairKey, mutation.result);
        });
    }

    for (const statementChunk of chunkItems(statements, BATCH_CHUNK_SIZE)) {
        if (statementChunk.length === 0) continue;
        await env.DB.batch(statementChunk);
    }

    return resultsMap;
}

export async function refreshOrderOverpaymentIssue(env, orderId, projectId) {
    const resultMap = await refreshOrderOverpaymentIssues(env, [{ orderId, projectId }]);
    return resultMap.get(`${Number(projectId)}::${Number(orderId)}`) || null;
}
