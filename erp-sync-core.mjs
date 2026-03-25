const ERP_CLOSED_STATES = new Set(['closed', '已认领', '已完成', '认领完成']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(2));
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(text)) return text;
  if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) return text.replace(/\//g, '-');
  return text;
}

export function buildErpRequestUrl(config) {
  const endpoint = normalizeText(config?.endpoint_url);
  if (!endpoint) throw new Error('未配置 ERP 接口地址');

  let url;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new Error('ERP 接口地址格式不正确');
  }

  if (!url.searchParams.has('datagrid')) {
    url.searchParams.append('datagrid', '');
  }

  const waterId = normalizeText(config?.water_id);
  if (waterId && !url.searchParams.has('waterId')) {
    url.searchParams.set('waterId', waterId);
  }

  return url.toString();
}

export function extractErpRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  throw new Error('ERP 接口返回格式异常，未找到 rows 数组');
}

export function normalizeErpRow(row) {
  const rawState = normalizeText(row?.state || row?.status);
  const erpId = normalizeText(row?.id || row?.erpId || row?.waterSubId);
  const amount = normalizeMoney(row?.ofrmb ?? row?.amount ?? row?.money);
  const companyName = normalizeText(row?.receivablesUnit || row?.customer_name || row?.company_name);
  const projectName = normalizeText(row?.extensionName || row?.project_name || row?.projectName);
  const payerName = normalizeText(row?.payerName || row?.fkname || row?.payer_name || companyName);
  const bankName = normalizeText(row?.bankName || row?.bank_name || row?.receiveBank || row?.payType);
  const paymentTime = normalizeDate(
    row?.claimTime ||
    row?.paymentTime ||
    row?.payment_time ||
    row?.confirmTime ||
    row?.createTime ||
    row?.createDate
  );

  return {
    erp_id: erpId,
    state: rawState,
    state_normalized: rawState.toLowerCase(),
    amount,
    company_name: companyName,
    project_name: projectName,
    payer_name: payerName,
    bank_name: bankName,
    payment_time: paymentTime,
    raw: row || {}
  };
}

export function buildErpSyncPlan({
  rows = [],
  orders = [],
  existingErpIds = [],
  expectedProjectName = ''
}) {
  const orderMap = new Map();
  orders.forEach((order) => {
    const key = normalizeText(order.company_name);
    if (!key) return;
    if (!orderMap.has(key)) orderMap.set(key, []);
    orderMap.get(key).push(order);
  });

  const knownErpIds = new Set(existingErpIds.map((id) => normalizeText(id)).filter(Boolean));
  const expectedProject = normalizeText(expectedProjectName);

  const summary = {
    total_rows: rows.length,
    matched_count: 0,
    importable_count: 0,
    duplicate_count: 0,
    skipped_not_closed: 0,
    skipped_project_mismatch: 0,
    skipped_invalid_amount: 0,
    skipped_overpaid: 0,
    unmatched_company: 0,
    ambiguous_company: 0
  };

  const preview = [];
  const importableItems = [];

  rows.forEach((row) => {
    const normalized = normalizeErpRow(row);
    const previewItem = {
      erp_id: normalized.erp_id || '(空)',
      company_name: normalized.company_name || '(未提供)',
      project_name: normalized.project_name || '(未提供)',
      amount: normalized.amount,
      state: normalized.state || '(未提供)'
    };

    if (!normalized.erp_id) {
      summary.unmatched_company += 1;
      preview.push({ ...previewItem, result: '跳过', reason: '缺少 ERP 记录 ID' });
      return;
    }

    const isClosed = ERP_CLOSED_STATES.has(normalized.state_normalized);
    if (!isClosed) {
      summary.skipped_not_closed += 1;
      preview.push({ ...previewItem, result: '跳过', reason: '不是已认领完成状态' });
      return;
    }

    if (expectedProject && normalized.project_name && normalized.project_name !== expectedProject) {
      summary.skipped_project_mismatch += 1;
      preview.push({ ...previewItem, result: '跳过', reason: 'ERP 项目名称与当前项目配置不一致' });
      return;
    }

    if (normalized.amount <= 0) {
      summary.skipped_invalid_amount += 1;
      preview.push({ ...previewItem, result: '跳过', reason: '金额无效' });
      return;
    }

    if (knownErpIds.has(normalized.erp_id)) {
      summary.duplicate_count += 1;
      preview.push({ ...previewItem, result: '跳过', reason: 'ERP 收款记录已同步过' });
      return;
    }

    const matches = orderMap.get(normalized.company_name) || [];
    if (matches.length === 0) {
      summary.unmatched_company += 1;
      preview.push({ ...previewItem, result: '待处理', reason: '未找到同名订单企业' });
      return;
    }

    if (matches.length > 1) {
      summary.ambiguous_company += 1;
      preview.push({ ...previewItem, result: '待处理', reason: '匹配到多个同名企业订单' });
      return;
    }

    const matchedOrder = matches[0];
    const futurePaidAmount = normalizeMoney(Number(matchedOrder.paid_amount || 0) + normalized.amount);
    if (futurePaidAmount > normalizeMoney(matchedOrder.total_amount || 0) + 0.01) {
      summary.skipped_overpaid += 1;
      preview.push({
        ...previewItem,
        result: '跳过',
        reason: '同步后会超过订单应收总额',
        matched_order_id: matchedOrder.id
      });
      return;
    }

    summary.matched_count += 1;
    summary.importable_count += 1;
    preview.push({
      ...previewItem,
      result: '可同步',
      reason: '已匹配订单',
      matched_order_id: matchedOrder.id
    });

    importableItems.push({
      erp_record_id: normalized.erp_id,
      order_id: matchedOrder.id,
      project_id: matchedOrder.project_id,
      amount: normalized.amount,
      payment_time: normalized.payment_time || new Date().toISOString().slice(0, 10),
      payer_name: normalized.payer_name || normalized.company_name || matchedOrder.company_name,
      bank_name: normalized.bank_name || 'ERP同步',
      remarks: `ERP同步导入：${normalized.project_name || '未注明项目'}`,
      source: 'ERP_SYNC',
      raw_payload: JSON.stringify(normalized.raw)
    });
  });

  return {
    summary,
    preview,
    importableItems
  };
}
