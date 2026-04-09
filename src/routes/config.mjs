import { requireSuperAdmin } from '../utils/auth.mjs';
import { getChinaTimestamp } from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';
import { readJsonBody } from '../utils/request.mjs';
import { buildErpPreviewResult, getErpConfig, saveErpConfig } from '../services/erp.mjs';
import { getOrderFieldSettings, saveOrderFieldSettings } from '../services/order-fields.mjs';
import { refreshOrderOverpaymentIssues } from '../services/overpayment.mjs';
import { syncBoothStatusByBoothIds } from '../services/booth-sync.mjs';
import { normalizeBoothCode } from '../utils/booth-map.mjs';

const SQL_IN_CHUNK_SIZE = 80;
const BATCH_CHUNK_SIZE = 40;
const ACCOUNT_NAME_MAX_LENGTH = 40;
const BANK_NAME_MAX_LENGTH = 60;
const ACCOUNT_NO_MAX_LENGTH = 64;
const INDUSTRY_NAME_MAX_LENGTH = 40;
const ERP_URL_MAX_LENGTH = 500;
const ERP_WATER_ID_MAX_LENGTH = 100;
const ERP_PROJECT_NAME_MAX_LENGTH = 120;
const ERP_SESSION_COOKIE_MAX_LENGTH = 4096;

function getChangedRows(result) {
    return Number(result?.meta?.changes || 0);
}

function chunkItems(items = [], chunkSize = SQL_IN_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

async function executeStatementsInChunks(env, statements = [], chunkSize = BATCH_CHUNK_SIZE) {
    for (const statementChunk of chunkItems(statements, chunkSize)) {
        if (statementChunk.length === 0) continue;
        await env.DB.batch(statementChunk);
    }
}

function normalizePositiveId(value) {
    const numericValue = Number(value || 0);
    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeBoundedText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function validateRequiredText(value, label, maxLength, corsHeaders) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return { error: errorResponse(`${label}不能为空`, 400, corsHeaders) };
    if (normalizedValue.length > maxLength) {
        return { error: errorResponse(`${label}不能超过 ${maxLength} 个字符`, 400, corsHeaders) };
    }
    if (/[\r\n\t]/.test(normalizedValue)) {
        return { error: errorResponse(`${label}格式不正确`, 400, corsHeaders) };
    }
    return { value: normalizedValue };
}

function validateAccountPayload(payload, corsHeaders) {
    const projectId = normalizePositiveId(payload?.project_id);
    if (!projectId) return { error: errorResponse('缺少项目 ID', 400, corsHeaders) };

    const accountNameResult = validateRequiredText(payload?.account_name, '收款账户名称', ACCOUNT_NAME_MAX_LENGTH, corsHeaders);
    if (accountNameResult.error) return accountNameResult;
    const bankNameResult = validateRequiredText(payload?.bank_name, '开户行', BANK_NAME_MAX_LENGTH, corsHeaders);
    if (bankNameResult.error) return bankNameResult;
    const accountNoResult = validateRequiredText(payload?.account_no, '收款账号', ACCOUNT_NO_MAX_LENGTH, corsHeaders);
    if (accountNoResult.error) return accountNoResult;

    return {
        value: {
            project_id: projectId,
            account_name: accountNameResult.value,
            bank_name: bankNameResult.value,
            account_no: accountNoResult.value
        }
    };
}

function validateIndustryPayload(payload, corsHeaders) {
    const projectId = normalizePositiveId(payload?.project_id);
    if (!projectId) return { error: errorResponse('缺少项目 ID', 400, corsHeaders) };
    const industryNameResult = validateRequiredText(payload?.industry_name, '行业分类名称', INDUSTRY_NAME_MAX_LENGTH, corsHeaders);
    if (industryNameResult.error) return industryNameResult;
    return {
        value: {
            project_id: projectId,
            industry_name: industryNameResult.value
        }
    };
}

function validateErpConfigPayload(payload, corsHeaders) {
    const projectId = normalizePositiveId(payload?.project_id);
    if (!projectId) return { error: errorResponse('缺少项目 ID', 400, corsHeaders) };

    const enabled = Number(payload?.enabled) ? 1 : 0;
    const endpointUrl = normalizeBoundedText(payload?.endpoint_url, ERP_URL_MAX_LENGTH);
    const waterId = normalizeBoundedText(payload?.water_id, ERP_WATER_ID_MAX_LENGTH);
    const expectedProjectName = normalizeBoundedText(payload?.expected_project_name, ERP_PROJECT_NAME_MAX_LENGTH);
    const sessionCookie = String(payload?.session_cookie || '').trim();

    if (sessionCookie.length > ERP_SESSION_COOKIE_MAX_LENGTH) {
        return { error: errorResponse(`ERP 会话 Cookie 不能超过 ${ERP_SESSION_COOKIE_MAX_LENGTH} 个字符`, 400, corsHeaders) };
    }

    if (enabled && !endpointUrl) {
        return { error: errorResponse('启用 ERP 同步时必须填写接口地址', 400, corsHeaders) };
    }

    if (endpointUrl) {
        try {
            const parsedUrl = new URL(endpointUrl);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                return { error: errorResponse('ERP 接口地址仅支持 http 或 https', 400, corsHeaders) };
            }
        } catch (error) {
            return { error: errorResponse('ERP 接口地址格式不正确', 400, corsHeaders) };
        }
    }

    return {
        value: {
            project_id: projectId,
            enabled,
            endpoint_url: endpointUrl,
            water_id: waterId,
            session_cookie: sessionCookie,
            expected_project_name: expectedProjectName
        }
    };
}

async function getExistingErpPaymentsMap(env, erpRecordIds = []) {
    const normalizedErpRecordIds = Array.from(new Set(
        (Array.isArray(erpRecordIds) ? erpRecordIds : [])
            .map((erpRecordId) => String(erpRecordId || '').trim())
            .filter(Boolean)
    ));
    const existingPaymentsMap = new Map();
    for (const erpRecordIdChunk of chunkItems(normalizedErpRecordIds)) {
        const placeholders = erpRecordIdChunk.map(() => '?').join(',');
        const rows = ((await env.DB.prepare(`
            SELECT
                p.id,
                p.order_id,
                p.project_id,
                p.amount,
                p.erp_record_id,
                o.status AS order_status
            FROM Payments p
            LEFT JOIN Orders o ON o.id = p.order_id
            WHERE p.deleted_at IS NULL
              AND p.erp_record_id IN (${placeholders})
        `).bind(...erpRecordIdChunk).all()).results || []);
        rows.forEach((row) => {
            const erpRecordId = String(row.erp_record_id || '').trim();
            if (erpRecordId && !existingPaymentsMap.has(erpRecordId)) {
                existingPaymentsMap.set(erpRecordId, row);
            }
        });
    }
    return existingPaymentsMap;
}

async function getActiveBoothIdsByOrderPairs(env, rawOrderPairs = []) {
    const normalizedOrderPairs = Array.from(new Set(
        (Array.isArray(rawOrderPairs) ? rawOrderPairs : [])
            .map((pair) => String(pair || '').trim())
            .filter(Boolean)
    ));
    const groupedOrderIds = normalizedOrderPairs.reduce((accumulator, pair) => {
        const [rawProjectId, rawOrderId] = pair.split('::');
        const projectId = normalizePositiveId(rawProjectId);
        const orderId = normalizePositiveId(rawOrderId);
        if (!projectId || !orderId) return accumulator;
        if (!accumulator.has(projectId)) {
            accumulator.set(projectId, new Set());
        }
        accumulator.get(projectId).add(orderId);
        return accumulator;
    }, new Map());

    const boothIdsByProject = new Map();
    for (const [projectId, orderIds] of groupedOrderIds.entries()) {
        const boothIds = new Set();
        for (const orderIdChunk of chunkItems(Array.from(orderIds))) {
            const placeholders = orderIdChunk.map(() => '?').join(',');
            const rows = ((await env.DB.prepare(`
                SELECT booth_id
                FROM Orders
                WHERE project_id = ?
                  AND id IN (${placeholders})
                  AND status NOT IN ('已退订', '已作废')
            `).bind(Number(projectId), ...orderIdChunk).all()).results || []);
            rows.forEach((row) => {
                const boothId = normalizeBoothCode(row.booth_id);
                if (boothId) boothIds.add(boothId);
            });
        }
        if (boothIds.size > 0) {
            boothIdsByProject.set(Number(projectId), boothIds);
        }
    }
    return boothIdsByProject;
}

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
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const validation = validateAccountPayload(payload, corsHeaders);
        if (validation.error) return validation.error;
        const { project_id, account_name, bank_name, account_no } = validation.value;
        await env.DB.prepare('INSERT INTO Accounts (project_id, account_name, bank_name, account_no) VALUES (?, ?, ?, ?)')
            .bind(project_id, account_name, bank_name, account_no).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/delete-account' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const accountId = normalizePositiveId(payload?.account_id);
        if (!accountId) return errorResponse('缺少收款账户 ID', 400, corsHeaders);
        await env.DB.prepare('DELETE FROM Accounts WHERE id = ?').bind(accountId).run();
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
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const projectId = normalizePositiveId(payload?.project_id);
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const saved = await saveOrderFieldSettings(env, projectId, payload.settings);
        return new Response(JSON.stringify({ success: true, settings: saved }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/save-erp-config' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const validation = validateErpConfigPayload(payload, corsHeaders);
        if (validation.error) return validation.error;
        await saveErpConfig(env, validation.value);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/erp-sync-preview' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const projectId = normalizePositiveId(payload?.project_id);
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const config = await getErpConfig(env, projectId);
        if (!config || Number(config.enabled) !== 1) {
            return errorResponse('请先在系统配置中启用 ERP 收款同步', 400, corsHeaders);
        }

        const plan = await buildErpPreviewResult(env, projectId, config);
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
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const projectId = normalizePositiveId(payload?.project_id);
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const config = await getErpConfig(env, projectId);
        if (!config || Number(config.enabled) !== 1) {
            return errorResponse('请先在系统配置中启用 ERP 收款同步', 400, corsHeaders);
        }

        const plan = await buildErpPreviewResult(env, projectId, config);
        if (plan.importableItems.length > 0) {
            const existingPaymentsMap = await getExistingErpPaymentsMap(
                env,
                plan.importableItems.map((item) => item.erp_record_id)
            );
            const statements = [];
            const affectedOrderPairs = new Set();

            for (const item of plan.importableItems) {
                const erpRecordId = String(item.erp_record_id || '').trim();
                const existingPayment = existingPaymentsMap.get(erpRecordId);
                if (existingPayment) {
                    const oldOrderStatus = String(existingPayment.order_status || '');
                    const canRebindCancelledOrder = oldOrderStatus === '已退订' || oldOrderStatus === '已作废';
                    if (!canRebindCancelledOrder) {
                        continue;
                    }
                    statements.push(
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
                    );
                    affectedOrderPairs.add(`${Number(existingPayment.project_id)}::${Number(existingPayment.order_id)}`);
                    affectedOrderPairs.add(`${Number(item.project_id)}::${Number(item.order_id)}`);
                    continue;
                }

                statements.push(
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
                        erpRecordId,
                        String(item.raw_payload || '')
                    ),
                    env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?')
                        .bind(Number(item.amount), Number(item.order_id))
                );
                affectedOrderPairs.add(`${Number(item.project_id)}::${Number(item.order_id)}`);
            }

            await executeStatementsInChunks(env, statements);

            const boothIdsByProject = await getActiveBoothIdsByOrderPairs(env, Array.from(affectedOrderPairs));
            for (const [syncedProjectId, boothIds] of boothIdsByProject.entries()) {
                await syncBoothStatusByBoothIds(env, Number(syncedProjectId), Array.from(boothIds));
            }
            await refreshOrderOverpaymentIssues(env, Array.from(affectedOrderPairs));
        }

        const syncSummary = JSON.stringify({
            synced_count: plan.importableItems.length,
            summary: plan.summary
        });

        await env.DB.prepare(`
            UPDATE ProjectErpConfigs
            SET last_sync_at = ?, last_sync_summary = ?
            WHERE project_id = ?
        `).bind(getChinaTimestamp(), syncSummary, Number(projectId)).run();

        return new Response(JSON.stringify({
            success: true,
            synced_count: plan.importableItems.length,
            summary: plan.summary,
            preview: plan.preview.slice(0, 50)
        }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/clear-project-rollout-data' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;

        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const normalizedProjectId = normalizePositiveId(payload?.project_id);
        if (!normalizedProjectId) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const deleteOperations = [
            ['payments', env.DB.prepare('DELETE FROM Payments WHERE project_id = ?').bind(normalizedProjectId)],
            ['expenses', env.DB.prepare('DELETE FROM Expenses WHERE project_id = ?').bind(normalizedProjectId)],
            ['order_overpayment_issues', env.DB.prepare('DELETE FROM OrderOverpaymentIssues WHERE project_id = ?').bind(normalizedProjectId)],
            ['order_booth_changes', env.DB.prepare('DELETE FROM OrderBoothChanges WHERE project_id = ?').bind(normalizedProjectId)],
            ['orders', env.DB.prepare('DELETE FROM Orders WHERE project_id = ?').bind(normalizedProjectId)],
            ['booth_map_items', env.DB.prepare('DELETE FROM BoothMapItems WHERE project_id = ?').bind(normalizedProjectId)],
            ['booth_maps', env.DB.prepare('DELETE FROM BoothMaps WHERE project_id = ?').bind(normalizedProjectId)],
            ['booths', env.DB.prepare('DELETE FROM Booths WHERE project_id = ?').bind(normalizedProjectId)]
        ];
        const results = await env.DB.batch(deleteOperations.map(([, statement]) => statement));
        const deletedCounts = Object.fromEntries(
            deleteOperations.map(([key], index) => [key, getChangedRows(results[index])])
        );

        return new Response(JSON.stringify({
            success: true,
            project_id: normalizedProjectId,
            deleted_counts: deletedCounts
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
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const validation = validateIndustryPayload(payload, corsHeaders);
        if (validation.error) return validation.error;
        const { project_id, industry_name } = validation.value;
        await env.DB.prepare('INSERT INTO Industries (project_id, industry_name) VALUES (?, ?)')
            .bind(project_id, industry_name).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/delete-industry' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const industryId = normalizePositiveId(payload?.industry_id);
        if (!industryId) return errorResponse('缺少行业分类 ID', 400, corsHeaders);
        await env.DB.prepare('DELETE FROM Industries WHERE id = ?').bind(industryId).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return null;
}
