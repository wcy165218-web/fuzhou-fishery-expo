import { normalizeBoothIds } from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';

const MANUAL_BOOTH_STATUSES = new Set(['可售', '已锁定']);

async function getReferencedBoothIds(env, projectId, boothIds) {
    const normalizedBoothIds = Array.isArray(boothIds)
        ? boothIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    if (normalizedBoothIds.length === 0) return [];
    const placeholders = normalizedBoothIds.map(() => '?').join(',');
    const results = await env.DB.prepare(`
      SELECT booth_id
      FROM Orders
      WHERE project_id = ?
        AND booth_id IN (${placeholders})
      GROUP BY booth_id
    `).bind(Number(projectId), ...normalizedBoothIds).all();
    return (results.results || []).map((row) => String(row.booth_id || '').trim()).filter(Boolean);
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
            SELECT b.*, SUM(o.total_booth_fee) as total_booth_fee
            FROM Booths b
            LEFT JOIN Orders o ON b.id = o.booth_id AND b.project_id = o.project_id AND o.status NOT IN ('已退订', '已作废')
            WHERE b.project_id = ?
            GROUP BY b.id
        `;
        const results = await env.DB.prepare(query).bind(pid).all();
        return new Response(JSON.stringify(results.results), { headers: corsHeaders });
    }

    if (url.pathname === '/api/add-booth' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { project_id, id, hall, type, area, price_unit, base_price } = await request.json();
        try {
            await env.DB.prepare('INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(id, project_id, hall, type, area, price_unit, base_price || 0, '可售').run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (error) {
            return errorResponse('添加失败，展位号可能已存在', 400, corsHeaders);
        }
    }

    if (url.pathname === '/api/edit-booth' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { project_id, id, type, area, base_price } = await request.json();
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
        const placeholders = normalizedBoothIds.map(() => '?').join(',');
        const query = `UPDATE Booths SET status = ? WHERE project_id = ? AND id IN (${placeholders})`;
        await env.DB.prepare(query).bind(status, projectId, ...normalizedBoothIds).run();
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
        const referencedBoothIds = await getReferencedBoothIds(env, projectId, normalizedBoothIds);
        if (referencedBoothIds.length > 0) {
            const previewText = referencedBoothIds.slice(0, 5).join('、');
            const suffix = referencedBoothIds.length > 5 ? ' 等' : '';
            return errorResponse(`以下展位已被历史订单引用，不能删除：${previewText}${suffix}`, 400, corsHeaders);
        }
        const placeholders = normalizedBoothIds.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM Booths WHERE project_id = ? AND id IN (${placeholders})`)
            .bind(projectId, ...normalizedBoothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { projectId, booths } = await request.json();
        const statements = booths.map((booth) =>
            env.DB.prepare('INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id, project_id) DO UPDATE SET hall=excluded.hall, type=excluded.type, area=excluded.area')
                .bind(booth.id, projectId, booth.hall, booth.type, booth.area, booth.price_unit, 0, '可售')
        );
        await env.DB.batch(statements);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return null;
}
