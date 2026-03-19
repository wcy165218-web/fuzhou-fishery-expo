const JWT_SECRET_STR = 'your-256-bit-secret-fuzhou-expo'; 

const base64UrlEncode = (source) => {
    let encoded = btoa(String.fromCharCode(...new Uint8Array(source)));
    return encoded.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const base64UrlDecode = (str) => {
    let encoded = str.replace(/-/g, '+').replace(/_/g, '/');
    while (encoded.length % 4) encoded += '=';
    return new Uint8Array(atob(encoded).split('').map(c => c.charCodeAt(0)));
};
const strToUint8 = (str) => new TextEncoder().encode(str);

async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signJWT(payload, secretStr) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encHeader = base64UrlEncode(strToUint8(JSON.stringify(header)));
    const encPayload = base64UrlEncode(strToUint8(JSON.stringify(payload)));
    const data = `${encHeader}.${encPayload}`;
    const key = await crypto.subtle.importKey('raw', strToUint8(secretStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, strToUint8(data));
    return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyJWT(token, secretStr) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey('raw', strToUint8(secretStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const isValid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(parts[2]), strToUint8(data));
    if (!isValid) throw new Error('Invalid signature');
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
}

function errorResponse(msg, status = 400) {
    return new Response(JSON.stringify({ success: false, error: msg }), {
        status: status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(request);
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    let currentUser = null;

    if (url.pathname !== '/api/login') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return errorResponse('未登录或登录已过期', 401);
      }
      const token = authHeader.split(' ')[1];
      try {
        currentUser = await verifyJWT(token, JWT_SECRET_STR);
      } catch (err) {
        return errorResponse('登录状态已失效，请重新登录', 401);
      }
    }

    try {
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
        // 【权限放宽】：允许所有人预览已上传的文件，取消 admin 强制限制
        const key = url.pathname.replace('/api/file/', '');
        const object = await env.BUCKET.get(key);
        if (!object) return errorResponse('文件不存在', 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(object.body, { headers });
      }

      if (url.pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const hashedPassword = await hashPassword(password);
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ? AND password = ?').bind(username, hashedPassword).first();
        if (!user) return errorResponse('账号或密码错误', 401);
        const exp = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
        const token = await signJWT({ name: user.name, role: user.role, exp }, JWT_SECRET_STR);
        return new Response(JSON.stringify({ user: { name: user.name, role: user.role, token } }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        const hashedOld = await hashPassword(oldPass);
        const hashedNew = await hashPassword(newPass);
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ? AND password = ?').bind(staffName, hashedOld).first();
        if (!user) return errorResponse('原密码错误', 400);
        await env.DB.prepare('UPDATE Staff SET password = ? WHERE name = ?').bind(hashedNew, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

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
          const results = await env.DB.prepare('SELECT name, role, target FROM Staff ORDER BY role ASC').all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } else if (request.method === 'POST') {
          if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
          const { name, role } = await request.json();
          try {
            const defaultHash = await hashPassword('123456');
            await env.DB.prepare("INSERT INTO Staff (name, password, role) VALUES (?, ?, ?)").bind(name, defaultHash, role).run();
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
          const query = `
            SELECT b.*, SUM(o.total_booth_fee) as total_booth_fee 
            FROM Booths b 
            LEFT JOIN Orders o ON b.id = o.booth_id AND b.project_id = o.project_id AND o.status NOT IN ('已退订', '已作废')
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

      if (url.pathname === '/api/orders' && request.method === 'GET') {
        const urlObj = new URL(request.url);
        const pid = urlObj.searchParams.get('projectId');
        const role = urlObj.searchParams.get('role');
        const sName = urlObj.searchParams.get('salesName');
        
        let query = `
          SELECT o.*, b.hall, b.type as booth_type 
          FROM Orders o 
          LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id 
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
        `;
        let params = [pid];
        if (role !== 'admin') { query += ` AND o.sales_name = ?`; params.push(sName); }
        query += ` ORDER BY o.created_at DESC`;
        const results = await env.DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results.results), { headers: corsHeaders });
      }

      if (url.pathname === '/api/submit-order' && request.method === 'POST') {
        const o = await request.json();
        const stmts = [];

        const existingOrder = await env.DB.prepare("SELECT id FROM Orders WHERE project_id = ? AND booth_id = ? AND status = '正常' ORDER BY created_at ASC LIMIT 1").bind(o.project_id, o.booth_id).first();
        if (existingOrder) {
            stmts.push(env.DB.prepare("UPDATE Orders SET area = ROUND(area - ?, 2) WHERE id = ?").bind(o.area, existingOrder.id));
        }

        stmts.push(env.DB.prepare(`
          INSERT INTO Orders (
            project_id, company_name, credit_code, no_code_checked, category, main_business,
            is_agent, agent_name, contact_person, phone, region, booth_id, area, price_unit, unit_price,
            total_booth_fee, discount_reason, other_income, fees_json, profile, total_amount, paid_amount,
            contract_url, sales_name, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
        `).bind(
          o.project_id, o.company_name, o.credit_code, o.no_code_checked ? 1 : 0, o.category, o.main_business,
          o.is_agent ? 1 : 0, o.agent_name, o.contact_person, o.phone, o.region, o.booth_id, o.area, o.price_unit, o.unit_price,
          o.total_booth_fee, o.discount_reason, o.other_income, o.fees_json, o.profile, o.total_amount, 0,
          o.contract_url || null, o.sales_name, '正常'
        ));

        stmts.push(env.DB.prepare(
          "UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ? AND status NOT IN ('已预订', '已成交')"
        ).bind(o.booth_id, o.project_id));

        await env.DB.batch(stmts);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-customer-info' && request.method === 'POST') {
        const d = await request.json();
        let query = `UPDATE Orders SET contact_person = ?, phone = ?, region = ?, main_business = ?, profile = ?, is_agent = ?, agent_name = ?, category = ?`;
        let params = [d.contact_person, d.phone, d.region, d.main_business, d.profile, d.is_agent ? 1 : 0, d.agent_name, d.category];
        
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
        if (currentUser.role !== 'admin') return errorResponse('权限不足：仅管理员可退订订单', 403);
        const { order_id, project_id, booth_id } = await request.json();
        
        await env.DB.prepare("UPDATE Orders SET status = '已退订' WHERE id = ?").bind(order_id).run();
        
        const remaining = await env.DB.prepare("SELECT COUNT(*) as cnt FROM Orders WHERE project_id = ? AND booth_id = ? AND status = '正常'").bind(project_id, booth_id).first();
        if (remaining.cnt === 0) {
            await env.DB.prepare("UPDATE Booths SET status = '可售' WHERE id = ? AND project_id = ?").bind(booth_id, project_id).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 【核心防崩拦截】：财务流水接口全加上 try catch，向前端抛出真实数据库死因
      if (url.pathname === '/api/payments' && request.method === 'GET') {
        try {
            const orderId = new URL(request.url).searchParams.get('orderId');
            const results = await env.DB.prepare('SELECT * FROM Payments WHERE order_id = ? ORDER BY payment_time DESC').bind(orderId).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } catch (e) {
            return errorResponse('查询流水异常: ' + e.message, 500);
        }
      }

      if (url.pathname === '/api/add-payment' && request.method === 'POST') {
        try {
            const p = await request.json();
            const stmtPayment = env.DB.prepare('INSERT INTO Payments (project_id, order_id, amount, payment_time, payer_name, bank_name, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(Number(p.project_id), Number(p.order_id), Number(p.amount), String(p.payment_time), String(p.payer_name), String(p.bank_name), String(p.remarks || ''));
            const stmtUpdatePaid = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?').bind(Number(p.amount), Number(p.order_id));
            await env.DB.batch([stmtPayment, stmtUpdatePaid]);
            
            const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(Number(p.order_id)).first();
            if (order && order.paid_amount >= order.total_amount) {
                await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, Number(p.project_id)).run();
            }
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            return errorResponse('流水写入失败: 请检查表结构是否正确 - ' + e.message, 500);
        }
      }

      if (url.pathname === '/api/delete-payment' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        try {
            const { order_id, payment_id } = await request.json();
            const payment = await env.DB.prepare('SELECT amount FROM Payments WHERE id = ?').bind(payment_id).first();
            if (!payment) return errorResponse('支付记录不存在', 404);
            const stmtDel = env.DB.prepare('DELETE FROM Payments WHERE id = ?').bind(payment_id);
            const stmtUpdatePaid = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount - ? WHERE id = ?').bind(payment.amount, order_id);
            await env.DB.batch([stmtDel, stmtUpdatePaid]);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) { return errorResponse('删除失败: ' + e.message, 500); }
      }

      if (url.pathname === '/api/edit-payment' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        try {
            const p = await request.json();
            const oldPayment = await env.DB.prepare('SELECT amount FROM Payments WHERE id = ?').bind(p.payment_id).first();
            const diff = p.amount - oldPayment.amount;
            const stmtUpdatePayment = env.DB.prepare('UPDATE Payments SET amount=?, payment_time=?, payer_name=?, bank_name=?, remarks=? WHERE id=?')
                .bind(p.amount, p.payment_time, p.payer_name, p.bank_name, p.remarks, p.payment_id);
            const stmtUpdateOrder = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?').bind(diff, p.order_id);
            await env.DB.batch([stmtUpdatePayment, stmtUpdateOrder]);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) { return errorResponse('修改失败: ' + e.message, 500); }
      }

      if (url.pathname === '/api/update-order-fees' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        try {
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
        } catch (e) { return errorResponse('账单变更失败: ' + e.message, 500); }
      }

      if (url.pathname === '/api/expenses' && request.method === 'GET') {
        try {
            const orderId = new URL(request.url).searchParams.get('orderId');
            const results = await env.DB.prepare('SELECT * FROM Expenses WHERE order_id = ? ORDER BY created_at DESC').bind(orderId).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } catch (e) { return errorResponse('查询异常: ' + e.message, 500); }
      }

      if (url.pathname === '/api/add-expense' && request.method === 'POST') {
        try {
            const ex = await request.json();
            await env.DB.prepare(`
              INSERT INTO Expenses (project_id, order_id, payee_name, payee_channel, payee_bank, payee_account, amount, applicant, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
            `).bind(ex.project_id, ex.order_id, ex.payee_name, ex.payee_channel, ex.payee_bank, ex.payee_account, ex.amount, ex.applicant, ex.reason).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) { return errorResponse('支出申请写入失败: ' + e.message, 500); }
      }

      if (url.pathname === '/api/delete-expense' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足：仅管理员可撤销单据', 403);
        try {
            const { expense_id } = await request.json();
            await env.DB.prepare('DELETE FROM Expenses WHERE id = ?').bind(expense_id).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) { return errorResponse('撤销失败: ' + e.message, 500); }
      }

      return errorResponse('接口不存在', 404);

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
