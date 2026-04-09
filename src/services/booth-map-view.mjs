import {
    clampNumber,
    roundTo
} from '../utils/helpers.mjs';
import { normalizeBoothCode } from '../utils/booth-map.mjs';

const DEFAULT_SCALE_PIXELS_PER_METER = 40;
const SQL_IN_CHUNK_SIZE = 80;

const STATUS_META = {
    locked: {
        code: 'locked',
        label: '已锁定',
        fillColor: '#6b7280',
        strokeColor: '#374151'
    },
    full_paid: {
        code: 'full_paid',
        label: '已付全款',
        fillColor: '#ef4444',
        strokeColor: '#991b1b'
    },
    deposit: {
        code: 'deposit',
        label: '已付定金',
        fillColor: '#3b82f6',
        strokeColor: '#1d4ed8'
    },
    reserved: {
        code: 'reserved',
        label: '已预定',
        fillColor: '#f59e0b',
        strokeColor: '#b45309'
    },
    available: {
        code: 'available',
        label: '可售',
        fillColor: '#ffffff',
        strokeColor: '#0f172a'
    }
};

function safeParseJson(rawValue, fallback) {
    try {
        if (rawValue === null || rawValue === undefined || rawValue === '') return fallback;
        const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

function getEffectiveScale(scalePixelsPerMeter) {
    const normalized = Number(scalePixelsPerMeter || 0);
    return normalized > 0 ? normalized : DEFAULT_SCALE_PIXELS_PER_METER;
}

function getDefaultCompanyRotation(widthPx, heightPx) {
    const safeHeight = Math.max(Number(heightPx || 0), 1);
    const ratio = Number(widthPx || 0) / safeHeight;
    if (ratio <= 0.8) return 90;
    return 0;
}

function chunkItems(items = [], chunkSize = SQL_IN_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

export function getBoothStatusMeta(code) {
    return STATUS_META[code] || STATUS_META.available;
}

export function deriveBoothRuntimeStatus(storedStatus, activeOrders = []) {
    const normalizedOrders = Array.isArray(activeOrders) ? activeOrders : [];
    const normalizedStoredStatus = String(storedStatus || '').trim();

    if (normalizedStoredStatus === '已锁定' && normalizedOrders.length === 0) {
        return STATUS_META.locked;
    }
    if (normalizedOrders.length === 0) {
        return STATUS_META.available;
    }

    const hasFullPaid = normalizedOrders.some((order) => Number(order.total_amount || 0) > 0 && Number(order.paid_amount || 0) >= Number(order.total_amount || 0));
    if (hasFullPaid) return STATUS_META.full_paid;

    const hasDeposit = normalizedOrders.some((order) => Number(order.paid_amount || 0) > 0);
    if (hasDeposit) return STATUS_META.deposit;

    return STATUS_META.reserved;
}

export function resolveBoothCompanyText(boothType, activeOrders = []) {
    if (!Array.isArray(activeOrders) || activeOrders.length === 0) {
        return {
            companyText: '',
            companyTextSource: ''
        };
    }
    if (activeOrders.length > 1) {
        return {
            companyText: '联合参展',
            companyTextSource: 'joint_order'
        };
    }

    const order = activeOrders[0] || {};
    const displayName = String(order.booth_display_name || '').trim();
    const companyName = String(order.company_name || '').trim();
    const normalizedBoothType = String(boothType || '').trim();

    if (normalizedBoothType === '光地') {
        return {
            companyText: displayName || companyName,
            companyTextSource: displayName ? 'booth_display_name' : 'company_name'
        };
    }

    return {
        companyText: displayName || companyName,
        companyTextSource: displayName ? 'booth_display_name' : 'company_name'
    };
}

export function createDefaultLabelStyle(widthPx, heightPx) {
    const shortSide = Math.max(Math.min(Number(widthPx || 0), Number(heightPx || 0)), 32);
    return {
        boothNo: {
            anchorX: 0.5,
            anchorY: 0.2,
            fontSize: clampNumber(Math.round(shortSide * 0.18), 1, 26),
            rotation: 0,
            visible: true
        },
        company: {
            anchorX: 0.5,
            anchorY: 0.58,
            fontSize: clampNumber(Math.round(shortSide * 0.14), 1, 24),
            rotation: getDefaultCompanyRotation(widthPx, heightPx),
            visible: true
        }
    };
}

export function normalizeLabelStyle(rawStyle, widthPx, heightPx) {
    const defaults = createDefaultLabelStyle(widthPx, heightPx);
    const parsed = safeParseJson(rawStyle, {});
    const normalizeBlock = (blockKey) => {
        const fallback = defaults[blockKey];
        const source = parsed?.[blockKey] && typeof parsed[blockKey] === 'object' ? parsed[blockKey] : {};
        return {
            anchorX: roundTo(clampNumber(source.anchorX ?? fallback.anchorX, 0.05, 0.95), 3),
            anchorY: roundTo(clampNumber(source.anchorY ?? fallback.anchorY, 0.05, 0.95), 3),
            fontSize: roundTo(clampNumber(source.fontSize ?? fallback.fontSize, 1, 36), 2),
            rotation: roundTo(clampNumber(source.rotation ?? fallback.rotation, -180, 180), 2),
            visible: source.visible === undefined ? fallback.visible : Number(source.visible) !== 0
        };
    };
    return {
        boothNo: normalizeBlock('boothNo'),
        company: normalizeBlock('company')
    };
}

export function normalizeBoothMapRecord(mapRow) {
    if (!mapRow) return null;
    return {
        ...mapRow,
        id: Number(mapRow.id || 0),
        project_id: Number(mapRow.project_id || 0),
        scale_pixels_per_meter: Number(mapRow.scale_pixels_per_meter || 0),
        default_stroke_width: Number(mapRow.default_stroke_width || 2),
        canvas_width: Number(mapRow.canvas_width || 0),
        canvas_height: Number(mapRow.canvas_height || 0),
        viewport_x: Number(mapRow.viewport_x || 0),
        viewport_y: Number(mapRow.viewport_y || 0),
        viewport_zoom: Number(mapRow.viewport_zoom || 1),
        calibration_json: safeParseJson(mapRow.calibration_json, {}),
        display_config: safeParseJson(mapRow.display_config_json, {})
    };
}

export function normalizeBoothMapItemRecord(itemRow, scalePixelsPerMeter = 0) {
    const effectiveScale = getEffectiveScale(scalePixelsPerMeter);
    const widthMeters = Number(itemRow.width_m || 0);
    const heightMeters = Number(itemRow.height_m || 0);
    const widthPx = roundTo(widthMeters * effectiveScale, 2);
    const heightPx = roundTo(heightMeters * effectiveScale, 2);
    return {
        ...itemRow,
        id: Number(itemRow.id || 0),
        project_id: Number(itemRow.project_id || 0),
        map_id: Number(itemRow.map_id || 0),
        width_m: widthMeters,
        height_m: heightMeters,
        area: Number(itemRow.area || 0),
        x: Number(itemRow.x || 0),
        y: Number(itemRow.y || 0),
        rotation: Number(itemRow.rotation || 0),
        stroke_width: Number(itemRow.stroke_width || 2),
        z_index: Number(itemRow.z_index || 0),
        hidden: Number(itemRow.hidden || 0),
        active_order_count: Number(itemRow.active_order_count || 0),
        points_json: safeParseJson(itemRow.points_json, []),
        label_style: normalizeLabelStyle(itemRow.label_style_json, widthPx, heightPx)
    };
}

export async function getProjectBoothOrdersMap(env, projectId, boothCodes = []) {
    const normalizedBoothCodes = Array.from(new Set(
        (Array.isArray(boothCodes) ? boothCodes : [])
            .map((code) => normalizeBoothCode(code))
            .filter(Boolean)
    ));
    const ordersMap = new Map();
    if (normalizedBoothCodes.length === 0) return ordersMap;

    for (const boothCodeChunk of chunkItems(normalizedBoothCodes)) {
        const placeholders = boothCodeChunk.map(() => '?').join(',');
        const results = await env.DB.prepare(`
          SELECT booth_id, company_name, booth_display_name, paid_amount, total_amount, created_at
          FROM Orders
          WHERE project_id = ?
            AND status = '正常'
            AND booth_id IN (${placeholders})
          ORDER BY datetime(created_at) ASC, id ASC
        `).bind(Number(projectId), ...boothCodeChunk).all();

        (results.results || []).forEach((row) => {
            const boothCode = normalizeBoothCode(row.booth_id);
            if (!boothCode) return;
            if (!ordersMap.has(boothCode)) {
                ordersMap.set(boothCode, []);
            }
            ordersMap.get(boothCode).push(row);
        });
    }

    return ordersMap;
}

export async function getBoothMapDetail(env, projectId, mapId, options = {}) {
    const mapRow = await env.DB.prepare(`
      SELECT *
      FROM BoothMaps
      WHERE id = ? AND project_id = ?
    `).bind(Number(mapId), Number(projectId)).first();
    if (!mapRow) return null;

    const normalizedMap = normalizeBoothMapRecord(mapRow);
    const includeActiveOrderCount = options?.includeActiveOrderCount !== false;
    const activeOrderSelectSql = includeActiveOrderCount ? ', COALESCE(oac.active_order_count, 0) AS active_order_count' : ', 0 AS active_order_count';
    const activeOrderJoinSql = includeActiveOrderCount ? `
      LEFT JOIN (
        SELECT project_id, booth_id, COUNT(*) AS active_order_count
        FROM Orders
        WHERE project_id = ? AND status = '正常'
        GROUP BY project_id, booth_id
      ) oac ON oac.project_id = bmi.project_id AND oac.booth_id = bmi.booth_code
    ` : '';
    const itemQuery = `
      SELECT
        bmi.*,
        b.status AS booth_status,
        b.source AS booth_source
        ${activeOrderSelectSql}
      FROM BoothMapItems bmi
      LEFT JOIN Booths b ON b.project_id = bmi.project_id AND b.id = bmi.booth_code
      ${activeOrderJoinSql}
      WHERE bmi.map_id = ? AND bmi.project_id = ?
      ORDER BY bmi.z_index ASC, bmi.id ASC
    `;
    const itemQueryParams = includeActiveOrderCount
        ? [Number(projectId), Number(mapId), Number(projectId)]
        : [Number(mapId), Number(projectId)];
    const itemRows = ((await env.DB.prepare(itemQuery).bind(...itemQueryParams).all()).results || []);

    return {
        map: normalizedMap,
        items: itemRows.map((row) => normalizeBoothMapItemRecord(row, normalizedMap.scale_pixels_per_meter))
    };
}

export async function getBoothMapRuntimeView(env, projectId, mapId) {
    const detail = await getBoothMapDetail(env, projectId, mapId, {
        includeActiveOrderCount: false
    });
    if (!detail) return null;

    const ordersMap = await getProjectBoothOrdersMap(
        env,
        Number(projectId),
        detail.items.map((item) => item.booth_code)
    );

    return {
        map: detail.map,
        items: detail.items.map((item) => {
            const normalizedBoothCode = normalizeBoothCode(item.booth_code);
            const activeOrders = ordersMap.get(normalizedBoothCode) || [];
            const statusMeta = deriveBoothRuntimeStatus(item.status || item.booth_status, activeOrders);
            const companyInfo = resolveBoothCompanyText(item.booth_type, activeOrders);
            return {
                ...item,
                active_order_count: activeOrders.length,
                status_code: statusMeta.code,
                status_label: statusMeta.label,
                fill_color: statusMeta.fillColor,
                stroke_color: statusMeta.strokeColor,
                booth_no_text: normalizedBoothCode,
                company_text: companyInfo.companyText,
                company_text_source: companyInfo.companyTextSource
            };
        })
    };
}
