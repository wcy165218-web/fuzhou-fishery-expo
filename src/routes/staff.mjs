import { hashPassword } from '../utils/crypto.mjs';
import { requireSuperAdmin } from '../utils/auth.mjs';
import { STAFF_SORT_ORDER } from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';
import { readJsonBody } from '../utils/request.mjs';

async function getOrderCountBySalesName(env, staffName) {
    const row = await env.DB.prepare(`
      SELECT COUNT(*) AS cnt
      FROM Orders
      WHERE sales_name = ?
    `).bind(String(staffName || '').trim()).first();
    return Number(row?.cnt || 0);
}

export async function handleStaffRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/staff') {
        if (request.method === 'GET') {
            const results = await env.DB.prepare(`SELECT name, role, target, display_order, exclude_from_sales_ranking FROM Staff ORDER BY ${STAFF_SORT_ORDER}`).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
        if (request.method === 'POST') {
            const denied = requireSuperAdmin(currentUser, corsHeaders);
            if (denied) return denied;
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const { name, role } = payload;
            try {
                const defaultHash = await hashPassword('123456');
                const maxOrderRow = await env.DB.prepare(`SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM Staff`).first();
                const nextOrder = Number(maxOrderRow?.maxOrder || 0) + 1;
                await env.DB.prepare("INSERT INTO Staff (name, password, role, display_order, exclude_from_sales_ranking, token_index) VALUES (?, ?, ?, ?, 0, 0)").bind(name, defaultHash, role, nextOrder).run();
                return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
            } catch (error) {
                return errorResponse('添加失败，可能姓名已存在', 400, corsHeaders);
            }
        }
    }

    if (url.pathname === '/api/delete-staff' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { staffName } = payload;
        if (staffName === 'admin') return errorResponse('不能删除超级管理员', 400, corsHeaders);
        const relatedOrderCount = await getOrderCountBySalesName(env, staffName);
        if (relatedOrderCount > 0) {
            return errorResponse(`该业务员名下仍有关联订单（${relatedOrderCount} 笔），请先转移或处理订单后再删除`, 400, corsHeaders);
        }
        await env.DB.prepare('DELETE FROM Staff WHERE name = ?').bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { staffName, role } = payload;
        if (staffName === 'admin') return errorResponse('不能修改超级管理员角色', 400, corsHeaders);
        await env.DB.prepare('UPDATE Staff SET role = ?, token_index = COALESCE(token_index, 0) + 1 WHERE name = ?').bind(role, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/set-target' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { staffName, target } = payload;
        await env.DB.prepare('UPDATE Staff SET target = ? WHERE name = ?').bind(target, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/update-staff-order' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { staffName, direction } = payload;
        if (!staffName || !['up', 'down'].includes(String(direction))) {
            return errorResponse('参数错误', 400, corsHeaders);
        }
        if (String(staffName) === 'admin') {
            return errorResponse('超级管理员顺序固定', 400, corsHeaders);
        }
        const staffRows = (await env.DB.prepare(`
          SELECT name, display_order
          FROM Staff
          WHERE name != 'admin'
          ORDER BY display_order ASC, name COLLATE NOCASE ASC
        `).all()).results || [];
        const currentIndex = staffRows.findIndex((row) => row.name === staffName);
        if (currentIndex === -1) return errorResponse('找不到该员工', 404, corsHeaders);
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= staffRows.length) {
            return new Response(JSON.stringify({ success: true, unchanged: true }), { headers: corsHeaders });
        }
        const currentRow = staffRows[currentIndex];
        const targetRow = staffRows[targetIndex];
        await env.DB.batch([
            env.DB.prepare('UPDATE Staff SET display_order = ? WHERE name = ?').bind(Number(targetRow.display_order || 0), currentRow.name),
            env.DB.prepare('UPDATE Staff SET display_order = ? WHERE name = ?').bind(Number(currentRow.display_order || 0), targetRow.name)
        ]);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/update-staff-sales-ranking' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { staffName, excludeFromSalesRanking } = payload;
        if (!staffName) return errorResponse('参数错误', 400, corsHeaders);
        await env.DB.prepare('UPDATE Staff SET exclude_from_sales_ranking = ? WHERE name = ?')
            .bind(Number(excludeFromSalesRanking) ? 1 : 0, staffName)
            .run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (url.pathname === '/api/reset-password' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { staffName } = payload;
        if (staffName === 'admin') return errorResponse('不能重置超级管理员的密码', 400, corsHeaders);
        const defaultHash = await hashPassword('123456');
        await env.DB.prepare('UPDATE Staff SET password = ?, token_index = COALESCE(token_index, 0) + 1 WHERE name = ?').bind(defaultHash, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return null;
}
