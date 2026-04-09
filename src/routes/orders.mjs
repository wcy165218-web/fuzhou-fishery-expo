import { canManageOrder, canViewSensitiveOrderFields, isSuperAdmin } from '../utils/auth.mjs';
import {
    countDisplayNameUnits,
    getChinaTimestamp,
    hasMetaChanges,
    normalizeEditableFeeItems,
    toBoothCount,
    toNonNegativeNumber,
    validateStandardBoothDisplayName
} from '../utils/helpers.mjs';
import { errorResponse, internalErrorResponse } from '../utils/response.mjs';
import { readJsonBody } from '../utils/request.mjs';
import { acquireBoothLocks, releaseBoothLocks } from '../services/booth-locks.mjs';
import { syncBoothStatusByBoothIds, syncBoothStatusByBoothId } from '../services/booth-sync.mjs';
import { refreshOrderOverpaymentIssue } from '../services/overpayment.mjs';
import { normalizeBoothCode } from '../utils/booth-map.mjs';

const SQL_IN_CHUNK_SIZE = 80;
const BATCH_CHUNK_SIZE = 40;
const ORDER_LIST_DEFAULT_PAGE_SIZE = 50;
const ORDER_LIST_MAX_PAGE_SIZE = 200;
const ORDER_LIST_SEARCH_MAX_BYTES = 40;
const MAX_SELECTED_BOOTHS = 20;

function chunkItems(items = [], chunkSize = SQL_IN_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

function resolveBoothDisplayName(boothType, payload) {
    const normalizedBoothType = String(boothType || '').trim();
    const standardName = String(payload.standard_booth_display_name || '').trim();
    const groundName = String(payload.ground_booth_display_name || '').trim();
    const companyName = String(payload.company_name || '').trim();
    if (normalizedBoothType === '光地') {
        return groundName || companyName;
    }
    return standardName;
}

function normalizeUtf8SearchValue(rawValue, maxBytes = ORDER_LIST_SEARCH_MAX_BYTES) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    let result = '';
    let byteCount = 0;
    for (const char of value) {
        const charByteCount = new TextEncoder().encode(char).length;
        if (byteCount + charByteCount > maxBytes) break;
        result += char;
        byteCount += charByteCount;
    }
    return result;
}

function escapeSqlLikePattern(value) {
    return String(value || '').replace(/[\\%_]/g, '\\$&');
}

export function normalizeOrderListParams(urlObj, currentUser) {
    const rawPage = Number(urlObj.searchParams.get('page') || 1);
    const rawPageSize = Number(urlObj.searchParams.get('pageSize') || ORDER_LIST_DEFAULT_PAGE_SIZE);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0
        ? Math.min(rawPageSize, ORDER_LIST_MAX_PAGE_SIZE)
        : ORDER_LIST_DEFAULT_PAGE_SIZE;
    const paymentStatus = String(urlObj.searchParams.get('paymentStatus') || '').trim();
    return {
        projectId: Number(urlObj.searchParams.get('projectId') || 0),
        page,
        pageSize,
        selectedSales: currentUser.role === 'admin' ? String(urlObj.searchParams.get('salesName') || '').trim() : '',
        search: normalizeUtf8SearchValue(urlObj.searchParams.get('search')),
        businessSearch: normalizeUtf8SearchValue(urlObj.searchParams.get('businessSearch')),
        paymentStatus: ['未付', '定金', '全款'].includes(paymentStatus) ? paymentStatus : ''
    };
}

function appendOrderListFilters(whereClauses, params, filters, currentUser) {
    whereClauses.push("o.status NOT IN ('已退订', '已作废')");
    whereClauses.push("(? = 'admin' OR o.sales_name = ? OR o.paid_amount >= o.total_amount)");
    params.push(currentUser.role, currentUser.name);

    if (filters.selectedSales) {
        whereClauses.push('o.sales_name = ?');
        params.push(filters.selectedSales);
    }
    if (filters.search) {
        const escapedSearch = `%${escapeSqlLikePattern(filters.search)}%`;
        whereClauses.push("(o.company_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR o.booth_id LIKE ? ESCAPE '\\' COLLATE NOCASE)");
        params.push(escapedSearch, escapedSearch);
    }
    if (filters.businessSearch) {
        const escapedSearch = `%${escapeSqlLikePattern(filters.businessSearch)}%`;
        whereClauses.push("COALESCE(o.main_business, '') LIKE ? ESCAPE '\\' COLLATE NOCASE");
        params.push(escapedSearch);
    }
    if (filters.paymentStatus === '未付') {
        whereClauses.push('o.paid_amount <= 0');
    } else if (filters.paymentStatus === '定金') {
        whereClauses.push('o.paid_amount > 0 AND o.paid_amount < o.total_amount');
    } else if (filters.paymentStatus === '全款') {
        whereClauses.push('o.paid_amount >= o.total_amount');
    }
}

async function getActiveOrdersByBoothIds(env, projectId, boothIds = []) {
    const normalizedBoothIds = Array.from(new Set(
        (Array.isArray(boothIds) ? boothIds : [])
            .map((boothId) => normalizeBoothCode(boothId))
            .filter(Boolean)
    ));
    const activeOrdersMap = new Map();
    if (!projectId || normalizedBoothIds.length === 0) return activeOrdersMap;
    for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        const rows = ((await env.DB.prepare(`
            SELECT id, booth_id, area, created_at
            FROM Orders
            WHERE project_id = ?
              AND booth_id IN (${placeholders})
              AND status = '正常'
            ORDER BY datetime(created_at) ASC, id ASC
        `).bind(Number(projectId), ...boothIdChunk).all()).results || []);
        rows.forEach((row) => {
            const boothId = normalizeBoothCode(row.booth_id);
            if (!boothId) return;
            if (!activeOrdersMap.has(boothId)) {
                activeOrdersMap.set(boothId, []);
            }
            activeOrdersMap.get(boothId).push(row);
        });
    }
    return activeOrdersMap;
}

async function executeStatementsInChunks(env, statements = [], chunkSize = BATCH_CHUNK_SIZE) {
    for (const statementChunk of chunkItems(statements, chunkSize)) {
        if (statementChunk.length === 0) continue;
        await env.DB.batch(statementChunk);
    }
}

export async function handleOrderRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/orders' && request.method === 'GET') {
        const filters = normalizeOrderListParams(new URL(request.url), currentUser);
        if (!filters.projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const countWhereClauses = ['o.project_id = ?'];
        const countParams = [filters.projectId];
        appendOrderListFilters(countWhereClauses, countParams, filters, currentUser);
        const totalRow = await env.DB.prepare(`
            SELECT COUNT(*) AS total
            FROM Orders o
            WHERE ${countWhereClauses.join(' AND ')}
        `).bind(...countParams).first();

        const total = Number(totalRow?.total || 0);
        const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
        const effectivePage = total > 0 ? Math.min(filters.page, totalPages) : 1;
        const offset = (effectivePage - 1) * filters.pageSize;
        const superAdminFlag = isSuperAdmin(currentUser) ? 1 : 0;
        const whereClauses = ['o.project_id = ?'];
        const filterParams = [filters.projectId];
        appendOrderListFilters(whereClauses, filterParams, filters, currentUser);

        const results = await env.DB.prepare(`
            SELECT
                o.*,
                b.hall,
                b.type AS booth_type,
                CASE WHEN ? = 'admin' OR o.sales_name = ? THEN 1 ELSE 0 END AS can_manage,
                CASE WHEN ? = 'admin' OR o.sales_name = ? THEN 1 ELSE 0 END AS can_preview_contract,
                CASE WHEN o.contract_url IS NOT NULL AND o.contract_url != '' THEN 1 ELSE 0 END AS has_contract,
                CASE
                    WHEN ? = 1 OR o.sales_name = ? THEN o.contact_person
                    ELSE CASE WHEN o.contact_person IS NULL OR o.contact_person = '' THEN '未填' ELSE '***' END
                END AS contact_person,
                CASE
                    WHEN ? = 1 OR o.sales_name = ? THEN o.phone
                    ELSE CASE
                        WHEN o.phone IS NULL OR o.phone = '' THEN '未填'
                        WHEN length(o.phone) >= 7 THEN substr(o.phone, 1, 3) || '****' || substr(o.phone, -4)
                        ELSE '***'
                    END
                END AS phone,
                CASE WHEN ? = 'admin' OR o.sales_name = ? THEN o.contract_url ELSE NULL END AS contract_url,
                COALESCE(oi.overpaid_amount, CASE WHEN o.paid_amount > o.total_amount THEN ROUND(o.paid_amount - o.total_amount, 2) ELSE 0 END) AS overpaid_amount,
                CASE
                    WHEN COALESCE(oi.overpaid_amount, 0) > 0 THEN oi.status
                    WHEN o.paid_amount > o.total_amount THEN 'pending'
                    ELSE ''
                END AS overpayment_status,
                COALESCE(oi.reason, '') AS overpayment_reason,
                COALESCE(oi.note, '') AS overpayment_note,
                COALESCE(oi.handled_by, '') AS overpayment_handled_by,
                COALESCE(oi.handled_at, '') AS overpayment_handled_at,
                CASE WHEN ? = 1 OR o.sales_name = ? THEN 1 ELSE 0 END AS can_handle_overpayment
            FROM Orders o
            LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id
            LEFT JOIN OrderOverpaymentIssues oi ON oi.order_id = o.id
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY datetime(o.created_at) DESC, o.id DESC
            LIMIT ? OFFSET ?
        `).bind(
            currentUser.role, currentUser.name,
            currentUser.role, currentUser.name,
            superAdminFlag, currentUser.name,
            superAdminFlag, currentUser.name,
            currentUser.role, currentUser.name,
            superAdminFlag, currentUser.name,
            ...filterParams,
            filters.pageSize,
            offset
        ).all();

        return new Response(JSON.stringify({
            items: results.results || [],
            total,
            page: effectivePage,
            pageSize: filters.pageSize,
            totalPages,
            hasMore: effectivePage < totalPages
        }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/submit-order' && request.method === 'POST') {
        let lockInfo = { lockToken: '', boothIds: [], projectId: 0 };
        try {
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const statements = [];
            const noBoothOrder = Number(payload.no_booth_order || 0) === 1;
            let normalizedFees = [];
            try {
                normalizedFees = normalizeEditableFeeItems(payload.fees_json || '[]');
            } catch (error) {
                return errorResponse('其他应收费用格式不正确', 400, corsHeaders);
            }
            const totalOtherIncome = Number(normalizedFees.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
            const totalBoothFee = Number(Number(payload.total_booth_fee || 0).toFixed(2));

            if (Array.isArray(payload.selected_booths) && payload.selected_booths.length > MAX_SELECTED_BOOTHS) {
                return errorResponse(`单次最多选择 ${MAX_SELECTED_BOOTHS} 个展位`, 400, corsHeaders);
            }

            const selectedBooths = noBoothOrder
                ? [{
                    booth_id: '',
                    area: 0,
                    price_unit: '无展位',
                    unit_price: 0,
                    standard_fee: 0,
                    is_joint: 0,
                    no_booth_order: 1
                }]
                : Array.isArray(payload.selected_booths) && payload.selected_booths.length > 0
                    ? payload.selected_booths.map((item) => ({
                        booth_id: normalizeBoothCode(item.booth_id),
                        hall: String(item.hall || '').trim(),
                        type: String(item.type || '').trim(),
                        area: Number(item.area || 0),
                        price_unit: String(item.price_unit || '').trim(),
                        unit_price: Number(item.unit_price || 0),
                        standard_fee: Number(item.standard_fee || 0),
                        is_joint: Number(item.is_joint || 0) ? 1 : 0
                    })).filter((item) => item.booth_id && item.area >= 0)
                    : [{
                        booth_id: normalizeBoothCode(payload.booth_id),
                        hall: '',
                        type: '',
                        area: Number(payload.area || 0),
                        price_unit: String(payload.price_unit || '').trim(),
                        unit_price: Number(payload.unit_price || 0),
                        standard_fee: Number(payload.total_booth_fee || 0),
                        is_joint: 0
                    }];

            if (!noBoothOrder && selectedBooths.length === 0) {
                return errorResponse('请至少选择一个展位', 400, corsHeaders);
            }

            const hasStandardTypeBooth = selectedBooths.some((item) => ['标摊', '豪标'].includes(String(item.type || '').trim()));
            if (hasStandardTypeBooth) {
                const standardDisplayNameError = validateStandardBoothDisplayName(payload.standard_booth_display_name);
                if (standardDisplayNameError) {
                    return errorResponse(standardDisplayNameError, 400, corsHeaders);
                }
            }
            if (countDisplayNameUnits(payload.ground_booth_display_name || '') > 24) {
                return errorResponse('光地显示名称不能超过 12 个汉字或 24 个英文字符', 400, corsHeaders);
            }

            const totalStandardFee = Number(selectedBooths.reduce((sum, item) => sum + Number(item.standard_fee || 0), 0).toFixed(2));
            const totalSelectedArea = Number(selectedBooths.reduce((sum, item) => sum + Number(item.area || 0), 0).toFixed(2));
            if (totalBoothFee < 0) return errorResponse('最终成交展位费不能为负数', 400, corsHeaders);
            if (noBoothOrder) {
                if (totalBoothFee !== 0) return errorResponse('无展位订单的应收展位费必须为0', 400, corsHeaders);
                if (normalizedFees.length === 0 || totalOtherIncome <= 0) return errorResponse('无展位订单必须至少包含一项其他应收费用', 400, corsHeaders);
            } else if (totalSelectedArea <= 0 && totalBoothFee > 0) {
                return errorResponse('0面积联合参展的应收展位费必须为0', 400, corsHeaders);
            }

            let remainingBoothFee = totalBoothFee;
            let remainingOtherIncome = totalOtherIncome;
            const distributedBooths = selectedBooths.map((item, index) => {
                const isLast = index === selectedBooths.length - 1;
                let boothFeePart = 0;
                let otherIncomePart = 0;
                if (isLast) {
                    boothFeePart = Number(remainingBoothFee.toFixed(2));
                    otherIncomePart = Number(remainingOtherIncome.toFixed(2));
                } else {
                    const ratioBase = totalStandardFee > 0 ? Number(item.standard_fee || 0) : 1;
                    const ratio = totalStandardFee > 0 ? ratioBase / totalStandardFee : 1 / selectedBooths.length;
                    boothFeePart = Number((totalBoothFee * ratio).toFixed(2));
                    otherIncomePart = Number((totalOtherIncome * ratio).toFixed(2));
                    remainingBoothFee = Number((remainingBoothFee - boothFeePart).toFixed(2));
                    remainingOtherIncome = Number((remainingOtherIncome - otherIncomePart).toFixed(2));
                }
                return {
                    ...item,
                    total_booth_fee: boothFeePart,
                    other_income: otherIncomePart,
                    total_amount: Number((boothFeePart + otherIncomePart).toFixed(2)),
                    fees_json: index === 0 ? JSON.stringify(normalizedFees) : '[]'
                };
            });

            const boothIdsToLock = distributedBooths.map((item) => item.booth_id).filter(Boolean);
            lockInfo = {
                ...(await acquireBoothLocks(env, Number(payload.project_id), boothIdsToLock)),
                projectId: Number(payload.project_id)
            };
            if (!lockInfo.success) {
                return errorResponse(`展位 ${lockInfo.conflictedBoothId} 正在被其他人操作，请刷新后重试`, 409, corsHeaders);
            }

            const activeOrdersMap = await getActiveOrdersByBoothIds(env, payload.project_id, boothIdsToLock);
            const boothIdsToSync = new Set();
            const normalizedOrderPayload = {
                project_id: Number(payload.project_id),
                company_name: String(payload.company_name || '').trim(),
                credit_code: String(payload.credit_code || '').trim(),
                category: String(payload.category || '').trim(),
                main_business: String(payload.main_business || '').trim(),
                agent_name: String(payload.agent_name || '').trim(),
                contact_person: String(payload.contact_person || '').trim(),
                phone: String(payload.phone || '').trim(),
                region: String(payload.region || '').trim(),
                discount_reason: String(payload.discount_reason || '').trim(),
                profile: String(payload.profile || '').trim(),
                sales_name: String(payload.sales_name || '').trim(),
                contract_url: payload.contract_url ? String(payload.contract_url).trim() : null
            };

            for (const boothItem of distributedBooths) {
                const activeOrders = activeOrdersMap.get(normalizeBoothCode(boothItem.booth_id)) || [];
                const existingOrder = activeOrders[0] || null;
                if (existingOrder && !boothItem.is_joint) {
                    return errorResponse(`展位 ${boothItem.booth_id} 已被占用，请刷新后重试`, 409, corsHeaders);
                }
                if (existingOrder && boothItem.is_joint && boothItem.area > 0) {
                    statements.push(
                        env.DB.prepare("UPDATE Orders SET area = ROUND(area - ?, 2) WHERE id = ? AND status = '正常'")
                            .bind(boothItem.area, existingOrder.id)
                    );
                    boothIdsToSync.add(normalizeBoothCode(boothItem.booth_id));
                }

                statements.push(env.DB.prepare(`
                    INSERT INTO Orders (
                        project_id, company_name, credit_code, no_code_checked, category, main_business,
                        is_agent, agent_name, contact_person, phone, region, booth_id, area, price_unit, unit_price,
                        total_booth_fee, discount_reason, other_income, fees_json, profile, total_amount, paid_amount,
                        contract_url, booth_display_name, sales_name, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
                `).bind(
                    normalizedOrderPayload.project_id, normalizedOrderPayload.company_name, normalizedOrderPayload.credit_code, payload.no_code_checked ? 1 : 0, normalizedOrderPayload.category, normalizedOrderPayload.main_business,
                    payload.is_agent ? 1 : 0, normalizedOrderPayload.agent_name, normalizedOrderPayload.contact_person, normalizedOrderPayload.phone, normalizedOrderPayload.region, boothItem.booth_id || '', boothItem.area, boothItem.price_unit, boothItem.unit_price,
                    boothItem.total_booth_fee, normalizedOrderPayload.discount_reason, boothItem.other_income, boothItem.fees_json, normalizedOrderPayload.profile, boothItem.total_amount, 0,
                    normalizedOrderPayload.contract_url, resolveBoothDisplayName(boothItem.type, payload), normalizedOrderPayload.sales_name, '正常'
                ));
                if (boothItem.booth_id) boothIdsToSync.add(normalizeBoothCode(boothItem.booth_id));
            }

            await executeStatementsInChunks(env, statements, BATCH_CHUNK_SIZE);
            await syncBoothStatusByBoothIds(env, Number(payload.project_id), Array.from(boothIdsToSync));
            return new Response(JSON.stringify({ success: true, created_count: distributedBooths.length }), { headers: corsHeaders });
        } catch (error) {
            console.error('Submit order failed:', error);
            return internalErrorResponse(corsHeaders);
        } finally {
            if (lockInfo.lockToken) {
                await releaseBoothLocks(env, lockInfo.projectId, lockInfo.boothIds, lockInfo.lockToken);
            }
        }
    }

    if (url.pathname === '/api/update-customer-info' && request.method === 'POST') {
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const hasPermission = await canManageOrder(env, currentUser, payload.order_id);
        if (!hasPermission) return errorResponse('权限不足：不能修改他人录入的客户资料', 403, corsHeaders);
        const canEditSensitive = await canViewSensitiveOrderFields(env, currentUser, payload.order_id);
        let query = 'UPDATE Orders SET region = ?, main_business = ?, profile = ?, is_agent = ?, agent_name = ?, category = ?';
        const params = [payload.region, payload.main_business, payload.profile, payload.is_agent ? 1 : 0, payload.agent_name, payload.category];

        if (canEditSensitive && (payload.contact_person !== undefined || payload.phone !== undefined)) {
            query += ', contact_person = ?, phone = ?';
            params.push(payload.contact_person || '', payload.phone || '');
        }

        if (payload.company_name !== undefined || payload.credit_code !== undefined || payload.no_code_checked !== undefined) {
            if (!isSuperAdmin(currentUser)) return errorResponse('权限不足：仅超级管理员可修改企业全称和信用代码', 403, corsHeaders);
            query += ', company_name = ?, credit_code = ?, no_code_checked = ?';
            params.push(payload.company_name || '', payload.credit_code || '', payload.no_code_checked ? 1 : 0);
        }

        if (payload.contract_url !== undefined) {
            query += ', contract_url = ?';
            params.push(payload.contract_url);
        }
        query += ' WHERE id = ? AND project_id = ?';
        params.push(payload.order_id, payload.project_id);

        await env.DB.prepare(query).bind(...params).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/change-order-booth' && request.method === 'POST') {
        let lockInfo = { lockToken: '', boothIds: [], projectId: 0 };
        try {
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const orderId = Number(payload.order_id || 0);
            const projectId = Number(payload.project_id || 0);
            const targetBoothId = normalizeBoothCode(payload.target_booth_id);
            const swapReason = String(payload.swap_reason || '').trim();
            const priceReason = String(payload.price_reason || '').trim();
            if (!orderId || !projectId || !targetBoothId) return errorResponse('缺少换展位必要信息', 400, corsHeaders);
            if (!swapReason) return errorResponse('请填写换展位原因', 400, corsHeaders);
            const hasPermission = await canManageOrder(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足：不能操作他人订单换展位', 403, corsHeaders);

            const initialOrder = await env.DB.prepare(`
                SELECT id, project_id, booth_id, area, total_booth_fee, other_income, total_amount, paid_amount, fees_json, sales_name, status
                FROM Orders
                WHERE id = ? AND project_id = ?
            `).bind(orderId, projectId).first();
            if (!initialOrder) return errorResponse('订单不存在', 404, corsHeaders);
            const currentBoothId = normalizeBoothCode(initialOrder.booth_id);
            if (currentBoothId === targetBoothId) return errorResponse('新展位与当前展位相同，无需换展位', 400, corsHeaders);

            lockInfo = {
                ...(await acquireBoothLocks(env, projectId, [currentBoothId, targetBoothId])),
                projectId
            };
            if (!lockInfo.success) {
                return errorResponse(`展位 ${lockInfo.conflictedBoothId} 正在被其他人操作，请刷新后重试`, 409, corsHeaders);
            }

            const currentOrder = await env.DB.prepare(`
                SELECT id, project_id, booth_id, area, total_booth_fee, other_income, total_amount, paid_amount, fees_json, sales_name, status
                FROM Orders
                WHERE id = ? AND project_id = ?
            `).bind(orderId, projectId).first();
            if (!currentOrder) return errorResponse('订单不存在', 404, corsHeaders);
            if (String(currentOrder.status || '') !== '正常') return errorResponse('仅正常订单可换展位', 400, corsHeaders);
            if (normalizeBoothCode(currentOrder.booth_id) !== currentBoothId) {
                return errorResponse('订单展位状态已变化，请刷新后重试', 409, corsHeaders);
            }

            const targetBooth = await env.DB.prepare(`
                SELECT id, hall, type, area, price_unit, base_price, status
                FROM Booths
                WHERE id = ? AND project_id = ?
            `).bind(targetBoothId, projectId).first();
            if (!targetBooth) return errorResponse('目标展位不存在', 404, corsHeaders);
            if (String(targetBooth.status || '') === '已锁定') return errorResponse('目标展位已被临时锁定，请稍后再试', 400, corsHeaders);

            const activeOrdersMap = await getActiveOrdersByBoothIds(env, projectId, [targetBoothId]);
            const targetBoothOrders = (activeOrdersMap.get(targetBoothId) || []).filter((order) => Number(order.id || 0) !== orderId);
            if (targetBoothOrders.length > 0) {
                return errorResponse('目标展位当前已被占用，暂不支持直接换入', 409, corsHeaders);
            }

            const targetArea = toNonNegativeNumber(targetBooth.area);
            if (!Number.isFinite(targetArea) || targetArea <= 0) {
                return errorResponse('目标展位面积异常，无法换展位', 400, corsHeaders);
            }
            const rawActualFee = toNonNegativeNumber(payload.actual_fee);
            if (!Number.isFinite(rawActualFee) || rawActualFee < 0) {
                return errorResponse('新展位成交展位费必须是非负数', 400, corsHeaders);
            }
            const defaultPriceRow = await env.DB.prepare(`
                SELECT price
                FROM Prices
                WHERE project_id = ? AND booth_type = ?
            `).bind(projectId, String(targetBooth.type || '')).first();
            const unitPrice = Number(targetBooth.base_price || 0) > 0
                ? Number(targetBooth.base_price || 0)
                : Number(defaultPriceRow?.price || 0);
            const standardFee = String(targetBooth.type || '') === '光地'
                ? Number((unitPrice * targetArea).toFixed(2))
                : Number((unitPrice * toBoothCount(targetArea)).toFixed(2));
            if (rawActualFee < standardFee && !priceReason) {
                return errorResponse('新展位成交价低于系统原价时，请填写价格说明', 400, corsHeaders);
            }

            let normalizedFeeItems = [];
            try {
                normalizedFeeItems = normalizeEditableFeeItems(payload.fees_json);
            } catch (error) {
                return errorResponse('其他收费明细格式无效，请重新填写', 400, corsHeaders);
            }
            const nextOtherIncome = Number(normalizedFeeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
            const nextTotalAmount = Number((rawActualFee + nextOtherIncome).toFixed(2));
            const currentBoothCount = toBoothCount(currentOrder.area);
            const nextBoothCount = toBoothCount(targetArea);
            const boothDeltaCount = Number((nextBoothCount - currentBoothCount).toFixed(2));
            const totalAmountDelta = Number((nextTotalAmount - Number(currentOrder.total_amount || 0)).toFixed(2));
            const mergedReason = [
                `换展位：${swapReason}`,
                priceReason ? `价格说明：${priceReason}` : ''
            ].filter(Boolean).join('；');
            const nowText = getChinaTimestamp();

            await env.DB.batch([
                env.DB.prepare(`
                    UPDATE Orders
                    SET booth_id = ?,
                        area = ?,
                        price_unit = ?,
                        unit_price = ?,
                        total_booth_fee = ?,
                        other_income = ?,
                        fees_json = ?,
                        discount_reason = ?,
                        total_amount = ?
                    WHERE id = ? AND project_id = ?
                `).bind(
                    targetBoothId,
                    targetArea,
                    String(targetBooth.price_unit || (String(targetBooth.type || '') === '光地' ? '平米' : '个')),
                    unitPrice,
                    rawActualFee,
                    nextOtherIncome,
                    JSON.stringify(normalizedFeeItems),
                    mergedReason,
                    nextTotalAmount,
                    orderId,
                    projectId
                ),
                env.DB.prepare(`
                    INSERT INTO OrderBoothChanges (
                        project_id, order_id, old_booth_id, new_booth_id,
                        old_area, new_area, booth_delta_count,
                        old_total_amount, new_total_amount, total_amount_delta,
                        changed_by, reason, changed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    projectId,
                    orderId,
                    currentBoothId,
                    targetBoothId,
                    Number(currentOrder.area || 0),
                    targetArea,
                    boothDeltaCount,
                    Number(currentOrder.total_amount || 0),
                    nextTotalAmount,
                    totalAmountDelta,
                    String(currentUser.name || ''),
                    mergedReason,
                    nowText
                )
            ]);

            await syncBoothStatusByBoothIds(env, projectId, [currentBoothId, targetBoothId]);
            await refreshOrderOverpaymentIssue(env, orderId, projectId);

            return new Response(JSON.stringify({
                success: true,
                order_id: orderId,
                old_booth_id: currentBoothId,
                new_booth_id: targetBoothId,
                booth_delta_count: boothDeltaCount,
                total_amount_delta: totalAmountDelta
            }), { headers: corsHeaders });
        } catch (error) {
            console.error('Change order booth failed:', error);
            return internalErrorResponse(corsHeaders);
        } finally {
            if (lockInfo.lockToken) {
                await releaseBoothLocks(env, lockInfo.projectId, lockInfo.boothIds, lockInfo.lockToken);
            }
        }
    }

    if (url.pathname === '/api/cancel-order' && request.method === 'POST') {
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const orderId = Number(payload.order_id || 0);
        if (!orderId) return errorResponse('缺少订单信息', 400, corsHeaders);

        const currentOrder = await env.DB.prepare(`
            SELECT id, project_id, booth_id, status
            FROM Orders
            WHERE id = ?
        `).bind(orderId).first();
        if (!currentOrder) return errorResponse('订单不存在', 404, corsHeaders);

        const hasPermission = await canManageOrder(env, currentUser, orderId);
        if (!hasPermission) return errorResponse('权限不足：仅管理员或所属业务员可退订订单', 403, corsHeaders);
        if (String(currentOrder.status || '') !== '正常') {
            return errorResponse('仅正常订单可退订', 400, corsHeaders);
        }

        const cancelResult = await env.DB.prepare(`
            UPDATE Orders
            SET status = '已退订'
            WHERE id = ? AND status = '正常'
        `).bind(orderId).run();
        if (hasMetaChanges(cancelResult) === 0) {
            return errorResponse('订单状态已变更，请刷新后重试', 409, corsHeaders);
        }

        const boothId = normalizeBoothCode(currentOrder.booth_id);
        if (boothId) {
            await syncBoothStatusByBoothId(env, Number(currentOrder.project_id), boothId);
        }
        await refreshOrderOverpaymentIssue(env, orderId, Number(currentOrder.project_id));
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return null;
}
