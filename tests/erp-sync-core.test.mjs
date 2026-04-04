import assert from 'node:assert/strict';
import {
  buildErpRequestUrl,
  buildErpRequestUrlWithSearch,
  buildErpRequestParams,
  buildErpRequestParamsWithSearch,
  buildProjectSearchKeywords,
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

  const exhibitionUrl = buildErpRequestUrl({
    endpoint_url: 'http://expo.hyfairs.com/hyExhibitionConfirmdealController.do?isDealdatagrid',
    water_id: 'EXPO123'
  });
  assert.equal(
    exhibitionUrl,
    'http://expo.hyfairs.com/hyExhibitionConfirmdealController.do?isDealdatagrid=&exhibitionId=EXPO123'
  );

  const exhibitionUrlWithPlaceholder = buildErpRequestUrl({
    endpoint_url: 'http://expo.hyfairs.com/hyExhibitionConfirmdealController.do?isDealdatagrid&exhibitionId=(exhibitionId)',
    water_id: 'EXPO123'
  });
  assert.equal(
    exhibitionUrlWithPlaceholder,
    'http://expo.hyfairs.com/hyExhibitionConfirmdealController.do?isDealdatagrid=&exhibitionId=EXPO123'
  );

  const dailyWaterUrl = buildErpRequestUrl({
    endpoint_url: 'http://expo.hyfairs.com/hyDailyWaterController.do?datagrid',
    water_id: 'EXPO123',
    expected_project_name: '2026年06月中国'
  });
  assert.equal(
    dailyWaterUrl,
    'http://expo.hyfairs.com/hyDailyWaterController.do?datagrid'
  );

  const dailyWaterUrlWithOverride = buildErpRequestUrlWithSearch({
    endpoint_url: 'http://expo.hyfairs.com/hyDailyWaterController.do?datagrid',
    water_id: 'EXPO123',
    expected_project_name: '2026年06月中国（福州）国际渔业博览会暨中国水产预制菜展(展览四部)'
  }, '2026年06月中国');
  assert.equal(
    dailyWaterUrlWithOverride,
    'http://expo.hyfairs.com/hyDailyWaterController.do?datagrid'
  );

  const dailyParams = buildErpRequestParams({
    endpoint_url: 'http://expo.hyfairs.com/hyDailyWaterController.do?datagrid',
    water_id: 'EXPO123',
    expected_project_name: '2026年06月中国'
  }, 2, 100);
  assert.deepEqual(dailyParams, {
    page: '2',
    rows: '100',
    searchColums: '',
    undefined: '',
    sqlbuilder: '',
    receivablesUnit: '',
    bank: '',
    ofrmb: '',
    collectTime_begin: '',
    collectTime_end: '',
    accountCompany: '',
    extensionName: '2026年06月中国',
    foreignAmount: '',
    departmentId: '',
    claimState: '',
    payAccount: '',
    deptUI: '',
    stateUI: '',
    accountUI: ''
  });

  const dailyParamsWithOverride = buildErpRequestParamsWithSearch({
    endpoint_url: 'http://expo.hyfairs.com/hyDailyWaterController.do?datagrid',
    water_id: 'EXPO123',
    expected_project_name: '2026年06月中国（福州）国际渔业博览会暨中国水产预制菜展(展览四部)'
  }, 1, 50, '2026年06月中国');
  assert.deepEqual(dailyParamsWithOverride, {
    page: '1',
    rows: '50',
    searchColums: '',
    undefined: '',
    sqlbuilder: '',
    receivablesUnit: '',
    bank: '',
    ofrmb: '',
    collectTime_begin: '',
    collectTime_end: '',
    accountCompany: '',
    extensionName: '2026年06月中国',
    foreignAmount: '',
    departmentId: '',
    claimState: '',
    payAccount: '',
    deptUI: '',
    stateUI: '',
    accountUI: ''
  });

  assert.deepEqual(
    buildProjectSearchKeywords('2026年06月中国（福州）国际渔业博览会暨中国水产预制菜展(展览四部)'),
    [
      '2026年06月中国（福州）国际渔业博览会暨中国水产预制菜展(展览四部)',
      '2026年06月中国（福州）国际渔业博览会暨中国水产预制菜展',
      '2026年06月中国（福州）',
      '2026年06月中国'
    ]
  );

  const waterSubParams = buildErpRequestParams({
    endpoint_url: 'http://expo.hyfairs.com/hyDailyWaterSubController.do?datagrid',
    water_id: 'WATER123'
  }, 1, 50);
  assert.deepEqual(waterSubParams, {
    page: '1',
    rows: '50',
    waterId: 'WATER123'
  });

  const rows = extractErpRows({ rows: [{ id: 'erp-1' }] });
  assert.equal(rows.length, 1);

  const plan = buildErpSyncPlan({
    rows: [
      { id: 'erp-1', state: 'closed', confirmMoney: '5000', extensionName: '福州渔博会 2026', accountCompany: '福建海洋科技', receivablesUnit: '张三', collectTime: '2026-03-26 10:13:23.0', bank: '交通银行', corporateAccount: '福建荟源', account: '123456' },
      { id: 'erp-2', state: 'draft', confirmMoney: '3000', extensionName: '福州渔博会 2026', accountCompany: '福建海洋科技' },
      { id: 'erp-3', state: 'closed', confirmMoney: '8000', extensionName: '别的项目', accountCompany: '福建海洋科技' },
      { id: 'erp-4', state: 'closed', confirmMoney: '2000', extensionName: '福州渔博会 2026', accountCompany: '找不到的企业' },
      { id: 'erp-5', state: 'closed', confirmMoney: '2000', extensionName: '福州渔博会 2026', accountCompany: '重复同步企业' },
      { id: 'erp-6', state: 'closed', confirmMoney: '9000', extensionName: '福州渔博会 2026', accountCompany: '会超额的企业' },
      { id: 'erp-7', state: 'closed', confirmMoney: '1000', extensionName: '福州渔博会 2026', accountCompany: '同名企业' },
      { id: 'erp-8', state: 'closed', confirmMoney: '36000', accountCompany: '项目ID不一致企业', exhibitionId: 'OTHER' },
      { id: 'erp-9', state: 'closed', confirmMoney: '6800', accountCompany: '退款企业', exhibitionId: 'EXPO123', refundMoney: '10' },
      { id: 'erp-10', state: 'closed', confirmMoney: '6800', accountCompany: '中渔（福建）渔业有限公司', exhibitionId: 'EXPO123' },
      { id: 'erp-11', state: 'closed', confirmMoney: '1200', extensionName: '福州渔博会旧名称', accountCompany: '旧项目名企业', exhibitionId: 'EXPO123' }
    ],
    orders: [
      { id: 11, project_id: 1, company_name: '福建海洋科技', total_amount: 6000, paid_amount: 0 },
      { id: 12, project_id: 1, company_name: '重复同步企业', total_amount: 5000, paid_amount: 0 },
      { id: 13, project_id: 1, company_name: '会超额的企业', total_amount: 6000, paid_amount: 1000 },
      { id: 14, project_id: 1, company_name: '同名企业', total_amount: 5000, paid_amount: 0 },
      { id: 15, project_id: 1, company_name: '同名企业', total_amount: 5000, paid_amount: 0 },
      { id: 16, project_id: 1, company_name: '项目ID不一致企业', total_amount: 50000, paid_amount: 0 },
      { id: 17, project_id: 1, company_name: '退款企业', total_amount: 50000, paid_amount: 0 },
      { id: 18, project_id: 1, company_name: '中渔（福建）渔业有限公司', total_amount: 50000, paid_amount: 0 },
      { id: 19, project_id: 1, company_name: '旧项目名企业', total_amount: 50000, paid_amount: 0 }
    ],
    existingErpIds: ['erp-5'],
    expectedProjectName: '福州渔博会 2026',
    expectedProjectId: 'EXPO123'
  });

  assert.equal(plan.summary.total_rows, 11);
  assert.equal(plan.summary.importable_count, 4);
  assert.equal(plan.summary.matched_count, 4);
  assert.equal(plan.summary.skipped_not_closed, 1);
  assert.equal(plan.summary.skipped_project_mismatch, 2);
  assert.equal(plan.summary.unmatched_company, 1);
  assert.equal(plan.summary.duplicate_count, 1);
  assert.equal(plan.summary.skipped_overpaid, 0);
  assert.equal(plan.summary.overpaid_pending_count, 1);
  assert.equal(plan.summary.ambiguous_company, 1);
  assert.equal(plan.summary.skipped_refund_related, 1);
  assert.equal(plan.importableItems.length, 4);
  assert.equal(plan.importableItems[0].order_id, 11);
  assert.equal(plan.importableItems[0].erp_record_id, 'erp-1');
  assert.equal(plan.importableItems[0].payer_name, '张三');
  assert.equal(plan.importableItems[0].payment_time, '2026-03-26');
  assert.match(plan.importableItems[0].remarks, /收至账户名：福建荟源/);
  assert.match(plan.importableItems[0].remarks, /收至账号：123456/);
  assert.equal(plan.importableItems[1].order_id, 13);
  assert.equal(plan.importableItems[1].erp_record_id, 'erp-6');
  assert.equal(plan.importableItems[1].overpaid_after_sync, true);
  assert.equal(plan.importableItems[2].order_id, 18);
  assert.equal(plan.importableItems[2].amount, 6800);
  assert.equal(plan.importableItems[2].erp_record_id, 'erp-10');
  assert.equal(plan.importableItems[3].order_id, 19);
  assert.equal(plan.importableItems[3].erp_record_id, 'erp-11');
}

runTests();
console.log('ERP sync core tests passed');
