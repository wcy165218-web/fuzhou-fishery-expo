import { canManageOrder } from '../utils/auth.mjs';
import { getChinaTimestamp } from '../utils/helpers.mjs';
import { errorResponse, internalErrorResponse } from '../utils/response.mjs';
import { readJsonBody } from '../utils/request.mjs';

export async function handleExpenseRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/expenses' && request.method === 'GET') {
        try {
            const orderId = new URL(request.url).searchParams.get('orderId');
            const hasPermission = await canManageOrder(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);
            const results = await env.DB.prepare('SELECT * FROM Expenses WHERE order_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
                .bind(orderId).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } catch (error) {
            console.error('Fetch expenses failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    if (url.pathname === '/api/add-expense' && request.method === 'POST') {
        try {
            const expense = await readJsonBody(request, corsHeaders);
            if (expense instanceof Response) return expense;
            const hasPermission = await canManageOrder(env, currentUser, expense.order_id);
            if (!hasPermission) return errorResponse('权限不足：不能操作他人订单支出', 403, corsHeaders);
            await env.DB.prepare(`
              INSERT INTO Expenses (project_id, order_id, payee_name, payee_channel, payee_bank, payee_account, amount, applicant, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
            `).bind(
                expense.project_id,
                expense.order_id,
                expense.payee_name,
                expense.payee_channel,
                expense.payee_bank,
                expense.payee_account,
                expense.amount,
                expense.applicant,
                expense.reason
            ).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            console.error('Add expense failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    if (url.pathname === '/api/delete-expense' && request.method === 'POST') {
        try {
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const { expense_id } = payload;
            const expense = await env.DB.prepare('SELECT id, order_id FROM Expenses WHERE id = ? AND deleted_at IS NULL')
                .bind(Number(expense_id)).first();
            if (!expense) return errorResponse('记录不存在或已撤销', 404, corsHeaders);
            const hasPermission = await canManageOrder(env, currentUser, expense.order_id);
            if (!hasPermission) return errorResponse('权限不足：仅管理员或本人名下企业可撤销', 403, corsHeaders);
            await env.DB.prepare('UPDATE Expenses SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
                .bind(getChinaTimestamp(), String(currentUser.name || ''), Number(expense_id))
                .run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            console.error('Delete expense failed:', error);
            return internalErrorResponse(corsHeaders);
        }
    }

    return null;
}
