import { normalizeBoothIds } from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';
import { deriveBoothRuntimeStatus } from '../services/booth-map-view.mjs';

const MANUAL_BOOTH_STATUSES = new Set(['可售', '已锁定']);
const SQL_IN_CHUNK_SIZE = 80;

function chunkItems(items = [], chunkSize = SQL_IN_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

function deriveHallFromBoothId(boothId, fallback = '') {
    const normalizedBoothId = String(boothId || '').trim().toUpperCase();
    const matched = normalizedBoothId.match(/^(\d+)/);
    if (matched) return `${matched[1]}号馆`;
    return String(fallback || '').trim();
}

async function getReferencedBoothIds(env, projectId, boothIds) {
    const normalizedBoothIds = Array.isArray(boothIds)
        ? boothIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    if (normalizedBoothIds.length === 0) return [];
    const referencedBoothIds = new Set();
    for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        const results = await env.DB.prepare(`
          SELECT booth_id
          FROM Orders
          WHERE project_id = ?
            AND booth_id IN (${placeholders})
          GROUP BY booth_id
        `).bind(Number(projectId), ...boothIdChunk).all();
        (results.results || []).forEach((row) => {
            const boothId = String(row.booth_id || '').trim();
            if (boothId) referencedBoothIds.add(boothId);
        });
    }
    return Array.from(referencedBoothIds);
}

async function getActiveOrdersMap(env, projectId, boothIds) {
    const normalizedBoothIds = Array.from(new Set(
        (Array.isArray(boothIds) ? boothIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    ));
    const orderMap = new Map();
    if (normalizedBoothIds.length === 0) return orderMap;
    for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        const results = await env.DB.prepare(`
          SELECT booth_id, paid_amount, total_amount
          FROM Orders
          WHERE project_id = ?
            AND booth_id IN (${placeholders})
            AND status = '正常'
        `).bind(Number(projectId), ...boothIdChunk).all();
        (results.results || []).forEach((row) => {
            const boothId = String(row.booth_id || '').trim();
            if (!boothId) return;
            if (!orderMap.has(boothId)) {
                orderMap.set(boothId, []);
            }
            orderMap.get(boothId).push(row);
        });
    }
    return orderMap;
}

async function getMapManagedBoothIds(env, projectId, boothIds) {
    const normalizedBoothIds = Array.from(new Set(
        (Array.isArray(boothIds) ? boothIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    ));
    if (normalizedBoothIds.length === 0) return [];
    const mapManagedBoothIds = new Set();
    for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        const results = await env.DB.prepare(`
          SELECT id
          FROM Booths
          WHERE project_id = ?
            AND id IN (${placeholders})
            AND (source = 'map' OR booth_map_id IS NOT NULL)
        `).bind(Number(projectId), ...boothIdChunk).all();
        (results.results || []).forEach((row) => {
            const boothId = String(row.id || '').trim();
            if (boothId) mapManagedBoothIds.add(boothId);
        });
    }
    return Array.from(mapManagedBoothIds);
}

export async function handleBoothRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/prices') {
        if (request.method === 'GET') {
            const pid = new URL(request.url).searchParams.get('projectId');
            const results = await env.DB.prepare('SELECT booth_type, price FROM Prices WHERE project_id = ?').bind(pid).all();
            const priceMap = {};
            results.results.forEach((row) => {
                priceMap[row.booth_type] = row.price;
            });
            return new Response(JSON.stringify(priceMap), { headers: corsHeaders });
        }
        if (request.method === 'POST') {
            if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
            const { projectId, prices } = await request.json();
            await env.DB.prepare('DELETE FROM Prices WHERE project_id = ?').bind(projectId).run();
            const statements = Object.keys(prices).map((type) =>
                env.DB.prepare('INSERT INTO Prices (project_id, booth_type, price) VALUES (?, ?, ?)')
                    .bind(projectId, type, prices[type])
            );
            await env.DB.batch(statements);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
    }

    if (url.pathname === '/api/booths' && request.method === 'GET') {
        const pid = new URL(request.url).searchParams.get('projectId');
        const query = `
            SELECT
              b.*,
              bm.name AS booth_map_name,
              SUM(o.total_booth_fee) as total_booth_fee
            FROM Booths b
            LEFT JOIN BoothMaps bm ON bm.id = b.booth_map_id AND bm.project_id = b.project_id
            LEFT JOIN Orders o ON b.id = o.booth_id AND b.project_id = o.project_id AND o.status NOT IN ('已退订', '已作废')
            WHERE b.project_id = ?
            GROUP BY b.id
        `;
        const results = await env.DB.prepare(query).bind(pid).all();
        const boothRows = results.results || [];
        const activeOrdersMap = await getActiveOrdersMap(env, pid, boothRows.map((row) => row.id));
        const payload = boothRows.map((row) => {
            const activeOrders = activeOrdersMap.get(String(row.id || '').trim()) || [];
            const runtimeStatus = deriveBoothRuntimeStatus(row.status, activeOrders);
            return {
                ...row,
                hall: deriveHallFromBoothId(row.id, row.hall),
                status: runtimeStatus.label,
                map_managed: Number(row.booth_map_id || 0) > 0 || String(row.source || '') === 'map' ? 1 : 0,
                sale_status_code: runtimeStatus.code,
                sale_status_label: runtimeStatus.label,
                sale_status_fill_color: runtimeStatus.fillColor,
                sale_status_stroke_color: runtimeStatus.strokeColor
            };
        });
        return new Response(JSON.stringify(payload), { headers: corsHeaders });
    }

    if (url.pathname === '/api/add-booth' && request.method === 'POST') {
        return errorResponse('展位库仅接收展位图中已保存的展位，请到展位图管理中新增', 400, corsHeaders);
    }

    if (url.pathname === '/api/edit-booth' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { project_id, id, type, area, base_price } = await request.json();
        const boothRow = await env.DB.prepare(`
          SELECT source, booth_map_id, type, area
          FROM Booths
          WHERE id = ? AND project_id = ?
        `).bind(id, project_id).first();
        const isMapManaged = boothRow && (String(boothRow.source || '') === 'map' || Number(boothRow.booth_map_id || 0) > 0);
        if (isMapManaged) {
            await env.DB.prepare('UPDATE Booths SET base_price = ? WHERE id = ? AND project_id = ?')
                .bind(base_price, id, project_id).run();
            return new Response(JSON.stringify({ success: true, price_only: true }), { headers: corsHeaders });
        }
        await env.DB.prepare('UPDATE Booths SET type=?, area=?, base_price=?, price_unit=? WHERE id=? AND project_id=?')
            .bind(type, area, base_price, type === '光地' ? '平米' : '个', id, project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/update-booth-status' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { projectId, boothIds, status } = await request.json();
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);
        let normalizedBoothIds = [];
        try {
            normalizedBoothIds = normalizeBoothIds(boothIds);
        } catch (error) {
            return errorResponse(error.message, 400, corsHeaders);
        }
        if (!MANUAL_BOOTH_STATUSES.has(String(status || '').trim())) {
            return errorResponse('仅允许手动设置为未售或已锁定', 400, corsHeaders);
        }
        for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
            const placeholders = boothIdChunk.map(() => '?').join(',');
            const query = `UPDATE Booths SET status = ? WHERE project_id = ? AND id IN (${placeholders})`;
            await env.DB.prepare(query).bind(status, projectId, ...boothIdChunk).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/delete-booths' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { projectId, boothIds } = await request.json();
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);
        let normalizedBoothIds = [];
        try {
            normalizedBoothIds = normalizeBoothIds(boothIds);
        } catch (error) {
            return errorResponse(error.message, 400, corsHeaders);
        }
        const mapManagedBoothIds = await getMapManagedBoothIds(env, projectId, normalizedBoothIds);
        if (mapManagedBoothIds.length > 0) {
            return errorResponse('该展位由展位图维护，请在展位图管理中修改', 400, corsHeaders);
        }
        const referencedBoothIds = await getReferencedBoothIds(env, projectId, normalizedBoothIds);
        if (referencedBoothIds.length > 0) {
            const previewText = referencedBoothIds.slice(0, 5).join('、');
            const suffix = referencedBoothIds.length > 5 ? ' 等' : '';
            return errorResponse(`以下展位已被历史订单引用，不能删除：${previewText}${suffix}`, 400, corsHeaders);
        }
        for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
            const placeholders = boothIdChunk.map(() => '?').join(',');
            await env.DB.prepare(`DELETE FROM Booths WHERE project_id = ? AND id IN (${placeholders})`)
                .bind(projectId, ...boothIdChunk).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        return errorResponse('展位库仅接收展位图中已保存的展位，不支持 Excel 批量导入', 400, corsHeaders);
    }

    return null;
}
