import assert from 'node:assert/strict';
import {
  buildRegionOverviewFromAggregateRows,
  getOptimizedHomeDashboardData,
  getRegionOverviewRows
} from '../src/routes/dashboard.mjs';

function createDashboardEnv() {
  const captured = [];
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
          async all() {
            captured.push({ sql, params: [...this.params], type: 'all' });
            if (sql.includes('FROM Orders o') && sql.includes("o.status NOT IN ('已退订', '已作废')") && !sql.includes('FROM Payments')) {
              return {
                results: [
                  { id: 1, region: '福建省 - 福州市 - 鼓楼区', area: 18, total_booth_fee: 2000, total_amount: 2500, paid_amount: 0, sales_name: '张三', hall: '1号馆', booth_type: '标摊' },
                  { id: 2, region: '国际 - 越南', area: 9, total_booth_fee: 1000, total_amount: 1200, paid_amount: 1200, sales_name: '李四', hall: '2号馆', booth_type: '光地' }
                ]
              };
            }
            if (sql.includes('first_payment_date') && sql.includes('GROUP BY p.order_id')) {
              return {
                results: [
                  { order_id: 1, first_payment_date: '2026-04-09', sales_name: '张三' },
                  { order_id: 2, first_payment_date: '2026-04-08', sales_name: '李四' }
                ]
              };
            }
            if (sql.includes('FROM OrderBoothChanges')) {
              return {
                results: [
                  { order_id: 1, booth_delta_count: 1, total_amount_delta: 300, changed_at: '2026-04-09' },
                  { order_id: 999, booth_delta_count: 2, total_amount_delta: 600, changed_at: '2026-04-09' }
                ]
              };
            }
            if (sql.includes('FROM Staff') && sql.includes('exclude_from_sales_ranking')) {
              return {
                results: [
                  { name: '张三', role: 'sales', target: 10, display_order: 1, exclude_from_sales_ranking: 0 },
                  { name: '李四', role: 'sales', target: 8, display_order: 2, exclude_from_sales_ranking: 0 }
                ]
              };
            }
            return { results: [] };
          },
          async first() {
            captured.push({ sql, params: [...this.params], type: 'first' });
            if (sql.includes('FROM Projects')) {
              return { id: 7, year: 2026 };
            }
            if (sql.includes('FROM Staff WHERE name = ?')) {
              return { name: '张三', role: 'sales', target: 10, display_order: 1, exclude_from_sales_ranking: 0 };
            }
            return null;
          }
        };
      }
    }
  };
}

async function runTests() {
  const env = createDashboardEnv();
  const data = await getOptimizedHomeDashboardData({
    env,
    projectId: 7,
    currentUser: { role: 'sales', name: '张三' }
  });

  assert.equal(data.projectYear, 2026);
  assert.equal(data.globalActiveOrders.length, 2);
  assert.equal(data.scopedOrders.length, 1);
  assert.equal(data.scopedOrders[0].sales_name, '张三');
  assert.ok(data.firstPaymentDates, 'should have firstPaymentDates');
  assert.equal(data.firstPaymentDates['1']?.payment_date, '2026-04-09');
  assert.equal(data.firstPaymentDates['1']?.sales_name, '张三');
  assert.equal(data.orderBoothChangeRows.length, 1);
  assert.equal(data.orderBoothChangeRows[0].order_id, 1);
  assert.equal(data.staffRows.length, 1);
  assert.equal(data.salesListStaffRows.length, 2);

  const orderQueryCount = env.captured.filter((entry) => entry.type === 'all' && entry.sql.includes('FROM Orders o')).length;
  const firstPaymentQueryCount = env.captured.filter((entry) => entry.type === 'all' && entry.sql.includes('MIN(substr(p.payment_time')).length;
  assert.equal(orderQueryCount, 1);
  assert.equal(firstPaymentQueryCount, 1);

  const regionOverview = buildRegionOverviewFromAggregateRows([
    { region: '福建省 - 福州市 - 鼓楼区', company_count: 2, booth_count: 3 },
    { region: '国际 - 越南', company_count: 1, booth_count: 1 },
    { region: '广东省 - 深圳市', company_count: 1, booth_count: 2 }
  ]);
  assert.equal(regionOverview.total_company_count, 4);
  assert.equal(regionOverview.total_booth_count, 6);
  assert.equal(regionOverview.pie_items[0].label, '福建省');
  assert.equal(regionOverview.sections.find((section) => section.key === 'inside_fujian')?.rows[0].label, '福州市 - 鼓楼区');

  const regionEnv = {
    DB: {
      prepare(query) {
        const sql = String(query || '');
        return {
          params: [],
          bind(...params) {
            this.params = params;
            return this;
          },
          async all() {
            assert.match(sql, /GROUP BY COALESCE\(NULLIF\(TRIM\(o\.region\), ''\), '未注明地区'\)/);
            assert.deepEqual(this.params, [7, '张三']);
            return {
              results: [
                { region: '福建省 - 福州市 - 鼓楼区', company_count: 2, booth_count: 3 },
                { region: '国际 - 越南', company_count: 1, booth_count: 1 }
              ]
            };
          }
        };
      }
    }
  };
  const scopedRegionOverview = await getRegionOverviewRows(regionEnv, 7, { role: 'sales', name: '张三' });
  assert.equal(scopedRegionOverview.total_company_count, 3);
  assert.equal(scopedRegionOverview.total_booth_count, 4);
}

await runTests();
console.log('Dashboard source data tests passed');
