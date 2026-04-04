import {
    buildErpRequestParams,
    buildErpRequestParamsWithSearch,
    buildErpRequestUrl,
    buildErpRequestUrlWithSearch,
    buildErpSyncPlan,
    buildProjectSearchKeywords,
    extractErpRows
} from '../../erp-sync-core.mjs';
import {
    decryptSensitiveValue,
    encryptSensitiveValue,
    isEncryptedSensitiveValue
} from '../utils/crypto.mjs';

async function migrateLegacyErpSessionCookie(env, projectId, plainSessionCookie) {
    const normalizedCookie = String(plainSessionCookie || '').trim();
    if (!normalizedCookie) return;
    const encryptedValue = await encryptSensitiveValue(normalizedCookie, env);
    await env.DB.prepare(`
      UPDATE ProjectErpConfigs
      SET session_cookie = ?
      WHERE project_id = ?
    `).bind(encryptedValue, Number(projectId)).run();
}

export async function migrateAllLegacyErpSessionCookies(env) {
    const rows = (await env.DB.prepare(`
      SELECT project_id, session_cookie
      FROM ProjectErpConfigs
      WHERE session_cookie IS NOT NULL
        AND TRIM(session_cookie) != ''
    `).all()).results || [];
    for (const row of rows) {
        const rawValue = String(row.session_cookie || '').trim();
        if (!rawValue || isEncryptedSensitiveValue(rawValue)) continue;
        await migrateLegacyErpSessionCookie(env, row.project_id, rawValue);
    }
}

export async function getErpConfig(env, projectId) {
    const config = await env.DB.prepare(`
        SELECT
            project_id,
            enabled,
            endpoint_url,
            water_id,
            session_cookie,
            expected_project_name,
            use_mock,
            mock_payload,
            last_sync_at,
            last_sync_summary
        FROM ProjectErpConfigs
        WHERE project_id = ?
    `).bind(projectId).first();
    if (!config) return null;
    const decryptedCookie = await decryptSensitiveValue(config.session_cookie, env);
    if (config.session_cookie && !isEncryptedSensitiveValue(config.session_cookie) && decryptedCookie) {
        try {
            await migrateLegacyErpSessionCookie(env, projectId, decryptedCookie);
        } catch (migrationError) {
            console.warn('ERP session cookie re-encryption skipped:', migrationError);
        }
    }
    return {
        ...config,
        session_cookie: decryptedCookie
    };
}

export async function saveErpConfig(env, payload) {
    const encryptedSessionCookie = await encryptSensitiveValue(String(payload.session_cookie || '').trim(), env);

    await env.DB.prepare(`
      INSERT INTO ProjectErpConfigs (
        project_id,
        enabled,
        endpoint_url,
        water_id,
        session_cookie,
        expected_project_name
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        enabled = excluded.enabled,
        endpoint_url = excluded.endpoint_url,
        water_id = excluded.water_id,
        session_cookie = excluded.session_cookie,
        expected_project_name = excluded.expected_project_name
    `).bind(
      Number(payload.project_id),
      Number(payload.enabled) ? 1 : 0,
      String(payload.endpoint_url || '').trim(),
      String(payload.water_id || '').trim(),
      encryptedSessionCookie,
      String(payload.expected_project_name || '').trim()
    ).run();
}

async function fetchErpPayload(config) {
    if (Number(config?.use_mock) === 1) {
        return JSON.parse(config.mock_payload || '{"rows": []}');
    }

    const sessionCookie = String(config?.session_cookie || '').trim();
    if (!sessionCookie) throw new Error('未配置 ERP 登录 Cookie / JSESSIONID');

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': sessionCookie.includes('JSESSIONID=') ? sessionCookie : `JSESSIONID=${sessionCookie}`
    };
    const pageSize = 100;
    const endpoint = String(config?.endpoint_url || '');
    const searchKeywords = endpoint.includes('hyDailyWaterController.do')
        ? buildProjectSearchKeywords(config?.expected_project_name).reverse()
        : [''];

    async function fetchPagedPayload(searchKeyword = '') {
        const erpUrl = searchKeyword ? buildErpRequestUrlWithSearch(config, searchKeyword) : buildErpRequestUrl(config);
        const allRows = [];
        let total = 0;

        for (let page = 1; page <= 50; page += 1) {
            const params = searchKeyword
                ? buildErpRequestParamsWithSearch(config, page, pageSize, searchKeyword)
                : buildErpRequestParams(config, page, pageSize);
            const response = await fetch(erpUrl, {
                method: 'POST',
                headers,
                body: new URLSearchParams(params).toString()
            });

            if (!response.ok) {
                throw new Error(`ERP 接口请求失败（HTTP ${response.status}）`);
            }

            const payload = await response.json();
            const rows = extractErpRows(payload);
            const payloadTotal = Number(payload?.total || 0);
            if (payloadTotal > 0) total = payloadTotal;
            allRows.push(...rows);

            if (rows.length === 0) {
                break;
            }

            if (total > 0 && allRows.length >= total) {
                break;
            }

            if (total <= 0 && rows.length < pageSize) {
                break;
            }
        }

        return {
            total: total || allRows.length,
            rows: allRows
        };
    }

    let fallbackResult = { total: 0, rows: [] };
    for (const keyword of searchKeywords) {
        const result = await fetchPagedPayload(keyword);
        if (result.total > 0 || result.rows.length > 0) {
            return result;
        }
        fallbackResult = result;
    }

    return fallbackResult;
}

export async function buildErpPreviewResult(env, projectId, config) {
    const payload = await fetchErpPayload(config);
    const rows = extractErpRows(payload);
    const orderRows = (await env.DB.prepare(`
        SELECT id, project_id, company_name, total_amount, paid_amount
        FROM Orders
        WHERE project_id = ? AND status NOT IN ('已退订', '已作废')
    `).bind(projectId).all()).results || [];
    const existingRows = (await env.DB.prepare(`
        SELECT p.erp_record_id
        FROM Payments p
        INNER JOIN Orders o ON o.id = p.order_id
        WHERE p.project_id = ?
          AND p.erp_record_id IS NOT NULL
          AND p.erp_record_id != ''
          AND p.deleted_at IS NULL
          AND o.status NOT IN ('已退订', '已作废')
    `).bind(projectId).all()).results || [];

    return buildErpSyncPlan({
        rows,
        orders: orderRows,
        existingErpIds: existingRows.map((row) => row.erp_record_id),
        expectedProjectName: config.expected_project_name || '',
        expectedProjectId: config.water_id || ''
    });
}
