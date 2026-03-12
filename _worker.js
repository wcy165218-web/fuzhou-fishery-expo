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

      // 2. 项目获取与创建
      if (url.pathname === '/api/projects' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT * FROM Projects ORDER BY year DESC, id DESC").all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/projects' && request.method === 'POST') {
        const p = await request.json();
        await env.DB.prepare("INSERT INTO Projects (name, year, start_date, end_date, status) VALUES (?, ?, ?, ?, '进行中')").bind(p.name, p.year, p.start_date, p.end_date).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 3. 员工获取 (关联当前选中的项目目标)
      if (url.pathname === '/api/staff' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        // 左连接获取该项目下的目标值
        const { results } = await env.DB.prepare(`
          SELECT s.name, s.role, IFNULL(m.target_value, 0) as target 
          FROM Staff s 
          LEFT JOIN Project_Staff_Map m ON s.name = m.staff_name AND m.project_id = ?
        `).bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      // 4. 员工创建
      if (url.pathname === '/api/staff' && request.method === 'POST') {
        const s = await request.json();
        try {
          await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, ?, ?)").bind(s.name, s.password || '123456', s.role).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, message: "该姓名已存在" }), { status: 400, headers: corsHeaders });
        }
      }

      // 5. 设置员工目标 (插入或更新)
      if (url.pathname === '/api/set-target' && request.method === 'POST') {
        const { projectId, staffName, target } = await request.json();
        await env.DB.prepare(`
          INSERT INTO Project_Staff_Map (project_id, staff_name, target_value) 
          VALUES (?, ?, ?) 
          ON CONFLICT(project_id, staff_name) 
          DO UPDATE SET target_value = excluded.target_value
        `).bind(projectId, staffName, target).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 6. 密码管理 (重置与修改)
      if (url.pathname === '/api/reset-password' && request.method === 'POST') {
        const { staffName } = await request.json();
        await env.DB.prepare("UPDATE Staff SET password = '123' WHERE name = ?").bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        const user = await env.DB.prepare("SELECT * FROM Staff WHERE name = ? AND password = ?").bind(staffName, oldPass).first();
        if(!user) return new Response(JSON.stringify({ success: false, message: "原密码错误" }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("UPDATE Staff SET password = ? WHERE name = ?").bind(newPass, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 7. 展位管理 (获取与批量导入)
      if (url.pathname === '/api/booths' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare("SELECT * FROM Booths WHERE project_id = ? ORDER BY id ASC").bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        const { projectId, booths } = await request.json();
        const stmt = env.DB.prepare("INSERT OR REPLACE INTO Booths (id, project_id, hall, type, area, open_sides, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '可售')");
        const batch = booths.map(b => stmt.bind(b.id, projectId, b.hall, b.type, b.area, b.open_sides, b.price_unit, b.base_price));
        await env.DB.batch(batch);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
}
