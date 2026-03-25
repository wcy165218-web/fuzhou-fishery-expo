import { buildErpRequestUrl, extractErpRows, buildErpSyncPlan } from './erp-sync-core.mjs';

const BOOTH_UNIT_AREA = 9;
const MANUAL_BOOTH_STATUSES = new Set(['可售', '已锁定']);
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;

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

function errorResponse(msg, status = 400, extraHeaders = {}) {
    return new Response(JSON.stringify({ success: false, error: msg }), {
        status: status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
    });
}

function getJwtSecret(env) {
    const secret = String(env.JWT_SECRET || '').trim();
    if (!secret) throw new Error('JWT_SECRET_MISSING');
    return secret;
}

function buildCorsHeaders(request, url, env) {
    const requestOrigin = request.headers.get('Origin');
    const configuredOrigins = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const allowedOrigins = Array.from(new Set([url.origin, ...configuredOrigins]));
    const allowOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
        ? requestOrigin
        : allowedOrigins[0] || url.origin;

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Vary': 'Origin'
    };
}

function internalErrorResponse(corsHeaders) {
    return errorResponse('系统内部错误，请稍后重试', 500, corsHeaders);
}

async function canManageOrder(env, currentUser, orderId) {
    if (currentUser.role === 'admin') return true;
    const order = await env.DB.prepare('SELECT sales_name FROM Orders WHERE id = ?').bind(orderId).first();
    return !!order && order.sales_name === currentUser.name;
}

function isSuperAdmin(user) {
    return !!user && user.role === 'admin' && user.name === 'admin';
}

function requireSuperAdmin(currentUser, corsHeaders) {
    if (!isSuperAdmin(currentUser)) {
        return errorResponse('仅超级管理员可操作', 403, corsHeaders);
    }
    return null;
}

function formatChinaDateTime(date = new Date()) {
    const chinaDate = new Date(date.getTime() + (8 * 60 * 60 * 1000));
    const year = chinaDate.getUTCFullYear();
    const month = String(chinaDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(chinaDate.getUTCDate()).padStart(2, '0');
    const hour = String(chinaDate.getUTCHours()).padStart(2, '0');
    const minute = String(chinaDate.getUTCMinutes()).padStart(2, '0');
    const second = String(chinaDate.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function parseChinaDateTime(value) {
    if (!value) return null;
    return Date.parse(String(value).replace(' ', 'T') + '+08:00');
}

function getLoginAttemptContext(request, username) {
    const forwarded = request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')
        || '';
    const ipAddress = String(forwarded).split(',')[0].trim() || 'unknown';
    const normalizedUser = String(username || '').trim().toLowerCase();
    return {
        username: normalizedUser,
        ipAddress,
        key: `${normalizedUser}::${ipAddress}`
    };
}

async function ensureLoginAttemptsTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS LoginAttempts (
            attempt_key TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            failed_count INTEGER NOT NULL DEFAULT 0,
            last_failed_at TEXT,
            locked_until TEXT
        )
    `).run();
}

async function getLoginAttempt(env, attemptKey) {
    return env.DB.prepare('SELECT * FROM LoginAttempts WHERE attempt_key = ?').bind(attemptKey).first();
}

async function clearLoginAttempt(env, attemptKey) {
    await env.DB.prepare('DELETE FROM LoginAttempts WHERE attempt_key = ?').bind(attemptKey).run();
}

async function recordLoginFailure(env, context) {
    const existing = await getLoginAttempt(env, context.key);
    const nextCount = Number(existing?.failed_count || 0) + 1;
    const lockedUntil = nextCount >= LOGIN_MAX_FAILURES
        ? formatChinaDateTime(new Date(Date.now() + (LOGIN_LOCK_MINUTES * 60 * 1000)))
        : null;
    const nowText = formatChinaDateTime();

    await env.DB.prepare(`
        INSERT INTO LoginAttempts (attempt_key, username, ip_address, failed_count, last_failed_at, locked_until)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_key) DO UPDATE SET
            failed_count = excluded.failed_count,
            last_failed_at = excluded.last_failed_at,
            locked_until = excluded.locked_until
    `).bind(context.key, context.username, context.ipAddress, nextCount, nowText, lockedUntil).run();

    return {
        failedCount: nextCount,
        lockedUntil
    };
}

function toSafeNumber(value) {
    return Number(value || 0);
}

function toBoothCount(area) {
    return Number((toSafeNumber(area) / BOOTH_UNIT_AREA).toFixed(2));
}

function normalizeBoothIds(rawBoothIds) {
    if (!Array.isArray(rawBoothIds) || rawBoothIds.length === 0) {
        throw new Error('请先选择要操作的展位');
    }
    if (rawBoothIds.length > 200) {
        throw new Error('单次最多处理 200 个展位');
    }
    return rawBoothIds
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function formatProvinceLabel(rawProvince) {
    const province = String(rawProvince || '')
        .replace(/省$/, '')
        .replace(/市$/, '')
        .replace(/壮族自治区|回族自治区|维吾尔自治区|自治区/g, '')
        .replace(/特别行政区/g, '')
        .trim();
    if (!province) return '未注明地区';
    if (['北京', '上海', '天津', '重庆'].includes(province)) return `${province}市`;
    if (province === '内蒙古') return '内蒙古自治区';
    if (province === '广西') return '广西壮族自治区';
    if (province === '宁夏') return '宁夏回族自治区';
    if (province === '新疆') return '新疆维吾尔自治区';
    if (province === '西藏') return '西藏自治区';
    if (province === '香港') return '香港特别行政区';
    if (province === '澳门') return '澳门特别行政区';
    if (province === '台湾') return '台湾地区';
    return `${province}省`;
}

function parseRegionInfo(regionText) {
    const parts = String(regionText || '')
        .split(' - ')
        .map((part) => part.trim())
        .filter(Boolean);
    const first = parts[0] || '未注明地区';

    if (first === '国际') {
        const country = parts[1] || '其他国际地区';
        return {
            scope: 'international',
            detailLabel: country,
            pieLabel: country
        };
    }

    if (['香港', '澳门', '台湾'].includes(first)) {
        return {
            scope: 'international',
            detailLabel: formatProvinceLabel(first),
            pieLabel: formatProvinceLabel(first)
        };
    }

    const normalizedProvince = first.replace(/省$/, '').replace(/市$/, '');
    if (normalizedProvince === '福建') {
        const cityRaw = (parts[1] || '福建省其他地区').replace(/市$/, '');
        const district = parts[2] || '';
        return {
            scope: 'inside_fujian',
            detailLabel: cityRaw === '福州' ? `福州市${district ? ` - ${district}` : ''}` : `${cityRaw}市`,
            pieLabel: '福建省'
        };
    }

    return {
        scope: 'outside_fujian',
        detailLabel: formatProvinceLabel(first),
        pieLabel: formatProvinceLabel(first)
    };
}

function getChinaTimestamp() {
    return new Date(Date.now() + (8 * 60 * 60 * 1000)).toISOString().replace('T', ' ').slice(0, 19);
}

async function getErpConfig(env, projectId) {
    return await env.DB.prepare(`
        SELECT
            project_id,
            enabled,
            endpoint_url,
            water_id,
            session_cookie,
            expected_project_name,
            use_mock,
            mock_payload,
            last_sync_at,
            last_sync_summary
        FROM ProjectErpConfigs
        WHERE project_id = ?
    `).bind(projectId).first();
}

async function fetchErpPayload(config) {
    if (Number(config?.use_mock) === 1) {
        return JSON.parse(config.mock_payload || '{"rows": []}');
    }

    const sessionCookie = String(config?.session_cookie || '').trim();
    if (!sessionCookie) throw new Error('未配置 ERP 登录 Cookie / JSESSIONID');

    const erpUrl = buildErpRequestUrl(config);
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': sessionCookie.includes('JSESSIONID=') ? sessionCookie : `JSESSIONID=${sessionCookie}`
    };
    const pageSize = 100;
    const allRows = [];
    let total = 0;

    for (let page = 1; page <= 50; page += 1) {
        const response = await fetch(erpUrl, {
            method: 'POST',
            headers,
            body: new URLSearchParams({
                page: String(page),
                rows: String(pageSize)
            }).toString()
        });

        if (!response.ok) {
            throw new Error(`ERP 接口请求失败（HTTP ${response.status}）`);
        }

        const payload = await response.json();
        const rows = extractErpRows(payload);
        total = Number(payload?.total || rows.length || 0);
        allRows.push(...rows);

        if (rows.length === 0 || allRows.length >= total || rows.length < pageSize) {
            break;
        }
    }

    return {
        total: total || allRows.length,
        rows: allRows
    };
}

async function buildErpPreviewResult(env, projectId, config) {
    const payload = await fetchErpPayload(config);
    const rows = extractErpRows(payload);
    const orderRows = (await env.DB.prepare(`
        SELECT id, project_id, company_name, total_amount, paid_amount
        FROM Orders
        WHERE project_id = ? AND status NOT IN ('已退订', '已作废')
    `).bind(projectId).all()).results || [];
    const existingRows = (await env.DB.prepare(`
        SELECT erp_record_id
        FROM Payments
        WHERE project_id = ? AND erp_record_id IS NOT NULL AND erp_record_id != ''
    `).bind(projectId).all()).results || [];

    return buildErpSyncPlan({
        rows,
        orders: orderRows,
        existingErpIds: existingRows.map((row) => row.erp_record_id),
        expectedProjectName: config.expected_project_name || ''
    });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(request);
    }

    const corsHeaders = buildCorsHeaders(request, url, env);

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    let currentUser = null;
    let jwtSecret = '';

    try {
      jwtSecret = getJwtSecret(env);
    } catch (err) {
      console.error('JWT secret missing:', err);
      return errorResponse('系统未完成安全配置，请联系管理员', 500, corsHeaders);
    }

    if (url.pathname !== '/api/login') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return errorResponse('未登录或登录已过期', 401, corsHeaders);
      }
      const token = authHeader.split(' ')[1];
      try {
        currentUser = await verifyJWT(token, jwtSecret);
      } catch (err) {
        return errorResponse('登录状态已失效，请重新登录', 401, corsHeaders);
      }
    }

    try {
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) return errorResponse('没有找到文件', 400, corsHeaders);
        const fileExt = file.name.split('.').pop();
        const fileKey = `contract_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        await env.BUCKET.put(fileKey, file.stream());
        return new Response(JSON.stringify({ success: true, fileKey }), { headers: corsHeaders });
      }

      if (url.pathname.startsWith('/api/file/')) {
        const key = url.pathname.replace('/api/file/', '');
        const orderId = url.searchParams.get('orderId');
        if (!orderId) return errorResponse('缺少订单信息', 400, corsHeaders);
        const order = await env.DB.prepare('SELECT sales_name, contract_url FROM Orders WHERE id = ?').bind(orderId).first();
        if (!order || order.contract_url !== key) return errorResponse('文件不存在', 404, corsHeaders);
        if (currentUser.role !== 'admin' && order.sales_name !== currentUser.name) {
          return errorResponse('无合同预览权限', 403, corsHeaders);
        }
        const object = await env.BUCKET.get(key);
        if (!object) return errorResponse('文件不存在', 404, corsHeaders);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']);
        headers.set('Vary', 'Origin');
        return new Response(object.body, { headers });
      }

      if (url.pathname === '/api/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        const loginContext = getLoginAttemptContext(request, username);
        await ensureLoginAttemptsTable(env);
        const loginAttempt = await getLoginAttempt(env, loginContext.key);
        const lockedUntilMs = parseChinaDateTime(loginAttempt?.locked_until);
        if (lockedUntilMs && lockedUntilMs > Date.now()) {
          return errorResponse(`登录失败次数过多，请于 ${loginAttempt.locked_until} 后重试`, 429, corsHeaders);
        }
        const hashedPassword = await hashPassword(password);
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ? AND password = ?').bind(username, hashedPassword).first();
        if (!user) {
          const failure = await recordLoginFailure(env, loginContext);
          if (failure.lockedUntil) {
            return errorResponse(`连续输错 ${LOGIN_MAX_FAILURES} 次，账号已临时锁定至 ${failure.lockedUntil}`, 429, corsHeaders);
          }
          return errorResponse(`账号或密码错误，已连续失败 ${failure.failedCount} 次`, 401, corsHeaders);
        }
        await clearLoginAttempt(env, loginContext.key);
        const exp = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
        const token = await signJWT({ name: user.name, role: user.role, exp }, jwtSecret);
        return new Response(JSON.stringify({ user: { name: user.name, role: user.role, token } }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        const hashedOld = await hashPassword(oldPass);
        const hashedNew = await hashPassword(newPass);
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ? AND password = ?').bind(staffName, hashedOld).first();
        if (!user) return errorResponse('原密码错误', 400, corsHeaders);
        await env.DB.prepare('UPDATE Staff SET password = ? WHERE name = ?').bind(hashedNew, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/projects') {
        if (request.method === 'GET') {
          const results = await env.DB.prepare('SELECT * FROM Projects ORDER BY id DESC').all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } else if (request.method === 'POST') {
          const denied = requireSuperAdmin(currentUser, corsHeaders);
          if (denied) return denied;
          const { name, year, start_date, end_date } = await request.json();
          await env.DB.prepare('INSERT INTO Projects (name, year, start_date, end_date) VALUES (?, ?, ?, ?)').bind(name, year, start_date, end_date).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
      }

      if (url.pathname === '/api/update-project' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { id, name, year, start_date, end_date } = await request.json();
        await env.DB.prepare('UPDATE Projects SET name = ?, year = ?, start_date = ?, end_date = ? WHERE id = ?').bind(name, year, start_date, end_date, id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/staff') {
        if (request.method === 'GET') {
          const results = await env.DB.prepare('SELECT name, role, target FROM Staff ORDER BY role ASC').all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } else if (request.method === 'POST') {
          const denied = requireSuperAdmin(currentUser, corsHeaders);
          if (denied) return denied;
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
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { staffName } = await request.json();
        if (staffName === 'admin') return errorResponse('不能删除超级管理员', 400);
        await env.DB.prepare('DELETE FROM Staff WHERE name = ?').bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { staffName, role } = await request.json();
        if (staffName === 'admin') return errorResponse('不能修改超级管理员角色', 400);
        await env.DB.prepare('UPDATE Staff SET role = ? WHERE name = ?').bind(role, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/set-target' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { staffName, target } = await request.json();
        await env.DB.prepare('UPDATE Staff SET target = ? WHERE name = ?').bind(target, staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 【新增】：重置密码接口
      if (url.pathname === '/api/reset-password' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { staffName } = await request.json();
        if (staffName === 'admin') return errorResponse('不能重置超级管理员的密码', 400);
        const defaultHash = await hashPassword('123456');
        await env.DB.prepare('UPDATE Staff SET password = ? WHERE name = ?').bind(defaultHash, staffName).run();
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
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id, account_name, bank_name, account_no } = await request.json();
        await env.DB.prepare('INSERT INTO Accounts (project_id, account_name, bank_name, account_no) VALUES (?, ?, ?, ?)').bind(project_id, account_name, bank_name, account_no).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-account' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { account_id } = await request.json();
        await env.DB.prepare('DELETE FROM Accounts WHERE id = ?').bind(account_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/erp-config' && request.method === 'GET') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const pid = new URL(request.url).searchParams.get('projectId');
        if (!pid) return errorResponse('缺少项目 ID', 400);
        const config = await getErpConfig(env, pid);
        return new Response(JSON.stringify(config || {
          project_id: Number(pid),
          enabled: 0,
          endpoint_url: '',
          water_id: '',
          session_cookie: '',
          expected_project_name: '',
          last_sync_at: '',
          last_sync_summary: ''
        }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/save-erp-config' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await request.json();
        if (!payload.project_id) return errorResponse('缺少项目 ID', 400);

        await env.DB.prepare(`
          INSERT INTO ProjectErpConfigs (
            project_id,
            enabled,
            endpoint_url,
            water_id,
            session_cookie,
            expected_project_name
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            enabled = excluded.enabled,
            endpoint_url = excluded.endpoint_url,
            water_id = excluded.water_id,
            session_cookie = excluded.session_cookie,
            expected_project_name = excluded.expected_project_name
        `).bind(
          Number(payload.project_id),
          Number(payload.enabled) ? 1 : 0,
          String(payload.endpoint_url || '').trim(),
          String(payload.water_id || '').trim(),
          String(payload.session_cookie || '').trim(),
          String(payload.expected_project_name || '').trim()
        ).run();

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/erp-sync-preview' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id } = await request.json();
        if (!project_id) return errorResponse('缺少项目 ID', 400);

        const config = await getErpConfig(env, project_id);
        if (!config || Number(config.enabled) !== 1) {
          return errorResponse('请先在系统配置中启用 ERP 收款同步', 400);
        }

        const plan = await buildErpPreviewResult(env, Number(project_id), config);
        return new Response(JSON.stringify({
          success: true,
          summary: plan.summary,
          preview: plan.preview.slice(0, 50),
          can_sync: plan.importableItems.length > 0
        }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/erp-sync' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id } = await request.json();
        if (!project_id) return errorResponse('缺少项目 ID', 400);

        const config = await getErpConfig(env, project_id);
        if (!config || Number(config.enabled) !== 1) {
          return errorResponse('请先在系统配置中启用 ERP 收款同步', 400);
        }

        const plan = await buildErpPreviewResult(env, Number(project_id), config);
        const statements = [];

        plan.importableItems.forEach((item) => {
          statements.push(
            env.DB.prepare(`
              INSERT INTO Payments (
                project_id,
                order_id,
                amount,
                payment_time,
                payer_name,
                bank_name,
                remarks,
                source,
                erp_record_id,
                raw_payload
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              Number(item.project_id),
              Number(item.order_id),
              Number(item.amount),
              String(item.payment_time),
              String(item.payer_name || ''),
              String(item.bank_name || ''),
              String(item.remarks || ''),
              String(item.source || 'ERP_SYNC'),
              String(item.erp_record_id),
              String(item.raw_payload || '')
            )
          );
          statements.push(
            env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?')
              .bind(Number(item.amount), Number(item.order_id))
          );
        });

        if (statements.length > 0) {
          await env.DB.batch(statements);

          const fullyPaidOrders = (await env.DB.prepare(`
            SELECT id, booth_id
            FROM Orders
            WHERE project_id = ? AND paid_amount >= total_amount AND status NOT IN ('已退订', '已作废')
          `).bind(project_id).all()).results || [];

          const boothStatements = fullyPaidOrders.map((order) =>
            env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?")
              .bind(order.booth_id, Number(project_id))
          );
          if (boothStatements.length > 0) {
            await env.DB.batch(boothStatements);
          }
        }

        const syncSummary = JSON.stringify({
          synced_count: plan.importableItems.length,
          summary: plan.summary
        });

        await env.DB.prepare(`
          UPDATE ProjectErpConfigs
          SET last_sync_at = ?, last_sync_summary = ?
          WHERE project_id = ?
        `).bind(getChinaTimestamp(), syncSummary, Number(project_id)).run();

        return new Response(JSON.stringify({
          success: true,
          synced_count: plan.importableItems.length,
          summary: plan.summary,
          preview: plan.preview.slice(0, 50)
        }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/industries') {
        if (request.method === 'GET') {
          const pid = new URL(request.url).searchParams.get('projectId');
          const results = await env.DB.prepare('SELECT * FROM Industries WHERE project_id = ?').bind(pid).all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        }
      }
      if (url.pathname === '/api/add-industry' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id, industry_name } = await request.json();
        await env.DB.prepare('INSERT INTO Industries (project_id, industry_name) VALUES (?, ?)').bind(project_id, industry_name).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      if (url.pathname === '/api/delete-industry' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
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
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);
        let normalizedBoothIds = [];
        try {
          normalizedBoothIds = normalizeBoothIds(boothIds);
        } catch (e) {
          return errorResponse(e.message, 400, corsHeaders);
        }
        if (!MANUAL_BOOTH_STATUSES.has(String(status || '').trim())) {
          return errorResponse('仅允许手动设置为未售或已锁定', 400, corsHeaders);
        }
        const placeholders = normalizedBoothIds.map(() => '?').join(',');
        const query = `UPDATE Booths SET status = ? WHERE project_id = ? AND id IN (${placeholders})`;
        await env.DB.prepare(query).bind(status, projectId, ...normalizedBoothIds).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/delete-booths' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403);
        const { projectId, boothIds } = await request.json();
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);
        let normalizedBoothIds = [];
        try {
          normalizedBoothIds = normalizeBoothIds(boothIds);
        } catch (e) {
          return errorResponse(e.message, 400, corsHeaders);
        }
        const placeholders = normalizedBoothIds.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM Booths WHERE project_id = ? AND id IN (${placeholders})`).bind(projectId, ...normalizedBoothIds).run();
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
        const selectedSales = currentUser.role === 'admin' ? urlObj.searchParams.get('salesName') : null;
        
        let query = `
          SELECT
            o.*,
            b.hall,
            b.type as booth_type,
            CASE WHEN ? = 'admin' OR o.sales_name = ? THEN 1 ELSE 0 END as can_manage,
            CASE WHEN ? = 'admin' OR o.sales_name = ? THEN 1 ELSE 0 END as can_preview_contract,
            CASE WHEN o.contract_url IS NOT NULL AND o.contract_url != '' THEN 1 ELSE 0 END as has_contract,
            CASE
              WHEN ? = 'admin' OR o.sales_name = ? THEN o.contact_person
              ELSE CASE WHEN o.contact_person IS NULL OR o.contact_person = '' THEN '未填' ELSE '***' END
            END as contact_person,
            CASE
              WHEN ? = 'admin' OR o.sales_name = ? THEN o.phone
              ELSE CASE
                WHEN o.phone IS NULL OR o.phone = '' THEN '未填'
                WHEN length(o.phone) >= 7 THEN substr(o.phone, 1, 3) || '****' || substr(o.phone, -4)
                ELSE '***'
              END
            END as phone,
            CASE WHEN ? = 'admin' OR o.sales_name = ? THEN o.contract_url ELSE NULL END as contract_url
          FROM Orders o 
          LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id 
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
            AND (? = 'admin' OR o.sales_name = ? OR o.paid_amount >= o.total_amount)
        `;
        let params = [
          currentUser.role, currentUser.name,
          currentUser.role, currentUser.name,
          currentUser.role, currentUser.name,
          currentUser.role, currentUser.name,
          currentUser.role, currentUser.name,
          pid,
          currentUser.role, currentUser.name
        ];
        if (selectedSales) {
          query += ` AND o.sales_name = ?`;
          params.push(selectedSales);
        }
        query += ` ORDER BY o.created_at DESC`;
        const results = await env.DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results.results), { headers: corsHeaders });
      }

      if (url.pathname === '/api/order-dashboard-stats' && request.method === 'GET') {
        const urlObj = new URL(request.url);
        const pid = urlObj.searchParams.get('projectId');
        const selectedSales = currentUser.role === 'admin' ? urlObj.searchParams.get('salesName') : null;
        const scopedSales = currentUser.role === 'admin' ? selectedSales : currentUser.name;

        let orderWhere = `o.project_id = ? AND o.status NOT IN ('已退订', '已作废')`;
        let orderParams = [pid];
        if (scopedSales) {
          orderWhere += ` AND o.sales_name = ?`;
          orderParams.push(scopedSales);
        }

        const orderStats = await env.DB.prepare(`
          SELECT
            COUNT(*) as company_count,
            ROUND(COALESCE(SUM(CASE WHEN o.paid_amount > 0 AND o.paid_amount < o.total_amount THEN o.area / 9.0 ELSE 0 END), 0), 2) as deposit_booth_count,
            ROUND(COALESCE(SUM(CASE WHEN o.paid_amount >= o.total_amount THEN o.area / 9.0 ELSE 0 END), 0), 2) as full_paid_booth_count,
            ROUND(COALESCE(SUM(o.total_booth_fee), 0), 2) as receivable_booth_fee,
            ROUND(COALESCE(SUM(o.other_income), 0), 2) as receivable_other_fee,
            ROUND(COALESCE(SUM(o.paid_amount), 0), 2) as received_total,
            ROUND(COALESCE(SUM(o.total_amount - o.paid_amount), 0), 2) as unpaid_total
          FROM Orders o
          WHERE ${orderWhere}
        `).bind(...orderParams).first();

        let expenseWhere = `e.project_id = ?`;
        let expenseParams = [pid];
        if (scopedSales) {
          expenseWhere += ` AND o.sales_name = ?`;
          expenseParams.push(scopedSales);
        }
        const expenseStats = await env.DB.prepare(`
          SELECT ROUND(COALESCE(SUM(e.amount), 0), 2) as total_expense
          FROM Expenses e
          LEFT JOIN Orders o ON e.order_id = o.id
          WHERE ${expenseWhere}
        `).bind(...expenseParams).first();

        let targetTotal = 0;
        if (currentUser.role === 'admin') {
          if (selectedSales) {
            const row = await env.DB.prepare('SELECT COALESCE(target, 0) as target_total FROM Staff WHERE name = ?').bind(selectedSales).first();
            targetTotal = Number(row?.target_total || 0);
          } else {
            const row = await env.DB.prepare('SELECT ROUND(COALESCE(SUM(target), 0), 2) as target_total FROM Staff').first();
            targetTotal = Number(row?.target_total || 0);
          }
        } else {
          const row = await env.DB.prepare('SELECT COALESCE(target, 0) as target_total FROM Staff WHERE name = ?').bind(currentUser.name).first();
          targetTotal = Number(row?.target_total || 0);
        }

        const depositBoothCount = Number(orderStats?.deposit_booth_count || 0);
        const fullPaidBoothCount = Number(orderStats?.full_paid_booth_count || 0);
        const advancedBoothCount = Number((depositBoothCount + fullPaidBoothCount).toFixed(2));
        const remainingTarget = Math.max(targetTotal - advancedBoothCount, 0);
        const totalReceivable = Number(orderStats?.receivable_booth_fee || 0) + Number(orderStats?.receivable_other_fee || 0);
        const remainingUnpaid = Math.max(totalReceivable - Number(orderStats?.received_total || 0), 0);
        const collectionRate = totalReceivable > 0 ? Number(((Number(orderStats?.received_total || 0) / totalReceivable) * 100).toFixed(1)) : 0;
        const unpaidRate = totalReceivable > 0 ? Number(((remainingUnpaid / totalReceivable) * 100).toFixed(1)) : 0;

        return new Response(JSON.stringify({
          target_total: targetTotal,
          deposit_booth_count: depositBoothCount,
          full_paid_booth_count: fullPaidBoothCount,
          remaining_target: remainingTarget,
          receivable_booth_fee: Number(orderStats?.receivable_booth_fee || 0),
          receivable_other_fee: Number(orderStats?.receivable_other_fee || 0),
          receivable_total: totalReceivable,
          received_total: Number(orderStats?.received_total || 0),
          unpaid_total: remainingUnpaid,
          unpaid_rate: unpaidRate,
          collection_rate: collectionRate,
          total_expense: Number(expenseStats?.total_expense || 0),
          company_count: Number(orderStats?.company_count || 0)
        }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/home-dashboard' && request.method === 'GET') {
        const pid = new URL(request.url).searchParams.get('projectId');
        if (!pid) return errorResponse('缺少项目 ID', 400);

        let scopedOrderQuery = `
          SELECT
            o.id,
            o.company_name,
            o.region,
            o.area,
            o.total_booth_fee,
            o.total_amount,
            o.other_income,
            o.paid_amount,
            o.sales_name,
            o.status,
            o.created_at,
            b.hall,
            b.type as booth_type
          FROM Orders o
          LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
        `;
        const scopedOrderParams = [pid];
        if (currentUser.role !== 'admin') {
          scopedOrderQuery += ` AND o.sales_name = ?`;
          scopedOrderParams.push(currentUser.name);
        }
        const scopedOrders = (await env.DB.prepare(scopedOrderQuery).bind(...scopedOrderParams).all()).results || [];

        const allActiveOrders = currentUser.role === 'admin'
          ? ((await env.DB.prepare(`
              SELECT
                o.id,
                o.company_name,
                o.region,
                o.area,
                o.total_booth_fee,
                o.total_amount,
                o.other_income,
                o.paid_amount,
                o.sales_name,
                o.status,
                o.created_at,
                b.hall,
                b.type as booth_type
              FROM Orders o
              LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id
              WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
            `).bind(pid).all()).results || [])
          : scopedOrders;

        const globalActiveOrders = (await env.DB.prepare(`
          SELECT
            o.id,
            o.company_name,
            o.region,
            o.area,
            o.total_booth_fee,
            o.total_amount,
            o.other_income,
            o.paid_amount,
            o.sales_name,
            o.status,
            o.created_at,
            b.hall,
            b.type as booth_type
          FROM Orders o
          LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
        `).bind(pid).all()).results || [];

        const staffRows = currentUser.role === 'admin'
          ? ((await env.DB.prepare('SELECT name, role, target FROM Staff ORDER BY name ASC').all()).results || [])
          : [await env.DB.prepare('SELECT name, role, target FROM Staff WHERE name = ?').bind(currentUser.name).first()].filter(Boolean);

        const salesListStaffRows = (await env.DB.prepare('SELECT name, role, target FROM Staff ORDER BY name ASC').all()).results || [];

        const boothRows = currentUser.role === 'admin'
          ? ((await env.DB.prepare('SELECT hall, type, area FROM Booths WHERE project_id = ? ORDER BY hall ASC').bind(pid).all()).results || [])
          : [];

        const nowChina = new Date(Date.now() + (8 * 60 * 60 * 1000));
        const nowYear = nowChina.getUTCFullYear();
        const nowMonth = nowChina.getUTCMonth();
        const nowDate = nowChina.getUTCDate();
        const todayKey = `${nowYear}-${String(nowMonth + 1).padStart(2, '0')}-${String(nowDate).padStart(2, '0')}`;
        const weekDay = nowChina.getUTCDay() || 7;
        const weekStart = new Date(Date.UTC(nowYear, nowMonth, nowDate - (weekDay - 1)));
        const weekStartKey = `${weekStart.getUTCFullYear()}-${String(weekStart.getUTCMonth() + 1).padStart(2, '0')}-${String(weekStart.getUTCDate()).padStart(2, '0')}`;
        const monthPrefix = `${nowYear}-${String(nowMonth + 1).padStart(2, '0')}`;

        let paymentQuery = `
          SELECT
            p.order_id,
            p.amount,
            p.payment_time,
            o.sales_name,
            o.area,
            o.company_name,
            o.total_amount
          FROM Payments p
          LEFT JOIN Orders o ON p.order_id = o.id
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
        `;
        const paymentParams = [pid];
        if (currentUser.role !== 'admin') {
          paymentQuery += ` AND o.sales_name = ?`;
          paymentParams.push(currentUser.name);
        }
        const paymentRows = (await env.DB.prepare(paymentQuery).bind(...paymentParams).all()).results || [];
        const globalPaymentRows = (await env.DB.prepare(`
          SELECT
            p.order_id,
            p.amount,
            p.payment_time,
            o.sales_name,
            o.area,
            o.company_name,
            o.total_amount
          FROM Payments p
          LEFT JOIN Orders o ON p.order_id = o.id
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
        `).bind(pid).all()).results || [];

        const getPeriodKeys = (paymentDate) => {
          const keys = ['total'];
          if (!paymentDate) return keys;
          if (paymentDate === todayKey) keys.push('today');
          if (paymentDate >= weekStartKey) keys.push('week');
          if (paymentDate.startsWith(monthPrefix)) keys.push('month');
          return keys;
        };

        const createPeriodBucket = (targetTotal = 0) => ({
          target_total: Number(targetTotal || 0),
          deposit_booth_count: 0,
          full_paid_booth_count: 0,
          reserved_booth_count: 0,
          paid_booth_count: 0,
          paid_company_count: 0,
          company_count: 0,
          received_total: 0,
          receivable_total: 0,
          _seenOrders: new Set()
        });

        const createPeriodMap = (targetTotal = 0) => ({
          today: createPeriodBucket(targetTotal),
          week: createPeriodBucket(targetTotal),
          month: createPeriodBucket(targetTotal),
          total: createPeriodBucket(targetTotal)
        });

        const createSalesListBucket = (targetTotal = 0) => ({
          target_total: Number(targetTotal || 0),
          reserved_booth_count: 0,
          deposit_booth_count: 0,
          full_paid_booth_count: 0,
          receivable_total: 0,
          received_total: 0
        });

        const createSalesListPeriodMap = (targetTotal = 0) => ({
          today: createSalesListBucket(targetTotal),
          week: createSalesListBucket(targetTotal),
          month: createSalesListBucket(targetTotal),
          total: createSalesListBucket(targetTotal)
        });

        const finalizePeriodBucket = (bucket) => ({
          target_total: Number(Number(bucket.target_total || 0).toFixed(2)),
          deposit_booth_count: Number(bucket.deposit_booth_count.toFixed(2)),
          full_paid_booth_count: Number(bucket.full_paid_booth_count.toFixed(2)),
          reserved_booth_count: Number(bucket.reserved_booth_count.toFixed(2)),
          paid_booth_count: Number(bucket.paid_booth_count.toFixed(2)),
          paid_company_count: bucket.paid_company_count,
          company_count: bucket.company_count,
          received_total: Number(bucket.received_total.toFixed(2)),
          receivable_total: Number(bucket.receivable_total.toFixed(2)),
          target_rate: bucket.target_total > 0 ? Number(((bucket.paid_booth_count / bucket.target_total) * 100).toFixed(1)) : 0,
          collection_rate: bucket.receivable_total > 0 ? Number(((bucket.received_total / bucket.receivable_total) * 100).toFixed(1)) : 0
        });

        const finalizeSalesListBucket = (bucket) => {
          const reservedBooths = Number(bucket.reserved_booth_count || 0);
          const depositBooths = Number(bucket.deposit_booth_count || 0);
          const fullPaidBooths = Number(bucket.full_paid_booth_count || 0);
          const targetTotalForBucket = Number(bucket.target_total || 0);
          const progressedBooths = reservedBooths + depositBooths + fullPaidBooths;
          const receivableTotalForBucket = Number(bucket.receivable_total || 0);
          const receivedTotalForBucket = Number(bucket.received_total || 0);
          return {
            target_total: Number(targetTotalForBucket.toFixed(2)),
            reserved_booth_count: Number(reservedBooths.toFixed(2)),
            deposit_booth_count: Number(depositBooths.toFixed(2)),
            full_paid_booth_count: Number(fullPaidBooths.toFixed(2)),
            remaining_target: Number(Math.max(targetTotalForBucket - progressedBooths, 0).toFixed(2)),
            completion_rate: targetTotalForBucket > 0 ? Number(((progressedBooths / targetTotalForBucket) * 100).toFixed(1)) : 0,
            receivable_total: Number(receivableTotalForBucket.toFixed(2)),
            received_total: Number(receivedTotalForBucket.toFixed(2)),
            collection_rate: receivableTotalForBucket > 0 ? Number(((receivedTotalForBucket / receivableTotalForBucket) * 100).toFixed(1)) : 0
          };
        };

        const salesOverview = staffRows.map((staff) => {
          const staffOrders = allActiveOrders.filter((order) => order.sales_name === staff.name);
          const completedOrders = staffOrders.filter((order) => toSafeNumber(order.paid_amount) >= toSafeNumber(order.total_amount));
          const targetBooths = toSafeNumber(staff.target);
          const completedBooths = Number(completedOrders.reduce((sum, order) => sum + toBoothCount(order.area), 0).toFixed(2));
          const receivableTotal = Number(staffOrders.reduce((sum, order) => sum + toSafeNumber(order.total_amount), 0).toFixed(2));
          const receivedTotal = Number(staffOrders.reduce((sum, order) => sum + toSafeNumber(order.paid_amount), 0).toFixed(2));
          return {
            staff_name: staff.name,
            role: staff.role,
            target_booths: targetBooths,
            completed_booths: completedBooths,
            completed_companies: completedOrders.length,
            receivable_total: receivableTotal,
            received_total: receivedTotal,
            completion_rate: targetBooths > 0 ? Number(((completedBooths / targetBooths) * 100).toFixed(1)) : 0,
            collection_rate: receivableTotal > 0 ? Number(((receivedTotal / receivableTotal) * 100).toFixed(1)) : 0
          };
        }).sort((a, b) => {
          if (b.completed_booths !== a.completed_booths) return b.completed_booths - a.completed_booths;
          if (b.received_total !== a.received_total) return b.received_total - a.received_total;
          return a.staff_name.localeCompare(b.staff_name, 'zh-CN');
        });

        const targetTotal = Number(salesOverview.reduce((sum, row) => sum + toSafeNumber(row.target_booths), 0).toFixed(2));
        const depositBoothCount = Number(scopedOrders.reduce((sum, order) => {
          if (toSafeNumber(order.paid_amount) > 0 && toSafeNumber(order.paid_amount) < toSafeNumber(order.total_amount)) {
            return sum + toBoothCount(order.area);
          }
          return sum;
        }, 0).toFixed(2));
        const fullPaidBoothCount = Number(scopedOrders.reduce((sum, order) => {
          if (toSafeNumber(order.paid_amount) >= toSafeNumber(order.total_amount)) {
            return sum + toBoothCount(order.area);
          }
          return sum;
        }, 0).toFixed(2));
        const receivableTotalHome = Number(scopedOrders.reduce((sum, order) => sum + toSafeNumber(order.total_amount), 0).toFixed(2));
        const receivedTotalHome = Number(scopedOrders.reduce((sum, order) => sum + toSafeNumber(order.paid_amount), 0).toFixed(2));
        const unpaidTotalHome = Number(Math.max(receivableTotalHome - receivedTotalHome, 0).toFixed(2));
        const homeProgress = {
          target_total: targetTotal,
          deposit_booth_count: depositBoothCount,
          full_paid_booth_count: fullPaidBoothCount,
          remaining_target: Number(Math.max(targetTotal - depositBoothCount - fullPaidBoothCount, 0).toFixed(2)),
          receivable_total: receivableTotalHome,
          received_total: receivedTotalHome,
          unpaid_total: unpaidTotalHome,
          received_rate: receivableTotalHome > 0 ? Number(((receivedTotalHome / receivableTotalHome) * 100).toFixed(1)) : 0
        };

        const salesSummaryPeriods = createPeriodMap(targetTotal);
        const salesListPeriodMap = {};
        const salesChampionMap = { today: {}, week: {}, month: {}, total: {} };
        salesListStaffRows.forEach((staff) => {
          salesListPeriodMap[staff.name] = createSalesListPeriodMap(toSafeNumber(staff.target));
        });

        scopedOrders.forEach((order) => {
          const createdDate = String(order.created_at || '').slice(0, 10);
          const periodKeys = getPeriodKeys(createdDate);
          const boothCount = toBoothCount(order.area);
          const paidAmount = toSafeNumber(order.paid_amount);
          const totalAmount = toSafeNumber(order.total_amount);

          periodKeys.forEach((periodKey) => {
            const bucket = salesSummaryPeriods[periodKey];
            bucket.company_count += 1;
            bucket.receivable_total += totalAmount;
            bucket.received_total += paidAmount;

            if (paidAmount <= 0) {
              bucket.reserved_booth_count += boothCount;
            } else if (paidAmount < totalAmount) {
              bucket.deposit_booth_count += boothCount;
              bucket.paid_booth_count += boothCount;
              bucket.paid_company_count += 1;
            } else {
              bucket.full_paid_booth_count += boothCount;
              bucket.paid_booth_count += boothCount;
              bucket.paid_company_count += 1;
            }
          });
        });

        paymentRows.forEach((payment) => {
          const periodKeys = getPeriodKeys(String(payment.payment_time || '').slice(0, 10));
          const amount = toSafeNumber(payment.amount);
          const boothCount = toBoothCount(payment.area);
          const receivableAmount = toSafeNumber(payment.total_amount);
          const orderKey = `${payment.order_id}`;

          periodKeys.forEach((periodKey) => {
            const summaryBucket = salesSummaryPeriods[periodKey];
            summaryBucket.received_total += amount;
            if (!summaryBucket._seenOrders.has(orderKey)) {
              summaryBucket._seenOrders.add(orderKey);
              summaryBucket.paid_booth_count += boothCount;
              summaryBucket.paid_company_count += 1;
              summaryBucket.receivable_total += receivableAmount;
            }
          });
        });

        globalActiveOrders.forEach((order) => {
          const createdDate = String(order.created_at || '').slice(0, 10);
          const periodKeys = getPeriodKeys(createdDate);
          const bucketMap = salesListPeriodMap[order.sales_name];
          if (!bucketMap) return;

          const boothCount = toBoothCount(order.area);
          const paidAmount = toSafeNumber(order.paid_amount);
          const totalAmount = toSafeNumber(order.total_amount);

          periodKeys.forEach((periodKey) => {
            const bucket = bucketMap[periodKey];
            bucket.receivable_total += totalAmount;
            bucket.received_total += paidAmount;

            if (paidAmount <= 0) {
              bucket.reserved_booth_count += boothCount;
            } else if (paidAmount < totalAmount) {
              bucket.deposit_booth_count += boothCount;
            } else {
              bucket.full_paid_booth_count += boothCount;
            }
          });
        });

        const firstPaymentByOrder = {};
        globalPaymentRows.forEach((payment) => {
          const orderKey = String(payment.order_id || '');
          const paymentDate = String(payment.payment_time || '').slice(0, 10);
          if (!orderKey || !payment.sales_name || !paymentDate) return;

          const existing = firstPaymentByOrder[orderKey];
          if (!existing || paymentDate < existing.payment_date) {
            firstPaymentByOrder[orderKey] = {
              sales_name: payment.sales_name,
              payment_date: paymentDate,
              booth_count: toBoothCount(payment.area)
            };
          }
        });

        Object.values(firstPaymentByOrder).forEach((payment) => {
          getPeriodKeys(payment.payment_date).forEach((periodKey) => {
            salesChampionMap[periodKey][payment.sales_name] = Number((
              Number(salesChampionMap[periodKey][payment.sales_name] || 0) + Number(payment.booth_count || 0)
            ).toFixed(2));
          });
        });

        const salesSummaryPeriodStats = Object.fromEntries(
          Object.entries(salesSummaryPeriods).map(([periodKey, bucket]) => [periodKey, finalizePeriodBucket(bucket)])
        );

        const salesListPeriods = {
          today: [],
          week: [],
          month: [],
          total: []
        };

        Object.entries(salesListPeriodMap).forEach(([staffName, periodMap]) => {
          const staffMeta = salesListStaffRows.find((staff) => staff.name === staffName);
          ['today', 'week', 'month', 'total'].forEach((periodKey) => {
            const bucket = finalizeSalesListBucket(periodMap[periodKey]);
            salesListPeriods[periodKey].push({
              staff_name: staffName,
              role: staffMeta?.role || 'user',
              target_booths: bucket.target_total,
              reserved_booth_count: bucket.reserved_booth_count,
              deposit_booth_count: bucket.deposit_booth_count,
              full_paid_booth_count: bucket.full_paid_booth_count,
              remaining_target: bucket.remaining_target,
              completion_rate: bucket.completion_rate,
              receivable_total: bucket.receivable_total,
              received_total: bucket.received_total,
              collection_rate: bucket.collection_rate
            });
          });
        });

        Object.keys(salesListPeriods).forEach((periodKey) => {
          salesListPeriods[periodKey].sort((a, b) => {
            if (b.received_total !== a.received_total) return b.received_total - a.received_total;
            const bProgress = Number(b.reserved_booth_count || 0) + Number(b.deposit_booth_count || 0) + Number(b.full_paid_booth_count || 0);
            const aProgress = Number(a.reserved_booth_count || 0) + Number(a.deposit_booth_count || 0) + Number(a.full_paid_booth_count || 0);
            if (bProgress !== aProgress) return bProgress - aProgress;
            return a.staff_name.localeCompare(b.staff_name, 'zh-CN');
          });
        });

        const salesListMeta = Object.fromEntries(
          ['today', 'week', 'month', 'total'].map((periodKey) => {
            const championEntries = Object.entries(salesChampionMap[periodKey] || {}).sort((a, b) => {
              if (b[1] !== a[1]) return b[1] - a[1];
              return a[0].localeCompare(b[0], 'zh-CN');
            });
            const topEntry = championEntries[0];
            return [periodKey, {
              champion_name: topEntry ? topEntry[0] : '暂无',
              champion_booth_count: topEntry ? Number(Number(topEntry[1] || 0).toFixed(2)) : 0
            }];
          })
        );

        const regionScopedOrders = scopedOrders;
        const totalRegionCompanyCount = regionScopedOrders.length;
        const totalRegionBoothCount = Number(regionScopedOrders.reduce((sum, order) => sum + toBoothCount(order.area), 0).toFixed(2));
        const pieMap = {};
        const sectionMap = {
          international: {
            key: 'international',
            title: '国际企业',
            description: '细分到具体国家/地区，统计企业数与展位数。',
            rows: {}
          },
          outside_fujian: {
            key: 'outside_fujian',
            title: '福建省外企业',
            description: '按省级行政区统计企业数与展位数，不细分到市。',
            rows: {}
          },
          inside_fujian: {
            key: 'inside_fujian',
            title: '福建省内企业',
            description: '覆盖福建省内所有城市；福州市继续细分到区县，其余城市汇总到市。',
            rows: {}
          }
        };

        regionScopedOrders.forEach((order) => {
          const boothCount = toBoothCount(order.area);
          const regionInfo = parseRegionInfo(order.region);

          if (!pieMap[regionInfo.pieLabel]) {
            pieMap[regionInfo.pieLabel] = { label: regionInfo.pieLabel, company_count: 0, booth_count: 0 };
          }
          pieMap[regionInfo.pieLabel].company_count += 1;
          pieMap[regionInfo.pieLabel].booth_count += boothCount;

          const section = sectionMap[regionInfo.scope];
          if (section) {
            if (!section.rows[regionInfo.detailLabel]) {
              section.rows[regionInfo.detailLabel] = { label: regionInfo.detailLabel, company_count: 0, booth_count: 0 };
            }
            section.rows[regionInfo.detailLabel].company_count += 1;
            section.rows[regionInfo.detailLabel].booth_count += boothCount;
          }
        });

        const regionSections = Object.values(sectionMap).map((section) => {
          const rows = Object.values(section.rows)
            .map((row) => ({
              ...row,
              booth_count: Number(row.booth_count.toFixed(2)),
              company_ratio: totalRegionCompanyCount > 0 ? Number(((row.company_count / totalRegionCompanyCount) * 100).toFixed(1)) : 0,
              booth_ratio: totalRegionBoothCount > 0 ? Number(((row.booth_count / totalRegionBoothCount) * 100).toFixed(1)) : 0
            }))
            .sort((a, b) => {
              if (b.company_count !== a.company_count) return b.company_count - a.company_count;
              if (b.booth_count !== a.booth_count) return b.booth_count - a.booth_count;
              return a.label.localeCompare(b.label, 'zh-CN');
            });
          const companyCount = rows.reduce((sum, row) => sum + row.company_count, 0);
          const boothCount = Number(rows.reduce((sum, row) => sum + toSafeNumber(row.booth_count), 0).toFixed(2));
          return {
            key: section.key,
            title: section.title,
            description: section.description,
            summary: {
              company_count: companyCount,
              booth_count: boothCount,
              company_ratio: totalRegionCompanyCount > 0 ? Number(((companyCount / totalRegionCompanyCount) * 100).toFixed(1)) : 0,
              booth_ratio: totalRegionBoothCount > 0 ? Number(((boothCount / totalRegionBoothCount) * 100).toFixed(1)) : 0
            },
            rows
          };
        });

        const pieItems = Object.values(pieMap)
          .map((item) => ({
            ...item,
            booth_count: Number(item.booth_count.toFixed(2)),
            company_ratio: totalRegionCompanyCount > 0 ? Number(((item.company_count / totalRegionCompanyCount) * 100).toFixed(1)) : 0
          }))
          .sort((a, b) => {
            if (b.company_count !== a.company_count) return b.company_count - a.company_count;
            if (b.booth_count !== a.booth_count) return b.booth_count - a.booth_count;
            return a.label.localeCompare(b.label, 'zh-CN');
          });

        let hallOverview = [];
        if (currentUser.role === 'admin') {
          const createHallStat = (hall) => ({
            hall,
            configured_booth_count: 0,
            received_company_count: 0,
            received_booth_count: 0,
            received_ground_booth_count: 0,
            received_standard_booth_count: 0,
            receivable_total: 0,
            received_total: 0,
            receivable_booth_fee: 0,
            received_booth_fee: 0,
            charged_booth_count: 0,
            free_booth_count: 0,
            charged_fee_total: 0,
            ordered_booth_count: 0,
            total_booth_fee_all: 0,
            ground_row_count: 0,
            ground_area: 0,
            ground_booth_count: 0,
            standard_row_count: 0,
            standard_area: 0,
            standard_booth_count: 0
          });

          const hallMap = {};
          boothRows.forEach((booth) => {
            const hall = booth.hall || '未分配展馆';
            if (!hallMap[hall]) {
              hallMap[hall] = createHallStat(hall);
            }
            const hallStat = hallMap[hall];
            const boothCount = toBoothCount(booth.area);
            hallStat.configured_booth_count += boothCount;
            if (booth.type === '光地') {
              hallStat.ground_row_count += 1;
              hallStat.ground_area += toSafeNumber(booth.area);
              hallStat.ground_booth_count += boothCount;
            } else {
              hallStat.standard_row_count += 1;
              hallStat.standard_area += toSafeNumber(booth.area);
              hallStat.standard_booth_count += boothCount;
            }
          });

          allActiveOrders.forEach((order) => {
            const hall = order.hall || '未分配展馆';
            if (!hallMap[hall]) {
              hallMap[hall] = createHallStat(hall);
            }

            const hallStat = hallMap[hall];
            const boothCount = toBoothCount(order.area);
            const boothFee = toSafeNumber(order.total_booth_fee);
            const paidAmount = toSafeNumber(order.paid_amount);
            const receivedBoothFee = boothFee > 0 ? Math.min(paidAmount, boothFee) : 0;
            const isFreeBooth = boothFee <= 0;
            const hasReceivedBooth = isFreeBooth || paidAmount > 0;
            const isGroundBooth = order.booth_type === '光地';
            hallStat.receivable_total += toSafeNumber(order.total_amount);
            hallStat.received_total += paidAmount;
            hallStat.ordered_booth_count += boothCount;
            hallStat.total_booth_fee_all += boothFee;
            hallStat.receivable_booth_fee += Math.max(boothFee, 0);
            hallStat.received_booth_fee += receivedBoothFee;
            if (boothFee > 0) {
              hallStat.charged_booth_count += boothCount;
              hallStat.charged_fee_total += boothFee;
            } else {
              hallStat.free_booth_count += boothCount;
            }
            if (hasReceivedBooth) {
              hallStat.received_company_count += 1;
              hallStat.received_booth_count += boothCount;
              if (isGroundBooth) {
                hallStat.received_ground_booth_count += boothCount;
              } else {
                hallStat.received_standard_booth_count += boothCount;
              }
            }
          });

          hallOverview = Object.values(hallMap)
            .map((hall) => ({
              hall: hall.hall,
              configured_booth_count: Number(hall.configured_booth_count.toFixed(2)),
              configured_total_booth_count: Number(hall.configured_booth_count.toFixed(2)),
              configured_ground_booth_count: Number(hall.ground_booth_count.toFixed(2)),
              configured_standard_booth_count: Number(hall.standard_booth_count.toFixed(2)),
              received_standard_booth_count: Number(hall.received_standard_booth_count.toFixed(2)),
              received_ground_booth_count: Number(hall.received_ground_booth_count.toFixed(2)),
              received_booth_count: Number(hall.received_booth_count.toFixed(2)),
              received_booth_rate: hall.configured_booth_count > 0 ? Number(((hall.received_booth_count / hall.configured_booth_count) * 100).toFixed(1)) : 0,
              remaining_unsold_booth_count: Number(Math.max(hall.configured_booth_count - hall.received_booth_count, 0).toFixed(2)),
              received_company_count: hall.received_company_count,
              receivable_total: Number(hall.receivable_total.toFixed(2)),
              received_total: Number(hall.received_total.toFixed(2)),
              receivable_booth_fee: Number(hall.receivable_booth_fee.toFixed(2)),
              received_booth_fee: Number(hall.received_booth_fee.toFixed(2)),
              collection_rate: hall.receivable_booth_fee > 0 ? Number(((hall.received_booth_fee / hall.receivable_booth_fee) * 100).toFixed(1)) : 0,
              charged_booth_count: Number(hall.charged_booth_count.toFixed(2)),
              free_booth_count: Number(hall.free_booth_count.toFixed(2)),
              charged_avg_unit_price: hall.charged_booth_count > 0 ? Number((hall.charged_fee_total / hall.charged_booth_count).toFixed(2)) : 0,
              overall_avg_unit_price: hall.configured_booth_count > 0 ? Number((hall.total_booth_fee_all / hall.configured_booth_count).toFixed(2)) : 0,
              ground_row_count: hall.ground_row_count,
              ground_area: Number(hall.ground_area.toFixed(2)),
              ground_booth_count: Number(hall.ground_booth_count.toFixed(2)),
              standard_row_count: hall.standard_row_count,
              standard_area: Number(hall.standard_area.toFixed(2)),
              standard_booth_count: Number(hall.standard_booth_count.toFixed(2))
            }))
            .sort((a, b) => a.hall.localeCompare(b.hall, 'zh-CN'));
        }

        return new Response(JSON.stringify({
          is_admin: currentUser.role === 'admin',
          home_progress: homeProgress,
          sales_overview: salesOverview,
          sales_summary_periods: salesSummaryPeriodStats,
          sales_list_periods: salesListPeriods,
          sales_list_meta: salesListMeta,
          region_overview: {
            total_company_count: totalRegionCompanyCount,
            total_booth_count: totalRegionBoothCount,
            sections: regionSections,
            pie_items: pieItems
          },
          hall_overview: hallOverview
        }), { headers: corsHeaders });
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
        const hasPermission = await canManageOrder(env, currentUser, d.order_id);
        if (!hasPermission) return errorResponse('权限不足：不能修改他人录入的客户资料', 403);
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

      if (url.pathname === '/api/payments' && request.method === 'GET') {
        try {
            const orderId = new URL(request.url).searchParams.get('orderId');
            const hasPermission = await canManageOrder(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足', 403);
            const results = await env.DB.prepare('SELECT * FROM Payments WHERE order_id = ? ORDER BY payment_time DESC').bind(orderId).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } catch (e) {
            console.error('Fetch payments failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/add-payment' && request.method === 'POST') {
        try {
            const p = await request.json();
            const hasPermission = await canManageOrder(env, currentUser, p.order_id);
            if (!hasPermission) return errorResponse('权限不足：不能操作他人订单收款', 403);
            const stmtPayment = env.DB.prepare('INSERT INTO Payments (project_id, order_id, amount, payment_time, payer_name, bank_name, remarks, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(Number(p.project_id), Number(p.order_id), Number(p.amount), String(p.payment_time), String(p.payer_name), String(p.bank_name), String(p.remarks || ''), 'MANUAL');
            const stmtUpdatePaid = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?').bind(Number(p.amount), Number(p.order_id));
            await env.DB.batch([stmtPayment, stmtUpdatePaid]);
            
            const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(Number(p.order_id)).first();
            if (order && order.paid_amount >= order.total_amount) {
                await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, Number(p.project_id)).run();
            }
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Add payment failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/delete-payment' && request.method === 'POST') {
        const { order_id, payment_id } = await request.json();
        const hasPermission = await canManageOrder(env, currentUser, order_id);
        if (!hasPermission) return errorResponse('权限不足', 403);
        try {
            const payment = await env.DB.prepare('SELECT amount, source FROM Payments WHERE id = ?').bind(payment_id).first();
            if (!payment) return errorResponse('支付记录不存在', 404);
            if (payment.source === 'ERP_SYNC') return errorResponse('ERP 同步流水不允许手动删除', 400);
            const stmtDel = env.DB.prepare('DELETE FROM Payments WHERE id = ?').bind(payment_id);
            const stmtUpdatePaid = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount - ? WHERE id = ?').bind(payment.amount, order_id);
            await env.DB.batch([stmtDel, stmtUpdatePaid]);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Delete payment failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/edit-payment' && request.method === 'POST') {
        try {
            const p = await request.json();
            const hasPermission = await canManageOrder(env, currentUser, p.order_id);
            if (!hasPermission) return errorResponse('权限不足', 403);
            const oldPayment = await env.DB.prepare('SELECT amount, source FROM Payments WHERE id = ?').bind(p.payment_id).first();
            if (!oldPayment) return errorResponse('收款记录不存在', 404);
            if (oldPayment.source === 'ERP_SYNC') return errorResponse('ERP 同步流水不允许手动修改', 400);
            const diff = p.amount - oldPayment.amount;
            const stmtUpdatePayment = env.DB.prepare('UPDATE Payments SET amount=?, payment_time=?, payer_name=?, bank_name=?, remarks=? WHERE id=?')
                .bind(p.amount, p.payment_time, p.payer_name, p.bank_name, p.remarks, p.payment_id);
            const stmtUpdateOrder = env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?').bind(diff, p.order_id);
            await env.DB.batch([stmtUpdatePayment, stmtUpdateOrder]);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Edit payment failed:', e);
            return internalErrorResponse(corsHeaders);
        }
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
        } catch (e) {
            console.error('Update order fees failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/expenses' && request.method === 'GET') {
        try {
            const orderId = new URL(request.url).searchParams.get('orderId');
            const hasPermission = await canManageOrder(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足', 403);
            const results = await env.DB.prepare('SELECT * FROM Expenses WHERE order_id = ? ORDER BY created_at DESC').bind(orderId).all();
            return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } catch (e) {
            console.error('Fetch expenses failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/add-expense' && request.method === 'POST') {
        try {
            const ex = await request.json();
            const hasPermission = await canManageOrder(env, currentUser, ex.order_id);
            if (!hasPermission) return errorResponse('权限不足：不能操作他人订单支出', 403);
            await env.DB.prepare(`
              INSERT INTO Expenses (project_id, order_id, payee_name, payee_channel, payee_bank, payee_account, amount, applicant, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
            `).bind(ex.project_id, ex.order_id, ex.payee_name, ex.payee_channel, ex.payee_bank, ex.payee_account, ex.amount, ex.applicant, ex.reason).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Add expense failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/delete-expense' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足：仅管理员可撤销单据', 403);
        try {
            const { expense_id } = await request.json();
            await env.DB.prepare('DELETE FROM Expenses WHERE id = ?').bind(expense_id).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Delete expense failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      return errorResponse('接口不存在', 404);

    } catch (err) {
      console.error('Unhandled API error:', err);
      return internalErrorResponse(corsHeaders);
    }
  }
};
