import assert from 'node:assert/strict';
import {
  normalizeHallLabel,
  normalizeBoothCode,
  deriveHallFromBoothCode,
  resolveHallFromMapName
} from '../src/utils/booth-map.mjs';
import { deriveBoothRuntimeStatus } from '../src/services/booth-map-view.mjs';

function runTests() {
  assert.equal(normalizeHallLabel('1'), '1号馆');
  assert.equal(normalizeHallLabel('2馆'), '2号馆');
  assert.equal(normalizeHallLabel('3号馆'), '3号馆');
  assert.equal(normalizeHallLabel('A馆'), 'A号馆');
  assert.equal(normalizeHallLabel('国际展区'), '国际展区');

  assert.equal(normalizeBoothCode(' 1a-09 '), '1A-09');
  assert.equal(normalizeBoothCode(''), '');
  assert.equal(normalizeBoothCode(null), '');

  assert.equal(deriveHallFromBoothCode('1A-09', ''), '1号馆');
  assert.equal(deriveHallFromBoothCode('  12b-01 ', ''), '12号馆');
  assert.equal(deriveHallFromBoothCode('VIP-01', '5馆'), '5号馆');
  assert.equal(deriveHallFromBoothCode('', '国际馆'), '国际号馆');

  assert.equal(resolveHallFromMapName('2026福州渔博会 8号馆 终版'), '8号馆');
  assert.equal(resolveHallFromMapName('国际展区地图'), '国际展区地图');
  assert.equal(resolveHallFromMapName(''), '');

  assert.deepEqual(
    deriveBoothRuntimeStatus('已锁定', []),
    {
      code: 'locked',
      label: '已锁定',
      fillColor: '#6b7280',
      strokeColor: '#374151'
    }
  );

  assert.deepEqual(
    deriveBoothRuntimeStatus('可售', []),
    {
      code: 'available',
      label: '可售',
      fillColor: '#ffffff',
      strokeColor: '#0f172a'
    }
  );

  assert.deepEqual(
    deriveBoothRuntimeStatus('可售', [{ total_amount: 1000, paid_amount: 0 }]),
    {
      code: 'reserved',
      label: '已预定',
      fillColor: '#f59e0b',
      strokeColor: '#b45309'
    }
  );

  assert.deepEqual(
    deriveBoothRuntimeStatus('可售', [{ total_amount: 1000, paid_amount: 200 }]),
    {
      code: 'deposit',
      label: '已付定金',
      fillColor: '#3b82f6',
      strokeColor: '#1d4ed8'
    }
  );

  assert.deepEqual(
    deriveBoothRuntimeStatus('可售', [{ total_amount: 1000, paid_amount: 1000 }]),
    {
      code: 'full_paid',
      label: '已付全款',
      fillColor: '#ef4444',
      strokeColor: '#991b1b'
    }
  );
}

runTests();
console.log('Booth rules tests passed');
