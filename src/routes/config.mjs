import { requireSuperAdmin } from '../utils/auth.mjs';
import { getChinaTimestamp } from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';
import { buildErpPreviewResult, getErpConfig, saveErpConfig } from '../services/erp.mjs';
import { getOrderFieldSettings, saveOrderFieldSettings } from '../services/order-fields.mjs';
import { refreshOrderOverpaymentIssue } from '../services/overpayment.mjs';
import { syncBoothStatusByBoothId } from '../services/booth-sync.mjs';

export async function handleConfigRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/accounts') {
        if (request.method === 'GET') {
            const pid = new URL(request.url).searchParams.get('projectId');
            const results = await env.DB.prepare('SELECT * FROM Accounts WHERE project_id = ?').bind(pid).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
    }

    if (url.pathname === '/api/add-account' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id, account_name, bank_name, account_no } = await request.json();
        await env.DB.prepare('INSERT INTO Accounts (project_id, account_name, bank_name, account_no) VALUES (?, ?, ?, ?)').bind(project_id, account_name, bank_name, account_no).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/delete-account' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { account_id } = await request.json();
        await env.DB.prepare('DELETE FROM Accounts WHERE id = ?').bind(account_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/erp-config' && request.method === 'GET') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const pid = new URL(request.url).searchParams.get('projectId');
        if (!pid) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const config = await getErpConfig(env, pid);
        return new Response(JSON.stringify(config || {
            project_id: Number(pid),
            enabled: 0,
            endpoint_url: '',
            water_id: '',
            session_cookie: '',
            expected_project_name: '',
            last_sync_at: '',
            last_sync_summary: ''
        }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/order-field-settings' && request.method === 'GET') {
        const pid = new URL(request.url).searchParams.get('projectId');
        if (!pid) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const settings = await getOrderFieldSettings(env, pid);
        return new Response(JSON.stringify(settings), { headers: corsHeaders });
    }

    if (url.pathname === '/api/save-order-field-settings' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id, settings } = await request.json();
        if (!project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const saved = await saveOrderFieldSettings(env, project_id, settings);
        return new Response(JSON.stringify({ success: true, settings: saved }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/save-erp-config' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await request.json();
        if (!payload.project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);
        await saveErpConfig(env, payload);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/erp-sync-preview' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id } = await request.json();
        if (!project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const config = await getErpConfig(env, project_id);
        if (!config || Number(config.enabled) !== 1) {
            return errorResponse('请先在系统配置中启用 ERP 收款同步', 400, corsHeaders);
        }

        const plan = await buildErpPreviewResult(env, Number(project_id), config);
        return new Response(JSON.stringify({
            success: true,
            summary: plan.summary,
            preview: plan.preview.slice(0, 50),
            can_sync: plan.importableItems.length > 0
        }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/erp-sync' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id } = await request.json();
        if (!project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const config = await getErpConfig(env, project_id);
        if (!config || Number(config.enabled) !== 1) {
            return errorResponse('请先在系统配置中启用 ERP 收款同步', 400, corsHeaders);
        }

        const plan = await buildErpPreviewResult(env, Number(project_id), config);
        if (plan.importableItems.length > 0) {
            const affectedOrderPairs = new Set();
            for (const item of plan.importableItems) {
                const existingPayment = await env.DB.prepare(`
          SELECT
            p.id,
            p.order_id,
            p.project_id,
            p.amount,
            o.status as order_status
              FROM Payments p
              LEFT JOIN Orders o ON o.id = p.order_id
              WHERE p.erp_record_id = ?
                AND p.deleted_at IS NULL
              LIMIT 1
            `).bind(String(item.erp_record_id)).first();

                if (existingPayment) {
                    const oldOrderStatus = String(existingPayment.order_status || '');
                    const canRebindCancelledOrder = oldOrderStatus === '已退订' || oldOrderStatus === '已作废';

                    if (!canRebindCancelledOrder) {
                        continue;
                    }

                    await env.DB.batch([
                        env.DB.prepare('UPDATE Orders SET paid_amount = MAX(0, paid_amount - ?) WHERE id = ?')
                            .bind(Number(existingPayment.amount || 0), Number(existingPayment.order_id)),
                        env.DB.prepare(`
                  UPDATE Payments
                  SET project_id = ?,
                      order_id = ?,
                      amount = ?,
                      payment_time = ?,
                      payer_name = ?,
                      bank_name = ?,
                      remarks = ?,
                      source = ?,
                      raw_payload = ?
                  WHERE id = ?
                `).bind(
                            Number(item.project_id),
                            Number(item.order_id),
                            Number(item.amount),
                            String(item.payment_time),
                            String(item.payer_name || ''),
                            String(item.bank_name || ''),
                            String(item.remarks || ''),
                            String(item.source || 'ERP_SYNC'),
                            String(item.raw_payload || ''),
                            Number(existingPayment.id)
                        ),
                        env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?')
                            .bind(Number(item.amount), Number(item.order_id))
                    ]);
                    affectedOrderPairs.add(`${Number(existingPayment.project_id)}::${Number(existingPayment.order_id)}`);
                    affectedOrderPairs.add(`${Number(item.project_id)}::${Number(item.order_id)}`);
                    continue;
                }

                await env.DB.batch([
                    env.DB.prepare(`
                INSERT INTO Payments (
                  project_id,
                  order_id,
                  amount,
                  payment_time,
                  payer_name,
                  bank_name,
                  remarks,
                  source,
                  erp_record_id,
                  raw_payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                        Number(item.project_id),
                        Number(item.order_id),
                        Number(item.amount),
                        String(item.payment_time),
                        String(item.payer_name || ''),
                        String(item.bank_name || ''),
                        String(item.remarks || ''),
                        String(item.source || 'ERP_SYNC'),
                        String(item.erp_record_id),
                        String(item.raw_payload || '')
                    ),
                    env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?')
                        .bind(Number(item.amount), Number(item.order_id))
                ]);
                affectedOrderPairs.add(`${Number(item.project_id)}::${Number(item.order_id)}`);
            }

            const fullyPaidOrders = (await env.DB.prepare(`
            SELECT id, booth_id
            FROM Orders
            WHERE project_id = ? AND paid_amount >= total_amount AND status NOT IN ('已退订', '已作废')
          `).bind(project_id).all()).results || [];

            for (const order of fullyPaidOrders) {
                await syncBoothStatusByBoothId(env, Number(project_id), String(order.booth_id || ''));
            }

            for (const pair of affectedOrderPairs) {
                const [syncedProjectId, syncedOrderId] = pair.split('::');
                await refreshOrderOverpaymentIssue(env, Number(syncedOrderId), Number(syncedProjectId));
            }
        }

        const syncSummary = JSON.stringify({
            synced_count: plan.importableItems.length,
            summary: plan.summary
        });

        await env.DB.prepare(`
          UPDATE ProjectErpConfigs
          SET last_sync_at = ?, last_sync_summary = ?
          WHERE project_id = ?
        `).bind(getChinaTimestamp(), syncSummary, Number(project_id)).run();

        return new Response(JSON.stringify({
            success: true,
            synced_count: plan.importableItems.length,
            summary: plan.summary,
            preview: plan.preview.slice(0, 50)
        }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/industries') {
        if (request.method === 'GET') {
            const pid = new URL(request.url).searchParams.get('projectId');
            const results = await env.DB.prepare('SELECT * FROM Industries WHERE project_id = ?').bind(pid).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
    }

    if (url.pathname === '/api/add-industry' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id, industry_name } = await request.json();
        await env.DB.prepare('INSERT INTO Industries (project_id, industry_name) VALUES (?, ?)').bind(project_id, industry_name).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/delete-industry' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { industry_id } = await request.json();
        await env.DB.prepare('DELETE FROM Industries WHERE id = ?').bind(industry_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return null;
}
