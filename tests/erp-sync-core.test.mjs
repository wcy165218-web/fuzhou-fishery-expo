import assert from 'node:assert/strict';
import {
  buildErpRequestUrl,
  extractErpRows,
  buildErpSyncPlan
} from '../erp-sync-core.mjs';

function runTests() {
  const url = buildErpRequestUrl({
    endpoint_url: 'http://expo.hyfairs.com/hyDailyWaterSubController.do',
    water_id: 'ABC123'
  });
  assert.equal(
    url,
    'http://expo.hyfairs.com/hyDailyWaterSubController.do?datagrid=&waterId=ABC123'
  );

  const rows = extractErpRows({ rows: [{ id: 'erp-1' }] });
  assert.equal(rows.length, 1);

  const plan = buildErpSyncPlan({
    rows: [
      { id: 'erp-1', state: 'closed', ofrmb: '5000', extensionName: '福州渔博会 2026', receivablesUnit: '福建海洋科技' },
      { id: 'erp-2', state: 'draft', ofrmb: '3000', extensionName: '福州渔博会 2026', receivablesUnit: '福建海洋科技' },
      { id: 'erp-3', state: 'closed', ofrmb: '8000', extensionName: '别的项目', receivablesUnit: '福建海洋科技' },
      { id: 'erp-4', state: 'closed', ofrmb: '2000', extensionName: '福州渔博会 2026', receivablesUnit: '找不到的企业' },
      { id: 'erp-5', state: 'closed', ofrmb: '2000', extensionName: '福州渔博会 2026', receivablesUnit: '重复同步企业' },
      { id: 'erp-6', state: 'closed', ofrmb: '9000', extensionName: '福州渔博会 2026', receivablesUnit: '会超额的企业' },
      { id: 'erp-7', state: 'closed', ofrmb: '1000', extensionName: '福州渔博会 2026', receivablesUnit: '同名企业' }
    ],
    orders: [
      { id: 11, project_id: 1, company_name: '福建海洋科技', total_amount: 6000, paid_amount: 0 },
      { id: 12, project_id: 1, company_name: '重复同步企业', total_amount: 5000, paid_amount: 0 },
      { id: 13, project_id: 1, company_name: '会超额的企业', total_amount: 6000, paid_amount: 1000 },
      { id: 14, project_id: 1, company_name: '同名企业', total_amount: 5000, paid_amount: 0 },
      { id: 15, project_id: 1, company_name: '同名企业', total_amount: 5000, paid_amount: 0 }
    ],
    existingErpIds: ['erp-5'],
    expectedProjectName: '福州渔博会 2026'
  });

  assert.equal(plan.summary.total_rows, 7);
  assert.equal(plan.summary.importable_count, 1);
  assert.equal(plan.summary.matched_count, 1);
  assert.equal(plan.summary.skipped_not_closed, 1);
  assert.equal(plan.summary.skipped_project_mismatch, 1);
  assert.equal(plan.summary.unmatched_company, 1);
  assert.equal(plan.summary.duplicate_count, 1);
  assert.equal(plan.summary.skipped_overpaid, 1);
  assert.equal(plan.summary.ambiguous_company, 1);
  assert.equal(plan.importableItems.length, 1);
  assert.equal(plan.importableItems[0].order_id, 11);
  assert.equal(plan.importableItems[0].erp_record_id, 'erp-1');
}

runTests();
console.log('ERP sync core tests passed');
