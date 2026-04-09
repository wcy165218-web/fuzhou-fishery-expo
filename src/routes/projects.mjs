import { requireSuperAdmin } from '../utils/auth.mjs';
import { readJsonBody } from '../utils/request.mjs';

export async function handleProjectRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/projects') {
        if (request.method === 'GET') {
            const results = await env.DB.prepare('SELECT * FROM Projects ORDER BY id DESC').all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
        if (request.method === 'POST') {
            const denied = requireSuperAdmin(currentUser, corsHeaders);
            if (denied) return denied;
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const { name, year, start_date, end_date } = payload;
            await env.DB.prepare('INSERT INTO Projects (name, year, start_date, end_date) VALUES (?, ?, ?, ?)').bind(name, year, start_date, end_date).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
    }

    if (url.pathname === '/api/update-project' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const { id, name, year, start_date, end_date } = payload;
        await env.DB.prepare('UPDATE Projects SET name = ?, year = ?, start_date = ?, end_date = ? WHERE id = ?').bind(name, year, start_date, end_date, id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return null;
}
