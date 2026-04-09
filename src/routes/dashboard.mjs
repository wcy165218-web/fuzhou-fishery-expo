import {
    STAFF_SORT_ORDER,
    applyStateMetricsToBucket,
    formatChinaDateTime,
    getChinaDateNow,
    parseRegionInfo,
    toBoothCount,
    toSafeNumber
} from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';

function getPeriodKeys(paymentDate, context) {
    const keys = ['total'];
    if (!paymentDate) return keys;
    if (paymentDate === context.todayKey) keys.push('today');
    if (paymentDate >= context.weekStartKey) keys.push('week');
    if (paymentDate.startsWith(context.monthPrefix)) keys.push('month');
    return keys;
}

function getDateYearMonth(dateValue) {
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
}

function createPeriodBucket(targetTotal = 0) {
    return {
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
    };
}

function createPeriodMap(targetTotal = 0) {
    return {
        today: createPeriodBucket(targetTotal),
        week: createPeriodBucket(targetTotal),
        month: createPeriodBucket(targetTotal),
        total: createPeriodBucket(targetTotal)
    };
}

function createMonthlyPeriodMap(targetTotal = 0) {
    return Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [String(index + 1), createPeriodBucket(targetTotal)])
    );
}

function createYearlyMonthlyPeriodMap(targetTotal = 0, years = []) {
    return Object.fromEntries(
        years.map((year) => [String(year), createMonthlyPeriodMap(targetTotal)])
    );
}

function createSalesListBucket(targetTotal = 0) {
    return {
        target_total: Number(targetTotal || 0),
        reserved_booth_count: 0,
        deposit_booth_count: 0,
        full_paid_booth_count: 0,
        receivable_total: 0,
        received_total: 0
    };
}

function createSalesListPeriodMap(targetTotal = 0) {
    return {
        today: createSalesListBucket(targetTotal),
        week: createSalesListBucket(targetTotal),
        month: createSalesListBucket(targetTotal),
        total: createSalesListBucket(targetTotal)
    };
}

function createSalesListMonthlyMap(targetTotal = 0) {
    return Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [String(index + 1), createSalesListBucket(targetTotal)])
    );
}

function createYearlySalesListMonthlyMap(targetTotal = 0, years = []) {
    return Object.fromEntries(
        years.map((year) => [String(year), createSalesListMonthlyMap(targetTotal)])
    );
}

function finalizePeriodBucket(bucket) {
    return {
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
    };
}

function finalizeSalesListBucket(bucket) {
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
}

function buildBoothChangeSummaryByOrder(rows = []) {
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
}

function toRoundedNumber(value, digits = 2) {
    return Number(Number(value || 0).toFixed(digits));
}

function createSalesOverviewStat(staffName = '') {
    return {
        staff_name: String(staffName || ''),
        completed_booths: 0,
        completed_companies: 0,
        receivable_total: 0,
        received_total: 0
    };
}

function buildSalesOverview(staffRows = [], orderRows = [], paymentTotalsBySales = {}) {
    const statsMap = {};
    (Array.isArray(orderRows) ? orderRows : []).forEach((order) => {
        const staffName = String(order.sales_name || '');
        if (!staffName) return;
        if (!statsMap[staffName]) statsMap[staffName] = createSalesOverviewStat(staffName);
        const boothCount = toBoothCount(order.area);
        const paidAmount = toSafeNumber(order.paid_amount);
        const totalAmount = toSafeNumber(order.total_amount);
        statsMap[staffName].receivable_total = Number((statsMap[staffName].receivable_total + totalAmount).toFixed(2));
        if (paidAmount >= totalAmount) {
            statsMap[staffName].completed_booths = Number((statsMap[staffName].completed_booths + boothCount).toFixed(2));
            statsMap[staffName].completed_companies += 1;
        }
    });

    Object.entries(paymentTotalsBySales).forEach(([staffName, receivedTotal]) => {
        if (!statsMap[staffName]) statsMap[staffName] = createSalesOverviewStat(staffName);
        statsMap[staffName].received_total = Number(Number(receivedTotal || 0).toFixed(2));
    });

    return (Array.isArray(staffRows) ? staffRows : []).map((staff) => {
        const staffName = String(staff.name || '');
        const stat = statsMap[staffName] || createSalesOverviewStat(staffName);
        const targetBooths = toSafeNumber(staff.target);
        return {
            staff_name: staffName,
            role: staff.role,
            target_booths: targetBooths,
            completed_booths: toRoundedNumber(stat.completed_booths),
            completed_companies: Number(stat.completed_companies || 0),
            receivable_total: toRoundedNumber(stat.receivable_total),
            received_total: toRoundedNumber(stat.received_total),
            completion_rate: targetBooths > 0 ? Number(((stat.completed_booths / targetBooths) * 100).toFixed(1)) : 0,
            collection_rate: stat.receivable_total > 0 ? Number(((stat.received_total / stat.receivable_total) * 100).toFixed(1)) : 0
        };
    }).sort((a, b) => {
        if (b.completed_booths !== a.completed_booths) return b.completed_booths - a.completed_booths;
        if (b.received_total !== a.received_total) return b.received_total - a.received_total;
        return a.staff_name.localeCompare(b.staff_name, 'zh-CN');
    });
}

function buildScopedRowsBySales(rows = [], currentUser) {
    if (currentUser.role === 'admin') return Array.isArray(rows) ? rows : [];
    return (Array.isArray(rows) ? rows : []).filter((row) => String(row.sales_name || '') === String(currentUser.name || ''));
}

function filterRowsByOrderIds(rows = [], allowedOrderIds = new Set()) {
    if (!(allowedOrderIds instanceof Set) || allowedOrderIds.size === 0) return [];
    return (Array.isArray(rows) ? rows : []).filter((row) => allowedOrderIds.has(String(row.order_id || row.id || '')));
}

async function getHomeDashboardSourceRows(env, projectId, currentUser) {
    const normalizedProjectId = Number(projectId || 0);
    const globalActiveOrders = ((await env.DB.prepare(`
      SELECT
        o.id,
        o.region,
        o.area,
        o.total_booth_fee,
        o.total_amount,
        o.paid_amount,
        o.sales_name,
        b.hall,
        b.type AS booth_type
      FROM Orders o
      LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id
      WHERE o.project_id = ?
        AND o.status NOT IN ('已退订', '已作废')
    `).bind(normalizedProjectId).all()).results || []);
    const scopedOrders = buildScopedRowsBySales(globalActiveOrders, currentUser);
    const scopedActiveOrderIds = new Set(scopedOrders.map((order) => String(order.id || '')).filter(Boolean));
    const globalActiveOrderIds = new Set(globalActiveOrders.map((order) => String(order.id || '')).filter(Boolean));

    const orderBoothChangeRows = globalActiveOrderIds.size > 0
        ? filterRowsByOrderIds(
            ((await env.DB.prepare(`
              SELECT order_id, booth_delta_count, total_amount_delta, changed_at
              FROM OrderBoothChanges
              WHERE project_id = ?
              ORDER BY changed_at ASC, id ASC
            `).bind(normalizedProjectId).all()).results || []),
            globalActiveOrderIds
        )
        : [];

    const firstPaymentDates = {};
    ((await env.DB.prepare(`
      SELECT p.order_id, MIN(substr(p.payment_time, 1, 10)) AS first_payment_date, o.sales_name
      FROM Payments p
      INNER JOIN Orders o ON p.order_id = o.id
      WHERE o.project_id = ?
        AND o.status NOT IN ('已退订', '已作废')
        AND p.deleted_at IS NULL
      GROUP BY p.order_id
    `).bind(normalizedProjectId).all()).results || []).forEach((row) => {
        firstPaymentDates[String(row.order_id)] = {
            order_id: String(row.order_id),
            sales_name: String(row.sales_name || ''),
            payment_date: String(row.first_payment_date || '')
        };
    });

    return {
        globalActiveOrders,
        scopedOrders,
        firstPaymentDates,
        orderBoothChangeRows,
        globalActiveOrderIds,
        scopedActiveOrderIds
    };
}

export async function getOptimizedHomeDashboardData({
    env,
    projectId,
    currentUser
}) {
    const projectRow = await env.DB.prepare(`
      SELECT id, name, year, start_date, end_date
      FROM Projects
      WHERE id = ?
    `).bind(projectId).first();
    const projectYear = Number(projectRow?.year || new Date(formatChinaDateTime().replace(' ', 'T') + '+08:00').getUTCFullYear());

    const {
        globalActiveOrders,
        scopedOrders,
        firstPaymentDates,
        orderBoothChangeRows,
        globalActiveOrderIds,
        scopedActiveOrderIds
    } = await getHomeDashboardSourceRows(env, projectId, currentUser);

    const staffRows = currentUser.role === 'admin'
        ? ((await env.DB.prepare(`SELECT name, role, target, display_order, exclude_from_sales_ranking FROM Staff ORDER BY ${STAFF_SORT_ORDER}`).all()).results || [])
        : [await env.DB.prepare('SELECT name, role, target, display_order, exclude_from_sales_ranking FROM Staff WHERE name = ?').bind(currentUser.name).first()].filter(Boolean);

    const salesListStaffRows = ((await env.DB.prepare(`
      SELECT name, role, target, display_order, exclude_from_sales_ranking
      FROM Staff
      WHERE COALESCE(exclude_from_sales_ranking, 0) = 0
      ORDER BY ${STAFF_SORT_ORDER}
    `).all()).results || []);

    return {
        projectYear,
        globalActiveOrders,
        scopedOrders,
        firstPaymentDates,
        orderBoothChangeRows,
        globalActiveOrderIds,
        scopedActiveOrderIds,
        staffRows,
        salesListStaffRows
    };
}

export function buildHallOverviewFromAggregateRows(configRows = [], orderRows = []) {
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
    (Array.isArray(configRows) ? configRows : []).forEach((row) => {
        const hall = String(row.hall || '未分配展馆');
        if (!hallMap[hall]) hallMap[hall] = createHallStat(hall);
        Object.assign(hallMap[hall], {
            ...hallMap[hall],
            configured_booth_count: toRoundedNumber(row.configured_booth_count),
            ground_row_count: Number(row.ground_row_count || 0),
            ground_area: toRoundedNumber(row.ground_area),
            ground_booth_count: toRoundedNumber(row.ground_booth_count),
            standard_row_count: Number(row.standard_row_count || 0),
            standard_area: toRoundedNumber(row.standard_area),
            standard_booth_count: toRoundedNumber(row.standard_booth_count)
        });
    });

    (Array.isArray(orderRows) ? orderRows : []).forEach((row) => {
        const hall = String(row.hall || '未分配展馆');
        if (!hallMap[hall]) hallMap[hall] = createHallStat(hall);
        Object.assign(hallMap[hall], {
            ...hallMap[hall],
            received_company_count: Number(row.received_company_count || 0),
            received_booth_count: toRoundedNumber(row.received_booth_count),
            received_ground_booth_count: toRoundedNumber(row.received_ground_booth_count),
            received_standard_booth_count: toRoundedNumber(row.received_standard_booth_count),
            receivable_total: toRoundedNumber(row.receivable_total),
            received_total: toRoundedNumber(row.received_total),
            receivable_booth_fee: toRoundedNumber(row.receivable_booth_fee),
            received_booth_fee: toRoundedNumber(row.received_booth_fee),
            charged_booth_count: toRoundedNumber(row.charged_booth_count),
            free_booth_count: toRoundedNumber(row.free_booth_count),
            charged_fee_total: toRoundedNumber(row.charged_fee_total),
            ordered_booth_count: toRoundedNumber(row.ordered_booth_count),
            total_booth_fee_all: toRoundedNumber(row.total_booth_fee_all)
        });
    });

    return Object.values(hallMap)
        .map((hall) => ({
            hall: hall.hall,
            configured_booth_count: toRoundedNumber(hall.configured_booth_count),
            configured_total_booth_count: toRoundedNumber(hall.configured_booth_count),
            configured_ground_booth_count: toRoundedNumber(hall.ground_booth_count),
            configured_standard_booth_count: toRoundedNumber(hall.standard_booth_count),
            received_standard_booth_count: toRoundedNumber(hall.received_standard_booth_count),
            received_ground_booth_count: toRoundedNumber(hall.received_ground_booth_count),
            received_booth_count: toRoundedNumber(hall.received_booth_count),
            received_booth_rate: hall.configured_booth_count > 0 ? toRoundedNumber((hall.received_booth_count / hall.configured_booth_count) * 100, 1) : 0,
            remaining_unsold_booth_count: toRoundedNumber(Math.max(hall.configured_booth_count - hall.received_booth_count, 0)),
            received_company_count: Number(hall.received_company_count || 0),
            receivable_total: toRoundedNumber(hall.receivable_total),
            received_total: toRoundedNumber(hall.received_total),
            receivable_booth_fee: toRoundedNumber(hall.receivable_booth_fee),
            received_booth_fee: toRoundedNumber(hall.received_booth_fee),
            collection_rate: hall.receivable_booth_fee > 0 ? toRoundedNumber((hall.received_booth_fee / hall.receivable_booth_fee) * 100, 1) : 0,
            charged_booth_count: toRoundedNumber(hall.charged_booth_count),
            free_booth_count: toRoundedNumber(hall.free_booth_count),
            charged_avg_unit_price: hall.charged_booth_count > 0 ? toRoundedNumber(hall.charged_fee_total / hall.charged_booth_count) : 0,
            overall_avg_unit_price: hall.configured_booth_count > 0 ? toRoundedNumber(hall.total_booth_fee_all / hall.configured_booth_count) : 0,
            ground_row_count: Number(hall.ground_row_count || 0),
            ground_area: toRoundedNumber(hall.ground_area),
            ground_booth_count: toRoundedNumber(hall.ground_booth_count),
            standard_row_count: Number(hall.standard_row_count || 0),
            standard_area: toRoundedNumber(hall.standard_area),
            standard_booth_count: toRoundedNumber(hall.standard_booth_count)
        }))
        .sort((a, b) => a.hall.localeCompare(b.hall, 'zh-CN'));
}

export async function getHallOverviewRows(env, projectId) {
    const normalizedProjectId = Number(projectId || 0);
    const configRows = ((await env.DB.prepare(`
      SELECT
        COALESCE(hall, '未分配展馆') AS hall,
        ROUND(COALESCE(SUM(area / 9.0), 0), 2) AS configured_booth_count,
        SUM(CASE WHEN type = '光地' THEN 1 ELSE 0 END) AS ground_row_count,
        ROUND(COALESCE(SUM(CASE WHEN type = '光地' THEN area ELSE 0 END), 0), 2) AS ground_area,
        ROUND(COALESCE(SUM(CASE WHEN type = '光地' THEN area / 9.0 ELSE 0 END), 0), 2) AS ground_booth_count,
        SUM(CASE WHEN type != '光地' THEN 1 ELSE 0 END) AS standard_row_count,
        ROUND(COALESCE(SUM(CASE WHEN type != '光地' THEN area ELSE 0 END), 0), 2) AS standard_area,
        ROUND(COALESCE(SUM(CASE WHEN type != '光地' THEN area / 9.0 ELSE 0 END), 0), 2) AS standard_booth_count
      FROM Booths
      WHERE project_id = ?
      GROUP BY COALESCE(hall, '未分配展馆')
      ORDER BY hall ASC
    `).bind(normalizedProjectId).all()).results || []);

    const orderRows = ((await env.DB.prepare(`
      SELECT
        COALESCE(b.hall, '未分配展馆') AS hall,
        SUM(CASE WHEN (o.total_booth_fee <= 0 OR o.paid_amount > 0) THEN 1 ELSE 0 END) AS received_company_count,
        ROUND(COALESCE(SUM(CASE WHEN (o.total_booth_fee <= 0 OR o.paid_amount > 0) THEN o.area / 9.0 ELSE 0 END), 0), 2) AS received_booth_count,
        ROUND(COALESCE(SUM(CASE WHEN (o.total_booth_fee <= 0 OR o.paid_amount > 0) AND b.type = '光地' THEN o.area / 9.0 ELSE 0 END), 0), 2) AS received_ground_booth_count,
        ROUND(COALESCE(SUM(CASE WHEN (o.total_booth_fee <= 0 OR o.paid_amount > 0) AND b.type != '光地' THEN o.area / 9.0 ELSE 0 END), 0), 2) AS received_standard_booth_count,
        ROUND(COALESCE(SUM(o.total_amount), 0), 2) AS receivable_total,
        ROUND(COALESCE(SUM(o.paid_amount), 0), 2) AS received_total,
        ROUND(COALESCE(SUM(CASE WHEN o.total_booth_fee > 0 THEN o.total_booth_fee ELSE 0 END), 0), 2) AS receivable_booth_fee,
        ROUND(COALESCE(SUM(CASE WHEN o.total_booth_fee > 0 THEN MIN(o.paid_amount, o.total_booth_fee) ELSE 0 END), 0), 2) AS received_booth_fee,
        ROUND(COALESCE(SUM(CASE WHEN o.total_booth_fee > 0 THEN o.area / 9.0 ELSE 0 END), 0), 2) AS charged_booth_count,
        ROUND(COALESCE(SUM(CASE WHEN o.total_booth_fee <= 0 THEN o.area / 9.0 ELSE 0 END), 0), 2) AS free_booth_count,
        ROUND(COALESCE(SUM(CASE WHEN o.total_booth_fee > 0 THEN o.total_booth_fee ELSE 0 END), 0), 2) AS charged_fee_total,
        ROUND(COALESCE(SUM(o.area / 9.0), 0), 2) AS ordered_booth_count,
        ROUND(COALESCE(SUM(o.total_booth_fee), 0), 2) AS total_booth_fee_all
      FROM Orders o
      LEFT JOIN Booths b ON o.booth_id = b.id AND o.project_id = b.project_id
      WHERE o.project_id = ?
        AND o.status NOT IN ('已退订', '已作废')
      GROUP BY COALESCE(b.hall, '未分配展馆')
      ORDER BY hall ASC
    `).bind(normalizedProjectId).all()).results || []);

    return buildHallOverviewFromAggregateRows(configRows, orderRows);
}

export function buildRegionOverviewFromAggregateRows(regionRows = []) {
    const normalizedRows = Array.isArray(regionRows) ? regionRows : [];
    const totalRegionCompanyCount = normalizedRows.reduce((sum, row) => sum + Number(row.company_count || 0), 0);
    const totalRegionBoothCount = toRoundedNumber(normalizedRows.reduce((sum, row) => sum + toSafeNumber(row.booth_count), 0));
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

    normalizedRows.forEach((row) => {
        const companyCount = Number(row.company_count || 0);
        const boothCount = toSafeNumber(row.booth_count);
        if (companyCount <= 0 && boothCount <= 0) return;

        const regionInfo = parseRegionInfo(row.region);
        if (!pieMap[regionInfo.pieLabel]) {
            pieMap[regionInfo.pieLabel] = { label: regionInfo.pieLabel, company_count: 0, booth_count: 0 };
        }
        pieMap[regionInfo.pieLabel].company_count += companyCount;
        pieMap[regionInfo.pieLabel].booth_count = Number((pieMap[regionInfo.pieLabel].booth_count + boothCount).toFixed(2));

        const section = sectionMap[regionInfo.scope];
        if (!section) return;
        if (!section.rows[regionInfo.detailLabel]) {
            section.rows[regionInfo.detailLabel] = { label: regionInfo.detailLabel, company_count: 0, booth_count: 0 };
        }
        section.rows[regionInfo.detailLabel].company_count += companyCount;
        section.rows[regionInfo.detailLabel].booth_count = Number((section.rows[regionInfo.detailLabel].booth_count + boothCount).toFixed(2));
    });

    const sections = Object.values(sectionMap).map((section) => {
        const rows = Object.values(section.rows)
            .map((row) => ({
                ...row,
                booth_count: toRoundedNumber(row.booth_count),
                company_ratio: totalRegionCompanyCount > 0 ? Number(((row.company_count / totalRegionCompanyCount) * 100).toFixed(1)) : 0,
                booth_ratio: totalRegionBoothCount > 0 ? Number(((row.booth_count / totalRegionBoothCount) * 100).toFixed(1)) : 0
            }))
            .sort((a, b) => {
                if (b.company_count !== a.company_count) return b.company_count - a.company_count;
                if (b.booth_count !== a.booth_count) return b.booth_count - a.booth_count;
                return a.label.localeCompare(b.label, 'zh-CN');
            });
        const companyCount = rows.reduce((sum, row) => sum + row.company_count, 0);
        const boothCount = toRoundedNumber(rows.reduce((sum, row) => sum + toSafeNumber(row.booth_count), 0));
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
            booth_count: toRoundedNumber(item.booth_count),
            company_ratio: totalRegionCompanyCount > 0 ? Number(((item.company_count / totalRegionCompanyCount) * 100).toFixed(1)) : 0
        }))
        .sort((a, b) => {
            if (b.company_count !== a.company_count) return b.company_count - a.company_count;
            if (b.booth_count !== a.booth_count) return b.booth_count - a.booth_count;
            return a.label.localeCompare(b.label, 'zh-CN');
        });

    return {
        total_company_count: totalRegionCompanyCount,
        total_booth_count: totalRegionBoothCount,
        sections,
        pie_items: pieItems
    };
}

export async function getRegionOverviewRows(env, projectId, currentUser) {
    const normalizedProjectId = Number(projectId || 0);
    const params = [normalizedProjectId];
    const salesFilterSql = currentUser.role === 'admin'
        ? ''
        : (() => {
            params.push(String(currentUser.name || ''));
            return ' AND o.sales_name = ?';
        })();

    const regionRows = ((await env.DB.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(o.region), ''), '未注明地区') AS region,
        COUNT(*) AS company_count,
        ROUND(COALESCE(SUM(o.area / 9.0), 0), 2) AS booth_count
      FROM Orders o
      WHERE o.project_id = ?
        AND o.status NOT IN ('已退订', '已作废')
        ${salesFilterSql}
      GROUP BY COALESCE(NULLIF(TRIM(o.region), ''), '未注明地区')
      ORDER BY region ASC
    `).bind(...params).all()).results || []);

    return buildRegionOverviewFromAggregateRows(regionRows);
}

export async function handleDashboardRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/order-dashboard-stats' && request.method === 'GET') {
        const urlObj = new URL(request.url);
        const pid = urlObj.searchParams.get('projectId');
        const selectedSales = currentUser.role === 'admin' ? urlObj.searchParams.get('salesName') : null;
        const scopedSales = currentUser.role === 'admin' ? selectedSales : currentUser.name;

        let orderWhere = `o.project_id = ? AND o.status NOT IN ('已退订', '已作废')`;
        const orderParams = [pid];
        if (scopedSales) {
            orderWhere += ' AND o.sales_name = ?';
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

        let expenseWhere = 'e.project_id = ?';
        const expenseParams = [pid];
        if (scopedSales) {
            expenseWhere += ' AND o.sales_name = ?';
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

        const {
            projectYear,
            globalActiveOrders,
            scopedOrders,
            firstPaymentDates,
            orderBoothChangeRows,
            globalActiveOrderIds,
            scopedActiveOrderIds,
            staffRows,
            salesListStaffRows
        } = await getOptimizedHomeDashboardData({
            env,
            projectId: Number(pid),
            currentUser
        });
        const allActiveOrders = currentUser.role === 'admin' ? globalActiveOrders : scopedOrders;

        const nowChina = getChinaDateNow();
        const nowYear = nowChina.getUTCFullYear();
        const nowMonth = nowChina.getUTCMonth();
        const nowDate = nowChina.getUTCDate();
        const periodContext = {
            todayKey: `${nowYear}-${String(nowMonth + 1).padStart(2, '0')}-${String(nowDate).padStart(2, '0')}`,
            weekStartKey: (() => {
                const weekDay = nowChina.getUTCDay() || 7;
                const weekStart = new Date(Date.UTC(nowYear, nowMonth, nowDate - (weekDay - 1)));
                return `${weekStart.getUTCFullYear()}-${String(weekStart.getUTCMonth() + 1).padStart(2, '0')}-${String(weekStart.getUTCDate()).padStart(2, '0')}`;
            })(),
            monthPrefix: `${nowYear}-${String(nowMonth + 1).padStart(2, '0')}`
        };

        const globalFirstPaymentByOrder = firstPaymentDates;
        const scopedFirstPaymentByOrder = {};
        Object.entries(firstPaymentDates).forEach(([key, value]) => {
            if (scopedActiveOrderIds.has(key)) {
                scopedFirstPaymentByOrder[key] = value;
            }
        });
        const globalBoothChangeSummaryByOrder = buildBoothChangeSummaryByOrder(orderBoothChangeRows);
        const scopedBoothChangeSummaryByOrder = buildBoothChangeSummaryByOrder(
            orderBoothChangeRows.filter((row) => scopedActiveOrderIds.has(String(row.order_id || '')))
        );

        // --- SQL: per-sales payment aggregation by period ---
        const paymentPeriodBySales = ((await env.DB.prepare(`
          SELECT
            o.sales_name,
            ROUND(SUM(p.amount), 2) AS total_received,
            ROUND(SUM(CASE WHEN substr(p.payment_time,1,10) = ? THEN p.amount ELSE 0 END), 2) AS today_received,
            ROUND(SUM(CASE WHEN substr(p.payment_time,1,10) >= ? THEN p.amount ELSE 0 END), 2) AS week_received,
            ROUND(SUM(CASE WHEN substr(p.payment_time,1,7) = ? THEN p.amount ELSE 0 END), 2) AS month_received
          FROM Payments p
          INNER JOIN Orders o ON p.order_id = o.id
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废') AND p.deleted_at IS NULL
          GROUP BY o.sales_name
        `).bind(periodContext.todayKey, periodContext.weekStartKey, periodContext.monthPrefix, Number(pid)).all()).results || []);

        // --- SQL: per-sales monthly payment totals ---
        const paymentMonthlyBySales = ((await env.DB.prepare(`
          SELECT
            o.sales_name,
            CAST(substr(p.payment_time,1,4) AS INTEGER) AS p_year,
            CAST(substr(p.payment_time,6,2) AS INTEGER) AS p_month,
            ROUND(SUM(p.amount), 2) AS received_total
          FROM Payments p
          INNER JOIN Orders o ON p.order_id = o.id
          WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废') AND p.deleted_at IS NULL
          GROUP BY o.sales_name, p_year, p_month
        `).bind(Number(pid)).all()).results || []);

        // --- SQL: scoped unique-order paid counts by period ---
        const scopedPaidParams = [periodContext.todayKey, periodContext.weekStartKey, periodContext.monthPrefix, Number(pid)];
        const scopedPaidFilter = currentUser.role === 'admin' ? '' : (() => { scopedPaidParams.push(currentUser.name); return ' AND o.sales_name = ?'; })();
        const scopedPaymentCounts = await env.DB.prepare(`
          SELECT
            ROUND(COALESCE(SUM(CASE WHEN has_today > 0 THEN booth_count ELSE 0 END), 0), 2) AS today_paid_booth_count,
            ROUND(COALESCE(SUM(CASE WHEN has_week > 0 THEN booth_count ELSE 0 END), 0), 2) AS week_paid_booth_count,
            ROUND(COALESCE(SUM(CASE WHEN has_month > 0 THEN booth_count ELSE 0 END), 0), 2) AS month_paid_booth_count,
            ROUND(COALESCE(SUM(booth_count), 0), 2) AS total_paid_booth_count,
            COALESCE(SUM(CASE WHEN has_today > 0 THEN 1 ELSE 0 END), 0) AS today_paid_company_count,
            COALESCE(SUM(CASE WHEN has_week > 0 THEN 1 ELSE 0 END), 0) AS week_paid_company_count,
            COALESCE(SUM(CASE WHEN has_month > 0 THEN 1 ELSE 0 END), 0) AS month_paid_company_count,
            COALESCE(COUNT(*), 0) AS total_paid_company_count
          FROM (
            SELECT
              p.order_id,
              ROUND(o.area / 9.0, 2) AS booth_count,
              MAX(CASE WHEN substr(p.payment_time,1,10) = ? THEN 1 ELSE 0 END) AS has_today,
              MAX(CASE WHEN substr(p.payment_time,1,10) >= ? THEN 1 ELSE 0 END) AS has_week,
              MAX(CASE WHEN substr(p.payment_time,1,7) = ? THEN 1 ELSE 0 END) AS has_month
            FROM Payments p
            INNER JOIN Orders o ON p.order_id = o.id
            WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废') AND p.deleted_at IS NULL${scopedPaidFilter}
            GROUP BY p.order_id
          )
        `).bind(...scopedPaidParams).first();

        // --- SQL: scoped unique-order paid counts by year/month ---
        const scopedMonthlyParams = [Number(pid)];
        const scopedMonthlyFilter = currentUser.role === 'admin' ? '' : (() => { scopedMonthlyParams.push(currentUser.name); return ' AND o.sales_name = ?'; })();
        const scopedMonthlyCounts = ((await env.DB.prepare(`
          SELECT
            agg.p_year,
            agg.p_month,
            ROUND(COALESCE(SUM(agg.booth_count), 0), 2) AS paid_booth_count,
            COALESCE(COUNT(*), 0) AS paid_company_count
          FROM (
            SELECT
              p.order_id,
              ROUND(o.area / 9.0, 2) AS booth_count,
              CAST(substr(p.payment_time,1,4) AS INTEGER) AS p_year,
              CAST(substr(p.payment_time,6,2) AS INTEGER) AS p_month
            FROM Payments p
            INNER JOIN Orders o ON p.order_id = o.id
            WHERE o.project_id = ? AND o.status NOT IN ('已退订', '已作废') AND p.deleted_at IS NULL${scopedMonthlyFilter}
            GROUP BY p.order_id, p_year, p_month
          ) agg
          GROUP BY agg.p_year, agg.p_month
        `).bind(...scopedMonthlyParams).all()).results || []);

        // Build payment totals by sales (for salesOverview)
        const paymentTotalsBySales = {};
        paymentPeriodBySales.forEach((row) => {
            paymentTotalsBySales[row.sales_name] = Number(row.total_received || 0);
        });

        // Scoped received totals by period
        let scopedReceivedByPeriod;
        if (currentUser.role === 'admin') {
            scopedReceivedByPeriod = {
                today: Number(paymentPeriodBySales.reduce((s, r) => s + Number(r.today_received || 0), 0).toFixed(2)),
                week: Number(paymentPeriodBySales.reduce((s, r) => s + Number(r.week_received || 0), 0).toFixed(2)),
                month: Number(paymentPeriodBySales.reduce((s, r) => s + Number(r.month_received || 0), 0).toFixed(2)),
                total: Number(paymentPeriodBySales.reduce((s, r) => s + Number(r.total_received || 0), 0).toFixed(2))
            };
        } else {
            const myPayment = paymentPeriodBySales.find((r) => r.sales_name === currentUser.name);
            scopedReceivedByPeriod = {
                today: Number(myPayment?.today_received || 0),
                week: Number(myPayment?.week_received || 0),
                month: Number(myPayment?.month_received || 0),
                total: Number(myPayment?.total_received || 0)
            };
        }

        // Scoped monthly received totals
        const scopedMonthlyReceived = {};
        if (currentUser.role === 'admin') {
            paymentMonthlyBySales.forEach((row) => {
                const key = `${row.p_year}::${row.p_month}`;
                scopedMonthlyReceived[key] = Number(((scopedMonthlyReceived[key] || 0) + Number(row.received_total || 0)).toFixed(2));
            });
        } else {
            paymentMonthlyBySales.filter((r) => r.sales_name === currentUser.name).forEach((row) => {
                scopedMonthlyReceived[`${row.p_year}::${row.p_month}`] = Number(row.received_total || 0);
            });
        }

        const paymentYears = [...new Set(paymentMonthlyBySales.map((r) => r.p_year).filter((y) => y > 0))];
        const salesAvailableYears = Array.from(new Set([
            projectYear,
            ...Object.values(globalFirstPaymentByOrder).map((p) => Number(String(p.payment_date || '').slice(0, 4))),
            ...paymentYears,
            ...orderBoothChangeRows.map((c) => Number(String(c.changed_at || '').slice(0, 4)))
        ].filter((y) => Number.isFinite(y) && y > 0))).sort((a, b) => b - a);

        const salesOverview = buildSalesOverview(staffRows, allActiveOrders, paymentTotalsBySales);

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
        const receivedTotalHome = scopedReceivedByPeriod.total;
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
            const firstPaymentPeriodKeys = getPeriodKeys(firstPayment.payment_date, periodContext).filter((periodKey) => periodKey !== 'total');
            const yearMonth = getDateYearMonth(firstPayment.payment_date);

            firstPaymentPeriodKeys.forEach((periodKey) => {
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
                const changePeriodKeys = getPeriodKeys(event.changed_at, periodContext).filter((periodKey) => periodKey !== 'total');
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

        // Apply SQL-aggregated payment data to salesSummaryPeriods
        ['today', 'week', 'month', 'total'].forEach((period) => {
            salesSummaryPeriods[period].received_total = scopedReceivedByPeriod[period];
            salesSummaryPeriods[period].paid_booth_count = Number(scopedPaymentCounts?.[`${period}_paid_booth_count`] || 0);
            salesSummaryPeriods[period].paid_company_count = Number(scopedPaymentCounts?.[`${period}_paid_company_count`] || 0);
        });

        // Apply SQL-aggregated payment data to salesSummaryMonthlyPeriods
        Object.entries(salesSummaryMonthlyPeriods).forEach(([yearKey, monthMap]) => {
            Object.entries(monthMap).forEach(([monthKey, bucket]) => {
                const key = `${yearKey}::${monthKey}`;
                bucket.received_total = Number(scopedMonthlyReceived[key] || 0);
                const countRow = scopedMonthlyCounts.find((r) => String(r.p_year) === yearKey && String(r.p_month) === monthKey);
                bucket.paid_booth_count = Number(countRow?.paid_booth_count || 0);
                bucket.paid_company_count = Number(countRow?.paid_company_count || 0);
            });
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
            const firstPaymentPeriodKeys = getPeriodKeys(firstPayment.payment_date, periodContext).filter((periodKey) => periodKey !== 'total');
            const yearMonth = getDateYearMonth(firstPayment.payment_date);

            firstPaymentPeriodKeys.forEach((periodKey) => {
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
                getPeriodKeys(firstPayment.payment_date, periodContext).forEach((periodKey) => {
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
                const changePeriodKeys = getPeriodKeys(event.changed_at, periodContext).filter((periodKey) => periodKey !== 'total');
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
                    getPeriodKeys(event.changed_at, periodContext).forEach((periodKey) => {
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

        // Apply SQL per-sales period payment totals to salesListPeriodMap
        paymentPeriodBySales.forEach((row) => {
            const bucketMap = salesListPeriodMap[row.sales_name];
            if (!bucketMap) return;
            bucketMap.today.received_total = Number(row.today_received || 0);
            bucketMap.week.received_total = Number(row.week_received || 0);
            bucketMap.month.received_total = Number(row.month_received || 0);
            bucketMap.total.received_total = Number(row.total_received || 0);
        });

        // Apply SQL per-sales monthly payment totals to salesListMonthlyPeriodMap
        paymentMonthlyBySales.forEach((row) => {
            const monthBucketMap = salesListMonthlyPeriodMap[row.sales_name];
            if (!monthBucketMap?.[String(row.p_year)]) return;
            monthBucketMap[String(row.p_year)][String(row.p_month)].received_total = Number(row.received_total || 0);
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

        const regionOverview = await getRegionOverviewRows(env, Number(pid), currentUser);
        const hallOverview = currentUser.role === 'admin' ? await getHallOverviewRows(env, Number(pid)) : [];

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
            region_overview: regionOverview,
            hall_overview: hallOverview
        }), { headers: corsHeaders });
    }

    return null;
}
