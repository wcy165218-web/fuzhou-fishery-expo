import { canHandleOverpayment, canManageOrder } from '../utils/auth.mjs';
import {
    getChinaTimestamp,
    hasMetaChanges,
    parseOrderFeeItems,
    toNonNegativeNumber
} from '../utils/helpers.mjs';
import { errorResponse, internalErrorResponse } from '../utils/response.mjs';
import { readJsonBody } from '../utils/request.mjs';
import { syncBoothStatusForOrder } from '../services/booth-sync.mjs';
import {
    applyOrderPaidAmountDelta,
    refreshOrderOverpaymentIssue,
    rollbackOrderPaidAmountDelta
} from '../services/overpayment.mjs';

async function getPaymentRecord(env, paymentId) {
    return env.DB.prepare(`
        SELECT
            p.id,
            p.project_id,
            p.order_id,
            p.amount,
            p.payment_time,
            p.payer_name,
            p.bank_name,
            p.remarks,
            p.source,
            p.deleted_at
        FROM Payments p
        WHERE p.id = ?
    `).bind(Number(paymentId)).first();
}

export async function handlePaymentRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/payments' && request.method === 'GET') {
        try {
            const orderId = new URL(request.url).searchParams.get('orderId');
            const hasPermission = await canManageOrder(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);
            const results = await env.DB.prepare('SELECT * FROM Payments WHERE order_id = ? AND deleted_at IS NULL ORDER BY payment_time DESC')
                .bind(orderId).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } catch (error) {
            console.error('Fetch payments failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    if (url.pathname === '/api/add-payment' && request.method === 'POST') {
        try {
            const payment = await readJsonBody(request, corsHeaders);
            if (payment instanceof Response) return payment;
            const hasPermission = await canManageOrder(env, currentUser, payment.order_id);
            if (!hasPermission) return errorResponse('权限不足：不能操作他人订单收款', 403, corsHeaders);
            const paymentAmount = toNonNegativeNumber(payment.amount);
            if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
                return errorResponse('请输入正确的收款金额', 400, corsHeaders);
            }
            const orderBeforePayment = await env.DB.prepare(`
                SELECT project_id, status
                FROM Orders
                WHERE id = ?
            `).bind(Number(payment.order_id)).first();
            if (!orderBeforePayment) return errorResponse('订单不存在', 404, corsHeaders);
            if (String(orderBeforePayment.status || '') !== '正常') {
                return errorResponse('无法向已退订或已作废的订单添加收款', 400, corsHeaders);
            }
            const applyResult = await applyOrderPaidAmountDelta(env, Number(payment.order_id), paymentAmount, { preventOverpay: true });
            if (!applyResult.success) {
                if (applyResult.reason === 'would_overpay') {
                    return errorResponse('本次收款会超过订单应收金额，请核对后再提交', 400, corsHeaders);
                }
                return errorResponse('收款处理中发生并发冲突，请刷新后重试', 409, corsHeaders);
            }
            try {
                await env.DB.prepare('INSERT INTO Payments (project_id, order_id, amount, payment_time, payer_name, bank_name, remarks, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(Number(orderBeforePayment.project_id), Number(payment.order_id), paymentAmount, String(payment.payment_time), String(payment.payer_name), String(payment.bank_name), String(payment.remarks || ''), 'MANUAL')
                    .run();
            } catch (insertError) {
                await rollbackOrderPaidAmountDelta(env, Number(payment.order_id), paymentAmount);
                throw insertError;
            }

            await syncBoothStatusForOrder(env, Number(payment.order_id), Number(orderBeforePayment.project_id));
            await refreshOrderOverpaymentIssue(env, Number(payment.order_id), Number(orderBeforePayment.project_id));
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            console.error('Add payment failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    if (url.pathname === '/api/delete-payment' && request.method === 'POST') {
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { payment_id } = payload;
        try {
            const payment = await getPaymentRecord(env, payment_id);
            if (!payment) return errorResponse('支付记录不存在', 404, corsHeaders);
            if (payment.deleted_at) return errorResponse('收款记录已删除', 400, corsHeaders);
            if (payment.source === 'ERP_SYNC') return errorResponse('ERP 同步流水不允许手动删除', 400, corsHeaders);
            const hasPermission = await canManageOrder(env, currentUser, Number(payment.order_id));
            if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);

            const paymentAmount = Number(payment.amount || 0);
            const applyResult = await applyOrderPaidAmountDelta(env, Number(payment.order_id), -paymentAmount);
            if (!applyResult.success) {
                return errorResponse('收款处理中发生并发冲突，请刷新后重试', 409, corsHeaders);
            }

            const nowText = getChinaTimestamp();
            let deleteResult = null;
            try {
                deleteResult = await env.DB.prepare(`
                    UPDATE Payments
                    SET deleted_at = ?, deleted_by = ?
                    WHERE id = ? AND order_id = ? AND deleted_at IS NULL
                `).bind(
                    nowText,
                    String(currentUser.name || ''),
                    Number(payment_id),
                    Number(payment.order_id)
                ).run();
            } catch (deleteError) {
                await rollbackOrderPaidAmountDelta(env, Number(payment.order_id), -paymentAmount);
                throw deleteError;
            }
            if (hasMetaChanges(deleteResult) === 0) {
                await rollbackOrderPaidAmountDelta(env, Number(payment.order_id), -paymentAmount);
                return errorResponse('收款记录状态已变更，请刷新后重试', 409, corsHeaders);
            }

            const order = await env.DB.prepare('SELECT project_id, total_amount, paid_amount FROM Orders WHERE id = ?')
                .bind(Number(payment.order_id)).first();
            if (order) {
                await syncBoothStatusForOrder(env, Number(payment.order_id), Number(order.project_id));
                await refreshOrderOverpaymentIssue(env, Number(payment.order_id), Number(order.project_id));
            }
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            console.error('Delete payment failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    if (url.pathname === '/api/edit-payment' && request.method === 'POST') {
        try {
            const payment = await readJsonBody(request, corsHeaders);
            if (payment instanceof Response) return payment;
            const oldPayment = await getPaymentRecord(env, payment.payment_id);
            if (!oldPayment) return errorResponse('收款记录不存在', 404, corsHeaders);
            if (oldPayment.deleted_at) return errorResponse('收款记录已删除', 400, corsHeaders);
            if (oldPayment.source === 'ERP_SYNC') return errorResponse('ERP 同步流水不允许手动修改', 400, corsHeaders);
            const hasPermission = await canManageOrder(env, currentUser, Number(oldPayment.order_id));
            if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);

            const nextAmount = toNonNegativeNumber(payment.amount);
            if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
                return errorResponse('请输入正确的收款金额', 400, corsHeaders);
            }
            const orderBeforeEdit = await env.DB.prepare('SELECT total_amount, paid_amount FROM Orders WHERE id = ?')
                .bind(Number(oldPayment.order_id)).first();
            if (!orderBeforeEdit) return errorResponse('订单不存在', 404, corsHeaders);
            const diff = nextAmount - Number(oldPayment.amount || 0);

            if (diff !== 0) {
                const applyResult = await applyOrderPaidAmountDelta(env, Number(oldPayment.order_id), diff, { preventOverpay: true });
                if (!applyResult.success) {
                    if (applyResult.reason === 'would_overpay') {
                        return errorResponse('修改后收款总额会超过订单应收金额', 400, corsHeaders);
                    }
                    if (applyResult.reason === 'negative_paid_amount') {
                        return errorResponse('修改后订单已收金额不能小于 0', 400, corsHeaders);
                    }
                    return errorResponse('收款处理中发生并发冲突，请刷新后重试', 409, corsHeaders);
                }
            }

            let updateResult = null;
            try {
                updateResult = await env.DB.prepare(`
                    UPDATE Payments
                    SET amount = ?, payment_time = ?, payer_name = ?, bank_name = ?, remarks = ?
                    WHERE id = ? AND order_id = ? AND deleted_at IS NULL AND amount = ?
                `).bind(
                    nextAmount,
                    payment.payment_time,
                    payment.payer_name,
                    payment.bank_name,
                    payment.remarks,
                    Number(payment.payment_id),
                    Number(oldPayment.order_id),
                    Number(oldPayment.amount || 0)
                ).run();
            } catch (updateError) {
                if (diff !== 0) {
                    await rollbackOrderPaidAmountDelta(env, Number(oldPayment.order_id), diff);
                }
                throw updateError;
            }

            if (hasMetaChanges(updateResult) === 0) {
                if (diff !== 0) {
                    await rollbackOrderPaidAmountDelta(env, Number(oldPayment.order_id), diff);
                }
                return errorResponse('收款记录状态已变更，请刷新后重试', 409, corsHeaders);
            }

            const order = await env.DB.prepare('SELECT project_id, total_amount, paid_amount FROM Orders WHERE id = ?')
                .bind(Number(oldPayment.order_id)).first();
            if (order) {
                await syncBoothStatusForOrder(env, Number(oldPayment.order_id), Number(order.project_id));
                await refreshOrderOverpaymentIssue(env, Number(oldPayment.order_id), Number(order.project_id));
            }
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            console.error('Edit payment failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    if (url.pathname === '/api/update-order-fees' && request.method === 'POST') {
        try {
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const hasPermission = await canManageOrder(env, currentUser, payload.order_id);
            if (!hasPermission) return errorResponse('权限不足：不能变更他人订单费用', 403, corsHeaders);
            const actualFee = toNonNegativeNumber(payload.actual_fee);
            const otherFeeTotal = toNonNegativeNumber(payload.other_fee_total);
            if (!Number.isFinite(actualFee) || actualFee < 0) {
                return errorResponse('展位费必须是非负数', 400, corsHeaders);
            }
            if (!Number.isFinite(otherFeeTotal) || otherFeeTotal < 0) {
                return errorResponse('其他费用必须是非负数', 400, corsHeaders);
            }
            let normalizedFeesJson = '[]';
            try {
                const parsedFees = JSON.parse(payload.fees_json || '[]');
                if (!Array.isArray(parsedFees)) throw new Error('INVALID_FEES_JSON');
                normalizedFeesJson = JSON.stringify(parsedFees);
            } catch (error) {
                return errorResponse('其他收费明细格式无效，请重新填写', 400, corsHeaders);
            }
            const total = actualFee + otherFeeTotal;
            const existingOrder = await env.DB.prepare('SELECT paid_amount FROM Orders WHERE id = ? AND project_id = ?')
                .bind(payload.order_id, payload.project_id).first();
            if (!existingOrder) return errorResponse('订单不存在', 404, corsHeaders);
            if (Number(existingOrder.paid_amount || 0) > total) {
                return errorResponse('调整后总额不能低于已收金额，请先处理退款或修改收款', 400, corsHeaders);
            }
            await env.DB.prepare('UPDATE Orders SET total_booth_fee=?, other_income=?, fees_json=?, discount_reason=?, total_amount=? WHERE id=? AND project_id=?')
                .bind(actualFee, otherFeeTotal, normalizedFeesJson, payload.reason, total, payload.order_id, payload.project_id).run();

            await syncBoothStatusForOrder(env, Number(payload.order_id), Number(payload.project_id));
            await refreshOrderOverpaymentIssue(env, Number(payload.order_id), Number(payload.project_id));
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            console.error('Update order fees failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    if (url.pathname === '/api/resolve-overpayment' && request.method === 'POST') {
        try {
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const orderId = Number(payload.order_id);
            const projectId = Number(payload.project_id);
            const action = String(payload.action || '').trim();
            const note = String(payload.note || '').trim();
            if (!orderId || !projectId) return errorResponse('缺少订单信息', 400, corsHeaders);
            const hasPermission = await canHandleOverpayment(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足：仅超级管理员或订单所属业务员可处理超收', 403, corsHeaders);
            const latestState = await refreshOrderOverpaymentIssue(env, orderId, projectId);
            if (!latestState || Number(latestState.overpaid_amount || 0) <= 0) {
                return errorResponse('当前订单不存在超收异常，无需处理', 400, corsHeaders);
            }
            if (!['fx_diff', 'on_hold'].includes(action)) {
                return errorResponse('处理方式无效', 400, corsHeaders);
            }
            if (!note) {
                return errorResponse(action === 'fx_diff' ? '请填写汇率差说明' : '请填写暂挂说明', 400, corsHeaders);
            }
            const nowText = getChinaTimestamp();
            const handledBy = String(currentUser.name || '');

            if (action === 'on_hold') {
                await env.DB.prepare(`
                    UPDATE OrderOverpaymentIssues
                    SET overpaid_amount = ?,
                        status = 'on_hold',
                        reason = 'on_hold',
                        note = ?,
                        handled_by = ?,
                        handled_at = ?,
                        updated_at = ?
                    WHERE order_id = ?
                `).bind(
                    Number(latestState.overpaid_amount || 0),
                    note,
                    handledBy,
                    nowText,
                    nowText,
                    orderId
                ).run();
                return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
            }

            const order = await env.DB.prepare(`
                SELECT booth_id, total_booth_fee, other_income, total_amount, paid_amount, fees_json
                FROM Orders
                WHERE id = ? AND project_id = ?
            `).bind(orderId, projectId).first();
            if (!order) return errorResponse('订单不存在', 404, corsHeaders);

            const latestOverpaidAmount = Number(latestState.overpaid_amount || 0);
            const feeItems = parseOrderFeeItems(order.fees_json);
            feeItems.push({
                name: note,
                amount: latestOverpaidAmount,
                source: 'overpayment_auto',
                overpayment_reason: 'fx_diff',
                created_at: nowText
            });
            const nextOtherIncome = Number(feeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
            const nextTotalAmount = Number((Number(order.total_booth_fee || 0) + nextOtherIncome).toFixed(2));
            await env.DB.batch([
                env.DB.prepare(`
                    UPDATE Orders
                    SET other_income = ?, fees_json = ?, total_amount = ?
                    WHERE id = ? AND project_id = ?
                `).bind(
                    nextOtherIncome,
                    JSON.stringify(feeItems),
                    nextTotalAmount,
                    orderId,
                    projectId
                ),
                env.DB.prepare(`
                    UPDATE OrderOverpaymentIssues
                    SET overpaid_amount = 0,
                        status = 'resolved_as_fx_diff',
                        reason = 'fx_diff',
                        note = ?,
                        handled_by = ?,
                        handled_at = ?,
                        updated_at = ?
                    WHERE order_id = ?
                `).bind(note, handledBy, nowText, nowText, orderId)
            ]);
            await syncBoothStatusForOrder(env, orderId, projectId);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            console.error('Resolve overpayment failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    return null;
}
