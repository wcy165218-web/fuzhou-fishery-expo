import assert from 'node:assert/strict';
import { handleOrderRoutes } from '../src/routes/orders.mjs';
import { handlePaymentRoutes } from '../src/routes/payments.mjs';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

function createMockEnv(options = {}) {
    const captured = { prepareCalls: [], batchCalls: [], runCalls: [] };
    const {
        firstResponses = {},
        allResponses = {},
        runResponses = {},
        batchResponses
    } = options;

    function resolveResponse(responseMap, sql, params) {
        for (const [pattern, handler] of Object.entries(responseMap)) {
            if (sql.includes(pattern)) {
                return typeof handler === 'function' ? handler(sql, params) : handler;
            }
        }
        return undefined;
    }

    const DB = {
        prepare(query) {
            const sql = String(query || '');
            return {
                sql,
                params: [],
                bind(...params) {
                    this.params = params;
                    return this;
                },
                async first() {
                    captured.prepareCalls.push({ sql, params: [...this.params], type: 'first' });
                    const res = resolveResponse(firstResponses, sql, this.params);
                    return res !== undefined ? res : null;
                },
                async all() {
                    captured.prepareCalls.push({ sql, params: [...this.params], type: 'all' });
                    const res = resolveResponse(allResponses, sql, this.params);
                    return res !== undefined ? res : { results: [] };
                },
                async run() {
                    captured.runCalls.push({ sql, params: [...this.params] });
                    const res = resolveResponse(runResponses, sql, this.params);
                    return res !== undefined ? res : { meta: { changes: 1 } };
                }
            };
        },
        async batch(statements) {
            const mapped = statements.map((s) => ({ sql: s.sql, params: [...s.params] }));
            captured.batchCalls.push(mapped);
            if (batchResponses) return batchResponses;
            return statements.map(() => ({ meta: { changes: 1 } }));
        }
    };

    return { captured, DB };
}

function jsonRequest(url, body) {
    return new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

const CORS = { 'Content-Type': 'application/json' };
const ADMIN = { role: 'admin', name: 'admin' };
const SALES = { role: 'sales', name: '张三' };

// ---------------------------------------------------------------------------
// submit-order tests
// ---------------------------------------------------------------------------

async function testSubmitOrderSuccess() {
    const db = createMockEnv({
        firstResponses: {
            'COUNT(*) AS total': { total: 0 }
        },
        allResponses: {
            'FROM Orders': { results: [] },
            'FROM Booths': { results: [] }
        },
        runResponses: {
            'DELETE FROM BoothLocks': { meta: { changes: 1 } },
            'INSERT INTO BoothLocks': { meta: { changes: 1 } }
        }
    });
    const req = jsonRequest('http://localhost/api/submit-order', {
        project_id: 7,
        company_name: '测试海洋科技',
        credit_code: '91350100MA12345678',
        category: '水产预制菜',
        main_business: '海鲜加工',
        contact_person: '王先生',
        phone: '13800000001',
        region: '福建省 - 福州市 - 鼓楼区',
        sales_name: '张三',
        total_booth_fee: 5000,
        selected_booths: [
            { booth_id: '1A01', hall: '1号馆', type: '标摊', area: 9, price_unit: '个', unit_price: 5000, standard_fee: 5000 }
        ],
        standard_booth_display_name: '测试海洋',
        fees_json: '[]'
    });
    const res = await handleOrderRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.created_count, 1);
    const insertCalls = db.captured.batchCalls.flat().filter((c) => c.sql.includes('INSERT INTO Orders'));
    assert.ok(insertCalls.length >= 1, 'should have at least 1 order INSERT');
    assert.ok(
        insertCalls.every((call) => call.params.every((value) => value !== undefined)),
        'should not bind undefined values into D1'
    );
}

async function testSubmitOrderExceedMaxBooths() {
    const db = createMockEnv();
    const booths = Array.from({ length: 21 }, (_, i) => ({
        booth_id: `1A${String(i + 1).padStart(2, '0')}`,
        hall: '1号馆',
        type: '标摊',
        area: 9,
        price_unit: '个',
        unit_price: 5000,
        standard_fee: 5000
    }));
    const req = jsonRequest('http://localhost/api/submit-order', {
        project_id: 7,
        company_name: '测试公司',
        credit_code: '91350100MA12345678',
        category: '水产',
        main_business: '加工',
        contact_person: '王先生',
        phone: '13800000001',
        region: '福建省',
        sales_name: '张三',
        total_booth_fee: 100000,
        selected_booths: booths,
        standard_booth_display_name: '测试公司',
        fees_json: '[]'
    });
    const res = await handleOrderRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.ok(body.error, 'should return error for >20 booths');
    assert.equal(res.status, 400);
}

async function testSubmitOrderBoothLockConflict() {
    const db = createMockEnv({
        runResponses: {
            'DELETE FROM BoothLocks': { meta: { changes: 0 } },
            'INSERT INTO BoothLocks': { meta: { changes: 0 } }
        }
    });
    const req = jsonRequest('http://localhost/api/submit-order', {
        project_id: 7,
        company_name: '测试公司',
        credit_code: '91350100MA12345678',
        category: '水产',
        main_business: '加工',
        contact_person: '王先生',
        phone: '13800000001',
        region: '福建省',
        sales_name: '张三',
        total_booth_fee: 5000,
        selected_booths: [
            { booth_id: '1A01', hall: '1号馆', type: '标摊', area: 9, price_unit: '个', unit_price: 5000, standard_fee: 5000 }
        ],
        standard_booth_display_name: '测试公司',
        fees_json: '[]'
    });
    const res = await handleOrderRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 409);
}

async function testSubmitOrderBoothOccupied() {
    const db = createMockEnv({
        allResponses: {
            'FROM Orders': (sql) => {
                if (sql.includes("status = '正常'")) {
                    return { results: [{ id: 99, booth_id: '1A01', area: 9, created_at: '2026-04-01' }] };
                }
                return { results: [] };
            },
            'FROM Booths': { results: [] }
        },
        runResponses: {
            'DELETE FROM BoothLocks': { meta: { changes: 1 } },
            'INSERT INTO BoothLocks': { meta: { changes: 1 } }
        }
    });
    const req = jsonRequest('http://localhost/api/submit-order', {
        project_id: 7,
        company_name: '测试公司',
        credit_code: '91350100MA12345678',
        category: '水产',
        main_business: '加工',
        contact_person: '王先生',
        phone: '13800000001',
        region: '福建省',
        sales_name: '张三',
        total_booth_fee: 5000,
        selected_booths: [
            { booth_id: '1A01', hall: '1号馆', type: '标摊', area: 9, price_unit: '个', unit_price: 5000, standard_fee: 5000, is_joint: 0 }
        ],
        standard_booth_display_name: '测试公司',
        fees_json: '[]'
    });
    const res = await handleOrderRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.ok(body.error.includes('已被占用'));
}

// ---------------------------------------------------------------------------
// add-payment tests
// ---------------------------------------------------------------------------

async function testAddPaymentSuccess() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: '张三' },
            'SELECT project_id, status': { project_id: 7, status: '正常' },
            'SELECT total_amount, paid_amount': { total_amount: 5000, paid_amount: 1000 },
            'SELECT booth_id, total_amount, paid_amount': { booth_id: '1A01', total_amount: 5000, paid_amount: 2000 },
            'SELECT id, project_id': { id: 7, project_id: 7 }
        },
        runResponses: {
            'UPDATE Orders': { meta: { changes: 1 } },
            'INSERT INTO Payments': { meta: { changes: 1 } },
            'UPDATE Booths': { meta: { changes: 1 } },
            'UPDATE OrderOverpaymentIssues': { meta: { changes: 1 } }
        },
        allResponses: {
            'FROM Booths': { results: [{ id: '1A01', status: '可售' }] },
            'FROM Orders': { results: [{ booth_id: '1A01', paid_amount: 2000, total_amount: 5000 }] }
        }
    });
    const req = jsonRequest('http://localhost/api/add-payment', {
        order_id: 101,
        amount: 1000,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: '定金'
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.equal(body.success, true);
    const insertCalls = db.captured.runCalls.filter((c) => c.sql.includes('INSERT INTO Payments'));
    assert.equal(insertCalls.length, 1, 'should have exactly 1 payment INSERT');
}

async function testAddPaymentWouldOverpay() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: '张三' },
            'SELECT project_id, status': { project_id: 7, status: '正常' },
            'SELECT total_amount, paid_amount FROM Orders': { total_amount: 1000, paid_amount: 900 }
        },
        runResponses: {
            'UPDATE Orders': { meta: { changes: 0 } }
        }
    });
    const req = jsonRequest('http://localhost/api/add-payment', {
        order_id: 101,
        amount: 500,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: ''
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('超过'));
}

async function testAddPaymentPermissionDenied() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: '李四' }
        }
    });
    const req = jsonRequest('http://localhost/api/add-payment', {
        order_id: 101,
        amount: 1000,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: ''
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: SALES, corsHeaders: CORS });
    assert.equal(res.status, 403);
}

async function testAddPaymentCancelledOrder() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: 'admin' },
            'SELECT project_id, status': { project_id: 7, status: '已退订' }
        }
    });
    const req = jsonRequest('http://localhost/api/add-payment', {
        order_id: 101,
        amount: 1000,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: ''
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('已退订'));
}

async function testAddPaymentInvalidAmount() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: 'admin' }
        }
    });
    const req = jsonRequest('http://localhost/api/add-payment', {
        order_id: 101,
        amount: -100,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: ''
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('金额'));
}

// ---------------------------------------------------------------------------
// edit-payment tests
// ---------------------------------------------------------------------------

async function testEditPaymentSuccess() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT': (sql, params) => {
                if (sql.includes('p.id') && sql.includes('p.project_id')) {
                    return { id: 201, project_id: 7, order_id: 101, amount: 1000, payment_time: '2026-04-01', payer_name: '王先生', bank_name: '中国银行', remarks: '', source: 'MANUAL', deleted_at: null };
                }
                if (sql.includes('SELECT sales_name FROM Orders')) return { sales_name: 'admin' };
                if (sql.includes('total_amount, paid_amount')) return { total_amount: 5000, paid_amount: 1000 };
                if (sql.includes('project_id, total_amount, paid_amount')) return { project_id: 7, total_amount: 5000, paid_amount: 1500 };
                if (sql.includes('booth_id, total_amount, paid_amount')) return { booth_id: '1A01', total_amount: 5000, paid_amount: 1500 };
                return null;
            }
        },
        runResponses: {
            'UPDATE Orders': { meta: { changes: 1 } },
            'UPDATE Payments': { meta: { changes: 1 } },
            'UPDATE Booths': { meta: { changes: 1 } }
        },
        allResponses: {
            'FROM Booths': { results: [{ id: '1A01', status: '可售' }] },
            'FROM Orders': { results: [{ booth_id: '1A01', paid_amount: 1500, total_amount: 5000 }] }
        }
    });
    const req = jsonRequest('http://localhost/api/edit-payment', {
        payment_id: 201,
        amount: 1500,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: '修改金额'
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.equal(body.success, true);
}

async function testEditPaymentErpSyncRejection() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT': (sql) => {
                if (sql.includes('p.id') && sql.includes('p.project_id')) {
                    return { id: 201, project_id: 7, order_id: 101, amount: 1000, source: 'ERP_SYNC', deleted_at: null };
                }
                return null;
            }
        }
    });
    const req = jsonRequest('http://localhost/api/edit-payment', {
        payment_id: 201,
        amount: 1500,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: ''
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('ERP'));
}

async function testEditPaymentConcurrentConflict() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT': (sql) => {
                if (sql.includes('p.id') && sql.includes('p.project_id')) {
                    return { id: 201, project_id: 7, order_id: 101, amount: 1000, source: 'MANUAL', deleted_at: null };
                }
                if (sql.includes('SELECT sales_name FROM Orders')) return { sales_name: 'admin' };
                if (sql.includes('total_amount, paid_amount')) return { total_amount: 5000, paid_amount: 2000 };
                return null;
            }
        },
        runResponses: {
            'UPDATE Orders': { meta: { changes: 1 } },
            'UPDATE Payments': { meta: { changes: 0 } }
        }
    });
    const req = jsonRequest('http://localhost/api/edit-payment', {
        payment_id: 201,
        amount: 1500,
        payment_time: '2026-04-09',
        payer_name: '王先生',
        bank_name: '中国银行',
        remarks: ''
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.ok(body.error.includes('已变更'));
}

// ---------------------------------------------------------------------------
// delete-payment tests
// ---------------------------------------------------------------------------

async function testDeletePaymentSuccess() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT': (sql) => {
                if (sql.includes('p.id') && sql.includes('p.project_id')) {
                    return { id: 201, project_id: 7, order_id: 101, amount: 1000, source: 'MANUAL', deleted_at: null };
                }
                if (sql.includes('SELECT sales_name FROM Orders')) return { sales_name: 'admin' };
                if (sql.includes('project_id, total_amount, paid_amount')) return { project_id: 7, total_amount: 5000, paid_amount: 0 };
                if (sql.includes('booth_id, total_amount, paid_amount')) return { booth_id: '1A01', total_amount: 5000, paid_amount: 0 };
                return null;
            }
        },
        runResponses: {
            'UPDATE Orders': { meta: { changes: 1 } },
            'UPDATE Payments': { meta: { changes: 1 } },
            'UPDATE Booths': { meta: { changes: 1 } }
        },
        allResponses: {
            'FROM Booths': { results: [{ id: '1A01', status: '已预定' }] },
            'FROM Orders': { results: [] }
        }
    });
    const req = jsonRequest('http://localhost/api/delete-payment', { payment_id: 201 });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.equal(body.success, true);
    const softDeleteCalls = db.captured.runCalls.filter((c) => c.sql.includes('UPDATE Payments') && c.sql.includes('deleted_at'));
    assert.ok(softDeleteCalls.length >= 1, 'should soft-delete payment');
}

async function testDeletePaymentErpSyncRejection() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT': (sql) => {
                if (sql.includes('p.id') && sql.includes('p.project_id')) {
                    return { id: 201, project_id: 7, order_id: 101, amount: 1000, source: 'ERP_SYNC', deleted_at: null };
                }
                return null;
            }
        }
    });
    const req = jsonRequest('http://localhost/api/delete-payment', { payment_id: 201 });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('ERP'));
}

async function testDeletePaymentPermissionDenied() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT': (sql) => {
                if (sql.includes('p.id') && sql.includes('p.project_id')) {
                    return { id: 201, project_id: 7, order_id: 101, amount: 1000, source: 'MANUAL', deleted_at: null };
                }
                if (sql.includes('SELECT sales_name FROM Orders')) return { sales_name: '李四' };
                return null;
            }
        }
    });
    const req = jsonRequest('http://localhost/api/delete-payment', { payment_id: 201 });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: SALES, corsHeaders: CORS });
    assert.equal(res.status, 403);
}

// ---------------------------------------------------------------------------
// change-order-booth tests
// ---------------------------------------------------------------------------

async function testChangeOrderBoothSuccess() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: 'admin' },
            'SELECT': (sql, params) => {
                if (sql.includes('SELECT id, project_id, booth_id, area, total_booth_fee')) {
                    return { id: 101, project_id: 7, booth_id: '1A01', area: 9, total_booth_fee: 5000, other_income: 0, total_amount: 5000, paid_amount: 1000, fees_json: '[]', sales_name: '张三', status: '正常' };
                }
                if (sql.includes('SELECT id, hall, type, area, price_unit, base_price, status')) {
                    return { id: '1A02', hall: '1号馆', type: '标摊', area: 9, price_unit: '个', base_price: 5000, status: '可售' };
                }
                if (sql.includes('SELECT price')) return { price: 5000 };
                if (sql.includes('SELECT sales_name')) return { sales_name: 'admin' };
                if (sql.includes('booth_id, total_amount, paid_amount')) return { booth_id: '1A02', total_amount: 5000, paid_amount: 1000 };
                return null;
            }
        },
        allResponses: {
            'FROM Orders': (sql) => {
                if (sql.includes("status = '正常'")) return { results: [] };
                return { results: [{ booth_id: '1A02', paid_amount: 1000, total_amount: 5000 }] };
            },
            'FROM Booths': { results: [{ id: '1A01', status: '可售' }, { id: '1A02', status: '可售' }] }
        },
        runResponses: {
            'DELETE FROM BoothLocks': { meta: { changes: 1 } },
            'INSERT INTO BoothLocks': { meta: { changes: 1 } },
            'UPDATE Orders': { meta: { changes: 1 } },
            'UPDATE Booths': { meta: { changes: 1 } }
        }
    });
    const req = jsonRequest('http://localhost/api/change-order-booth', {
        order_id: 101,
        project_id: 7,
        target_booth_id: '1A02',
        swap_reason: '客户要求',
        actual_fee: 5000
    });
    const res = await handleOrderRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.equal(body.success, true);
}

async function testChangeOrderBoothTargetOccupied() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: 'admin' },
            'SELECT': (sql) => {
                if (sql.includes('SELECT id, project_id, booth_id, area, total_booth_fee')) {
                    return { id: 101, project_id: 7, booth_id: '1A01', area: 9, total_booth_fee: 5000, other_income: 0, total_amount: 5000, paid_amount: 0, fees_json: '[]', sales_name: '张三', status: '正常' };
                }
                if (sql.includes('SELECT id, hall, type, area, price_unit, base_price, status')) {
                    return { id: '1A02', hall: '1号馆', type: '标摊', area: 9, price_unit: '个', base_price: 5000, status: '可售' };
                }
                return null;
            }
        },
        allResponses: {
            'FROM Orders': (sql) => {
                if (sql.includes("status = '正常'")) {
                    return { results: [{ id: 200, booth_id: '1A02', area: 9, created_at: '2026-04-01' }] };
                }
                return { results: [] };
            }
        },
        runResponses: {
            'DELETE FROM BoothLocks': { meta: { changes: 1 } },
            'INSERT INTO BoothLocks': { meta: { changes: 1 } }
        }
    });
    const req = jsonRequest('http://localhost/api/change-order-booth', {
        order_id: 101,
        project_id: 7,
        target_booth_id: '1A02',
        swap_reason: '客户要求',
        actual_fee: 5000
    });
    const res = await handleOrderRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.ok(body.error.includes('已被占用'));
}

async function testChangeOrderBoothMissingReason() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: 'admin' }
        }
    });
    const req = jsonRequest('http://localhost/api/change-order-booth', {
        order_id: 101,
        project_id: 7,
        target_booth_id: '1A02',
        swap_reason: '',
        actual_fee: 5000
    });
    const res = await handleOrderRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('原因'));
}

// ---------------------------------------------------------------------------
// resolve-overpayment tests
// ---------------------------------------------------------------------------

async function testResolveOverpaymentFxDiffSuccess() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT': (sql) => {
                if (sql.includes('booth_id, total_booth_fee, other_income')) {
                    return { booth_id: '1A01', total_booth_fee: 5000, other_income: 0, total_amount: 5000, paid_amount: 5500, fees_json: '[]' };
                }
                if (sql.includes('booth_id, total_amount, paid_amount')) {
                    return { booth_id: '1A01', total_amount: 5500, paid_amount: 5500 };
                }
                return null;
            }
        },
        allResponses: {
            'SELECT': (sql) => {
                if (sql.includes('FROM OrderOverpaymentIssues')) {
                    return { results: [{ order_id: 101, project_id: 7, overpaid_amount: 500, status: 'pending', reason: '', note: '', detected_at: '2026-04-08', handled_by: '', handled_at: '' }] };
                }
                if (sql.includes('id, project_id, total_amount, paid_amount, status')) {
                    return { results: [{ id: 101, project_id: 7, total_amount: 5000, paid_amount: 5500, status: '正常' }] };
                }
                if (sql.includes('FROM Booths')) {
                    return { results: [{ id: '1A01', status: '可售' }] };
                }
                if (sql.includes("status = '正常'")) {
                    return { results: [{ booth_id: '1A01', paid_amount: 5500, total_amount: 5500 }] };
                }
                return { results: [] };
            }
        }
    });
    const req = jsonRequest('http://localhost/api/resolve-overpayment', {
        order_id: 101,
        project_id: 7,
        action: 'fx_diff',
        note: '汇率差异调节'
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.equal(body.success, true);
    const batchOps = db.captured.batchCalls.flat();
    const orderUpdate = batchOps.find((c) => c.sql.includes('UPDATE Orders') && c.sql.includes('other_income'));
    assert.ok(orderUpdate, 'should update order fees');
    const issueUpdate = batchOps.find((c) => c.sql.includes('UPDATE OrderOverpaymentIssues') && c.sql.includes('resolved_as_fx_diff'));
    assert.ok(issueUpdate, 'should resolve overpayment issue');
}

async function testResolveOverpaymentOnHoldSuccess() {
    const db = createMockEnv({
        allResponses: {
            'SELECT': (sql) => {
                if (sql.includes('FROM OrderOverpaymentIssues')) {
                    return { results: [{ order_id: 101, project_id: 7, overpaid_amount: 500, status: 'pending', reason: '', note: '', detected_at: '2026-04-08', handled_by: '', handled_at: '' }] };
                }
                if (sql.includes('id, project_id, total_amount, paid_amount, status')) {
                    return { results: [{ id: 101, project_id: 7, total_amount: 5000, paid_amount: 5500, status: '正常' }] };
                }
                return { results: [] };
            }
        }
    });
    const req = jsonRequest('http://localhost/api/resolve-overpayment', {
        order_id: 101,
        project_id: 7,
        action: 'on_hold',
        note: '等待客户确认'
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    const body = await res.json();
    assert.equal(body.success, true);
}

async function testResolveOverpaymentInvalidAction() {
    const db = createMockEnv({
        allResponses: {
            'SELECT': (sql) => {
                if (sql.includes('FROM OrderOverpaymentIssues')) {
                    return { results: [{ order_id: 101, project_id: 7, overpaid_amount: 500, status: 'pending', reason: '', note: '', detected_at: '2026-04-08', handled_by: '', handled_at: '' }] };
                }
                if (sql.includes('id, project_id, total_amount, paid_amount, status')) {
                    return { results: [{ id: 101, project_id: 7, total_amount: 5000, paid_amount: 5500, status: '正常' }] };
                }
                return { results: [] };
            }
        }
    });
    const req = jsonRequest('http://localhost/api/resolve-overpayment', {
        order_id: 101,
        project_id: 7,
        action: 'invalid_action',
        note: '测试'
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('无效'));
}

async function testResolveOverpaymentPermissionDenied() {
    const db = createMockEnv({
        firstResponses: {
            'SELECT sales_name FROM Orders': { sales_name: '李四' }
        }
    });
    const req = jsonRequest('http://localhost/api/resolve-overpayment', {
        order_id: 101,
        project_id: 7,
        action: 'fx_diff',
        note: '汇率差'
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: SALES, corsHeaders: CORS });
    assert.equal(res.status, 403);
}

async function testResolveOverpaymentMissingNote() {
    const db = createMockEnv({
        allResponses: {
            'SELECT': (sql) => {
                if (sql.includes('FROM OrderOverpaymentIssues')) {
                    return { results: [{ order_id: 101, project_id: 7, overpaid_amount: 500, status: 'pending', reason: '', note: '', detected_at: '2026-04-08', handled_by: '', handled_at: '' }] };
                }
                if (sql.includes('id, project_id, total_amount, paid_amount, status')) {
                    return { results: [{ id: 101, project_id: 7, total_amount: 5000, paid_amount: 5500, status: '正常' }] };
                }
                return { results: [] };
            }
        }
    });
    const req = jsonRequest('http://localhost/api/resolve-overpayment', {
        order_id: 101,
        project_id: 7,
        action: 'fx_diff',
        note: ''
    });
    const res = await handlePaymentRoutes({ request: req, env: db, url: new URL(req.url), currentUser: ADMIN, corsHeaders: CORS });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('说明'));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runTests() {
    // submit-order
    await testSubmitOrderSuccess();
    await testSubmitOrderExceedMaxBooths();
    await testSubmitOrderBoothLockConflict();
    await testSubmitOrderBoothOccupied();

    // add-payment
    await testAddPaymentSuccess();
    await testAddPaymentWouldOverpay();
    await testAddPaymentPermissionDenied();
    await testAddPaymentCancelledOrder();
    await testAddPaymentInvalidAmount();

    // edit-payment
    await testEditPaymentSuccess();
    await testEditPaymentErpSyncRejection();
    await testEditPaymentConcurrentConflict();

    // delete-payment
    await testDeletePaymentSuccess();
    await testDeletePaymentErpSyncRejection();
    await testDeletePaymentPermissionDenied();

    // change-order-booth
    await testChangeOrderBoothSuccess();
    await testChangeOrderBoothTargetOccupied();
    await testChangeOrderBoothMissingReason();

    // resolve-overpayment
    await testResolveOverpaymentFxDiffSuccess();
    await testResolveOverpaymentOnHoldSuccess();
    await testResolveOverpaymentInvalidAction();
    await testResolveOverpaymentPermissionDenied();
    await testResolveOverpaymentMissingNote();
}

await runTests();
console.log('Route main-chain regression tests passed (22 cases)');
