import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode('your-256-bit-secret');

// 统一的错误响应生成器 (将纯文本拦截变为 JSON，防止前端报错)
function errorResponse(msg, status = 400) {
    return new Response(JSON.stringify({ success: false, error: msg }), {
        status: status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    let currentUser = null;

    // 【安全修复 1】：移除文件的免登录特权，所有 /api/ 路由（除 login 外）必须验证 JWT
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/login') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return errorResponse('未登录或登录已过期', 401);
      }
      const token = authHeader.split(' ')[1];
      try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        currentUser = payload;
      } catch (err) {
        return errorResponse('登录令牌无效', 401);
      }
    }

    try {
      // ================== 文件上传与下载 ==================
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) return errorResponse('没有找到文件');
        const fileExt = file.name.split('.').pop();
        const fileKey = `contract_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        await env.BUCKET.put(fileKey, file.stream());
        return new Response(JSON.stringify({ success: true, fileKey }), { headers: corsHeaders });
      }

      if (url.pathname.startsWith('/api/file/')) {
        // 【安全修复 2】：仅允许管理员下载和预览合同文件
        if (!currentUser || currentUser.role !== 'admin') {
            return errorResponse('权限不足：仅管理员可下载或预览合同', 403);
        }
        const key = url.pathname.replace('/api/file/', '');
        const object = await env.BUCKET.get(key);
        if (!object) return errorResponse('文件不存在', 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(object.body, { headers });
      }

      // ================== 身份认证 ==================
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ? AND password = ?').bind(username, password).first();
        if (!user) return errorResponse('账号或密码错误', 401);
        const token = await new SignJWT({ name: user.name, role: user.role })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('24h')
          .sign(JWT_SECRET);
        return new Response(JSON.stringify({ user: { name: user.name, role: user.role, token } }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ? AND password = ?').bind(staffName, oldPass).first();
        if (!user) return errorResponse('原密码错误', 400);
        await env.DB.prepare('UPDATE Staff SET password = ? WHERE name = ?').bind(newPass, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ================== 基础配置管理 ==================
      if (url.pathname === '/api/projects') {
        if (request.method === 'GET') {
          const results = await env.DB.prepare('SELECT * FROM Projects ORDER BY id DESC').all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } else if (request.method === 'POST') {
          if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
          const { name, year, start_date, end_date } = await request.json();
          await env.DB.prepare('INSERT INTO Projects (name, year, start_date, end_date) VALUES (?, ?, ?, ?)').bind(name, year, start_date, end_date).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
      }

      if (url.pathname === '/api/update-project' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { id, name, year, start_date, end_date } = await request.json();
        await env.DB.prepare('UPDATE Projects SET name = ?, year = ?, start_date = ?, end_date = ? WHERE id = ?').bind(name, year, start_date, end_date, id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/staff') {
        if (request.method === 'GET') {
          const urlObj = new URL(request.url);
          const projectId = urlObj.searchParams.get('projectId');
          const results = await env.DB.prepare('SELECT name, role, target FROM Staff ORDER BY role ASC').all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } else if (request.method === 'POST') {
          if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
          const { name, role } = await request.json();
          try {
            await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, '123456', ?)").bind(name, role).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
          } catch (e) {
            return errorResponse('添加失败，可能姓名已存在');
          }
        }
      }

      if (url.pathname === '/api/delete-staff' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { staffName } = await request.json();
        if (staffName === 'admin') return errorResponse('不能删除超级管理员', 400);
        await env.DB.prepare('DELETE FROM Staff WHERE name = ?').bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { staffName, role } = await request.json();
        if (staffName === 'admin') return errorResponse('不能修改超级管理员角色', 400);
        await env.DB.prepare('UPDATE Staff SET role = ? WHERE name = ?').bind(role, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/set-target' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { staffName, target } = await request.json();
        await env.DB.prepare('UPDATE Staff SET target = ? WHERE name = ?').bind(target, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ================== 业务数据字典 ==================
      if (url.pathname === '/api/accounts') {
        if (request.method === 'GET') {
          const pid = new URL(request.url).searchParams.get('projectId');
          const results = await env.DB.prepare('SELECT * FROM Accounts WHERE project_id = ?').bind(pid).all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
      }
      if (url.pathname === '/api/add-account' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { project_id, account_name, bank_name, account_no } = await request.json();
        await env.DB.prepare('INSERT INTO Accounts (project_id, account_name, bank_name, account_no) VALUES (?, ?, ?, ?)').bind(project_id, account_name, bank_name, account_no).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-account' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { account_id } = await request.json();
        await env.DB.prepare('DELETE FROM Accounts WHERE id = ?').bind(account_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/industries') {
        if (request.method === 'GET') {
          const pid = new URL(request.url).searchParams.get('projectId');
          const results = await env.DB.prepare('SELECT * FROM Industries WHERE project_id = ?').bind(pid).all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
      }
      if (url.pathname === '/api/add-industry' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { project_id, industry_name } = await request.json();
        await env.DB.prepare('INSERT INTO Industries (project_id, industry_name) VALUES (?, ?)').bind(project_id, industry_name).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-industry' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { industry_id } = await request.json();
        await env.DB.prepare('DELETE FROM Industries WHERE id = ?').bind(industry_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ================== 展位库核心 ==================
      if (url.pathname === '/api/prices') {
        if (request.method === 'GET') {
          const pid = new URL(request.url).searchParams.get('projectId');
          const results = await env.DB.prepare('SELECT booth_type, price FROM Prices WHERE project_id = ?').bind(pid).all();
          const priceMap = {};
          results.results.forEach(r => priceMap[r.booth_type] = r.price);
          return new Response(JSON.stringify(priceMap), { headers: corsHeaders });
        } else if (request.method === 'POST') {
          if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
          const { projectId, prices } = await request.json();
          await env.DB.prepare('DELETE FROM Prices WHERE project_id = ?').bind(projectId).run();
          const stmts = Object.keys(prices).map(type => env.DB.prepare('INSERT INTO Prices (project_id, booth_type, price) VALUES (?, ?, ?)').bind(projectId, type, prices[type]));
          await env.DB.batch(stmts);
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
      }

      if (url.pathname === '/api/booths') {
        if (request.method === 'GET') {
          const pid = new URL(request.url).searchParams.get('projectId');
          // 关联查询展位的实际订单成交金额，利用 GROUP BY 处理联合参展
          const query = `
            SELECT b.*, SUM(o.total_booth_fee) as total_booth_fee 
            FROM Booths b 
            LEFT JOIN Orders o ON b.id = o.booth_id AND b.project_id = o.project_id AND o.status != '已作废'
            WHERE b.project_id = ? 
            GROUP BY b.id
          `;
          const results = await env.DB.prepare(query).bind(pid).all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
      }

      if (url.pathname === '/api/add-booth' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { project_id, id, hall, type, area, price_unit, base_price } = await request.json();
        try {
          await env.DB.prepare('INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(id, project_id, hall, type, area, price_unit, base_price || 0, '可售').run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
          return errorResponse('添加失败，展位号可能已存在');
        }
      }

      if (url.pathname === '/api/edit-booth' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { project_id, id, type, area, base_price } = await request.json();
        await env.DB.prepare('UPDATE Booths SET type=?, area=?, base_price=?, price_unit=? WHERE id=? AND project_id=?')
              .bind(type, area, base_price, type==='光地'?'平米':'个', id, project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-booth-status' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { projectId, boothIds, status } = await request.json();
        const placeholders = boothIds.map(() => '?').join(',');
        const query = `UPDATE Booths SET status = ? WHERE project_id = ? AND id IN (${placeholders})`;
        await env.DB.prepare(query).bind(status, projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/delete-booths' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { projectId, boothIds } = await request.json();
        const placeholders = boothIds.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM Booths WHERE project_id = ? AND id IN (${placeholders})`).bind(projectId, ...boothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/import-booths' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { projectId, booths } = await request.json();
        const stmts = booths.map(b => 
          env.DB.prepare('INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id, project_id) DO UPDATE SET hall=excluded.hall, type=excluded.type, area=excluded.area')
          .bind(b.id, projectId, b.hall, b.type, b.area, b.price_unit, 0, '可售')
        );
        await env.DB.batch(stmts);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ================== 订单生命周期核心 ==================
      if (url.pathname === '/api/orders' && request.method === 'GET') {
        const urlObj = new URL(request.url);
        const pid = urlObj.searchParams.get('projectId');
        const role = urlObj.searchParams.get('role');
        const sName = urlObj.searchParams.get('salesName');
        
        let query = `
          SELECT o.*, b.hall, b.type as booth_type 
          FROM Orders o 
          LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id 
          WHERE o.project_id = ? AND o.status != '已作废'
        `;
        let params = [pid];
        if (role !== 'admin') { query += ` AND o.sales_name = ?`; params.push(sName); }
        query += ` ORDER BY o.created_at DESC`;
        const results = await env.DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results.results), { headers: corsHeaders });
      }

      if (url.pathname === '/api/submit-order' && request.method === 'POST') {
        const o = await request.json();
        const stmtOrder = env.DB.prepare(`
          INSERT INTO Orders (
            project_id, company_name, credit_code, no_code_checked, category, main_business,
            is_agent, agent_name, contact_person, phone, region, booth_id, area, price_unit, unit_price,
            total_booth_fee, discount_reason, other_income, fees_json, profile, total_amount, paid_amount,
            contract_url, sales_name, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).bind(
          o.project_id, o.company_name, o.credit_code, o.no_code_checked ? 1 : 0, o.category, o.main_business,
          o.is_agent ? 1 : 0, o.agent_name, o.contact_person, o.phone, o.region, o.booth_id, o.area, o.price_unit, o.unit_price,
          o.total_booth_fee, o.discount_reason, o.other_income, o.fees_json, o.profile, o.total_amount, 0,
          o.contract_url || null, o.sales_name, '正常'
        );

        // 【安全修复 3】：展位状态精确更新，避免覆盖“已成交”状态
        const stmtUpdateBooth = env.DB.prepare(
          "UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ? AND status NOT IN ('已预订', '已成交')"
        ).bind(o.booth_id, o.project_id);

        await env.DB.batch([stmtOrder, stmtUpdateBooth]);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-customer-info' && request.method === 'POST') {
        const d = await request.json();
        let query = `UPDATE Orders SET contact_person = ?, phone = ?, region = ?, main_business = ?, profile = ?, is_agent = ?, agent_name = ?, category = ?`;
        let params = [d.contact_person, d.phone, d.region, d.main_business, d.profile, d.is_agent ? 1 : 0, d.agent_name, d.category];
        
        // 动态支持合同上传
        if (d.contract_url !== undefined) {
            query += `, contract_url = ?`;
            params.push(d.contract_url);
        }
        query += ` WHERE id = ? AND project_id = ?`;
        params.push(d.order_id, d.project_id);
        
        await env.DB.prepare(query).bind(...params).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/cancel-order' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足：仅管理员可作废订单', 403);
        const { order_id, project_id, booth_id } = await request.json();
        
        // 1. 作废订单本身
        await env.DB.prepare("UPDATE Orders SET status = '已作废' WHERE id = ?").bind(order_id).run();
        
        // 【安全修复 4】：防误伤退单 - 检查展位上是否还有联合参展的“正常”订单
        const remaining = await env.DB.prepare("SELECT COUNT(*) as cnt FROM Orders WHERE project_id = ? AND booth_id = ? AND status = '正常'").bind(project_id, booth_id).first();
        
        // 2. 若完全没订单了，将展位释放为“可售”
        if (remaining.cnt === 0) {
            await env.DB.prepare("UPDATE Booths SET status = '可售' WHERE id = ? AND project_id = ?").bind(booth_id, project_id).run();
        }
        // 注意：基于财务严谨性，作废订单的 paid_amount、Payments 流水保留归档，财务对账时按“已作废”过滤处理即可。
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ================== 财务与收付款流 ==================
      if (url.pathname === '/api/payments' && request.method === 'GET') {
        const orderId = new URL(request.url).searchParams.get('orderId');
        const results = await env.DB.prepare('SELECT * FROM Payments WHERE order_id = ? ORDER BY payment_time DESC').bind(orderId).all();
        return new Response(JSON.stringify(results.results), { headers: corsHeaders });
      }

      if (url.pathname === '/api/add-payment' && request.method === 'POST') {
        const p = await request.json();
        const stmtPayment = env.DB.prepare('INSERT INTO Payments (project_id, order_id, amount, payment_time, payer_name, bank_name, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(p.project_id, p.order_id, p.amount, p.payment_time, p.payer_name, p.bank_name, p.remarks);
        const stmtUpdatePaid = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?').bind(p.amount, p.order_id);
        await env.DB.batch([stmtPayment, stmtUpdatePaid]);
        
        // 更新展位状态判定
        const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(p.order_id).first();
        if (order && order.paid_amount >= order.total_amount) {
            await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, p.project_id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/delete-payment' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { order_id, payment_id } = await request.json();
        const payment = await env.DB.prepare('SELECT amount FROM Payments WHERE id = ?').bind(payment_id).first();
        if (!payment) return errorResponse('支付记录不存在', 404);
        const stmtDel = env.DB.prepare('DELETE FROM Payments WHERE id = ?').bind(payment_id);
        const stmtUpdatePaid = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount - ? WHERE id = ?').bind(payment.amount, order_id);
        await env.DB.batch([stmtDel, stmtUpdatePaid]);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/edit-payment' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const p = await request.json();
        const oldPayment = await env.DB.prepare('SELECT amount FROM Payments WHERE id = ?').bind(p.payment_id).first();
        const diff = p.amount - oldPayment.amount;
        const stmtUpdatePayment = env.DB.prepare('UPDATE Payments SET amount=?, payment_time=?, payer_name=?, bank_name=?, remarks=? WHERE id=?')
            .bind(p.amount, p.payment_time, p.payer_name, p.bank_name, p.remarks, p.payment_id);
        const stmtUpdateOrder = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?').bind(diff, p.order_id);
        await env.DB.batch([stmtUpdatePayment, stmtUpdateOrder]);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-order-fees' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const d = await request.json();
        const total = d.actual_fee + d.other_fee_total;
        await env.DB.prepare('UPDATE Orders SET total_booth_fee=?, other_income=?, fees_json=?, discount_reason=?, total_amount=? WHERE id=? AND project_id=?')
            .bind(d.actual_fee, d.other_fee_total, d.fees_json, d.reason, total, d.order_id, d.project_id).run();
        
        const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(d.order_id).first();
        if (order && order.paid_amount >= order.total_amount) {
            await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, d.project_id).run();
        } else {
            await env.DB.prepare("UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ? AND status = '已成交'").bind(order.booth_id, d.project_id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/expenses' && request.method === 'GET') {
        const orderId = new URL(request.url).searchParams.get('orderId');
        const results = await env.DB.prepare('SELECT * FROM Expenses WHERE order_id = ? ORDER BY created_at DESC').bind(orderId).all();
        return new Response(JSON.stringify(results.results), { headers: corsHeaders });
      }

      if (url.pathname === '/api/add-expense' && request.method === 'POST') {
        const ex = await request.json();
        await env.DB.prepare(`
          INSERT INTO Expenses (project_id, order_id, payee_name, payee_channel, payee_bank, payee_account, amount, applicant, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).bind(ex.project_id, ex.order_id, ex.payee_name, ex.payee_channel, ex.payee_bank, ex.payee_account, ex.amount, ex.applicant, ex.reason).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/delete-expense' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足：仅管理员可撤销单据', 403);
        const { expense_id } = await request.json();
        await env.DB.prepare('DELETE FROM Expenses WHERE id = ?').bind(expense_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 未匹配路由
      return errorResponse('接口不存在', 404);

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
