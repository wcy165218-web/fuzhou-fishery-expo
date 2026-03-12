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
      // 1. 登录接口
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const user = await env.DB.prepare("SELECT name, role FROM Staff WHERE name = ? AND password = ?")
          .bind(username, password).first();
        if (user) {
          return new Response(JSON.stringify({ success: true, user }), { headers: corsHeaders });
        }
        return new Response(JSON.stringify({ success: false, message: "账号或密码错误" }), { status: 401, headers: corsHeaders });
      }

      // 2. 获取所有项目列表
      if (url.pathname === '/api/projects' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT * FROM Projects ORDER BY year DESC, id DESC").all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      // 3. 新增项目
      if (url.pathname === '/api/projects' && request.method === 'POST') {
        const p = await request.json();
        await env.DB.prepare("INSERT INTO Projects (name, year, start_date, end_date, status) VALUES (?, ?, ?, ?, '进行中')")
          .bind(p.name, p.year, p.start_date, p.end_date).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 4. 获取所有业务员列表
      if (url.pathname === '/api/staff' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT name, role FROM Staff").all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      // 5. 新增业务员
      if (url.pathname === '/api/staff' && request.method === 'POST') {
        const s = await request.json();
        try {
          await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, ?, ?)")
            .bind(s.name, s.password || '123456', s.role).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) {
          // 如果名字重复会报错
          return new Response(JSON.stringify({ success: false, message: "该姓名已存在" }), { status: 400, headers: corsHeaders });
        }
      }

      // 如果不是 API 请求，统一返回前端网页
      return env.ASSETS.fetch(request);

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
}
