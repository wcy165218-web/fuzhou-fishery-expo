import assert from 'node:assert/strict';
import { handleConfigRoutes } from '../src/routes/config.mjs';
import { handleFileRoutes } from '../src/routes/files.mjs';
import { handleOrderRoutes } from '../src/routes/orders.mjs';

function createOrderRouteEnv() {
  const captured = {
    firstCalls: [],
    allCalls: []
  };

  return {
    captured,
    DB: {
      prepare(query) {
        const sql = String(query || '');
        return {
          params: [],
          bind(...params) {
            this.params = params;
            return this;
          },
          async first() {
            captured.firstCalls.push({ sql, params: [...this.params] });
            if (sql.includes('COUNT(*) AS total')) {
              return { total: 120 };
            }
            return null;
          },
          async all() {
            captured.allCalls.push({ sql, params: [...this.params] });
            return {
              results: [
                {
                  id: 101,
                  project_id: 7,
                  booth_id: '1A01',
                  company_name: '福建海洋科技',
                  sales_name: '张三',
                  paid_amount: 1000,
                  total_amount: 1000,
                  can_manage: 1,
                  can_preview_contract: 1,
                  has_contract: 1,
                  contract_url: 'contract_1.pdf',
                  hall: '1号馆',
                  booth_type: '标摊',
                  overpaid_amount: 0,
                  overpayment_status: '',
                  overpayment_reason: '',
                  overpayment_note: '',
                  overpayment_handled_by: '',
                  overpayment_handled_at: '',
                  can_handle_overpayment: 1,
                  contact_person: '联系人甲',
                  phone: '13800000000',
                  created_at: '2026-04-09 10:00:00'
                }
              ]
            };
          }
        };
      }
    }
  };
}

function createConfigRouteEnv() {
  const captured = {
    batchCalls: []
  };
  return {
    captured,
    DB: {
      prepare(query) {
        const sql = String(query || '');
        return {
          sql,
          params: [],
          bind(...params) {
            this.params = params;
            return this;
          }
        };
      },
      async batch(statements) {
        captured.batchCalls.push(statements.map((statement) => ({
          sql: statement.sql,
          params: [...statement.params]
        })));
        return statements.map((_, index) => ({
          meta: { changes: index + 1 }
        }));
      }
    }
  };
}

async function runTests() {
  const corsHeaders = { 'Content-Type': 'application/json' };

  const orderEnv = createOrderRouteEnv();
  const orderRequest = new Request(
    'http://localhost/api/orders?projectId=7&page=2&pageSize=50&search=%E6%B5%B7%E9%B2%9C&paymentStatus=%E5%85%A8%E6%AC%BE&salesName=%E5%BC%A0%E4%B8%89',
    { method: 'GET' }
  );
  const orderResponse = await handleOrderRoutes({
    request: orderRequest,
    env: orderEnv,
    url: new URL(orderRequest.url),
    currentUser: { role: 'admin', name: 'admin' },
    corsHeaders
  });
  const orderPayload = await orderResponse.json();
  assert.deepEqual(orderPayload, {
    items: [
      {
        id: 101,
        project_id: 7,
        booth_id: '1A01',
        company_name: '福建海洋科技',
        sales_name: '张三',
        paid_amount: 1000,
        total_amount: 1000,
        can_manage: 1,
        can_preview_contract: 1,
        has_contract: 1,
        contract_url: 'contract_1.pdf',
        hall: '1号馆',
        booth_type: '标摊',
        overpaid_amount: 0,
        overpayment_status: '',
        overpayment_reason: '',
        overpayment_note: '',
        overpayment_handled_by: '',
        overpayment_handled_at: '',
        can_handle_overpayment: 1,
        contact_person: '联系人甲',
        phone: '13800000000',
        created_at: '2026-04-09 10:00:00'
      }
    ],
    total: 120,
    page: 2,
    pageSize: 50,
    totalPages: 3,
    hasMore: true
  });
  assert.equal(orderEnv.captured.firstCalls.length, 1);
  assert.equal(orderEnv.captured.allCalls.length, 1);
  assert.deepEqual(orderEnv.captured.firstCalls[0].params.slice(0, 4), [7, 'admin', 'admin', '张三']);
  assert.deepEqual(orderEnv.captured.allCalls[0].params.slice(-2), [50, 50]);

  const configEnv = createConfigRouteEnv();
  const clearRequest = new Request('http://localhost/api/clear-project-rollout-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: 9 })
  });
  const clearResponse = await handleConfigRoutes({
    request: clearRequest,
    env: configEnv,
    url: new URL(clearRequest.url),
    currentUser: { role: 'admin', name: 'admin' },
    corsHeaders
  });
  const clearPayload = await clearResponse.json();
  assert.equal(configEnv.captured.batchCalls.length, 1);
  assert.equal(configEnv.captured.batchCalls[0].length, 8);
  assert.deepEqual(clearPayload, {
    success: true,
    project_id: 9,
    deleted_counts: {
      payments: 1,
      expenses: 2,
      order_overpayment_issues: 3,
      order_booth_changes: 4,
      orders: 5,
      booth_map_items: 6,
      booth_maps: 7,
      booths: 8
    }
  });

  const rawUploadBody = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const uploadedObjects = [];
  const uploadRequest = new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent('回归测试合同.pdf')
    },
    body: rawUploadBody
  });
  const uploadResponse = await handleFileRoutes({
    request: uploadRequest,
    env: {
      BUCKET: {
        async put(key, body, options) {
          uploadedObjects.push({ key, size: body.byteLength, contentType: options?.httpMetadata?.contentType || '' });
        }
      }
    },
    url: new URL(uploadRequest.url),
    currentUser: { role: 'admin', name: 'admin' },
    corsHeaders
  });
  const uploadPayload = await uploadResponse.json();
  assert.equal(uploadPayload.success, true);
  assert.equal(uploadedObjects.length, 1);
  assert.equal(uploadedObjects[0].size, rawUploadBody.byteLength);
  assert.equal(uploadedObjects[0].contentType, 'application/pdf');
  assert.ok(uploadedObjects[0].key.endsWith('.pdf'));

  const jsonUploadedObjects = [];
  const retryUploadId = 'retry-upload-id-12345';
  const jsonUploadRequest = new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileName: 'JSON回归测试合同.pdf',
      mimeType: 'application/pdf',
      uploadId: retryUploadId,
      contentBase64: Buffer.from(rawUploadBody).toString('base64')
    })
  });
  const jsonUploadResponse = await handleFileRoutes({
    request: jsonUploadRequest,
    env: {
      BUCKET: {
        async put(key, body, options) {
          jsonUploadedObjects.push({ key, size: body.byteLength, contentType: options?.httpMetadata?.contentType || '' });
        }
      }
    },
    url: new URL(jsonUploadRequest.url),
    currentUser: { role: 'admin', name: 'admin' },
    corsHeaders
  });
  const jsonUploadPayload = await jsonUploadResponse.json();
  assert.equal(jsonUploadPayload.success, true);
  assert.equal(jsonUploadedObjects.length, 1);
  assert.equal(jsonUploadedObjects[0].size, rawUploadBody.byteLength);
  assert.equal(jsonUploadedObjects[0].contentType, 'application/pdf');
  assert.ok(jsonUploadedObjects[0].key.endsWith('.pdf'));

  const jsonRetryRequest = new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileName: 'JSON回归测试合同.pdf',
      mimeType: 'application/pdf',
      uploadId: retryUploadId,
      contentBase64: Buffer.from(rawUploadBody).toString('base64')
    })
  });
  const jsonRetryResponse = await handleFileRoutes({
    request: jsonRetryRequest,
    env: {
      BUCKET: {
        async put(key, body, options) {
          jsonUploadedObjects.push({ key, size: body.byteLength, contentType: options?.httpMetadata?.contentType || '' });
        }
      }
    },
    url: new URL(jsonRetryRequest.url),
    currentUser: { role: 'admin', name: 'admin' },
    corsHeaders
  });
  const jsonRetryPayload = await jsonRetryResponse.json();
  assert.equal(jsonRetryPayload.success, true);
  assert.equal(jsonRetryPayload.fileKey, jsonUploadPayload.fileKey);
  assert.equal(jsonUploadedObjects.length, 2);
  assert.equal(jsonUploadedObjects[1].key, jsonUploadedObjects[0].key);
}

await runTests();
console.log('Route regression tests passed');
