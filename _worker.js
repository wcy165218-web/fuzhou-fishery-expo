export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { DB } = env;

    // 跨域设置，允许前端调用
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 1. 登录验证接口
    if (url.pathname === "/api/login" && request.method === "POST") {
      const { username, password } = await request.json();
      const user = await DB.prepare("SELECT * FROM Staff WHERE name = ? AND password = ?")
        .bind(username, password)
        .first();

      if (user) {
        return Response.json({ success: true, user: { name: user.name, role: user.role } }, { headers: corsHeaders });
      } else {
        return Response.json({ success: false, message: "账号或密码错误" }, { status: 401, headers: corsHeaders });
      }
    }

    // 2. 获取可选展位接口
    if (url.pathname === "/api/get-booths" && request.method === "GET") {
      const { results } = await DB.prepare("SELECT * FROM Booths WHERE status = '可售'").all();
      return Response.json(results, { headers: corsHeaders });
    }

    // 3. 提交成交订单接口
    if (url.pathname === "/api/submit-order" && request.method === "POST") {
      const data = await request.json();
      
      // 开启事务：1. 插入订单 2. 更新展位状态为 '预定'
      const info = await DB.prepare(
        "INSERT INTO Orders (company_name, booth_id, total_amount, sales_name, region_info) VALUES (?, ?, ?, ?, ?)"
      ).bind(data.company_name, data.booth_id, data.total_amount, data.sales_name, data.region_info).run();

      await DB.prepare("UPDATE Booths SET status = '预定' WHERE id = ?")
        .bind(data.booth_id)
        .run();

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // 如果不是 API 请求，直接返回默认响应（或交给 Pages 处理静态资源）
    return new Response("API Engine Running", { headers: corsHeaders });
  }
};
