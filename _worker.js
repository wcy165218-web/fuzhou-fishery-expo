export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      // 1. 登录
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const user = await env.DB.prepare("SELECT name, role FROM Staff WHERE name = ? AND password = ?").bind(username, password).first();
        if (user) return new Response(JSON.stringify({ success: true, user }), { headers: corsHeaders });
        return new Response(JSON.stringify({ success: false, message: "账号或密码错误" }), { status: 401, headers: corsHeaders });
      }

      // 2. 项目管理
      if (url.pathname === '/api/projects' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT * FROM Projects ORDER BY year DESC, id DESC").all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/projects' && request.method === 'POST') {
        const p = await request.json();
        await env.DB.prepare("INSERT INTO Projects (name, year, start_date, end_date, status) VALUES (?, ?, ?, ?, '进行中')").bind(p.name, p.year, p.start_date, p.end_date).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/update-project' && request.method === 'POST') {
        const p = await request.json();
        await env.DB.prepare("UPDATE Projects SET name = ?, year = ?, start_date = ?, end_date = ? WHERE id = ?").bind(p.name, p.year, p.start_date, p.end_date, p.id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 3. 员工与目标管理
      if (url.pathname === '/api/staff' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare(`
          SELECT s.name, s.role, IFNULL(m.target_value, 0) as target 
          FROM Staff s LEFT JOIN Project_Staff_Map m ON s.name = m.staff_name AND m.project_id = ?
        `).bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/staff' && request.method === 'POST') {
        const s = await request.json();
        try {
          await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, ?, ?)").bind(s.name, s.password || '123456', s.role).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, message: "该姓名已存在" }), { status: 400, headers: corsHeaders });
        }
      }

      if (url.pathname === '/api/set-target' && request.method === 'POST') {
        const { projectId, staffName, target } = await request.json();
        await env.DB.prepare(`INSERT INTO Project_Staff_Map (project_id, staff_name, target_value) VALUES (?, ?, ?) ON CONFLICT(project_id, staff_name) DO UPDATE SET target_value = excluded.target_value`).bind(projectId, staffName, target).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 【新增】修改员工角色
      if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        const { staffName, role } = await request.json();
        if (staffName === 'admin') return new Response(JSON.stringify({ success: false, message: "不能修改超级管理员角色" }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("UPDATE Staff SET role = ? WHERE name = ?").bind(role, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 【新增】删除员工 (账号和目标设置)
      if (url.pathname === '/api/delete-staff' && request.method === 'POST') {
        const { staffName } = await request.json();
        if (staffName === 'admin') return new Response(JSON.stringify({ success: false, message: "不能删除超级管理员" }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("DELETE FROM Staff WHERE name = ?").bind(staffName).run();
        await env.DB.prepare("DELETE FROM Project_Staff_Map WHERE staff_name = ?").bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 4. 密码管理
      if (url.pathname === '/api/reset-password' && request.method === 'POST') {
        const { staffName } = await request.json();
        await env.DB.prepare("UPDATE Staff SET password = '123456' WHERE name = ?").bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        const user = await env.DB.prepare("SELECT * FROM Staff WHERE name = ? AND password = ?").bind(staffName, oldPass).first();
        if(!user) return new Response(JSON.stringify({ success: false, message: "原密码错误" }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("UPDATE Staff SET password = ? WHERE name = ?").bind(newPass, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 5. 展位管理
      if (url.pathname === '/api/booths' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare("SELECT * FROM Booths WHERE project_id = ? ORDER BY id ASC").bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/add-booth' && request.method === 'POST') {
        const b = await request.json();
        const safeArea = Number(b.area) || 0;
        const safePrice = Number(b.base_price) || 0;
        await env.DB.prepare("INSERT OR REPLACE INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, '可售')")
          .bind(b.id, b.project_id, b.hall, b.type, safeArea, b.price_unit, safePrice).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        const { projectId, booths } = await request.json();
        if (!booths || booths.length === 0) {
          return new Response(JSON.stringify({ success: true, message: "没有发现可导入的数据" }), { headers: corsHeaders });
        }
        const stmt = env.DB.prepare("INSERT OR REPLACE INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, '可售')");
        const batch = booths.map(b => stmt.bind(b.id, projectId, b.hall, b.type, Number(b.area)||0, b.price_unit, Number(b.base_price)||0));
        await env.DB.batch(batch);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/update-booth-status' && request.method === 'POST') {
        const { projectId, boothId, status } = await request.json();
        await env.DB.prepare("UPDATE Booths SET status = ? WHERE id = ? AND project_id = ?").bind(status, boothId, projectId).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
}
