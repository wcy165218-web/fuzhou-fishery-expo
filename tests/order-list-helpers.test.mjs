import assert from 'node:assert/strict';
import { estimateBoothMapSaveD1CallCount } from '../src/routes/booth-maps.mjs';
import { normalizeOrderListParams } from '../src/routes/orders.mjs';

function getUtf8ByteLength(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function runTests() {
  const adminParams = normalizeOrderListParams(
    new URL('http://localhost/api/orders?projectId=12&page=3&pageSize=999&search=%20%E6%B5%B7%E9%B2%9C%E5%B8%82%E5%9C%BA%20&businessSearch=%20%E9%A2%84%E5%88%B6%E8%8F%9C%20&paymentStatus=%E5%AE%9A%E9%87%91&salesName=%E5%BC%A0%E4%B8%89'),
    { role: 'admin', name: 'admin' }
  );
  assert.deepEqual(adminParams, {
    projectId: 12,
    page: 3,
    pageSize: 200,
    selectedSales: '张三',
    search: '海鲜市场',
    businessSearch: '预制菜',
    paymentStatus: '定金'
  });

  const staffParams = normalizeOrderListParams(
    new URL(`http://localhost/api/orders?projectId=9&page=-2&pageSize=abc&search=${'a'.repeat(80)}&paymentStatus=%E4%B9%B1%E5%86%99&salesName=%E6%9D%8E%E5%9B%9B`),
    { role: 'sales', name: '业务员甲' }
  );
  assert.equal(staffParams.projectId, 9);
  assert.equal(staffParams.page, 1);
  assert.equal(staffParams.pageSize, 50);
  assert.equal(staffParams.selectedSales, '');
  assert.equal(staffParams.paymentStatus, '');
  assert.ok(getUtf8ByteLength(staffParams.search) <= 40);

  assert.equal(
    estimateBoothMapSaveD1CallCount({
      itemCount: 300,
      removedCount: 20,
      renamedCount: 10,
      occupiedReadCalls: 4,
      removedReferencedReadCalls: 1,
      renamedReferencedReadCalls: 1
    }),
    26
  );

  assert.ok(
    estimateBoothMapSaveD1CallCount({
      itemCount: 300,
      removedCount: 300,
      renamedCount: 150,
      occupiedReadCalls: 6,
      removedReferencedReadCalls: 2,
      renamedReferencedReadCalls: 2
    }) > 45
  );
}

runTests();
console.log('Order list helper tests passed');
