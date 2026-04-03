import {
    buildErpRequestUrl,
    buildErpRequestUrlWithSearch,
    buildErpRequestParams,
    buildErpRequestParamsWithSearch,
    buildProjectSearchKeywords,
    extractErpRows,
    buildErpSyncPlan
} from './erp-sync-core.mjs';

const BOOTH_UNIT_AREA = 9;
const MANUAL_BOOTH_STATUSES = new Set(['可售', '已锁定']);
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const PASSWORD_HASH_VERSION = 'pbkdf2_sha256';
const PASSWORD_PBKDF2_ITERATIONS = 150000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;
const ERP_SECRET_VERSION = 'erpenc_v1';
const ERP_SECRET_IV_BYTES = 12;
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['pdf']);
const ALLOWED_UPLOAD_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf', '']);
const MAX_UPLOAD_SIZE = 6 * 1024 * 1024;
const STAFF_SORT_ORDER = `CASE WHEN name = 'admin' THEN 0 ELSE 1 END ASC, display_order ASC, name COLLATE NOCASE ASC`;
const ORDER_FIELD_SETTINGS = [
    { key: 'is_agent', enabled: 1, required: 1 },
    { key: 'agent_name', enabled: 1, required: 1 },
    { key: 'company_name', enabled: 1, required: 1 },
    { key: 'credit_code', enabled: 1, required: 1 },
    { key: 'contact_person', enabled: 1, required: 1 },
    { key: 'phone', enabled: 1, required: 1 },
    { key: 'region', enabled: 1, required: 1 },
    { key: 'category', enabled: 1, required: 1 },
    { key: 'main_business', enabled: 1, required: 1 },
    { key: 'profile', enabled: 1, required: 1 },
    { key: 'booth_selection', enabled: 1, required: 1, immutable: true },
    { key: 'actual_booth_fee', enabled: 1, required: 1 },
    { key: 'extra_fees', enabled: 1, required: 0 },
    { key: 'contract_upload', enabled: 1, required: 0 }
];
const schemaEnsureState = {
    loginAttempts: false,
    staffDisplayOrder: false,
    staffSalesRanking: false,
    orderFieldSettings: false,
    overpaymentIssues: false,
    orderBoothChanges: false,
    paymentsSoftDelete: false,
    expensesSoftDelete: false
};

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
const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const hexToUint8 = (hex) => {
    const normalized = String(hex || '').trim().toLowerCase();
    if (!normalized || normalized.length % 2 !== 0 || /[^0-9a-f]/.test(normalized)) return null;
    const result = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
        result[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
    }
    return result;
};
const hasMetaChanges = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);

async function hashPasswordLegacy(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function derivePasswordHash(password, saltBytes, iterations = PASSWORD_PBKDF2_ITERATIONS) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        strToUint8(String(password || '')),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        PASSWORD_HASH_BYTES * 8
    );
    return new Uint8Array(derivedBits);
}

function isModernPasswordHash(hashValue) {
    return String(hashValue || '').startsWith(`${PASSWORD_HASH_VERSION}$`);
}

async function hashPassword(password) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
    const derivedBytes = await derivePasswordHash(password, saltBytes, PASSWORD_PBKDF2_ITERATIONS);
    return [
        PASSWORD_HASH_VERSION,
        String(PASSWORD_PBKDF2_ITERATIONS),
        bytesToHex(saltBytes),
        bytesToHex(derivedBytes)
    ].join('$');
}

async function verifyPassword(password, storedHash) {
    const normalizedHash = String(storedHash || '').trim();
    if (!normalizedHash) return false;
    if (!isModernPasswordHash(normalizedHash)) {
        const legacyHash = await hashPasswordLegacy(password);
        return legacyHash === normalizedHash;
    }
    const [, iterationsRaw, saltHex, hashHex] = normalizedHash.split('$');
    const iterations = Number.parseInt(iterationsRaw, 10);
    const saltBytes = hexToUint8(saltHex);
    const expectedHashBytes = hexToUint8(hashHex);
    if (!Number.isFinite(iterations) || iterations <= 0 || !saltBytes || !expectedHashBytes) {
        return false;
    }
    const derivedBytes = await derivePasswordHash(password, saltBytes, iterations);
    if (derivedBytes.length !== expectedHashBytes.length) return false;
    let diff = 0;
    for (let i = 0; i < derivedBytes.length; i += 1) {
        diff |= derivedBytes[i] ^ expectedHashBytes[i];
    }
    return diff === 0;
}

async function isDefaultPasswordHash(storedHash) {
    return verifyPassword('123456', storedHash);
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

function getErpConfigSecret(env) {
    const secret = String(env.ERP_CONFIG_SECRET || env.JWT_SECRET || '').trim();
    if (!secret) throw new Error('ERP_CONFIG_SECRET_MISSING');
    return secret;
}

async function importAesKey(secretStr) {
    const keyMaterial = await crypto.subtle.digest('SHA-256', strToUint8(secretStr));
    return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSensitiveValue(value, env) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const iv = crypto.getRandomValues(new Uint8Array(ERP_SECRET_IV_BYTES));
    const key = await importAesKey(getErpConfigSecret(env));
    const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, strToUint8(normalized));
    return `${ERP_SECRET_VERSION}$${bytesToHex(iv)}$${bytesToHex(new Uint8Array(cipherBuffer))}`;
}

async function decryptSensitiveValue(value, env) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (!normalized.startsWith(`${ERP_SECRET_VERSION}$`)) {
        return normalized;
    }
    const [, ivHex, cipherHex] = normalized.split('$');
    const iv = hexToUint8(ivHex);
    const cipherBytes = hexToUint8(cipherHex);
    if (!iv || !cipherBytes) throw new Error('ERP_CONFIG_DECRYPT_INVALID');
    const key = await importAesKey(getErpConfigSecret(env));
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
    return new TextDecoder().decode(plainBuffer);
}

function buildSecurityHeaders({ includeCsp = false } = {}) {
    const headers = {
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin'
    };
    if (includeCsp) {
        headers['Content-Security-Policy'] = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'self'"
        ].join('; ');
    }
    return headers;
}

function withResponseHeaders(response, extraHeaders = {}) {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(extraHeaders || {})) {
        headers.set(key, value);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

function buildCorsHeaders(request, url, env) {
    const requestOrigin = request.headers.get('Origin');
    const configuredOrigins = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const allowedOrigins = Array.from(new Set([url.origin, ...configuredOrigins]));
    const allowOrigin = requestOrigin
        ? (allowedOrigins.includes(requestOrigin) ? requestOrigin : '')
        : (allowedOrigins[0] || url.origin);

    const headers = {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Vary': 'Origin',
        ...buildSecurityHeaders()
    };
    if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
    return headers;
}

function internalErrorResponse(corsHeaders) {
    return errorResponse('系统内部错误，请稍后重试', 500, corsHeaders);
}

async function canManageOrder(env, currentUser, orderId) {
    if (currentUser.role === 'admin') return true;
    const order = await env.DB.prepare('SELECT sales_name FROM Orders WHERE id = ?').bind(orderId).first();
    return !!order && order.sales_name === currentUser.name;
}

async function canViewSensitiveOrderFields(env, currentUser, orderId) {
    if (isSuperAdmin(currentUser)) return true;
    const order = await env.DB.prepare('SELECT sales_name FROM Orders WHERE id = ?').bind(orderId).first();
    return !!order && order.sales_name === currentUser.name;
}

async function canHandleOverpayment(env, currentUser, orderId) {
    if (isSuperAdmin(currentUser)) return true;
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
    if (schemaEnsureState.loginAttempts) return;
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
    schemaEnsureState.loginAttempts = true;
}

async function ensureStaffDisplayOrderColumn(env) {
    if (schemaEnsureState.staffDisplayOrder) return;
    const columns = (await env.DB.prepare(`PRAGMA table_info(Staff)`).all()).results || [];
    const hasDisplayOrder = columns.some((column) => String(column.name || '').toLowerCase() === 'display_order');
    if (!hasDisplayOrder) {
        await env.DB.prepare(`ALTER TABLE Staff ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0`).run();
        await env.DB.prepare(`UPDATE Staff SET display_order = id WHERE display_order = 0`).run();
    } else {
        await env.DB.prepare(`UPDATE Staff SET display_order = id WHERE display_order IS NULL OR display_order = 0`).run();
    }
    schemaEnsureState.staffDisplayOrder = true;
}

async function ensureStaffSalesRankingColumn(env) {
    if (schemaEnsureState.staffSalesRanking) return;
    const columns = (await env.DB.prepare(`PRAGMA table_info(Staff)`).all()).results || [];
    const hasRankingColumn = columns.some((column) => String(column.name || '').toLowerCase() === 'exclude_from_sales_ranking');
    if (!hasRankingColumn) {
        await env.DB.prepare(`ALTER TABLE Staff ADD COLUMN exclude_from_sales_ranking INTEGER NOT NULL DEFAULT 0`).run();
    }
    await env.DB.prepare(`UPDATE Staff SET exclude_from_sales_ranking = 0 WHERE exclude_from_sales_ranking IS NULL`).run();
    schemaEnsureState.staffSalesRanking = true;
}

async function ensureOrderFieldSettingsTable(env) {
    if (schemaEnsureState.orderFieldSettings) return;
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS ProjectOrderFieldSettings (
            project_id INTEGER NOT NULL,
            field_key TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            required INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
            PRIMARY KEY (project_id, field_key)
        )
    `).run();
    schemaEnsureState.orderFieldSettings = true;
}

async function getOrderFieldSettings(env, projectId) {
    await ensureOrderFieldSettingsTable(env);
    const rows = (await env.DB.prepare(`
        SELECT field_key, enabled, required
        FROM ProjectOrderFieldSettings
        WHERE project_id = ?
    `).bind(Number(projectId)).all()).results || [];
    const rowMap = Object.fromEntries(rows.map((row) => [String(row.field_key), row]));
    return ORDER_FIELD_SETTINGS.map((item) => {
        const stored = rowMap[item.key];
        return {
            key: item.key,
            enabled: item.immutable ? 1 : Number(stored?.enabled ?? item.enabled ?? 1),
            required: item.immutable ? 1 : Number(stored?.required ?? item.required ?? 0)
        };
    });
}

async function saveOrderFieldSettings(env, projectId, settings) {
    await ensureOrderFieldSettingsTable(env);
    const normalizedSettings = ORDER_FIELD_SETTINGS.map((item) => {
        const incoming = Array.isArray(settings)
            ? settings.find((setting) => String(setting.key) === item.key)
            : null;
        return {
            key: item.key,
            enabled: item.immutable ? 1 : Number(incoming?.enabled ?? item.enabled ?? 1) ? 1 : 0,
            required: item.immutable ? 1 : Number(incoming?.required ?? item.required ?? 0) ? 1 : 0
        };
    });
    const nowText = getChinaTimestamp();
    const statements = normalizedSettings.map((item) => env.DB.prepare(`
        INSERT INTO ProjectOrderFieldSettings (project_id, field_key, enabled, required, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, field_key) DO UPDATE SET
            enabled = excluded.enabled,
            required = excluded.required,
            updated_at = excluded.updated_at
    `).bind(Number(projectId), item.key, item.enabled, item.required, nowText));
    if (statements.length > 0) {
        await env.DB.batch(statements);
    }
    return normalizedSettings;
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

function validateNewPassword(newPass) {
    const password = String(newPass || '');
    if (password.trim().length < 6) {
        return '新密码长度至少 6 位';
    }
    if (password === '123456') {
        return '新密码不能使用默认密码 123456';
    }
    return '';
}

function normalizeUploadExtension(fileName) {
    return String(fileName || '').split('.').pop()?.toLowerCase().trim() || '';
}

function validateUploadFile(file) {
    if (!file || typeof file.name !== 'string') return '没有找到文件';
    const fileExt = normalizeUploadExtension(file.name);
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(fileExt)) {
        return '仅允许上传 PDF 格式文件';
    }
    const fileType = String(file.type || '').trim().toLowerCase();
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(fileType)) {
        return '文件类型无效，请上传 PDF 文件';
    }
    if (Number(file.size || 0) <= 0) {
        return '文件不能为空';
    }
    if (Number(file.size || 0) > MAX_UPLOAD_SIZE) {
        return '文件大小不能超过 6MB';
    }
    return '';
}

function toNonNegativeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
}

async function applyOrderPaidAmountDelta(env, orderId, delta, { preventOverpay = false } = {}) {
    const numericDelta = Number(delta || 0);
    if (!Number.isFinite(numericDelta)) {
        return { success: false, reason: 'invalid_delta' };
    }
    const result = await env.DB.prepare(`
        UPDATE Orders
        SET paid_amount = ROUND(paid_amount + ?, 2)
        WHERE id = ?
          AND paid_amount + ? >= 0
          AND (? = 0 OR paid_amount + ? <= total_amount)
    `).bind(
        numericDelta,
        Number(orderId),
        numericDelta,
        preventOverpay ? 1 : 0,
        numericDelta
    ).run();
    if (hasMetaChanges(result) > 0) {
        return { success: true };
    }
    const order = await env.DB.prepare('SELECT total_amount, paid_amount FROM Orders WHERE id = ?').bind(Number(orderId)).first();
    if (!order) return { success: false, reason: 'missing_order' };
    const nextPaidAmount = Number(order.paid_amount || 0) + numericDelta;
    if (nextPaidAmount < 0) return { success: false, reason: 'negative_paid_amount' };
    if (preventOverpay && nextPaidAmount > Number(order.total_amount || 0)) {
        return { success: false, reason: 'would_overpay' };
    }
    return { success: false, reason: 'conflict' };
}

async function rollbackOrderPaidAmountDelta(env, orderId, delta) {
    const numericDelta = Number(delta || 0);
    if (!Number.isFinite(numericDelta) || numericDelta === 0) return;
    await env.DB.prepare(`
        UPDATE Orders
        SET paid_amount = ROUND(paid_amount - ?, 2)
        WHERE id = ?
    `).bind(numericDelta, Number(orderId)).run();
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

async function ensureOverpaymentIssuesTable(env) {
    if (schemaEnsureState.overpaymentIssues) return;
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS OrderOverpaymentIssues (
            order_id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            overpaid_amount REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            reason TEXT,
            note TEXT,
            handled_by TEXT,
            handled_at TEXT,
            detected_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
        )
    `).run();
    schemaEnsureState.overpaymentIssues = true;
}

async function ensureOrderBoothChangesTable(env) {
    if (schemaEnsureState.orderBoothChanges) return;
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS OrderBoothChanges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            order_id INTEGER NOT NULL,
            old_booth_id TEXT NOT NULL,
            new_booth_id TEXT NOT NULL,
            old_area REAL NOT NULL DEFAULT 0,
            new_area REAL NOT NULL DEFAULT 0,
            booth_delta_count REAL NOT NULL DEFAULT 0,
            old_total_amount REAL NOT NULL DEFAULT 0,
            new_total_amount REAL NOT NULL DEFAULT 0,
            total_amount_delta REAL NOT NULL DEFAULT 0,
            changed_by TEXT,
            reason TEXT,
            changed_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
        )
    `).run();
    schemaEnsureState.orderBoothChanges = true;
}

async function ensurePaymentsSoftDeleteColumns(env) {
    if (schemaEnsureState.paymentsSoftDelete) return;
    const columns = (await env.DB.prepare(`PRAGMA table_info(Payments)`).all()).results || [];
    const hasDeletedAt = columns.some((column) => String(column.name || '').toLowerCase() === 'deleted_at');
    const hasDeletedBy = columns.some((column) => String(column.name || '').toLowerCase() === 'deleted_by');
    if (!hasDeletedAt) {
        await env.DB.prepare(`ALTER TABLE Payments ADD COLUMN deleted_at TEXT`).run();
    }
    if (!hasDeletedBy) {
        await env.DB.prepare(`ALTER TABLE Payments ADD COLUMN deleted_by TEXT`).run();
    }
    schemaEnsureState.paymentsSoftDelete = true;
}

async function ensureExpensesSoftDeleteColumns(env) {
    if (schemaEnsureState.expensesSoftDelete) return;
    const columns = (await env.DB.prepare(`PRAGMA table_info(Expenses)`).all()).results || [];
    const hasDeletedAt = columns.some((column) => String(column.name || '').toLowerCase() === 'deleted_at');
    const hasDeletedBy = columns.some((column) => String(column.name || '').toLowerCase() === 'deleted_by');
    if (!hasDeletedAt) {
        await env.DB.prepare(`ALTER TABLE Expenses ADD COLUMN deleted_at TEXT`).run();
    }
    if (!hasDeletedBy) {
        await env.DB.prepare(`ALTER TABLE Expenses ADD COLUMN deleted_by TEXT`).run();
    }
    schemaEnsureState.expensesSoftDelete = true;
}

function getOverpaidAmount(totalAmount, paidAmount) {
    return Number((Number(paidAmount || 0) - Number(totalAmount || 0)).toFixed(2));
}

function parseOrderFeeItems(rawFeesJson) {
    try {
        const parsed = JSON.parse(rawFeesJson || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((item) => ({
                ...item,
                name: String(item?.name || '').trim(),
                amount: Number(item?.amount || 0)
            }))
            .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0);
    } catch (e) {
        return [];
    }
}

function normalizeEditableFeeItems(rawFees) {
    const parsed = Array.isArray(rawFees) ? rawFees : JSON.parse(rawFees || '[]');
    if (!Array.isArray(parsed)) throw new Error('INVALID_FEES_JSON');
    return parsed
        .map((item) => ({
            ...item,
            name: String(item?.name || '').trim(),
            amount: Number(item?.amount || 0)
        }))
        .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0);
}

function applyStateMetricsToBucket(bucket, boothCount, paidAmount, totalAmount, options = {}) {
    const normalizedBoothCount = Number(boothCount || 0);
    const normalizedPaidAmount = Number(paidAmount || 0);
    const normalizedTotalAmount = Number(totalAmount || 0);
    if (options.includeCompany && typeof bucket.company_count === 'number') bucket.company_count += 1;

    if (normalizedPaidAmount <= 0) {
        if (typeof bucket.reserved_booth_count === 'number') bucket.reserved_booth_count += normalizedBoothCount;
        return;
    }

    if (normalizedPaidAmount < normalizedTotalAmount) {
        if (typeof bucket.deposit_booth_count === 'number') bucket.deposit_booth_count += normalizedBoothCount;
    } else {
        if (typeof bucket.full_paid_booth_count === 'number') bucket.full_paid_booth_count += normalizedBoothCount;
    }

    if (typeof bucket.paid_booth_count === 'number') bucket.paid_booth_count += normalizedBoothCount;
    if (options.includePaidCompany && typeof bucket.paid_company_count === 'number') bucket.paid_company_count += 1;
}

async function syncBoothStatusForOrder(env, orderId, projectId) {
    const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ? AND project_id = ?')
        .bind(Number(orderId), Number(projectId)).first();
    if (!order) return;
    await syncBoothStatusByBoothId(env, Number(projectId), String(order.booth_id || ''));
}

async function syncBoothStatusByBoothId(env, projectId, boothId) {
    const normalizedBoothId = String(boothId || '').trim();
    if (!projectId || !normalizedBoothId) return;
    const activeOrders = ((await env.DB.prepare(`
        SELECT paid_amount, total_amount
        FROM Orders
        WHERE project_id = ? AND booth_id = ? AND status = '正常'
    `).bind(Number(projectId), normalizedBoothId).all()).results || []);
    if (activeOrders.length === 0) {
        await env.DB.prepare("UPDATE Booths SET status = '可售' WHERE id = ? AND project_id = ?")
            .bind(normalizedBoothId, Number(projectId)).run();
        return;
    }
    const hasFullyPaidOrder = activeOrders.some((order) => Number(order.paid_amount || 0) >= Number(order.total_amount || 0));
    await env.DB.prepare("UPDATE Booths SET status = ? WHERE id = ? AND project_id = ?")
        .bind(hasFullyPaidOrder ? '已成交' : '已预订', normalizedBoothId, Number(projectId)).run();
}

async function refreshOrderOverpaymentIssue(env, orderId, projectId) {
    await ensureOverpaymentIssuesTable(env);
    const order = await env.DB.prepare(`
        SELECT id, project_id, total_amount, paid_amount
        FROM Orders
        WHERE id = ? AND project_id = ?
    `).bind(Number(orderId), Number(projectId)).first();
    if (!order) return null;

    const overpaidAmount = getOverpaidAmount(order.total_amount, order.paid_amount);
    const nowText = getChinaTimestamp();
    const existing = await env.DB.prepare('SELECT * FROM OrderOverpaymentIssues WHERE order_id = ?').bind(Number(orderId)).first();

    if (overpaidAmount > 0.01) {
        const shouldResetToPending = !existing || !existing.status || existing.status === 'resolved_by_fee_update' || Number(existing.overpaid_amount || 0) <= 0;
        const nextStatus = shouldResetToPending ? 'pending' : String(existing.status || 'pending');
        const nextReason = shouldResetToPending ? '' : String(existing.reason || '');
        const nextNote = shouldResetToPending ? '' : String(existing.note || '');
        const nextHandledBy = shouldResetToPending ? '' : String(existing.handled_by || '');
        const nextHandledAt = shouldResetToPending ? '' : String(existing.handled_at || '');
        const detectedAt = existing?.detected_at || nowText;

        await env.DB.prepare(`
            INSERT INTO OrderOverpaymentIssues (
                order_id, project_id, overpaid_amount, status, reason, note,
                handled_by, handled_at, detected_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                project_id = excluded.project_id,
                overpaid_amount = excluded.overpaid_amount,
                status = excluded.status,
                reason = excluded.reason,
                note = excluded.note,
                handled_by = excluded.handled_by,
                handled_at = excluded.handled_at,
                detected_at = excluded.detected_at,
                updated_at = excluded.updated_at
        `).bind(
            Number(orderId),
            Number(projectId),
            overpaidAmount,
            nextStatus,
            nextReason,
            nextNote,
            nextHandledBy,
            nextHandledAt,
            detectedAt,
            nowText
        ).run();

        return {
            overpaid_amount: overpaidAmount,
            status: nextStatus,
            reason: nextReason,
            note: nextNote
        };
    }

    if (existing) {
        await env.DB.prepare(`
            UPDATE OrderOverpaymentIssues
            SET overpaid_amount = 0,
                status = 'resolved_by_fee_update',
                updated_at = ?
            WHERE order_id = ?
        `).bind(nowText, Number(orderId)).run();
    }

    return {
        overpaid_amount: 0,
        status: 'resolved_by_fee_update',
        reason: existing?.reason || '',
        note: existing?.note || ''
    };
}

async function getErpConfig(env, projectId) {
    const config = await env.DB.prepare(`
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
    if (!config) return null;
    return {
        ...config,
        session_cookie: await decryptSensitiveValue(config.session_cookie, env)
    };
}

async function fetchErpPayload(config) {
    if (Number(config?.use_mock) === 1) {
        return JSON.parse(config.mock_payload || '{"rows": []}');
    }

    const sessionCookie = String(config?.session_cookie || '').trim();
    if (!sessionCookie) throw new Error('未配置 ERP 登录 Cookie / JSESSIONID');

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': sessionCookie.includes('JSESSIONID=') ? sessionCookie : `JSESSIONID=${sessionCookie}`
    };
    const pageSize = 100;
    const endpoint = String(config?.endpoint_url || '');
    const searchKeywords = endpoint.includes('hyDailyWaterController.do')
        ? buildProjectSearchKeywords(config?.expected_project_name).reverse()
        : [''];

    async function fetchPagedPayload(searchKeyword = '') {
        const erpUrl = searchKeyword ? buildErpRequestUrlWithSearch(config, searchKeyword) : buildErpRequestUrl(config);
        const allRows = [];
        let total = 0;

        for (let page = 1; page <= 50; page += 1) {
            const params = searchKeyword
                ? buildErpRequestParamsWithSearch(config, page, pageSize, searchKeyword)
                : buildErpRequestParams(config, page, pageSize);
            const response = await fetch(erpUrl, {
                method: 'POST',
                headers,
                body: new URLSearchParams(params).toString()
            });

            if (!response.ok) {
                throw new Error(`ERP 接口请求失败（HTTP ${response.status}）`);
            }

            const payload = await response.json();
            const rows = extractErpRows(payload);
            const payloadTotal = Number(payload?.total || 0);
            if (payloadTotal > 0) total = payloadTotal;
            allRows.push(...rows);

            if (rows.length === 0) {
                break;
            }

            if (total > 0 && allRows.length >= total) {
                break;
            }

            if (total <= 0 && rows.length < pageSize) {
                break;
            }
        }

        return {
            total: total || allRows.length,
            rows: allRows
        };
    }

    let fallbackResult = { total: 0, rows: [] };
    for (const keyword of searchKeywords) {
        const result = await fetchPagedPayload(keyword);
        if (result.total > 0 || result.rows.length > 0) {
            return result;
        }
        fallbackResult = result;
    }

    return fallbackResult;
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
        SELECT p.erp_record_id
        FROM Payments p
        INNER JOIN Orders o ON o.id = p.order_id
        WHERE p.project_id = ?
          AND p.erp_record_id IS NOT NULL
          AND p.erp_record_id != ''
          AND p.deleted_at IS NULL
          AND o.status NOT IN ('已退订', '已作废')
    `).bind(projectId).all()).results || [];

    return buildErpSyncPlan({
        rows,
        orders: orderRows,
        existingErpIds: existingRows.map((row) => row.erp_record_id),
        expectedProjectName: config.expected_project_name || '',
        expectedProjectId: config.water_id || ''
    });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
        const assetResponse = await env.ASSETS.fetch(request);
        return withResponseHeaders(assetResponse, buildSecurityHeaders({ includeCsp: true }));
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

    await Promise.all([
      ensurePaymentsSoftDeleteColumns(env),
      ensureExpensesSoftDeleteColumns(env)
    ]);

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
        const uploadError = validateUploadFile(file);
        if (uploadError) return errorResponse(uploadError, 400, corsHeaders);
        const fileExt = normalizeUploadExtension(file.name);
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
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ?').bind(username).first();
        const passwordMatches = user ? await verifyPassword(password, user.password) : false;
        if (!user || !passwordMatches) {
          const failure = await recordLoginFailure(env, loginContext);
          if (failure.lockedUntil) {
            return errorResponse(`连续输错 ${LOGIN_MAX_FAILURES} 次，账号已临时锁定至 ${failure.lockedUntil}`, 429, corsHeaders);
          }
          return errorResponse(`账号或密码错误，已连续失败 ${failure.failedCount} 次`, 401, corsHeaders);
        }
        await clearLoginAttempt(env, loginContext.key);
        const exp = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
        const token = await signJWT({ name: user.name, role: user.role, exp }, jwtSecret);
        const mustChangePassword = await isDefaultPasswordHash(user.password);
        return new Response(JSON.stringify({
          user: {
            name: user.name,
            role: user.role,
            token,
            must_change_password: mustChangePassword
          }
        }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const { staffName, oldPass, newPass } = await request.json();
        if (staffName && staffName !== currentUser.name) {
          return errorResponse('只能修改当前登录账号的密码', 403, corsHeaders);
        }
        const passwordError = validateNewPassword(newPass);
        if (passwordError) return errorResponse(passwordError, 400, corsHeaders);
        const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ?').bind(currentUser.name).first();
        if (!user) return errorResponse('账号不存在', 404, corsHeaders);
        const oldPasswordMatches = await verifyPassword(oldPass, user.password);
        if (!oldPasswordMatches) return errorResponse('原密码错误', 400, corsHeaders);
        if (oldPass === newPass) return errorResponse('新密码不能与原密码相同', 400, corsHeaders);
        const hashedNew = await hashPassword(newPass);
        await env.DB.prepare('UPDATE Staff SET password = ? WHERE name = ?').bind(hashedNew, currentUser.name).run();
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
          await ensureStaffDisplayOrderColumn(env);
          await ensureStaffSalesRankingColumn(env);
          const results = await env.DB.prepare(`SELECT name, role, target, display_order, exclude_from_sales_ranking FROM Staff ORDER BY ${STAFF_SORT_ORDER}`).all();
          return new Response(JSON.stringify(results.results), { headers: corsHeaders });
        } else if (request.method === 'POST') {
          const denied = requireSuperAdmin(currentUser, corsHeaders);
          if (denied) return denied;
          const { name, role } = await request.json();
          try {
            await ensureStaffDisplayOrderColumn(env);
            await ensureStaffSalesRankingColumn(env);
            const defaultHash = await hashPassword('123456');
            const maxOrderRow = await env.DB.prepare(`SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM Staff`).first();
            const nextOrder = Number(maxOrderRow?.maxOrder || 0) + 1;
            await env.DB.prepare("INSERT INTO Staff (name, password, role, display_order, exclude_from_sales_ranking) VALUES (?, ?, ?, ?, 0)").bind(name, defaultHash, role, nextOrder).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
          } catch (e) {
            return errorResponse('添加失败，可能姓名已存在', 400, corsHeaders);
          }
        }
      }

      if (url.pathname === '/api/delete-staff' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { staffName } = await request.json();
        if (staffName === 'admin') return errorResponse('不能删除超级管理员', 400, corsHeaders);
        await env.DB.prepare('DELETE FROM Staff WHERE name = ?').bind(staffName).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-staff-role' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { staffName, role } = await request.json();
        if (staffName === 'admin') return errorResponse('不能修改超级管理员角色', 400, corsHeaders);
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

      if (url.pathname === '/api/update-staff-order' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        await ensureStaffDisplayOrderColumn(env);
        const { staffName, direction } = await request.json();
        if (!staffName || !['up', 'down'].includes(String(direction))) {
          return errorResponse('参数错误', 400, corsHeaders);
        }
        if (String(staffName) === 'admin') {
          return errorResponse('超级管理员顺序固定', 400, corsHeaders);
        }
        const staffRows = (await env.DB.prepare(`
          SELECT name, display_order
          FROM Staff
          WHERE name != 'admin'
          ORDER BY display_order ASC, name COLLATE NOCASE ASC
        `).all()).results || [];
        const currentIndex = staffRows.findIndex((row) => row.name === staffName);
        if (currentIndex === -1) return errorResponse('找不到该员工', 404, corsHeaders);
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= staffRows.length) {
          return new Response(JSON.stringify({ success: true, unchanged: true }), { headers: corsHeaders });
        }
        const currentRow = staffRows[currentIndex];
        const targetRow = staffRows[targetIndex];
        await env.DB.batch([
          env.DB.prepare('UPDATE Staff SET display_order = ? WHERE name = ?').bind(Number(targetRow.display_order || 0), currentRow.name),
          env.DB.prepare('UPDATE Staff SET display_order = ? WHERE name = ?').bind(Number(currentRow.display_order || 0), targetRow.name)
        ]);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-staff-sales-ranking' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        await ensureStaffSalesRankingColumn(env);
        const { staffName, excludeFromSalesRanking } = await request.json();
        if (!staffName) return errorResponse('参数错误', 400, corsHeaders);
        await env.DB.prepare('UPDATE Staff SET exclude_from_sales_ranking = ? WHERE name = ?')
          .bind(Number(excludeFromSalesRanking) ? 1 : 0, staffName)
          .run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 【新增】：重置密码接口
      if (url.pathname === '/api/reset-password' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { staffName } = await request.json();
        if (staffName === 'admin') return errorResponse('不能重置超级管理员的密码', 400, corsHeaders);
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
        if (!pid) return errorResponse('缺少项目 ID', 400, corsHeaders);
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

      if (url.pathname === '/api/order-field-settings' && request.method === 'GET') {
        const pid = new URL(request.url).searchParams.get('projectId');
        if (!pid) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const settings = await getOrderFieldSettings(env, pid);
        return new Response(JSON.stringify(settings), { headers: corsHeaders });
      }

      if (url.pathname === '/api/save-order-field-settings' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id, settings } = await request.json();
        if (!project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const saved = await saveOrderFieldSettings(env, project_id, settings);
        return new Response(JSON.stringify({ success: true, settings: saved }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/save-erp-config' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const payload = await request.json();
        if (!payload.project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const encryptedSessionCookie = await encryptSensitiveValue(String(payload.session_cookie || '').trim(), env);

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
          encryptedSessionCookie,
          String(payload.expected_project_name || '').trim()
        ).run();

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/erp-sync-preview' && request.method === 'POST') {
        const denied = requireSuperAdmin(currentUser, corsHeaders);
        if (denied) return denied;
        const { project_id } = await request.json();
        if (!project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const config = await getErpConfig(env, project_id);
        if (!config || Number(config.enabled) !== 1) {
          return errorResponse('请先在系统配置中启用 ERP 收款同步', 400, corsHeaders);
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
        if (!project_id) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const config = await getErpConfig(env, project_id);
        if (!config || Number(config.enabled) !== 1) {
          return errorResponse('请先在系统配置中启用 ERP 收款同步', 400, corsHeaders);
        }

        const plan = await buildErpPreviewResult(env, Number(project_id), config);
        if (plan.importableItems.length > 0) {
          for (const item of plan.importableItems) {
            const existingPayment = await env.DB.prepare(`
          SELECT
            p.id,
            p.order_id,
            p.project_id,
            p.amount,
            o.status as order_status
              FROM Payments p
              LEFT JOIN Orders o ON o.id = p.order_id
              WHERE p.erp_record_id = ?
                AND p.deleted_at IS NULL
              LIMIT 1
            `).bind(String(item.erp_record_id)).first();

            if (existingPayment) {
              const oldOrderStatus = String(existingPayment.order_status || '');
              const canRebindCancelledOrder = oldOrderStatus === '已退订' || oldOrderStatus === '已作废';

              if (!canRebindCancelledOrder) {
                continue;
              }

              await env.DB.batch([
                env.DB.prepare('UPDATE Orders SET paid_amount = MAX(0, paid_amount - ?) WHERE id = ?')
                  .bind(Number(existingPayment.amount || 0), Number(existingPayment.order_id)),
                env.DB.prepare(`
                  UPDATE Payments
                  SET project_id = ?,
                      order_id = ?,
                      amount = ?,
                      payment_time = ?,
                      payer_name = ?,
                      bank_name = ?,
                      remarks = ?,
                      source = ?,
                      raw_payload = ?
                  WHERE id = ?
                `).bind(
                  Number(item.project_id),
                  Number(item.order_id),
                  Number(item.amount),
                  String(item.payment_time),
                  String(item.payer_name || ''),
                  String(item.bank_name || ''),
                  String(item.remarks || ''),
                  String(item.source || 'ERP_SYNC'),
                  String(item.raw_payload || ''),
                  Number(existingPayment.id)
                ),
                env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?')
                  .bind(Number(item.amount), Number(item.order_id))
              ]);
              continue;
            }

            await env.DB.batch([
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
              ),
              env.DB.prepare('UPDATE Orders SET paid_amount = paid_amount + ? WHERE id = ?')
                .bind(Number(item.amount), Number(item.order_id))
            ]);
          }

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

          const syncedOrderPairs = Array.from(new Set(
            plan.importableItems.map((item) => `${item.project_id}::${item.order_id}`)
          ));
          for (const pair of syncedOrderPairs) {
            const [syncedProjectId, syncedOrderId] = pair.split('::');
            await refreshOrderOverpaymentIssue(env, Number(syncedOrderId), Number(syncedProjectId));
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
          if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
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
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { project_id, id, hall, type, area, price_unit, base_price } = await request.json();
        try {
          await env.DB.prepare('INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(id, project_id, hall, type, area, price_unit, base_price || 0, '可售').run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
          return errorResponse('添加失败，展位号可能已存在', 400, corsHeaders);
        }
      }

      if (url.pathname === '/api/edit-booth' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { project_id, id, type, area, base_price } = await request.json();
        await env.DB.prepare('UPDATE Booths SET type=?, area=?, base_price=?, price_unit=? WHERE id=? AND project_id=?')
              .bind(type, area, base_price, type==='光地'?'平米':'个', id, project_id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-booth-status' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
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
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
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
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        const { projectId, booths } = await request.json();
        const stmts = booths.map(b => 
          env.DB.prepare('INSERT INTO Booths (id, project_id, hall, type, area, price_unit, base_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id, project_id) DO UPDATE SET hall=excluded.hall, type=excluded.type, area=excluded.area')
          .bind(b.id, projectId, b.hall, b.type, b.area, b.price_unit, 0, '可售')
        );
        await env.DB.batch(stmts);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/orders' && request.method === 'GET') {
        await ensureOverpaymentIssuesTable(env);
        const urlObj = new URL(request.url);
        const pid = urlObj.searchParams.get('projectId');
        const selectedSales = currentUser.role === 'admin' ? urlObj.searchParams.get('salesName') : null;
        const superAdminFlag = isSuperAdmin(currentUser) ? 1 : 0;
        
        let query = `
          SELECT
            o.*,
            b.hall,
            b.type as booth_type,
            CASE WHEN ? = 'admin' OR o.sales_name = ? THEN 1 ELSE 0 END as can_manage,
            CASE WHEN ? = 'admin' OR o.sales_name = ? THEN 1 ELSE 0 END as can_preview_contract,
            CASE WHEN o.contract_url IS NOT NULL AND o.contract_url != '' THEN 1 ELSE 0 END as has_contract,
            CASE
              WHEN ? = 1 OR o.sales_name = ? THEN o.contact_person
              ELSE CASE WHEN o.contact_person IS NULL OR o.contact_person = '' THEN '未填' ELSE '***' END
            END as contact_person,
            CASE
              WHEN ? = 1 OR o.sales_name = ? THEN o.phone
              ELSE CASE
                WHEN o.phone IS NULL OR o.phone = '' THEN '未填'
                WHEN length(o.phone) >= 7 THEN substr(o.phone, 1, 3) || '****' || substr(o.phone, -4)
                ELSE '***'
              END
            END as phone,
            CASE WHEN ? = 'admin' OR o.sales_name = ? THEN o.contract_url ELSE NULL END as contract_url,
            COALESCE(oi.overpaid_amount, CASE WHEN o.paid_amount > o.total_amount THEN ROUND(o.paid_amount - o.total_amount, 2) ELSE 0 END) as overpaid_amount,
            CASE
              WHEN COALESCE(oi.overpaid_amount, 0) > 0 THEN oi.status
              WHEN o.paid_amount > o.total_amount THEN 'pending'
              ELSE ''
            END as overpayment_status,
            COALESCE(oi.reason, '') as overpayment_reason,
            COALESCE(oi.note, '') as overpayment_note,
            COALESCE(oi.handled_by, '') as overpayment_handled_by,
            COALESCE(oi.handled_at, '') as overpayment_handled_at,
            CASE WHEN ? = 1 OR o.sales_name = ? THEN 1 ELSE 0 END as can_handle_overpayment
          FROM Orders o 
          LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id 
          LEFT JOIN OrderOverpaymentIssues oi ON oi.order_id = o.id
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废')
            AND (? = 'admin' OR o.sales_name = ? OR o.paid_amount >= o.total_amount)
        `;
        let params = [
          currentUser.role, currentUser.name,
          currentUser.role, currentUser.name,
          superAdminFlag, currentUser.name,
          superAdminFlag, currentUser.name,
          currentUser.role, currentUser.name,
          superAdminFlag, currentUser.name,
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
          WHERE ${expenseWhere} AND e.deleted_at IS NULL
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
        if (!pid) return errorResponse('缺少项目 ID', 400, corsHeaders);

        const projectRow = await env.DB.prepare(`
          SELECT id, name, year, start_date, end_date
          FROM Projects
          WHERE id = ?
        `).bind(pid).first();
        const projectYear = Number(projectRow?.year || new Date(Date.now() + (8 * 60 * 60 * 1000)).getUTCFullYear());

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

        await ensureStaffDisplayOrderColumn(env);
        await ensureStaffSalesRankingColumn(env);
        const staffRows = currentUser.role === 'admin'
          ? ((await env.DB.prepare(`SELECT name, role, target, display_order, exclude_from_sales_ranking FROM Staff ORDER BY ${STAFF_SORT_ORDER}`).all()).results || [])
          : [await env.DB.prepare('SELECT name, role, target, display_order, exclude_from_sales_ranking FROM Staff WHERE name = ?').bind(currentUser.name).first()].filter(Boolean);

        const salesListStaffRows = ((await env.DB.prepare(`
          SELECT name, role, target, display_order, exclude_from_sales_ranking
          FROM Staff
          WHERE COALESCE(exclude_from_sales_ranking, 0) = 0
          ORDER BY ${STAFF_SORT_ORDER}
        `).all()).results || []);

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
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废') AND p.deleted_at IS NULL
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
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废') AND p.deleted_at IS NULL
        `).bind(pid).all()).results || [];
        await ensureOrderBoothChangesTable(env);
        const scopedActiveOrderIds = new Set(scopedOrders.map((order) => String(order.id || '')).filter(Boolean));
        const globalActiveOrderIds = new Set(globalActiveOrders.map((order) => String(order.id || '')).filter(Boolean));
        const orderBoothChangeRows = globalActiveOrderIds.size > 0
          ? (((await env.DB.prepare(`
              SELECT order_id, booth_delta_count, total_amount_delta, changed_at
              FROM OrderBoothChanges
              WHERE project_id = ?
              ORDER BY changed_at ASC, id ASC
            `).bind(pid).all()).results || []).filter((row) => globalActiveOrderIds.has(String(row.order_id || ''))))
          : [];

        const getPeriodKeys = (paymentDate) => {
          const keys = ['total'];
          if (!paymentDate) return keys;
          if (paymentDate === todayKey) keys.push('today');
          if (paymentDate >= weekStartKey) keys.push('week');
          if (paymentDate.startsWith(monthPrefix)) keys.push('month');
          return keys;
        };

        const getDateYearMonth = (dateValue) => {
          const normalized = String(dateValue || '').slice(0, 10);
          if (!normalized) return null;
          const [yearPart, monthPart] = normalized.split('-');
          const yearNum = Number(yearPart);
          const monthNum = Number(monthPart);
          if (!Number.isFinite(yearNum) || !Number.isFinite(monthNum)) return null;
          if (monthNum < 1 || monthNum > 12) return null;
          return {
            year: yearNum,
            month: monthNum,
            normalized
          };
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

        const createMonthlyPeriodMap = (targetTotal = 0) => Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [String(index + 1), createPeriodBucket(targetTotal)])
        );

        const createYearlyMonthlyPeriodMap = (targetTotal = 0, years = []) => Object.fromEntries(
          years.map((year) => [String(year), createMonthlyPeriodMap(targetTotal)])
        );

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

        const createSalesListMonthlyMap = (targetTotal = 0) => Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [String(index + 1), createSalesListBucket(targetTotal)])
        );

        const createYearlySalesListMonthlyMap = (targetTotal = 0, years = []) => Object.fromEntries(
          years.map((year) => [String(year), createSalesListMonthlyMap(targetTotal)])
        );

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

        const buildFirstPaymentByOrder = (rows = []) => {
          const firstPaymentMap = {};
          rows.forEach((payment) => {
            const orderKey = String(payment.order_id || '');
            const paymentDate = String(payment.payment_time || '').slice(0, 10);
            if (!orderKey || !paymentDate) return;
            const existing = firstPaymentMap[orderKey];
            if (!existing || paymentDate < existing.payment_date) {
              firstPaymentMap[orderKey] = {
                order_id: orderKey,
                sales_name: payment.sales_name || '',
                payment_date: paymentDate
              };
            }
          });
          return firstPaymentMap;
        };

        const buildBoothChangeSummaryByOrder = (rows = []) => {
          const summaryMap = {};
          rows.forEach((row) => {
            const orderKey = String(row.order_id || '');
            const changedAt = String(row.changed_at || '').slice(0, 10);
            if (!orderKey || !changedAt) return;
            if (!summaryMap[orderKey]) {
              summaryMap[orderKey] = {
                booth_delta_total: 0,
                total_amount_delta_total: 0,
                events: []
              };
            }
            const boothDeltaCount = Number(Number(row.booth_delta_count || 0).toFixed(2));
            const totalAmountDelta = Number(Number(row.total_amount_delta || 0).toFixed(2));
            summaryMap[orderKey].booth_delta_total = Number((summaryMap[orderKey].booth_delta_total + boothDeltaCount).toFixed(2));
            summaryMap[orderKey].total_amount_delta_total = Number((summaryMap[orderKey].total_amount_delta_total + totalAmountDelta).toFixed(2));
            summaryMap[orderKey].events.push({
              changed_at: changedAt,
              booth_delta_count: boothDeltaCount,
              total_amount_delta: totalAmountDelta
            });
          });
          return summaryMap;
        };

        const scopedFirstPaymentByOrder = buildFirstPaymentByOrder(paymentRows);
        const globalFirstPaymentByOrder = buildFirstPaymentByOrder(globalPaymentRows);
        const globalBoothChangeSummaryByOrder = buildBoothChangeSummaryByOrder(orderBoothChangeRows);
        const scopedBoothChangeSummaryByOrder = buildBoothChangeSummaryByOrder(
          orderBoothChangeRows.filter((row) => scopedActiveOrderIds.has(String(row.order_id || '')))
        );
        const salesAvailableYears = Array.from(new Set([
          projectYear,
          ...Object.values(globalFirstPaymentByOrder).map((payment) => Number(String(payment.payment_date || '').slice(0, 4))),
          ...globalPaymentRows.map((payment) => Number(String(payment.payment_time || '').slice(0, 4))),
          ...orderBoothChangeRows.map((change) => Number(String(change.changed_at || '').slice(0, 4)))
        ].filter((year) => Number.isFinite(year) && year > 0))).sort((a, b) => b - a);

        const salesOverview = staffRows.map((staff) => {
          const staffOrders = allActiveOrders.filter((order) => order.sales_name === staff.name);
          const completedOrders = staffOrders.filter((order) => toSafeNumber(order.paid_amount) >= toSafeNumber(order.total_amount));
          const targetBooths = toSafeNumber(staff.target);
          const completedBooths = Number(completedOrders.reduce((sum, order) => sum + toBoothCount(order.area), 0).toFixed(2));
          const receivableTotal = Number(staffOrders.reduce((sum, order) => sum + toSafeNumber(order.total_amount), 0).toFixed(2));
          const receivedTotal = Number(globalPaymentRows
            .filter((payment) => payment.sales_name === staff.name)
            .reduce((sum, payment) => sum + toSafeNumber(payment.amount), 0)
            .toFixed(2));
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
        const receivedTotalHome = Number(paymentRows.reduce((sum, payment) => sum + toSafeNumber(payment.amount), 0).toFixed(2));
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
        const salesSummaryMonthlyPeriods = createYearlyMonthlyPeriodMap(targetTotal, salesAvailableYears);
        const salesListPeriodMap = {};
        const salesListMonthlyPeriodMap = {};
        const salesChampionMap = { today: {}, week: {}, month: {}, total: {} };
        const salesChampionMonthlyMap = Object.fromEntries(
          salesAvailableYears.map((year) => [String(year), Object.fromEntries(
            Array.from({ length: 12 }, (_, index) => [String(index + 1), {}])
          )])
        );
        salesListStaffRows.forEach((staff) => {
          salesListPeriodMap[staff.name] = createSalesListPeriodMap(toSafeNumber(staff.target));
          salesListMonthlyPeriodMap[staff.name] = createYearlySalesListMonthlyMap(toSafeNumber(staff.target), salesAvailableYears);
        });

        scopedOrders.forEach((order) => {
          const boothCount = toBoothCount(order.area);
          const paidAmount = toSafeNumber(order.paid_amount);
          const totalAmount = toSafeNumber(order.total_amount);
          const orderKey = String(order.id || '');
          const boothChangeSummary = scopedBoothChangeSummaryByOrder[orderKey] || {
            booth_delta_total: 0,
            total_amount_delta_total: 0,
            events: []
          };
          const baseBoothCount = Number(Math.max(0, boothCount - Number(boothChangeSummary.booth_delta_total || 0)).toFixed(2));
          const baseTotalAmount = Number(Math.max(0, totalAmount - Number(boothChangeSummary.total_amount_delta_total || 0)).toFixed(2));

          salesSummaryPeriods.total.company_count += 1;
          salesSummaryPeriods.total.receivable_total += totalAmount;

          if (paidAmount <= 0) {
            salesSummaryPeriods.total.reserved_booth_count += boothCount;
          } else if (paidAmount < totalAmount) {
            salesSummaryPeriods.total.deposit_booth_count += boothCount;
          } else {
            salesSummaryPeriods.total.full_paid_booth_count += boothCount;
          }

          const firstPayment = scopedFirstPaymentByOrder[orderKey];
          if (!firstPayment?.payment_date) return;
          const periodKeys = getPeriodKeys(firstPayment.payment_date).filter((periodKey) => periodKey !== 'total');
          const yearMonth = getDateYearMonth(firstPayment.payment_date);

          periodKeys.forEach((periodKey) => {
            const bucket = salesSummaryPeriods[periodKey];
            bucket.receivable_total += baseTotalAmount;
            applyStateMetricsToBucket(bucket, baseBoothCount, paidAmount, totalAmount, {
              includeCompany: true,
              includePaidCompany: paidAmount > 0
            });
          });

          if (yearMonth && salesSummaryMonthlyPeriods[String(yearMonth.year)]) {
            const monthBucket = salesSummaryMonthlyPeriods[String(yearMonth.year)][String(yearMonth.month)];
            monthBucket.receivable_total += baseTotalAmount;
            applyStateMetricsToBucket(monthBucket, baseBoothCount, paidAmount, totalAmount, {
              includeCompany: true,
              includePaidCompany: paidAmount > 0
            });
          }

          boothChangeSummary.events.forEach((event) => {
            const changePeriodKeys = getPeriodKeys(event.changed_at).filter((periodKey) => periodKey !== 'total');
            const changeYearMonth = getDateYearMonth(event.changed_at);
            changePeriodKeys.forEach((periodKey) => {
              const bucket = salesSummaryPeriods[periodKey];
              bucket.receivable_total += Number(event.total_amount_delta || 0);
              applyStateMetricsToBucket(bucket, Number(event.booth_delta_count || 0), paidAmount, totalAmount);
            });
            if (changeYearMonth && salesSummaryMonthlyPeriods[String(changeYearMonth.year)]) {
              const bucket = salesSummaryMonthlyPeriods[String(changeYearMonth.year)][String(changeYearMonth.month)];
              bucket.receivable_total += Number(event.total_amount_delta || 0);
              applyStateMetricsToBucket(bucket, Number(event.booth_delta_count || 0), paidAmount, totalAmount);
            }
          });
        });

        paymentRows.forEach((payment) => {
          const paymentDate = String(payment.payment_time || '').slice(0, 10);
          const periodKeys = getPeriodKeys(paymentDate);
          const yearMonth = getDateYearMonth(paymentDate);
          const amount = toSafeNumber(payment.amount);
          const boothCount = toBoothCount(payment.area);
          const orderKey = `${payment.order_id}`;

          periodKeys.forEach((periodKey) => {
            const summaryBucket = salesSummaryPeriods[periodKey];
            summaryBucket.received_total += amount;
            if (!summaryBucket._seenOrders.has(orderKey)) {
              summaryBucket._seenOrders.add(orderKey);
              summaryBucket.paid_booth_count += boothCount;
              summaryBucket.paid_company_count += 1;
            }
          });

          if (yearMonth && salesSummaryMonthlyPeriods[String(yearMonth.year)]) {
            const summaryBucket = salesSummaryMonthlyPeriods[String(yearMonth.year)][String(yearMonth.month)];
            summaryBucket.received_total += amount;
            if (!summaryBucket._seenOrders.has(orderKey)) {
              summaryBucket._seenOrders.add(orderKey);
              summaryBucket.paid_booth_count += boothCount;
              summaryBucket.paid_company_count += 1;
            }
          }
        });

        globalActiveOrders.forEach((order) => {
          const bucketMap = salesListPeriodMap[order.sales_name];
          const monthBucketMap = salesListMonthlyPeriodMap[order.sales_name];
          if (!bucketMap) return;
          const boothCount = toBoothCount(order.area);
          const paidAmount = toSafeNumber(order.paid_amount);
          const totalAmount = toSafeNumber(order.total_amount);
          const orderKey = String(order.id || '');
          const boothChangeSummary = globalBoothChangeSummaryByOrder[orderKey] || {
            booth_delta_total: 0,
            total_amount_delta_total: 0,
            events: []
          };
          const baseBoothCount = Number(Math.max(0, boothCount - Number(boothChangeSummary.booth_delta_total || 0)).toFixed(2));
          const baseTotalAmount = Number(Math.max(0, totalAmount - Number(boothChangeSummary.total_amount_delta_total || 0)).toFixed(2));
          bucketMap.total.receivable_total += totalAmount;

          if (paidAmount <= 0) {
            bucketMap.total.reserved_booth_count += boothCount;
          } else if (paidAmount < totalAmount) {
            bucketMap.total.deposit_booth_count += boothCount;
          } else {
            bucketMap.total.full_paid_booth_count += boothCount;
          }

          const firstPayment = globalFirstPaymentByOrder[orderKey];
          if (!firstPayment?.payment_date) return;
          const periodKeys = getPeriodKeys(firstPayment.payment_date).filter((periodKey) => periodKey !== 'total');
          const yearMonth = getDateYearMonth(firstPayment.payment_date);

          periodKeys.forEach((periodKey) => {
            const bucket = bucketMap[periodKey];
            bucket.receivable_total += baseTotalAmount;
            applyStateMetricsToBucket(bucket, baseBoothCount, paidAmount, totalAmount);
          });

          if (yearMonth && monthBucketMap?.[String(yearMonth.year)]) {
            const monthBucket = monthBucketMap[String(yearMonth.year)][String(yearMonth.month)];
            monthBucket.receivable_total += baseTotalAmount;
            applyStateMetricsToBucket(monthBucket, baseBoothCount, paidAmount, totalAmount);
          }

          if (paidAmount > 0 && baseBoothCount > 0) {
            getPeriodKeys(firstPayment.payment_date).forEach((periodKey) => {
              salesChampionMap[periodKey][order.sales_name] = Number((
                Number(salesChampionMap[periodKey][order.sales_name] || 0) + baseBoothCount
              ).toFixed(2));
            });
            if (yearMonth && salesChampionMonthlyMap[String(yearMonth.year)]) {
              const monthlyChampionMap = salesChampionMonthlyMap[String(yearMonth.year)][String(yearMonth.month)];
              monthlyChampionMap[order.sales_name] = Number((
                Number(monthlyChampionMap[order.sales_name] || 0) + baseBoothCount
              ).toFixed(2));
            }
          }

          boothChangeSummary.events.forEach((event) => {
            const deltaBoothCount = Number(event.booth_delta_count || 0);
            const deltaAmount = Number(event.total_amount_delta || 0);
            const changePeriodKeys = getPeriodKeys(event.changed_at).filter((periodKey) => periodKey !== 'total');
            const changeYearMonth = getDateYearMonth(event.changed_at);
            changePeriodKeys.forEach((periodKey) => {
              const bucket = bucketMap[periodKey];
              bucket.receivable_total += deltaAmount;
              applyStateMetricsToBucket(bucket, deltaBoothCount, paidAmount, totalAmount);
            });
            if (changeYearMonth && monthBucketMap?.[String(changeYearMonth.year)]) {
              const bucket = monthBucketMap[String(changeYearMonth.year)][String(changeYearMonth.month)];
              bucket.receivable_total += deltaAmount;
              applyStateMetricsToBucket(bucket, deltaBoothCount, paidAmount, totalAmount);
            }
            if (paidAmount > 0 && deltaBoothCount > 0) {
              getPeriodKeys(event.changed_at).forEach((periodKey) => {
                salesChampionMap[periodKey][order.sales_name] = Number((
                  Number(salesChampionMap[periodKey][order.sales_name] || 0) + deltaBoothCount
                ).toFixed(2));
              });
              if (changeYearMonth && salesChampionMonthlyMap[String(changeYearMonth.year)]) {
                const monthlyChampionMap = salesChampionMonthlyMap[String(changeYearMonth.year)][String(changeYearMonth.month)];
                monthlyChampionMap[order.sales_name] = Number((
                  Number(monthlyChampionMap[order.sales_name] || 0) + deltaBoothCount
                ).toFixed(2));
              }
            }
          });
        });

        globalPaymentRows.forEach((payment) => {
          const paymentDate = String(payment.payment_time || '').slice(0, 10);
          const periodKeys = getPeriodKeys(paymentDate);
          const yearMonth = getDateYearMonth(paymentDate);
          const amount = toSafeNumber(payment.amount);
          const bucketMap = salesListPeriodMap[payment.sales_name];
          const monthBucketMap = salesListMonthlyPeriodMap[payment.sales_name];
          if (!bucketMap) return;

          periodKeys.forEach((periodKey) => {
            bucketMap[periodKey].received_total += amount;
          });

          if (yearMonth && monthBucketMap?.[String(yearMonth.year)]) {
            monthBucketMap[String(yearMonth.year)][String(yearMonth.month)].received_total += amount;
          }
        });

        const salesSummaryPeriodStats = Object.fromEntries(
          Object.entries(salesSummaryPeriods).map(([periodKey, bucket]) => [periodKey, finalizePeriodBucket(bucket)])
        );
        const salesSummaryMonthlyStats = Object.fromEntries(
          Object.entries(salesSummaryMonthlyPeriods).map(([yearKey, monthMap]) => [yearKey, Object.fromEntries(
            Object.entries(monthMap).map(([monthKey, bucket]) => [monthKey, finalizePeriodBucket(bucket)])
          )])
        );

        const salesListPeriods = {
          today: [],
          week: [],
          month: [],
          total: []
        };
        const salesListMonthlyPeriods = Object.fromEntries(
          salesAvailableYears.map((year) => [String(year), Object.fromEntries(
            Array.from({ length: 12 }, (_, index) => [String(index + 1), []])
          )])
        );

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

          const monthlyMap = salesListMonthlyPeriodMap[staffName] || {};
          Object.entries(monthlyMap).forEach(([yearKey, yearBucketMap]) => {
            Object.entries(yearBucketMap).forEach(([monthKey, bucket]) => {
              const monthlyBucket = finalizeSalesListBucket(bucket);
              salesListMonthlyPeriods[yearKey][monthKey].push({
                staff_name: staffName,
                role: staffMeta?.role || 'user',
                target_booths: monthlyBucket.target_total,
                reserved_booth_count: monthlyBucket.reserved_booth_count,
                deposit_booth_count: monthlyBucket.deposit_booth_count,
                full_paid_booth_count: monthlyBucket.full_paid_booth_count,
                remaining_target: monthlyBucket.remaining_target,
                completion_rate: monthlyBucket.completion_rate,
                receivable_total: monthlyBucket.receivable_total,
                received_total: monthlyBucket.received_total,
                collection_rate: monthlyBucket.collection_rate
              });
            });
          });
        });

        const salesListMeta = Object.fromEntries(
          ['today', 'week', 'month'].map((periodKey) => {
            const championEntries = Object.entries(salesChampionMap[periodKey] || {}).sort((a, b) => {
              if (b[1] !== a[1]) return b[1] - a[1];
              return a[0].localeCompare(b[0], 'zh-CN');
            });
            const topEntry = championEntries[0];
            const topBoothCount = topEntry ? Number(Number(topEntry[1] || 0).toFixed(2)) : 0;
            return [periodKey, {
              champion_name: topBoothCount > 0 ? topEntry[0] : '暂无',
              champion_booth_count: topBoothCount
            }];
          })
        );
        const totalChampionRows = [...salesListPeriods.total].sort((a, b) => {
          const boothCountA = Number(a.deposit_booth_count || 0) + Number(a.full_paid_booth_count || 0);
          const boothCountB = Number(b.deposit_booth_count || 0) + Number(b.full_paid_booth_count || 0);
          if (boothCountB !== boothCountA) return boothCountB - boothCountA;
          return String(a.staff_name || '').localeCompare(String(b.staff_name || ''), 'zh-CN');
        });
        const totalChampion = totalChampionRows[0];
        const totalChampionBoothCount = totalChampion
          ? Number((Number(totalChampion.deposit_booth_count || 0) + Number(totalChampion.full_paid_booth_count || 0)).toFixed(2))
          : 0;
        salesListMeta.total = {
          champion_name: totalChampionBoothCount > 0 ? totalChampion.staff_name : '暂无',
          champion_booth_count: totalChampionBoothCount
        };
        const salesListMonthlyMeta = Object.fromEntries(
          salesAvailableYears.map((year) => [String(year), Object.fromEntries(
            Array.from({ length: 12 }, (_, index) => {
              const monthKey = String(index + 1);
              const championEntries = Object.entries(salesChampionMonthlyMap[String(year)]?.[monthKey] || {}).sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1];
                return a[0].localeCompare(b[0], 'zh-CN');
              });
              const topEntry = championEntries[0];
              const topBoothCount = topEntry ? Number(Number(topEntry[1] || 0).toFixed(2)) : 0;
              return [monthKey, {
                champion_name: topBoothCount > 0 ? topEntry[0] : '暂无',
                champion_booth_count: topBoothCount
              }];
            })
          )])
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
          sales_summary_monthly_periods: salesSummaryMonthlyStats,
          sales_summary_year: projectYear,
          sales_available_years: salesAvailableYears,
          sales_list_periods: salesListPeriods,
          sales_list_meta: salesListMeta,
          sales_list_monthly_periods: salesListMonthlyPeriods,
          sales_list_monthly_meta: salesListMonthlyMeta,
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
        const noBoothOrder = Number(o.no_booth_order || 0) === 1;
        let normalizedFees = [];
        try {
          normalizedFees = normalizeEditableFeeItems(o.fees_json || '[]');
        } catch (e) {
          return errorResponse('其他应收费用格式不正确', 400, corsHeaders);
        }
        const totalOtherIncome = Number(normalizedFees.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
        const totalBoothFee = Number(Number(o.total_booth_fee || 0).toFixed(2));

        const selectedBooths = noBoothOrder
          ? [{
              booth_id: '',
              area: 0,
              price_unit: '无展位',
              unit_price: 0,
              standard_fee: 0,
              is_joint: 0,
              no_booth_order: 1
            }]
          : Array.isArray(o.selected_booths) && o.selected_booths.length > 0
            ? o.selected_booths.map((item) => ({
                booth_id: String(item.booth_id || '').trim(),
                area: Number(item.area || 0),
                price_unit: String(item.price_unit || '').trim(),
                unit_price: Number(item.unit_price || 0),
                standard_fee: Number(item.standard_fee || 0),
                is_joint: Number(item.is_joint || 0) ? 1 : 0
              })).filter((item) => item.booth_id && item.area >= 0)
            : [{
                booth_id: String(o.booth_id || '').trim(),
                area: Number(o.area || 0),
                price_unit: String(o.price_unit || '').trim(),
                unit_price: Number(o.unit_price || 0),
                standard_fee: Number(o.total_booth_fee || 0),
                is_joint: 0
              }];

        if (!noBoothOrder && selectedBooths.length === 0) {
          return errorResponse('请至少选择一个展位', 400, corsHeaders);
        }

        const totalStandardFee = Number(selectedBooths.reduce((sum, item) => sum + Number(item.standard_fee || 0), 0).toFixed(2));
        const totalSelectedArea = Number(selectedBooths.reduce((sum, item) => sum + Number(item.area || 0), 0).toFixed(2));
        if (totalBoothFee < 0) return errorResponse('最终成交展位费不能为负数', 400, corsHeaders);
        if (noBoothOrder) {
          if (totalBoothFee !== 0) return errorResponse('无展位订单的应收展位费必须为0', 400, corsHeaders);
          if (normalizedFees.length === 0 || totalOtherIncome <= 0) return errorResponse('无展位订单必须至少包含一项其他应收费用', 400, corsHeaders);
        } else if (totalSelectedArea <= 0 && totalBoothFee > 0) {
          return errorResponse('0面积联合参展的应收展位费必须为0', 400, corsHeaders);
        }

        let remainingBoothFee = totalBoothFee;
        let remainingOtherIncome = totalOtherIncome;

        const distributedBooths = selectedBooths.map((item, index) => {
          const isLast = index === selectedBooths.length - 1;
          let boothFeePart = 0;
          let otherIncomePart = 0;
          if (isLast) {
            boothFeePart = Number(remainingBoothFee.toFixed(2));
            otherIncomePart = Number(remainingOtherIncome.toFixed(2));
          } else {
            const ratioBase = totalStandardFee > 0 ? Number(item.standard_fee || 0) : 1;
            const ratio = totalStandardFee > 0 ? ratioBase / totalStandardFee : 1 / selectedBooths.length;
            boothFeePart = Number((totalBoothFee * ratio).toFixed(2));
            otherIncomePart = Number((totalOtherIncome * ratio).toFixed(2));
            remainingBoothFee = Number((remainingBoothFee - boothFeePart).toFixed(2));
            remainingOtherIncome = Number((remainingOtherIncome - otherIncomePart).toFixed(2));
          }
          return {
            ...item,
            total_booth_fee: boothFeePart,
            other_income: otherIncomePart,
            total_amount: Number((boothFeePart + otherIncomePart).toFixed(2)),
            fees_json: index === 0 ? JSON.stringify(normalizedFees) : '[]'
          };
        });

        for (const boothItem of distributedBooths) {
          let existingOrder = null;
          if (boothItem.booth_id) {
            existingOrder = await env.DB.prepare("SELECT id FROM Orders WHERE project_id = ? AND booth_id = ? AND status = '正常' ORDER BY created_at ASC LIMIT 1").bind(o.project_id, boothItem.booth_id).first();
          }
          if (existingOrder && boothItem.is_joint && boothItem.area > 0) {
            stmts.push(env.DB.prepare("UPDATE Orders SET area = ROUND(area - ?, 2) WHERE id = ?").bind(boothItem.area, existingOrder.id));
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
            o.is_agent ? 1 : 0, o.agent_name, o.contact_person, o.phone, o.region, boothItem.booth_id || '', boothItem.area, boothItem.price_unit, boothItem.unit_price,
            boothItem.total_booth_fee, o.discount_reason, boothItem.other_income, boothItem.fees_json, o.profile, boothItem.total_amount, 0,
            o.contract_url || null, o.sales_name, '正常'
          ));

          if (boothItem.booth_id) {
            stmts.push(env.DB.prepare(
              "UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ? AND status NOT IN ('已预订', '已成交')"
            ).bind(boothItem.booth_id, o.project_id));
          }
        }

        await env.DB.batch(stmts);
        return new Response(JSON.stringify({ success: true, created_count: distributedBooths.length }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/update-customer-info' && request.method === 'POST') {
        const d = await request.json();
        const hasPermission = await canManageOrder(env, currentUser, d.order_id);
        if (!hasPermission) return errorResponse('权限不足：不能修改他人录入的客户资料', 403, corsHeaders);
        const canEditSensitive = await canViewSensitiveOrderFields(env, currentUser, d.order_id);
        let query = `UPDATE Orders SET region = ?, main_business = ?, profile = ?, is_agent = ?, agent_name = ?, category = ?`;
        let params = [d.region, d.main_business, d.profile, d.is_agent ? 1 : 0, d.agent_name, d.category];

        if (canEditSensitive && (d.contact_person !== undefined || d.phone !== undefined)) {
          query += `, contact_person = ?, phone = ?`;
          params.push(d.contact_person || '', d.phone || '');
        }

        if (d.company_name !== undefined || d.credit_code !== undefined || d.no_code_checked !== undefined) {
          if (!isSuperAdmin(currentUser)) return errorResponse('权限不足：仅超级管理员可修改企业全称和信用代码', 403, corsHeaders);
          query += `, company_name = ?, credit_code = ?, no_code_checked = ?`;
          params.push(d.company_name || '', d.credit_code || '', d.no_code_checked ? 1 : 0);
        }
        
        if (d.contract_url !== undefined) {
            query += `, contract_url = ?`;
            params.push(d.contract_url);
        }
        query += ` WHERE id = ? AND project_id = ?`;
        params.push(d.order_id, d.project_id);
        
        await env.DB.prepare(query).bind(...params).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (url.pathname === '/api/change-order-booth' && request.method === 'POST') {
        try {
          await ensureOrderBoothChangesTable(env);
          const payload = await request.json();
          const orderId = Number(payload.order_id || 0);
          const projectId = Number(payload.project_id || 0);
          const targetBoothId = String(payload.target_booth_id || '').trim();
          const swapReason = String(payload.swap_reason || '').trim();
          const priceReason = String(payload.price_reason || '').trim();
          if (!orderId || !projectId || !targetBoothId) return errorResponse('缺少换展位必要信息', 400, corsHeaders);
          if (!swapReason) return errorResponse('请填写换展位原因', 400, corsHeaders);
          const hasPermission = await canManageOrder(env, currentUser, orderId);
          if (!hasPermission) return errorResponse('权限不足：不能操作他人订单换展位', 403, corsHeaders);

          const currentOrder = await env.DB.prepare(`
            SELECT id, project_id, booth_id, area, total_booth_fee, other_income, total_amount, paid_amount, fees_json, sales_name, status
            FROM Orders
            WHERE id = ? AND project_id = ?
          `).bind(orderId, projectId).first();
          if (!currentOrder) return errorResponse('订单不存在', 404, corsHeaders);
          if (String(currentOrder.status || '') !== '正常') return errorResponse('仅正常订单可换展位', 400, corsHeaders);
          if (String(currentOrder.booth_id || '') === targetBoothId) return errorResponse('新展位与当前展位相同，无需换展位', 400, corsHeaders);

          const targetBooth = await env.DB.prepare(`
            SELECT id, hall, type, area, price_unit, base_price, status
            FROM Booths
            WHERE id = ? AND project_id = ?
          `).bind(targetBoothId, projectId).first();
          if (!targetBooth) return errorResponse('目标展位不存在', 404, corsHeaders);
          if (String(targetBooth.status || '') === '已锁定') return errorResponse('目标展位已被临时锁定，请稍后再试', 400, corsHeaders);
          const targetBoothOccupancy = await env.DB.prepare(`
            SELECT COUNT(*) AS cnt
            FROM Orders
            WHERE project_id = ? AND booth_id = ? AND status = '正常' AND id <> ?
          `).bind(projectId, targetBoothId, orderId).first();
          if (Number(targetBoothOccupancy?.cnt || 0) > 0) {
            return errorResponse('目标展位当前已被占用，暂不支持直接换入', 400, corsHeaders);
          }

          const targetArea = toNonNegativeNumber(targetBooth.area);
          if (!Number.isFinite(targetArea) || targetArea <= 0) {
            return errorResponse('目标展位面积异常，无法换展位', 400, corsHeaders);
          }
          const rawActualFee = toNonNegativeNumber(payload.actual_fee);
          if (!Number.isFinite(rawActualFee) || rawActualFee < 0) {
            return errorResponse('新展位成交展位费必须是非负数', 400, corsHeaders);
          }
          const defaultPriceRow = await env.DB.prepare(`
            SELECT price
            FROM Prices
            WHERE project_id = ? AND booth_type = ?
          `).bind(projectId, String(targetBooth.type || '')).first();
          const unitPrice = Number(targetBooth.base_price || 0) > 0
            ? Number(targetBooth.base_price || 0)
            : Number(defaultPriceRow?.price || 0);
          const standardFee = String(targetBooth.type || '') === '光地'
            ? Number((unitPrice * targetArea).toFixed(2))
            : Number((unitPrice * (targetArea / BOOTH_UNIT_AREA)).toFixed(2));
          if (rawActualFee < standardFee && !priceReason) {
            return errorResponse('新展位成交价低于系统原价时，请填写价格说明', 400, corsHeaders);
          }

          let normalizedFeeItems = [];
          try {
            normalizedFeeItems = normalizeEditableFeeItems(payload.fees_json);
          } catch (e) {
            return errorResponse('其他收费明细格式无效，请重新填写', 400, corsHeaders);
          }
          const nextOtherIncome = Number(normalizedFeeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2));
          const nextTotalAmount = Number((rawActualFee + nextOtherIncome).toFixed(2));
          const currentBoothCount = toBoothCount(currentOrder.area);
          const nextBoothCount = toBoothCount(targetArea);
          const boothDeltaCount = Number((nextBoothCount - currentBoothCount).toFixed(2));
          const totalAmountDelta = Number((nextTotalAmount - Number(currentOrder.total_amount || 0)).toFixed(2));
          const mergedReason = [
            `换展位：${swapReason}`,
            priceReason ? `价格说明：${priceReason}` : ''
          ].filter(Boolean).join('；');
          const nowText = getChinaTimestamp();

          await env.DB.batch([
            env.DB.prepare(`
              UPDATE Orders
              SET booth_id = ?,
                  area = ?,
                  price_unit = ?,
                  unit_price = ?,
                  total_booth_fee = ?,
                  other_income = ?,
                  fees_json = ?,
                  discount_reason = ?,
                  total_amount = ?
              WHERE id = ? AND project_id = ?
            `).bind(
              targetBoothId,
              targetArea,
              String(targetBooth.price_unit || (String(targetBooth.type || '') === '光地' ? '平米' : '个')),
              unitPrice,
              rawActualFee,
              nextOtherIncome,
              JSON.stringify(normalizedFeeItems),
              mergedReason,
              nextTotalAmount,
              orderId,
              projectId
            ),
            env.DB.prepare(`
              INSERT INTO OrderBoothChanges (
                project_id, order_id, old_booth_id, new_booth_id,
                old_area, new_area, booth_delta_count,
                old_total_amount, new_total_amount, total_amount_delta,
                changed_by, reason, changed_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              projectId,
              orderId,
              String(currentOrder.booth_id || ''),
              targetBoothId,
              Number(currentOrder.area || 0),
              targetArea,
              boothDeltaCount,
              Number(currentOrder.total_amount || 0),
              nextTotalAmount,
              totalAmountDelta,
              String(currentUser.name || ''),
              mergedReason,
              nowText
            )
          ]);

          await syncBoothStatusByBoothId(env, projectId, String(currentOrder.booth_id || ''));
          await syncBoothStatusByBoothId(env, projectId, targetBoothId);
          await refreshOrderOverpaymentIssue(env, orderId, projectId);

          return new Response(JSON.stringify({
            success: true,
            order_id: orderId,
            old_booth_id: String(currentOrder.booth_id || ''),
            new_booth_id: targetBoothId,
            booth_delta_count: boothDeltaCount,
            total_amount_delta: totalAmountDelta
          }), { headers: corsHeaders });
        } catch (e) {
          console.error('Change order booth failed:', e);
          return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/cancel-order' && request.method === 'POST') {
        const { order_id, project_id, booth_id } = await request.json();
        const hasPermission = await canManageOrder(env, currentUser, order_id);
        if (!hasPermission) return errorResponse('权限不足：仅管理员或所属业务员可退订订单', 403, corsHeaders);
        
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
            if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);
            const results = await env.DB.prepare('SELECT * FROM Payments WHERE order_id = ? AND deleted_at IS NULL ORDER BY payment_time DESC').bind(orderId).all();
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
            if (!hasPermission) return errorResponse('权限不足：不能操作他人订单收款', 403, corsHeaders);
            const paymentAmount = toNonNegativeNumber(p.amount);
            if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
                return errorResponse('请输入正确的收款金额', 400, corsHeaders);
            }
            const orderBeforePayment = await env.DB.prepare('SELECT booth_id FROM Orders WHERE id = ?').bind(Number(p.order_id)).first();
            if (!orderBeforePayment) return errorResponse('订单不存在', 404, corsHeaders);
            const applyResult = await applyOrderPaidAmountDelta(env, Number(p.order_id), paymentAmount, { preventOverpay: true });
            if (!applyResult.success) {
                if (applyResult.reason === 'would_overpay') {
                    return errorResponse('本次收款会超过订单应收金额，请核对后再提交', 400, corsHeaders);
                }
                return errorResponse('收款处理中发生并发冲突，请刷新后重试', 409, corsHeaders);
            }
            try {
                await env.DB.prepare('INSERT INTO Payments (project_id, order_id, amount, payment_time, payer_name, bank_name, remarks, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(Number(p.project_id), Number(p.order_id), paymentAmount, String(p.payment_time), String(p.payer_name), String(p.bank_name), String(p.remarks || ''), 'MANUAL')
                    .run();
            } catch (insertError) {
                await rollbackOrderPaidAmountDelta(env, Number(p.order_id), paymentAmount);
                throw insertError;
            }
            
            const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(Number(p.order_id)).first();
            if (order && order.paid_amount >= order.total_amount) {
                await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, Number(p.project_id)).run();
            }
            await refreshOrderOverpaymentIssue(env, Number(p.order_id), Number(p.project_id));
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Add payment failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/delete-payment' && request.method === 'POST') {
        const { order_id, payment_id } = await request.json();
        const hasPermission = await canManageOrder(env, currentUser, order_id);
        if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);
        try {
            const payment = await env.DB.prepare('SELECT amount, source, deleted_at FROM Payments WHERE id = ?').bind(payment_id).first();
            if (!payment) return errorResponse('支付记录不存在', 404, corsHeaders);
            if (payment.deleted_at) return errorResponse('收款记录已删除', 400, corsHeaders);
            if (payment.source === 'ERP_SYNC') return errorResponse('ERP 同步流水不允许手动删除', 400, corsHeaders);
            const nowText = getChinaTimestamp();
            await env.DB.batch([
                env.DB.prepare('UPDATE Payments SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
                    .bind(nowText, String(currentUser.name || ''), Number(payment_id)),
                env.DB.prepare('UPDATE Orders SET paid_amount = MAX(0, ROUND(paid_amount - ?, 2)) WHERE id = ?')
                    .bind(Number(payment.amount || 0), Number(order_id))
            ]);
            const order = await env.DB.prepare('SELECT project_id, booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(order_id).first();
            if (order) {
                if (Number(order.paid_amount || 0) < Number(order.total_amount || 0)) {
                    await env.DB.prepare("UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ? AND status = '已成交'").bind(order.booth_id, Number(order.project_id)).run();
                }
                await refreshOrderOverpaymentIssue(env, Number(order_id), Number(order.project_id));
            }
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
            if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);
            const oldPayment = await env.DB.prepare('SELECT amount, source, deleted_at FROM Payments WHERE id = ?').bind(p.payment_id).first();
            if (!oldPayment) return errorResponse('收款记录不存在', 404, corsHeaders);
            if (oldPayment.deleted_at) return errorResponse('收款记录已删除', 400, corsHeaders);
            if (oldPayment.source === 'ERP_SYNC') return errorResponse('ERP 同步流水不允许手动修改', 400, corsHeaders);
            const nextAmount = toNonNegativeNumber(p.amount);
            if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
                return errorResponse('请输入正确的收款金额', 400, corsHeaders);
            }
            const orderBeforeEdit = await env.DB.prepare('SELECT total_amount, paid_amount FROM Orders WHERE id = ?').bind(p.order_id).first();
            if (!orderBeforeEdit) return errorResponse('订单不存在', 404, corsHeaders);
            const diff = nextAmount - Number(oldPayment.amount || 0);
            const applyResult = await applyOrderPaidAmountDelta(env, Number(p.order_id), diff, { preventOverpay: true });
            if (!applyResult.success) {
                if (applyResult.reason === 'would_overpay') {
                    return errorResponse('修改后收款总额会超过订单应收金额', 400, corsHeaders);
                }
                if (applyResult.reason === 'negative_paid_amount') {
                    return errorResponse('修改后订单已收金额不能小于 0', 400, corsHeaders);
                }
                return errorResponse('收款处理中发生并发冲突，请刷新后重试', 409, corsHeaders);
            }
            try {
                const updateResult = await env.DB.prepare('UPDATE Payments SET amount=?, payment_time=?, payer_name=?, bank_name=?, remarks=? WHERE id=? AND deleted_at IS NULL')
                    .bind(nextAmount, p.payment_time, p.payer_name, p.bank_name, p.remarks, p.payment_id)
                    .run();
                if (hasMetaChanges(updateResult) === 0) {
                    throw new Error('PAYMENT_EDIT_CONFLICT');
                }
            } catch (updateError) {
                await rollbackOrderPaidAmountDelta(env, Number(p.order_id), diff);
                throw updateError;
            }
            const order = await env.DB.prepare('SELECT project_id, booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(p.order_id).first();
            if (order) {
                if (Number(order.paid_amount || 0) >= Number(order.total_amount || 0)) {
                    await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, Number(order.project_id)).run();
                } else {
                    await env.DB.prepare("UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ? AND status = '已成交'").bind(order.booth_id, Number(order.project_id)).run();
                }
                await refreshOrderOverpaymentIssue(env, Number(p.order_id), Number(order.project_id));
            }
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Edit payment failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/update-order-fees' && request.method === 'POST') {
        if (currentUser.role !== 'admin') return errorResponse('权限不足', 403, corsHeaders);
        try {
            const d = await request.json();
            const actualFee = toNonNegativeNumber(d.actual_fee);
            const otherFeeTotal = toNonNegativeNumber(d.other_fee_total);
            if (!Number.isFinite(actualFee) || actualFee < 0) {
                return errorResponse('展位费必须是非负数', 400, corsHeaders);
            }
            if (!Number.isFinite(otherFeeTotal) || otherFeeTotal < 0) {
                return errorResponse('其他费用必须是非负数', 400, corsHeaders);
            }
            let normalizedFeesJson = '[]';
            try {
                const parsedFees = JSON.parse(d.fees_json || '[]');
                if (!Array.isArray(parsedFees)) throw new Error('INVALID_FEES_JSON');
                normalizedFeesJson = JSON.stringify(parsedFees);
            } catch (e) {
                return errorResponse('其他收费明细格式无效，请重新填写', 400, corsHeaders);
            }
            const total = actualFee + otherFeeTotal;
            const existingOrder = await env.DB.prepare('SELECT paid_amount FROM Orders WHERE id = ? AND project_id = ?').bind(d.order_id, d.project_id).first();
            if (!existingOrder) return errorResponse('订单不存在', 404, corsHeaders);
            if (Number(existingOrder.paid_amount || 0) > total) {
                return errorResponse('调整后总额不能低于已收金额，请先处理退款或修改收款', 400, corsHeaders);
            }
            await env.DB.prepare('UPDATE Orders SET total_booth_fee=?, other_income=?, fees_json=?, discount_reason=?, total_amount=? WHERE id=? AND project_id=?')
                .bind(actualFee, otherFeeTotal, normalizedFeesJson, d.reason, total, d.order_id, d.project_id).run();
            
            const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ?').bind(d.order_id).first();
            if (order && order.paid_amount >= order.total_amount) {
                await env.DB.prepare("UPDATE Booths SET status = '已成交' WHERE id = ? AND project_id = ?").bind(order.booth_id, d.project_id).run();
            } else {
                await env.DB.prepare("UPDATE Booths SET status = '已预订' WHERE id = ? AND project_id = ? AND status = '已成交'").bind(order.booth_id, d.project_id).run();
            }
            await refreshOrderOverpaymentIssue(env, Number(d.order_id), Number(d.project_id));
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Update order fees failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/resolve-overpayment' && request.method === 'POST') {
        await ensureOverpaymentIssuesTable(env);
        try {
            const payload = await request.json();
            const orderId = Number(payload.order_id);
            const projectId = Number(payload.project_id);
            const action = String(payload.action || '').trim();
            const note = String(payload.note || '').trim();
            if (!orderId || !projectId) return errorResponse('缺少订单信息', 400, corsHeaders);
            const hasPermission = await canHandleOverpayment(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足：仅超级管理员或订单所属业务员可处理超收', 403, corsHeaders);
            const latestState = await refreshOrderOverpaymentIssue(env, orderId, projectId);
            if (!latestState || Number(latestState.overpaid_amount || 0) <= 0) {
                return errorResponse('当前订单不存在超收异常，无需处理', 400, corsHeaders);
            }
            if (!['fx_diff', 'on_hold'].includes(action)) {
                return errorResponse('处理方式无效', 400, corsHeaders);
            }
            if (!note) {
                return errorResponse(action === 'fx_diff' ? '请填写汇率差说明' : '请填写暂挂说明', 400, corsHeaders);
            }
            const nextStatus = action === 'fx_diff' ? 'resolved_as_fx_diff' : 'on_hold';
            const nextReason = action === 'fx_diff' ? 'fx_diff' : 'on_hold';
            const nowText = getChinaTimestamp();
            await env.DB.prepare(`
                UPDATE OrderOverpaymentIssues
                SET status = ?,
                    reason = ?,
                    note = ?,
                    handled_by = ?,
                    handled_at = ?,
                    updated_at = ?
                WHERE order_id = ?
            `).bind(nextStatus, nextReason, note, String(currentUser.name || ''), nowText, nowText, orderId).run();
            const order = await env.DB.prepare(`
                SELECT booth_id, total_booth_fee, other_income, total_amount, paid_amount, fees_json
                FROM Orders
                WHERE id = ? AND project_id = ?
            `).bind(orderId, projectId).first();
            if (!order) return errorResponse('订单不存在', 404, corsHeaders);

            const latestOverpaidAmount = Number(latestState.overpaid_amount || 0);
            const feeItems = parseOrderFeeItems(order.fees_json);
            feeItems.push({
                name: note,
                amount: latestOverpaidAmount,
                source: 'overpayment_auto',
                overpayment_reason: nextReason,
                created_at: nowText
            });
            const nextOtherIncome = Number((feeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)).toFixed(2));
            const nextTotalAmount = Number((Number(order.total_booth_fee || 0) + nextOtherIncome).toFixed(2));
            await env.DB.prepare(`
                UPDATE Orders
                SET other_income = ?, fees_json = ?, total_amount = ?
                WHERE id = ? AND project_id = ?
            `).bind(
                nextOtherIncome,
                JSON.stringify(feeItems),
                nextTotalAmount,
                orderId,
                projectId
            ).run();
            await syncBoothStatusForOrder(env, orderId, projectId);
            await refreshOrderOverpaymentIssue(env, orderId, projectId);
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Resolve overpayment failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      if (url.pathname === '/api/expenses' && request.method === 'GET') {
        try {
            const orderId = new URL(request.url).searchParams.get('orderId');
            const hasPermission = await canManageOrder(env, currentUser, orderId);
            if (!hasPermission) return errorResponse('权限不足', 403, corsHeaders);
            const results = await env.DB.prepare('SELECT * FROM Expenses WHERE order_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').bind(orderId).all();
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
            if (!hasPermission) return errorResponse('权限不足：不能操作他人订单支出', 403, corsHeaders);
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
        try {
            const { expense_id } = await request.json();
            const expense = await env.DB.prepare('SELECT id, order_id FROM Expenses WHERE id = ? AND deleted_at IS NULL')
                .bind(Number(expense_id)).first();
            if (!expense) return errorResponse('记录不存在或已撤销', 404, corsHeaders);
            const hasPermission = await canManageOrder(env, currentUser, expense.order_id);
            if (!hasPermission) return errorResponse('权限不足：仅管理员或本人名下企业可撤销', 403, corsHeaders);
            await env.DB.prepare('UPDATE Expenses SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
                .bind(getChinaTimestamp(), String(currentUser.name || ''), Number(expense_id))
                .run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        } catch (e) {
            console.error('Delete expense failed:', e);
            return internalErrorResponse(corsHeaders);
        }
      }

      return errorResponse('接口不存在', 404, corsHeaders);

    } catch (err) {
      console.error('Unhandled API error:', err);
      return internalErrorResponse(corsHeaders);
    }
  }
};
