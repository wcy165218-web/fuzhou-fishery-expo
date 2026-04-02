const ERP_CLOSED_STATES = new Set(['closed', '已认领', '已完成', '认领完成']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(2));
}

function normalizeDate(value, dateOnly = false) {
  const text = normalizeText(value).replace(/\.\d+$/, '');
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    const normalized = text.replace('T', ' ');
    return dateOnly ? normalized.slice(0, 10) : normalized;
  }
  if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) {
    const normalized = text.replace(/\//g, '-');
    return dateOnly ? normalized.slice(0, 10) : normalized;
  }
  return text;
}

export function buildErpRequestUrl(config) {
  return buildErpRequestUrlWithSearch(config);
}

export function buildErpRequestUrlWithSearch(config, searchKeyword = '') {
  const endpoint = normalizeText(config?.endpoint_url);
  if (!endpoint) throw new Error('未配置 ERP 接口地址');

  let url;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new Error('ERP 接口地址格式不正确');
  }

  const hasDatagridParam = url.searchParams.has('datagrid') || url.searchParams.has('isDealdatagrid');
  if (!hasDatagridParam) {
    url.searchParams.append('datagrid', '');
  }

  const scopeId = normalizeText(config?.water_id);
  const expectedProjectName = normalizeText(config?.expected_project_name);
  const effectiveSearchKeyword = normalizeText(searchKeyword) || expectedProjectName;
  if (scopeId) {
    if (url.searchParams.has('isDealdatagrid')) {
      url.searchParams.set('exhibitionId', scopeId);
    } else if (url.pathname.includes('hyDailyWaterController.do')) {
      // This total-pool endpoint filters via POST form fields rather than URL params.
    } else if (!url.searchParams.has('waterId')) {
      url.searchParams.set('waterId', scopeId);
    }
  }

  return url.toString();
}

export function buildErpRequestParams(config, page, pageSize) {
  return buildErpRequestParamsWithSearch(config, page, pageSize);
}

export function buildErpRequestParamsWithSearch(config, page, pageSize, searchKeyword = '') {
  const params = {
    page: String(page),
    rows: String(pageSize)
  };
  const scopeId = normalizeText(config?.water_id);
  const endpoint = normalizeText(config?.endpoint_url);
  const expectedProjectName = normalizeText(config?.expected_project_name);
  const effectiveSearchKeyword = normalizeText(searchKeyword) || expectedProjectName;
  if (!endpoint) return params;
  if (endpoint.includes('hyDailyWaterController.do')) {
    params.searchColums = '';
    params.undefined = '';
    params.sqlbuilder = '';
    params.receivablesUnit = '';
    params.bank = '';
    params.ofrmb = '';
    params.collectTime_begin = '';
    params.collectTime_end = '';
    params.accountCompany = '';
    if (effectiveSearchKeyword) {
      params.extensionName = effectiveSearchKeyword;
    }
    params.foreignAmount = '';
    params.departmentId = '';
    params.claimState = '';
    params.payAccount = '';
    params.deptUI = '';
    params.stateUI = '';
    params.accountUI = '';
  } else if (!scopeId) {
    return params;
  } else if (endpoint.includes('isDealdatagrid')) {
    params.exhibitionId = scopeId;
  } else if (endpoint.includes('hyDailyWaterSubController.do')) {
    params.waterId = scopeId;
  }
  return params;
}

export function buildProjectSearchKeywords(projectName) {
  const fullName = normalizeText(projectName);
  if (!fullName) return [];

  const candidates = new Set([fullName]);
  const withoutTrailingParen = fullName.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
  if (withoutTrailingParen) candidates.add(withoutTrailingParen);

  const beforeIntl = fullName.includes('国际') ? fullName.slice(0, fullName.indexOf('国际')).trim() : '';
  if (beforeIntl) candidates.add(beforeIntl);

  const chinaPrefix = fullName.match(/^\d{4}年\d{2}月中国/);
  if (chinaPrefix?.[0]) candidates.add(chinaPrefix[0]);

  return Array.from(candidates).filter(Boolean);
}

export function extractErpRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  throw new Error('ERP 接口返回格式异常，未找到 rows 数组');
}

export function normalizeErpRow(row) {
  const rawState = normalizeText(row?.state || row?.status);
  const erpId = normalizeText(row?.id || row?.erpId || row?.waterSubId);
  const amount = normalizeMoney(row?.confirmMoney ?? row?.confirm_money ?? row?.waterMoney ?? row?.ofrmb ?? row?.amount ?? row?.money);
  const companyName = normalizeText(
    row?.accountCompany ||
    row?.account_company ||
    row?.company ||
    row?.company_name ||
    row?.customer_name ||
    row?.receivablesUnit
  );
  const projectName = normalizeText(row?.extensionName || row?.project_name || row?.projectName);
  const projectId = normalizeText(row?.exhibitionId || row?.projectId || row?.project_id);
  const payerName = normalizeText(
    row?.receivablesUnit ||
    row?.receivables_unit ||
    row?.payerName ||
    row?.fkname ||
    row?.payer_name ||
    companyName
  );
  const bankName = normalizeText(row?.bank || row?.bankName || row?.bank_name || row?.receiveBank || row?.payType);
  const receivingAccountName = normalizeText(row?.corporateAccount || row?.corporate_account);
  const receivingAccountNo = normalizeText(row?.account || row?.account_no);
  const refundAmount = normalizeMoney(row?.refundMoney ?? row?.refund_money ?? row?.cancellationAmount ?? row?.cancellation_amount);
  const paymentTime = normalizeDate(
    row?.collectTime ||
    row?.collect_time ||
    row?.claimTime ||
    row?.paymentTime ||
    row?.payment_time ||
    row?.confirmTime ||
    row?.createTime ||
    row?.createDate,
    true
  );

  return {
    erp_id: erpId,
    state: rawState,
    state_normalized: rawState.toLowerCase(),
    amount,
    company_name: companyName,
    project_name: projectName,
    project_id: projectId,
    payer_name: payerName,
    bank_name: bankName,
    receiving_account_name: receivingAccountName,
    receiving_account_no: receivingAccountNo,
    refund_amount: refundAmount,
    payment_time: paymentTime,
    raw: row || {}
  };
}

export function buildErpSyncPlan({
  rows = [],
  orders = [],
  existingErpIds = [],
  expectedProjectName = '',
  expectedProjectId = ''
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
  const expectedScopeId = normalizeText(expectedProjectId);

  const summary = {
    total_rows: rows.length,
    matched_count: 0,
    importable_count: 0,
    duplicate_count: 0,
    skipped_not_closed: 0,
    skipped_project_mismatch: 0,
    skipped_refund_related: 0,
    skipped_invalid_amount: 0,
    skipped_overpaid: 0,
    overpaid_pending_count: 0,
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

    if (expectedScopeId && normalized.project_id) {
      if (normalized.project_id !== expectedScopeId) {
        summary.skipped_project_mismatch += 1;
        preview.push({ ...previewItem, result: '跳过', reason: 'ERP 项目标识与当前项目配置不一致' });
        return;
      }
    } else if (expectedProject && normalized.project_name && normalized.project_name !== expectedProject) {
      summary.skipped_project_mismatch += 1;
      preview.push({ ...previewItem, result: '跳过', reason: 'ERP 项目名称与当前项目配置不一致' });
      return;
    }

    if (normalized.refund_amount > 0) {
      summary.skipped_refund_related += 1;
      preview.push({ ...previewItem, result: '跳过', reason: '包含退款金额，需人工复核' });
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
    const willOverpay = futurePaidAmount > normalizeMoney(matchedOrder.total_amount || 0) + 0.01;

    summary.matched_count += 1;
    summary.importable_count += 1;
    preview.push({
      ...previewItem,
      result: '可同步',
      reason: willOverpay ? '已匹配订单，入账后会触发超收异常待处理' : '已匹配订单',
      overpaid_after_sync: willOverpay,
      overpaid_amount: willOverpay ? normalizeMoney(futurePaidAmount - normalizeMoney(matchedOrder.total_amount || 0)) : 0,
      matched_order_id: matchedOrder.id
    });
    if (willOverpay) {
      summary.overpaid_pending_count += 1;
    }

    importableItems.push({
      erp_record_id: normalized.erp_id,
      order_id: matchedOrder.id,
      project_id: matchedOrder.project_id,
      amount: normalized.amount,
      payment_time: normalized.payment_time || new Date().toISOString().slice(0, 10),
      payer_name: normalized.payer_name || normalized.company_name || matchedOrder.company_name,
      bank_name: normalized.bank_name || 'ERP同步',
      remarks: [
        `ERP同步导入：${normalized.project_name || '未注明项目'}`,
        normalized.receiving_account_name ? `收至账户名：${normalized.receiving_account_name}` : '',
        normalized.receiving_account_no ? `收至账号：${normalized.receiving_account_no}` : ''
      ].filter(Boolean).join(' | '),
      source: 'ERP_SYNC',
      raw_payload: JSON.stringify(normalized.raw),
      overpaid_after_sync: willOverpay
    });
  });

  return {
    summary,
    preview,
    importableItems
  };
}
