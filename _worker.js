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
      // 1. 登录与基础项目
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const user = await env.DB.prepare("SELECT name, role FROM Staff WHERE name = ? AND password = ?").bind(username, password).first();
        if (user) return new Response(JSON.stringify({ success: true, user }), { headers: corsHeaders });
        return new Response(JSON.stringify({ success: false, message: "账号或密码错误" }), { status: 401, headers: corsHeaders });
      }
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

      // 2. 人员与目标
      if (url.pathname === '/api/staff' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare(`SELECT s.name, s.role, IFNULL(m.target_value, 0) as target FROM Staff s LEFT JOIN Project_Staff_Map m ON s.name = m.staff_name AND m.project_id = ?`).bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/staff' && request.method === 'POST') {
        const s = await request.json();
        try {
          await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, ?, ?)").bind(s.name, s.password || '123456', s.role).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) { return new Response(JSON.stringify({ success: false, message: "该姓名已存在" }), { status: 400, headers: corsHeaders }); }
      }
      if (url.pathname === '/api/set-target' && request.method === 'POST') {
        const { projectId, staffName, target } = await request.json();
        await env.DB.prepare(`INSERT INTO Project_Staff_Map (project_id, staff_name, target_value) VALUES (?, ?, ?) ON CONFLICT(project_id, staff_name) DO UPDATE SET target_value = excluded.target_value`).bind(projectId, staffName, target).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        const { staffName, role } = await request.json();
        if (staffName === 'admin') return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("UPDATE Staff SET role = ? WHERE name = ?").bind(role, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-staff' && request.method === 'POST') {
        const { staffName } = await request.json();
        if (staffName === 'admin') return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("DELETE FROM Staff WHERE name = ?").bind(staffName).run();
        await env.DB.prepare("DELETE FROM Project_Staff_Map WHERE staff_name = ?").bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
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

      // 3. 全局价格设置 (新增)
      if (url.pathname === '/api/prices' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare("SELECT type, price FROM Project_Prices WHERE project_id = ?").bind(projectId).all();
        // 转成键值对 { '标摊': 5800, ... }
        let prices = {}; results.forEach(r => prices[r.type] = r.price);
        return new Response(JSON.stringify(prices), { headers: corsHeaders });
      }
      if (url.pathname === '/api/prices' && request.method === 'POST') {
        const { projectId, prices } = await request.json();
        const stmt = env.DB.prepare("INSERT OR REPLACE INTO Project_Prices (project_id, type, price) VALUES (?, ?, ?)");
        const batch = Object.keys(prices).map(type => stmt.bind(projectId, type, prices[type]));
        if(batch.length > 0) await env.DB.batch(batch);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 4. 展位管理 (重构版)
      if (url.pathname === '/api/booths' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare("SELECT * FROM Booths WHERE project_id = ? ORDER BY id ASC").bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      
      // 单个新增展位 (含查重)
      if (url.pathname === '/api/add-booth' && request.method === 'POST') {
        const b = await request.json();
        // 查重检测
        const exists = await env.DB.prepare("SELECT id FROM Booths WHERE id = ? AND project_id = ?").bind(b.id, b.project_id).first();
        if (exists) return new Response(JSON.stringify({ success: false, error: "展位号已存在，不允许重复录入！" }), { status: 400, headers: corsHeaders });
        
        await env.DB.prepare("INSERT INTO Booths (id, project_id, hall, type, area, status) VALUES (?, ?, ?, ?, ?, '可售')")
          .bind(b.id, b.project_id, b.hall, b.type, Number(b.area)||0).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 批量导入展位 (使用 INSERT OR IGNORE 忽略重复项)
      if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        const { projectId, booths } = await request.json();
        if (!booths || booths.length === 0) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        
        const stmt = env.DB.prepare("INSERT OR IGNORE INTO Booths (id, project_id, hall, type, area, status) VALUES (?, ?, ?, ?, ?, '可售')");
        const batch = booths.map(b => stmt.bind(b.id, projectId, b.hall, b.type, Number(b.area)||0));
        await env.DB.batch(batch);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 单条或批量修改状态
      if (url.pathname === '/api/update-booth-status' && request.method === 'POST') {
        const { projectId, boothIds, status } = await request.json(); // boothIds 是数组
        if (!boothIds || boothIds.length === 0) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        
        // 生成问号占位符
        const placeholders = boothIds.map(() => '?').join(',');
        const query = `UPDATE Booths SET status = ? WHERE project_id = ? AND id IN (${placeholders})`;
        await env.DB.prepare(query).bind(status, projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 修改展位信息 (面积/类型)
      if (url.pathname === '/api/edit-booth' && request.method === 'POST') {
        const { projectId, id, type, area } = await request.json();
        await env.DB.prepare("UPDATE Booths SET type = ?, area = ? WHERE id = ? AND project_id = ? AND status != '已成交'")
          .bind(type, area, id, projectId).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 单条或批量删除展位 (仅限非已成交状态)
      if (url.pathname === '/api/delete-booths' && request.method === 'POST') {
        const { projectId, boothIds } = await request.json();
        if (!boothIds || boothIds.length === 0) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        
        const placeholders = boothIds.map(() => '?').join(',');
        const query = `DELETE FROM Booths WHERE project_id = ? AND status != '已成交' AND id IN (${placeholders})`;
        await env.DB.prepare(query).bind(projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
}
