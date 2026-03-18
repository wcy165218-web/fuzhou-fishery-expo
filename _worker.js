// 辅助函数：SHA-256 密码加密
async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 【安全升级】允许前端发送 Authorization 鉴权头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization', 
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      // ============ 🔥 全局接口鉴权拦截器 (修复版) ============
      let currentUser = null;
      
      // 【重点修复】：只有访问 /api/ 且不是登录、不是下载文件的请求，才需要校验 Token
      // 这样普通的网页访问（如 /index.html）就会直接跳过拦截，下发到最底部的 env.ASSETS.fetch
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/login' && !url.pathname.startsWith('/api/file/')) {
          const authHeader = request.headers.get('Authorization');
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return new Response(JSON.stringify({ error: "非法请求：缺少身份凭证" }), { status: 401, headers: corsHeaders });
          }
          const token = authHeader.split(' ')[1];
          currentUser = await env.DB.prepare("SELECT name, role FROM Staff WHERE token = ?").bind(token).first();
          if (!currentUser) {
              return new Response(JSON.stringify({ error: "身份已过期或无效，请重新登录" }), { status: 401, headers: corsHeaders });
          }
      }

      // 1. 登录 (签发 Token 并验证哈希密码)
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const hashedPassword = await hashPassword(password); // 加密比对
        const user = await env.DB.prepare("SELECT name, role FROM Staff WHERE name = ? AND password = ?").bind(username, hashedPassword).first();
        if (user) {
            const token = crypto.randomUUID(); // 签发安全令牌
            await env.DB.prepare("UPDATE Staff SET token = ? WHERE name = ?").bind(token, username).run();
            user.token = token;
            return new Response(JSON.stringify({ success: true, user }), { headers: corsHeaders });
        }
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

      // 3. 人员管理与密码修改 (加密存储)
      if (url.pathname === '/api/staff' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare(`SELECT s.name, s.role, IFNULL(m.target_value, 0) as target FROM Staff s LEFT JOIN Project_Staff_Map m ON s.name = m.staff_name AND m.project_id = ?`).bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/staff' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return new Response('Forbidden', {status: 403});
        const s = await request.json();
        const hashedPassword = await hashPassword(s.password || '123456');
        try { await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, ?, ?)").bind(s.name, hashedPassword, s.role).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) { return new Response(JSON.stringify({ success: false, message: "该姓名已存在" }), { status: 400, headers: corsHeaders }); }
      }
      if (url.pathname === '/api/set-target' && request.method === 'POST') {
        const { projectId, staffName, target } = await request.json();
        await env.DB.prepare(`INSERT INTO Project_Staff_Map (project_id, staff_name, target_value) VALUES (?, ?, ?) ON CONFLICT(project_id, staff_name) DO UPDATE SET target_value = excluded.target_value`).bind(projectId, staffName, target).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return new Response('Forbidden', {status: 403});
        const { staffName, role } = await request.json(); if (staffName === 'admin') return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("UPDATE Staff SET role = ? WHERE name = ?").bind(role, staffName).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-staff' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return new Response('Forbidden', {status: 403});
        const { staffName } = await request.json(); if (staffName === 'admin') return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("DELETE FROM Staff WHERE name = ?").bind(staffName).run(); await env.DB.prepare("DELETE FROM Project_Staff_Map WHERE staff_name = ?").bind(staffName).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        if (currentUser.name !== staffName) return new Response('Forbidden', {status: 403});
        const hashedOld = await hashPassword(oldPass);
        const user = await env.DB.prepare("SELECT * FROM Staff WHERE name = ? AND password = ?").bind(staffName, hashedOld).first();
        if(!user) return new Response(JSON.stringify({ success: false, message: "原密码错误" }), { status: 400, headers: corsHeaders });
        const hashedNew = await hashPassword(newPass);
        await env.DB.prepare("UPDATE Staff SET password = ?, token = NULL WHERE name = ?").bind(hashedNew, staffName).run(); // 改密后清空token强制下线
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 4. 收款账户管理
      if (url.pathname === '/api/accounts' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare("SELECT * FROM Project_Accounts WHERE project_id = ?").bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/add-account' && request.method === 'POST') {
        const a = await request.json();
        await env.DB.prepare("INSERT INTO Project_Accounts (project_id, account_name, bank_name, account_no) VALUES (?, ?, ?, ?)").bind(a.project_id, a.account_name, a.bank_name, a.account_no).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-account' && request.method === 'POST') {
        const { account_id } = await request.json();
        await env.DB.prepare("DELETE FROM Project_Accounts WHERE id = ?").bind(account_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 5. 行业分类配置
      if (url.pathname === '/api/industries' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare("SELECT * FROM Project_Industries WHERE project_id = ? ORDER BY id DESC").bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/add-industry' && request.method === 'POST') {
        const i = await request.json();
        await env.DB.prepare("INSERT INTO Project_Industries (project_id, industry_name) VALUES (?, ?)").bind(i.project_id, i.industry_name).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-industry' && request.method === 'POST') {
        const { industry_id } = await request.json();
        await env.DB.prepare("DELETE FROM Project_Industries WHERE id = ?").bind(industry_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 6. 展位管理与批量导入
      if (url.pathname === '/api/prices' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId'); const { results } = await env.DB.prepare("SELECT type, price FROM Project_Prices WHERE project_id = ?").bind(projectId).all();
        let prices = {}; results.forEach(r => prices[r.type] = r.price); return new Response(JSON.stringify(prices), { headers: corsHeaders });
      }
      if (url.pathname === '/api/prices' && request.method === 'POST') {
        const { projectId, prices } = await request.json(); const stmt = env.DB.prepare("INSERT OR REPLACE INTO Project_Prices (project_id, type, price) VALUES (?, ?, ?)");
        const batch = Object.keys(prices).map(type => stmt.bind(projectId, type, prices[type])); if(batch.length > 0) await env.DB.batch(batch);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/booths' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        // 【核心优化】：使用 SUM 聚合金额，并使用 GROUP BY 保证展位号唯一
        const query = `
          SELECT 
            b.*, 
            SUM(o.total_booth_fee) as total_booth_fee 
          FROM Booths b 
          LEFT JOIN Orders o ON b.id = o.booth_id AND b.project_id = o.project_id AND o.status = '正常'
          WHERE b.project_id = ? 
          GROUP BY b.id
          ORDER BY b.id ASC
        `;
        const { results } = await env.DB.prepare(query).bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/add-booth' && request.method === 'POST') {
        const b = await request.json();
        const exists = await env.DB.prepare("SELECT id FROM Booths WHERE id = ? AND project_id = ?").bind(b.id, b.project_id).first();
        if (exists) return new Response(JSON.stringify({ success: false, error: "展位号已存在" }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, '可售')").bind(b.id, b.project_id, b.hall, b.type, Number(b.area)||0, b.price_unit, Number(b.base_price)||0).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      
      // 【事务优化】批量导入展位接口
      if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        const { projectId, booths } = await request.json();
        const stmt = env.DB.prepare("INSERT OR IGNORE INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, '可售')");
        const batch = booths.map(b => stmt.bind(b.id, projectId, b.hall, b.type, Number(b.area)||0, b.price_unit, 0));
        if (batch.length > 0) await env.DB.batch(batch);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-booth-status' && request.method === 'POST') {
        const { projectId, boothIds, status } = await request.json();
        const placeholders = boothIds.map(() => '?').join(',');
        await env.DB.prepare(`UPDATE Booths SET status = ? WHERE project_id = ? AND id IN (${placeholders}) AND status NOT IN ('已预订', '已成交')`).bind(status, projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-booths' && request.method === 'POST') {
        const { projectId, boothIds } = await request.json();
        const placeholders = boothIds.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM Booths WHERE project_id = ? AND status NOT IN ('已预订', '已成交') AND id IN (${placeholders})`).bind(projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/edit-booth' && request.method === 'POST') {
        const b = await request.json();
        await env.DB.prepare("UPDATE Booths SET type = ?, area = ?, base_price = ? WHERE id = ? AND project_id = ? AND status NOT IN ('已预订', '已成交')").bind(b.type, b.area, b.base_price, b.id, b.project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 6. 客户资料编辑
      if (url.pathname === '/api/update-customer-info' && request.method === 'POST') {
        const d = await request.json();
        await env.DB.prepare(`
            UPDATE Orders SET contact_person = ?, phone = ?, region = ?, main_business = ?, profile = ?, is_agent = ?, agent_name = ?, category = ? 
            WHERE id = ? AND project_id = ?
        `).bind(d.contact_person, d.phone, d.region, d.main_business, d.profile, d.is_agent ? 1 : 0, d.agent_name, d.category, d.order_id, d.project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ============ 🔥 安全升级：R2 文件上传严格验证 ============
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData(); const file = formData.get('file');
        if (!file) return new Response(JSON.stringify({ error: "没有接收到文件" }), { status: 400, headers: corsHeaders });
        
        // 防火墙：拦截超大文件和非 PDF 文件
        if (file.size > 10 * 1024 * 1024) return new Response(JSON.stringify({ error: "出于安全限制，附件大小不能超过10MB" }), { status: 400, headers: corsHeaders });
        if (file.type !== 'application/pdf') return new Response(JSON.stringify({ error: "非法文件类型！系统仅允许上传 PDF 格式的合同" }), { status: 400, headers: corsHeaders });

        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_'); const fileName = `contract_${Date.now()}_${safeName}`; 
        await env.BUCKET.put(fileName, file.stream(), { httpMetadata: { contentType: file.type } });
        return new Response(JSON.stringify({ success: true, fileKey: fileName }), { headers: corsHeaders });
      }
      if (url.pathname.startsWith('/api/file/') && request.method === 'GET') {
        const key = decodeURIComponent(url.pathname.replace('/api/file/', '')); const object = await env.BUCKET.get(key);
        if (!object) return new Response('文件不存在', { status: 404, headers: corsHeaders });
        const headers = new Headers(corsHeaders); object.writeHttpMetadata(headers); headers.set('etag', object.httpEtag);
        return new Response(object.body, { headers });
      }

      // ============ 🔥 事务升级：订单录入原子性保障 ============
      if (url.pathname === '/api/submit-order' && request.method === 'POST') {
        const o = await request.json();
        if (o.credit_code && !o.no_code_checked) {
            const existCode = await env.DB.prepare("SELECT id FROM Orders WHERE project_id = ? AND credit_code = ? AND status = '正常'").bind(o.project_id, o.credit_code).first();
            if (existCode) return new Response(JSON.stringify({ success: false, error: `社会信用代码 [${o.credit_code}] 已存在，无法重复录入！` }), { status: 400, headers: corsHeaders });
        }
        
        const stmtInsertOrder = env.DB.prepare(`
          INSERT INTO Orders (
            project_id, company_name, credit_code, no_code_checked, main_business, is_agent, agent_name, contact_person, phone, region,
            booth_id, area, price_unit, unit_price, total_booth_fee, discount_reason, other_income, fees_json, profile, total_amount, contract_url, sales_name, status, category
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '正常', ?)
        `).bind(
          o.project_id, o.company_name, o.credit_code, o.no_code_checked ? 1 : 0, o.main_business, o.is_agent ? 1 : 0, o.agent_name,
          o.contact_person, o.phone, o.region, o.booth_id, o.area, o.price_unit, o.unit_price, o.total_booth_fee, o.discount_reason,
          o.other_income, o.fees_json, o.profile, o.total_amount, o.contract_url, o.sales_name, o.category
        );

        const stmtUpdateBooth = env.DB.prepare("UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ?").bind(o.booth_id, o.project_id);

        try {
            // 使用 batch 确保两条 SQL 语句同生共死
            await env.DB.batch([stmtInsertOrder, stmtUpdateBooth]);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (dbErr) {
            return new Response(JSON.stringify({ success: false, error: "系统事务异常：" + dbErr.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 9. 财务大盘与流水
      if (url.pathname === '/api/orders' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const role = url.searchParams.get('role');
        const salesName = url.searchParams.get('salesName');
        let query = `SELECT o.*, b.hall, b.type as booth_type FROM Orders o LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id WHERE o.project_id = ? AND o.status = '正常'`;
        let params = [projectId];
        if (role === 'user') { query += " AND o.sales_name = ?"; params.push(salesName); }
        query += " ORDER BY o.id DESC";
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      if (url.pathname === '/api/payments' && request.method === 'GET') {
        const orderId = url.searchParams.get('orderId');
        const { results } = await env.DB.prepare("SELECT * FROM Payments WHERE order_id = ? ORDER BY payment_time DESC, id DESC").bind(orderId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      if (url.pathname === '/api/add-payment' && request.method === 'POST') {
        const p = await request.json();
        await env.DB.prepare("INSERT INTO Payments (order_id, amount, bank_name, payment_time, payer_name, remarks) VALUES (?, ?, ?, ?, ?, ?)").bind(p.order_id, p.amount, p.bank_name, p.payment_time, p.payer_name, p.remarks).run();
        await env.DB.prepare("UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?").bind(p.amount, p.order_id).run();
        const order = await env.DB.prepare("SELECT paid_amount, total_amount, booth_id FROM Orders WHERE id = ?").bind(p.order_id).first();
        if (order && order.paid_amount >= order.total_amount) {
            await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, p.project_id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/edit-payment' && request.method === 'POST') {
        const p = await request.json();
        const oldPay = await env.DB.prepare("SELECT amount FROM Payments WHERE id = ?").bind(p.payment_id).first();
        if(!oldPay) return new Response(JSON.stringify({ success: false, error: '流水不存在' }), { status: 400, headers: corsHeaders });
        const diff = Number(p.amount) - Number(oldPay.amount);
        await env.DB.prepare("UPDATE Payments SET amount=?, bank_name=?, payment_time=?, payer_name=?, remarks=? WHERE id=?").bind(p.amount, p.bank_name, p.payment_time, p.payer_name, p.remarks, p.payment_id).run();
        await env.DB.prepare("UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?").bind(diff, p.order_id).run();
        const order = await env.DB.prepare("SELECT paid_amount, total_amount, booth_id FROM Orders WHERE id = ?").bind(p.order_id).first();
        if (order) {
            const newStatus = order.paid_amount >= order.total_amount ? '已成交' : '已预订';
            await env.DB.prepare("UPDATE Booths SET status = ? WHERE id = ? AND project_id = ?").bind(newStatus, order.booth_id, p.project_id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/delete-payment' && request.method === 'POST') {
        const { payment_id, order_id, project_id } = await request.json();
        const pay = await env.DB.prepare("SELECT amount FROM Payments WHERE id = ?").bind(payment_id).first();
        if(!pay) return new Response(JSON.stringify({ success: false }), { headers: corsHeaders });
        await env.DB.prepare("DELETE FROM Payments WHERE id = ?").bind(payment_id).run();
        await env.DB.prepare("UPDATE Orders SET paid_amount = paid_amount - ? WHERE id = ?").bind(pay.amount, order_id).run();
        const order = await env.DB.prepare("SELECT paid_amount, total_amount, booth_id FROM Orders WHERE id = ?").bind(order_id).first();
        if(order && order.paid_amount < order.total_amount) {
            await env.DB.prepare("UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ?").bind(order.booth_id, project_id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 10. 费用变更与退单
      if (url.pathname === '/api/update-order-fees' && request.method === 'POST') {
        const o = await request.json();
        const total = Number(o.actual_fee) + Number(o.other_fee_total);
        await env.DB.prepare("UPDATE Orders SET total_booth_fee = ?, other_income = ?, total_amount = ?, discount_reason = ?, fees_json = ? WHERE id = ?").bind(o.actual_fee, o.other_fee_total, total, o.reason, o.fees_json, o.order_id).run();
        const order = await env.DB.prepare("SELECT paid_amount, total_amount, booth_id FROM Orders WHERE id = ?").bind(o.order_id).first();
        if (order) {
            const newStatus = order.paid_amount >= order.total_amount ? '已成交' : '已预订';
            await env.DB.prepare("UPDATE Booths SET status = ? WHERE id = ? AND project_id = ?").bind(newStatus, order.booth_id, o.project_id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/cancel-order' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403, headers: corsHeaders });
        const { order_id, project_id, booth_id } = await request.json();
        await env.DB.prepare("UPDATE Orders SET status = '已作废' WHERE id = ?").bind(order_id).run();
        await env.DB.prepare("UPDATE Booths SET status = '可售' WHERE id = ? AND project_id = ?").bind(booth_id, project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 11. 代付/返佣接口
      if (url.pathname === '/api/expenses' && request.method === 'GET') {
        try {
            const orderId = Number(url.searchParams.get('orderId')) || 0;
            const { results } = await env.DB.prepare("SELECT * FROM Expenses WHERE order_id = ? ORDER BY id DESC").bind(orderId).all();
            return new Response(JSON.stringify(results || []), { headers: corsHeaders });
        } catch (err) {
            return new Response(JSON.stringify({ error: "数据库读取失败: " + err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (url.pathname === '/api/add-expense' && request.method === 'POST') {
        try {
          const e = await request.json();
          const params = [
            Number(e.project_id) || 0,
            Number(e.order_id) || 0,
            String(e.fee_item_name || '总收款抵扣'),
            String(e.payee_name || ''),
            String(e.payee_channel || '银行转账'),
            String(e.payee_bank || ''),
            String(e.payee_account || ''),
            Number(e.amount) || 0,
            String(e.applicant || ''),
            String(e.reason || '') 
          ];

          await env.DB.prepare(`
            INSERT INTO Expenses (
              project_id, order_id, fee_item_name, payee_name, 
              payee_channel, payee_bank, payee_account, amount, applicant, reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(...params).run();

          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: "写入失败: " + err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (url.pathname === '/api/delete-expense' && request.method === 'POST') {
        const { expense_id } = await request.json();
        await env.DB.prepare("DELETE FROM Expenses WHERE id = ?").bind(expense_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 如果不是 /api/ 开头的请求，则下发前端静态文件
      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
}
