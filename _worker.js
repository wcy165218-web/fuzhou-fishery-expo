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

      // 2. 人员管理
      if (url.pathname === '/api/staff' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare(`SELECT s.name, s.role, IFNULL(m.target_value, 0) as target FROM Staff s LEFT JOIN Project_Staff_Map m ON s.name = m.staff_name AND m.project_id = ?`).bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/staff' && request.method === 'POST') {
        const s = await request.json();
        try { await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, ?, ?)").bind(s.name, s.password || '123456', s.role).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (err) { return new Response(JSON.stringify({ success: false, message: "该姓名已存在" }), { status: 400, headers: corsHeaders }); }
      }
      if (url.pathname === '/api/set-target' && request.method === 'POST') {
        const { projectId, staffName, target } = await request.json();
        await env.DB.prepare(`INSERT INTO Project_Staff_Map (project_id, staff_name, target_value) VALUES (?, ?, ?) ON CONFLICT(project_id, staff_name) DO UPDATE SET target_value = excluded.target_value`).bind(projectId, staffName, target).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        const { staffName, role } = await request.json(); if (staffName === 'admin') return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("UPDATE Staff SET role = ? WHERE name = ?").bind(role, staffName).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-staff' && request.method === 'POST') {
        const { staffName } = await request.json(); if (staffName === 'admin') return new Response(JSON.stringify({ success: false }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("DELETE FROM Staff WHERE name = ?").bind(staffName).run(); await env.DB.prepare("DELETE FROM Project_Staff_Map WHERE staff_name = ?").bind(staffName).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        const user = await env.DB.prepare("SELECT * FROM Staff WHERE name = ? AND password = ?").bind(staffName, oldPass).first();
        if(!user) return new Response(JSON.stringify({ success: false, message: "原密码错误" }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("UPDATE Staff SET password = ? WHERE name = ?").bind(newPass, staffName).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 3. 价格与展位
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
        const { results } = await env.DB.prepare("SELECT * FROM Booths WHERE project_id = ? ORDER BY id ASC").bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/add-booth' && request.method === 'POST') {
        const b = await request.json();
        const exists = await env.DB.prepare("SELECT id FROM Booths WHERE id = ? AND project_id = ?").bind(b.id, b.project_id).first();
        if (exists) return new Response(JSON.stringify({ success: false, error: "展位号已存在" }), { status: 400, headers: corsHeaders });
        await env.DB.prepare("INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, '可售')").bind(b.id, b.project_id, b.hall, b.type, Number(b.area)||0, b.price_unit, Number(b.base_price)||0).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        const { projectId, booths } = await request.json(); if (!booths || booths.length === 0) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        const stmt = env.DB.prepare("INSERT OR IGNORE INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, 0, '可售')");
        const batch = booths.map(b => stmt.bind(b.id, projectId, b.hall, b.type, Number(b.area)||0, b.price_unit)); await env.DB.batch(batch); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/update-booth-status' && request.method === 'POST') {
        const { projectId, boothIds, status } = await request.json(); if (!boothIds || boothIds.length === 0) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        const placeholders = boothIds.map(() => '?').join(','); 
        await env.DB.prepare(`UPDATE Booths SET status = ? WHERE project_id = ? AND id IN (${placeholders}) AND status NOT IN ('已预订', '已成交')`).bind(status, projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/edit-booth' && request.method === 'POST') {
        const { projectId, id, type, area, base_price } = await request.json();
        await env.DB.prepare("UPDATE Booths SET type = ?, area = ?, base_price = ? WHERE id = ? AND project_id = ? AND status NOT IN ('已预订', '已成交')").bind(type, area, base_price, id, projectId).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-booths' && request.method === 'POST') {
        const { projectId, boothIds } = await request.json(); if (!boothIds || boothIds.length === 0) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        const placeholders = boothIds.map(() => '?').join(','); 
        await env.DB.prepare(`DELETE FROM Booths WHERE project_id = ? AND status NOT IN ('已预订', '已成交') AND id IN (${placeholders})`).bind(projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 4. R2 文件服务
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData(); const file = formData.get('file');
        if (!file) return new Response(JSON.stringify({ error: "没有接收到文件" }), { status: 400, headers: corsHeaders });
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

      // 【新增】5. 项目收款账户管理 API
      if (url.pathname === '/api/accounts' && request.method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const { results } = await env.DB.prepare("SELECT * FROM Project_Accounts WHERE project_id = ? ORDER BY id DESC").bind(projectId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/add-account' && request.method === 'POST') {
        const acc = await request.json();
        await env.DB.prepare("INSERT INTO Project_Accounts (project_id, account_name, bank_name, account_no) VALUES (?, ?, ?, ?)").bind(acc.project_id, acc.account_name, acc.bank_name, acc.account_no).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-account' && request.method === 'POST') {
        const { account_id } = await request.json();
        await env.DB.prepare("DELETE FROM Project_Accounts WHERE id = ?").bind(account_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 6. 订单录入
      if (url.pathname === '/api/submit-order' && request.method === 'POST') {
        const o = await request.json();
        if (o.credit_code && !o.no_code_checked) {
            const existCode = await env.DB.prepare("SELECT id FROM Orders WHERE project_id = ? AND credit_code = ? AND status = '正常'").bind(o.project_id, o.credit_code).first();
            if (existCode) return new Response(JSON.stringify({ success: false, error: `社会信用代码 [${o.credit_code}] 已存在，无法重复录入！` }), { status: 400, headers: corsHeaders });
        }
        const stmt = `INSERT INTO Orders (
          project_id, company_name, credit_code, no_code_checked, main_business, is_agent, agent_name, contact_person, phone, region,
          booth_id, area, price_unit, unit_price, total_booth_fee, discount_reason, other_income, fees_json, profile, total_amount, contract_url, sales_name, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '正常')`;
        await env.DB.prepare(stmt).bind(
          o.project_id, o.company_name, o.credit_code, o.no_code_checked ? 1 : 0, o.main_business, o.is_agent ? 1 : 0, o.agent_name,
          o.contact_person, o.phone, o.region, o.booth_id, o.area, o.price_unit, o.unit_price, o.total_booth_fee, o.discount_reason,
          o.other_income, o.fees_json, o.profile, o.total_amount, o.contract_url, o.sales_name
        ).run();
        await env.DB.prepare("UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ?").bind(o.booth_id, o.project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 7. 客户资料编辑
      if (url.pathname === '/api/update-customer-info' && request.method === 'POST') {
        const data = await request.json();
        await env.DB.prepare(`
            UPDATE Orders SET contact_person = ?, phone = ?, region = ?, main_business = ?, profile = ?, is_agent = ?, agent_name = ?
            WHERE id = ? AND project_id = ?
        `).bind(data.contact_person, data.phone, data.region, data.main_business, data.profile, data.is_agent ? 1 : 0, data.agent_name, data.order_id, data.project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 8. 财务大盘数据
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

      // 9. 财务流水接口
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
        const { order_id, project_id, booth_id } = await request.json();
        await env.DB.prepare("UPDATE Orders SET status = '已作废' WHERE id = ?").bind(order_id).run();
        await env.DB.prepare("UPDATE Booths SET status = '可售' WHERE id = ? AND project_id = ?").bind(booth_id, project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 11. 代付申请接口 (支持 payee_channel)
      if (url.pathname === '/api/expenses' && request.method === 'GET') {
        const orderId = url.searchParams.get('orderId');
        const { results } = await env.DB.prepare("SELECT * FROM Expenses WHERE order_id = ? ORDER BY id DESC").bind(orderId).all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }
      if (url.pathname === '/api/add-expense' && request.method === 'POST') {
        const e = await request.json();
        await env.DB.prepare("INSERT INTO Expenses (project_id, order_id, fee_item_name, payee_name, payee_channel, payee_bank, payee_account, amount, applicant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(e.project_id, e.order_id, e.fee_item_name, e.payee_name, e.payee_channel, e.payee_bank, e.payee_account, e.amount, e.applicant).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-expense' && request.method === 'POST') {
        const { expense_id } = await request.json();
        await env.DB.prepare("DELETE FROM Expenses WHERE id = ?").bind(expense_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
}
