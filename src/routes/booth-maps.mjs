import {
    clampNumber,
    getChinaTimestamp,
    normalizeUploadExtension,
    roundTo,
    validateBoothMapImageFile
} from '../utils/helpers.mjs';
import { errorResponse, internalErrorResponse } from '../utils/response.mjs';
import { BOOTH_MAP_IMAGE_UPLOAD_BODY_LIMIT, readFormDataBody, readJsonBody } from '../utils/request.mjs';
import {
    getBoothMapDetail,
    getBoothMapRuntimeView,
    normalizeLabelStyle
} from '../services/booth-map-view.mjs';
import {
    deriveHallFromBoothCode,
    normalizeBoothCode,
    resolveHallFromMapName
} from '../utils/booth-map.mjs';

const ALLOWED_BOOTH_TYPES = new Set(['标摊', '豪标', '光地']);
const ALLOWED_OPENING_TYPES = new Set(['单开口', '双开口', '三开口', '四面开']);
const SQL_IN_CHUNK_SIZE = 80;
const BATCH_CHUNK_SIZE = 40;
const MAX_BOOTH_MAP_ITEMS = 300;
const MAX_DELETED_BOOTH_CODES = 300;
const D1_FREE_TIER_CALL_BUDGET = 45;

function jsonResponse(payload, corsHeaders) {
    return new Response(JSON.stringify(payload), { headers: corsHeaders });
}

function normalizeMapName(rawValue) {
    return String(rawValue || '').trim();
}

function normalizeMapDimension(rawValue, fallbackValue) {
    const normalized = Number(rawValue);
    if (!Number.isFinite(normalized)) return fallbackValue;
    return clampNumber(normalized, 320, 5000);
}

function normalizeViewportValue(rawValue, fallbackValue = 0) {
    const normalized = Number(rawValue);
    if (!Number.isFinite(normalized)) return fallbackValue;
    return roundTo(normalized, 2);
}

function normalizeScaleValue(rawValue) {
    const normalized = Number(rawValue);
    if (!Number.isFinite(normalized) || normalized < 0) return 0;
    return roundTo(clampNumber(normalized, 0, 1000), 4);
}

function normalizeStrokeWidth(rawValue) {
    const normalized = Number(rawValue);
    if (!Number.isFinite(normalized)) return 2;
    return roundTo(clampNumber(normalized, 1, 12), 2);
}

function safeParseJson(rawValue, fallback) {
    try {
        if (rawValue === null || rawValue === undefined || rawValue === '') return fallback;
        const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

function normalizeShapeType(rawValue) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (normalized === 'trapezoid') return 'trapezoid';
    if (normalized === 'l' || normalized === 'l-shape') return 'l';
    if (normalized === 'polygon') return 'polygon';
    return 'rect';
}

function getDefaultShapePoints(shapeType) {
    if (shapeType === 'trapezoid') {
        return [
            { x: 0.15, y: 0 },
            { x: 0.85, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
        ];
    }
    if (shapeType === 'l') {
        return [
            { x: 0, y: 0 },
            { x: 0.58, y: 0 },
            { x: 0.58, y: 0.42 },
            { x: 1, y: 0.42 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
        ];
    }
    return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
    ];
}

function normalizeShapePoints(rawValue, shapeType) {
    const parsed = Array.isArray(rawValue) ? rawValue : safeParseJson(rawValue, []);
    const points = (Array.isArray(parsed) ? parsed : [])
        .map((point) => ({
            x: roundTo(clampNumber(Number(point?.x), 0, 1), 4),
            y: roundTo(clampNumber(Number(point?.y), 0, 1), 4)
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    return points.length >= 3 ? points : getDefaultShapePoints(shapeType);
}

function calculatePolygonAreaRatio(points) {
    const normalized = Array.isArray(points) ? points : [];
    if (normalized.length < 3) return 1;
    let sum = 0;
    normalized.forEach((point, index) => {
        const next = normalized[(index + 1) % normalized.length];
        sum += Number(point.x || 0) * Number(next.y || 0) - Number(next.x || 0) * Number(point.y || 0);
    });
    return roundTo(Math.abs(sum) / 2, 6);
}

function normalizeBooleanFlag(rawValue) {
    return Number(rawValue || 0) ? 1 : 0;
}

function chunkItems(items = [], chunkSize = SQL_IN_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

async function executeStatementsInChunks(env, statements = [], chunkSize = BATCH_CHUNK_SIZE) {
    for (const statementChunk of chunkItems(statements, chunkSize)) {
        if (statementChunk.length === 0) continue;
        await env.DB.batch(statementChunk);
    }
}

async function getReferencedBoothCodes(env, projectId, boothCodes) {
    const normalizedBoothCodes = Array.from(new Set(
        (Array.isArray(boothCodes) ? boothCodes : [])
            .map((code) => normalizeBoothCode(code))
            .filter(Boolean)
    ));
    if (normalizedBoothCodes.length === 0) return [];
    const referencedCodes = new Set();
    for (const boothCodeChunk of chunkItems(normalizedBoothCodes)) {
        const placeholders = boothCodeChunk.map(() => '?').join(',');
        const results = await env.DB.prepare(`
          SELECT booth_id
          FROM Orders
          WHERE project_id = ?
            AND booth_id IN (${placeholders})
          GROUP BY booth_id
        `).bind(Number(projectId), ...boothCodeChunk).all();
        (results.results || []).forEach((row) => {
            const normalized = normalizeBoothCode(row.booth_id);
            if (normalized) referencedCodes.add(normalized);
        });
    }
    return Array.from(referencedCodes);
}

async function getOccupiedBoothMapRows(env, projectId, mapId, boothCodes) {
    const normalizedBoothCodes = Array.from(new Set(
        (Array.isArray(boothCodes) ? boothCodes : [])
            .map((code) => normalizeBoothCode(code))
            .filter(Boolean)
    ));
    if (normalizedBoothCodes.length === 0) return [];
    const occupiedRows = [];
    for (const boothCodeChunk of chunkItems(normalizedBoothCodes)) {
        const placeholders = boothCodeChunk.map(() => '?').join(',');
        const results = await env.DB.prepare(`
          SELECT booth_code, map_id
          FROM BoothMapItems
          WHERE project_id = ?
            AND booth_code IN (${placeholders})
            AND map_id <> ?
        `).bind(Number(projectId), ...boothCodeChunk, Number(mapId)).all();
        occupiedRows.push(...(results.results || []));
    }
    return occupiedRows;
}

function ensureAdmin(currentUser, corsHeaders) {
    if (currentUser?.role !== 'admin') {
        return errorResponse('权限不足', 403, corsHeaders);
    }
    return null;
}

export function estimateBoothMapSaveD1CallCount({
    itemCount = 0,
    removedCount = 0,
    renamedCount = 0,
    occupiedReadCalls = 0,
    removedReferencedReadCalls = 0,
    renamedReferencedReadCalls = 0
} = {}) {
    const writeStatementCount = (Number(removedCount || 0) * 2) + (Number(renamedCount || 0) * 2) + (Number(itemCount || 0) * 2) + 1;
    return 3
        + Number(occupiedReadCalls || 0)
        + Number(removedReferencedReadCalls || 0)
        + Number(renamedReferencedReadCalls || 0)
        + Math.ceil(writeStatementCount / BATCH_CHUNK_SIZE);
}

function normalizeBoothMapItemPayload(item, mapRecord, index) {
    const boothCode = normalizeBoothCode(item?.booth_code);
    const hall = deriveHallFromBoothCode(boothCode, item?.hall || resolveHallFromMapName(mapRecord?.name));
    const boothType = String(item?.booth_type || '').trim();
    const openingType = String(item?.opening_type || '').trim();
    const widthMeters = Number(item?.width_m);
    const heightMeters = Number(item?.height_m);
    const x = Number(item?.x);
    const y = Number(item?.y);
    const rotation = Number(item?.rotation || 0);
    const strokeWidth = Number(item?.stroke_width || 2);
    const zIndex = Number(item?.z_index || index + 1);
    const hidden = normalizeBooleanFlag(item?.hidden);
    const effectiveScale = Number(mapRecord?.scale_pixels_per_meter || 0) > 0 ? Number(mapRecord.scale_pixels_per_meter) : 40;
    const shapeType = normalizeShapeType(item?.shape_type);
    const points = normalizeShapePoints(item?.points_json, shapeType);

    if (!boothCode) {
        throw new Error(`第 ${index + 1} 个展位缺少展位号`);
    }
    if (!hall) {
        throw new Error(`展位 ${boothCode} 缺少馆号`);
    }
    if (!ALLOWED_BOOTH_TYPES.has(boothType)) {
        throw new Error(`展位 ${boothCode} 的类型无效`);
    }
    if (!Number.isFinite(widthMeters) || widthMeters <= 0 || !Number.isFinite(heightMeters) || heightMeters <= 0) {
        throw new Error(`展位 ${boothCode} 的长宽必须大于 0`);
    }
    if (boothType === '光地' && openingType) {
        throw new Error('光地不允许设置开口类型');
    }
    if (boothType !== '光地' && !ALLOWED_OPENING_TYPES.has(openingType)) {
        throw new Error('标摊或豪标必须选择开口类型');
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`展位 ${boothCode} 的画布坐标无效`);
    }

    const widthPx = roundTo(widthMeters * effectiveScale, 2);
    const heightPx = roundTo(heightMeters * effectiveScale, 2);
    const labelStyle = normalizeLabelStyle(item?.label_style || item?.label_style_json, widthPx, heightPx);

    return {
        id: Number(item?.id || 0),
        booth_code: boothCode,
        hall,
        booth_type: boothType,
        opening_type: boothType === '光地' ? '' : openingType,
        width_m: roundTo(widthMeters, 2),
        height_m: roundTo(heightMeters, 2),
        area: roundTo(widthMeters * heightMeters * calculatePolygonAreaRatio(points), 2),
        x: roundTo(x, 2),
        y: roundTo(y, 2),
        rotation: roundTo(rotation, 2),
        stroke_width: roundTo(clampNumber(strokeWidth, 1, 12), 2),
        shape_type: shapeType,
        points_json: JSON.stringify(points),
        label_style_json: JSON.stringify(labelStyle),
        z_index: Math.max(1, Number.isFinite(zIndex) ? Math.round(zIndex) : index + 1),
        hidden
    };
}

export async function handleBoothMapRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (
        !url.pathname.startsWith('/api/booth-map')
        && url.pathname !== '/api/booth-maps'
        && url.pathname !== '/api/create-booth-map'
        && url.pathname !== '/api/update-booth-map'
        && url.pathname !== '/api/delete-booth-map'
        && url.pathname !== '/api/upload-booth-map-background'
        && url.pathname !== '/api/save-booth-map-items'
        && url.pathname !== '/api/delete-booth-map-background'
    ) {
        return null;
    }

    if (url.pathname === '/api/booth-maps' && request.method === 'GET') {
        const projectId = Number(url.searchParams.get('projectId') || 0);
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);
        const results = await env.DB.prepare(`
          SELECT
            bm.*,
            COUNT(bmi.id) AS item_count
          FROM BoothMaps bm
          LEFT JOIN BoothMapItems bmi ON bmi.map_id = bm.id AND bmi.project_id = bm.project_id
          WHERE bm.project_id = ?
          GROUP BY bm.id
          ORDER BY datetime(bm.updated_at) DESC, bm.id DESC
        `).bind(projectId).all();
        return jsonResponse({
            success: true,
            items: (results.results || []).map((row) => ({
                ...row,
                id: Number(row.id || 0),
                project_id: Number(row.project_id || 0),
                item_count: Number(row.item_count || 0),
                scale_pixels_per_meter: Number(row.scale_pixels_per_meter || 0),
                default_stroke_width: Number(row.default_stroke_width || 2),
                canvas_width: Number(row.canvas_width || 0),
                canvas_height: Number(row.canvas_height || 0),
                display_config_json: safeParseJson(row.display_config_json, {})
            }))
        }, corsHeaders);
    }

    if (url.pathname === '/api/create-booth-map' && request.method === 'POST') {
        const adminError = ensureAdmin(currentUser, corsHeaders);
        if (adminError) return adminError;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const projectId = Number(payload.projectId || 0);
        const name = normalizeMapName(payload.name);
        if (!projectId) return errorResponse('缺少项目 ID', 400, corsHeaders);
        if (!name) return errorResponse('请填写画布名称', 400, corsHeaders);
        const nowText = getChinaTimestamp();
        const result = await env.DB.prepare(`
          INSERT INTO BoothMaps (
            project_id, name, scale_pixels_per_meter, default_stroke_width, canvas_width, canvas_height,
            viewport_x, viewport_y, viewport_zoom, calibration_json, display_config_json, created_at, updated_at
          ) VALUES (?, ?, 0, 2, 1600, 900, 0, 0, 1, '{}', '{}', ?, ?)
        `).bind(projectId, name, nowText, nowText).run();
        return jsonResponse({
            success: true,
            id: Number(result.meta?.last_row_id || 0)
        }, corsHeaders);
    }

    if (url.pathname === '/api/update-booth-map' && request.method === 'POST') {
        const adminError = ensureAdmin(currentUser, corsHeaders);
        if (adminError) return adminError;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const mapId = Number(payload.id || 0);
        const projectId = Number(payload.projectId || 0);
        const name = normalizeMapName(payload.name);
        if (!mapId || !projectId) return errorResponse('缺少画布信息', 400, corsHeaders);
        if (!name) return errorResponse('请填写画布名称', 400, corsHeaders);
        const updatedAt = getChinaTimestamp();
        await env.DB.prepare(`
          UPDATE BoothMaps
          SET name = ?,
              scale_pixels_per_meter = ?,
              default_stroke_width = ?,
              canvas_width = ?,
              canvas_height = ?,
              viewport_x = ?,
              viewport_y = ?,
              viewport_zoom = ?,
              calibration_json = ?,
              display_config_json = ?,
              updated_at = ?
          WHERE id = ? AND project_id = ?
        `).bind(
            name,
            normalizeScaleValue(payload.scale_pixels_per_meter),
            normalizeStrokeWidth(payload.default_stroke_width),
            normalizeMapDimension(payload.canvas_width, 1600),
            normalizeMapDimension(payload.canvas_height, 900),
            normalizeViewportValue(payload.viewport_x, 0),
            normalizeViewportValue(payload.viewport_y, 0),
            normalizeViewportValue(payload.viewport_zoom, 1),
            JSON.stringify(payload.calibration_json && typeof payload.calibration_json === 'object' ? payload.calibration_json : {}),
            JSON.stringify(safeParseJson(payload.display_config_json, {})),
            updatedAt,
            mapId,
            projectId
        ).run();
        return jsonResponse({ success: true, updated_at: updatedAt }, corsHeaders);
    }

    if (url.pathname === '/api/delete-booth-map' && request.method === 'POST') {
        const adminError = ensureAdmin(currentUser, corsHeaders);
        if (adminError) return adminError;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const mapId = Number(payload.id || 0);
        const projectId = Number(payload.projectId || 0);
        if (!mapId || !projectId) return errorResponse('缺少画布信息', 400, corsHeaders);
        const itemRows = ((await env.DB.prepare(`
          SELECT booth_code
          FROM BoothMapItems
          WHERE map_id = ? AND project_id = ?
        `).bind(mapId, projectId).all()).results || []);
        const boothCodes = itemRows.map((row) => normalizeBoothCode(row.booth_code)).filter(Boolean);
        const referencedBoothCodes = await getReferencedBoothCodes(env, projectId, boothCodes);
        if (referencedBoothCodes.length > 0) {
            const previewText = referencedBoothCodes.slice(0, 5).join('、');
            const suffix = referencedBoothCodes.length > 5 ? ' 等' : '';
            return errorResponse(`以下展位已被订单引用，不能从展位图中删除：${previewText}${suffix}`, 400, corsHeaders);
        }
        const statements = [
            env.DB.prepare('DELETE FROM BoothMapItems WHERE map_id = ? AND project_id = ?').bind(mapId, projectId),
            env.DB.prepare('DELETE FROM Booths WHERE project_id = ? AND booth_map_id = ?').bind(projectId, mapId),
            env.DB.prepare('DELETE FROM BoothMaps WHERE id = ? AND project_id = ?').bind(mapId, projectId)
        ];
        await env.DB.batch(statements);
        return jsonResponse({ success: true }, corsHeaders);
    }

    if (url.pathname === '/api/booth-map-detail' && request.method === 'GET') {
        const mapId = Number(url.searchParams.get('id') || 0);
        const projectId = Number(url.searchParams.get('projectId') || 0);
        if (!mapId || !projectId) return errorResponse('缺少画布信息', 400, corsHeaders);
        const detail = await getBoothMapDetail(env, projectId, mapId);
        if (!detail) return errorResponse('展位图不存在', 404, corsHeaders);
        return jsonResponse({
            success: true,
            map: detail.map,
            items: detail.items
        }, corsHeaders);
    }

    if (url.pathname === '/api/booth-map-runtime-view' && request.method === 'GET') {
        const mapId = Number(url.searchParams.get('id') || 0);
        const projectId = Number(url.searchParams.get('projectId') || 0);
        if (!mapId || !projectId) return errorResponse('缺少画布信息', 400, corsHeaders);
        const runtimeView = await getBoothMapRuntimeView(env, projectId, mapId);
        if (!runtimeView) return errorResponse('展位图不存在', 404, corsHeaders);
        return jsonResponse({
            success: true,
            map: runtimeView.map,
            items: runtimeView.items
        }, corsHeaders);
    }

    if (url.pathname === '/api/upload-booth-map-background' && request.method === 'POST') {
        const adminError = ensureAdmin(currentUser, corsHeaders);
        if (adminError) return adminError;
        const formData = await readFormDataBody(request, corsHeaders, { maxBytes: BOOTH_MAP_IMAGE_UPLOAD_BODY_LIMIT });
        if (formData instanceof Response) return formData;
        const file = formData.get('file');
        const mapId = Number(formData.get('mapId') || 0);
        const projectId = Number(formData.get('projectId') || 0);
        if (!mapId || !projectId) return errorResponse('缺少画布信息', 400, corsHeaders);
        const mapRow = await env.DB.prepare('SELECT id FROM BoothMaps WHERE id = ? AND project_id = ?')
            .bind(mapId, projectId).first();
        if (!mapRow) return errorResponse('展位图不存在', 404, corsHeaders);
        const uploadError = validateBoothMapImageFile(file);
        if (uploadError) return errorResponse(uploadError, 400, corsHeaders);
        const fileExt = normalizeUploadExtension(file.name);
        const fileKey = `booth_map_${projectId}_${mapId}_${Date.now()}_${crypto.randomUUID()}.${fileExt}`;
        try {
            const fileBuffer = await file.arrayBuffer();
            await env.BUCKET.put(fileKey, fileBuffer, {
                httpMetadata: {
                    contentType: String(file.type || 'application/octet-stream').trim() || 'application/octet-stream'
                }
            });
            await env.DB.prepare(`
              UPDATE BoothMaps
              SET background_image_key = ?, updated_at = ?
              WHERE id = ? AND project_id = ?
            `).bind(fileKey, getChinaTimestamp(), mapId, projectId).run();
            return jsonResponse({ success: true, fileKey }, corsHeaders);
        } catch (error) {
            console.error('Upload booth map background failed:', error);
            return errorResponse('底图上传失败，请稍后重试', 500, corsHeaders);
        }
    }

    if (url.pathname === '/api/delete-booth-map-background' && request.method === 'POST') {
        const adminError = ensureAdmin(currentUser, corsHeaders);
        if (adminError) return adminError;
        const payload = await readJsonBody(request, corsHeaders);
        if (payload instanceof Response) return payload;
        const mapId = Number(payload.mapId || payload.id || 0);
        const projectId = Number(payload.projectId || 0);
        if (!mapId || !projectId) return errorResponse('缺少画布信息', 400, corsHeaders);
        await env.DB.prepare(`
          UPDATE BoothMaps
          SET background_image_key = NULL, updated_at = ?
          WHERE id = ? AND project_id = ?
        `).bind(getChinaTimestamp(), mapId, projectId).run();
        return jsonResponse({ success: true }, corsHeaders);
    }

    if (url.pathname.startsWith('/api/booth-map-asset/') && request.method === 'GET') {
        const mapId = Number(url.searchParams.get('mapId') || 0);
        const key = decodeURIComponent(url.pathname.replace('/api/booth-map-asset/', ''));
        if (!mapId || !key) return errorResponse('缺少底图信息', 400, corsHeaders);
        const mapRow = await env.DB.prepare(`
          SELECT background_image_key
          FROM BoothMaps
          WHERE id = ?
        `).bind(mapId).first();
        if (!mapRow || String(mapRow.background_image_key || '') !== key) {
            return errorResponse('文件不存在', 404, corsHeaders);
        }
        const object = await env.BUCKET.get(key);
        if (!object) return errorResponse('文件不存在', 404, corsHeaders);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']);
        headers.set('Vary', 'Origin');
        return new Response(object.body, { headers });
    }

    if (url.pathname === '/api/save-booth-map-items' && request.method === 'POST') {
        const adminError = ensureAdmin(currentUser, corsHeaders);
        if (adminError) return adminError;
        try {
            const payload = await readJsonBody(request, corsHeaders);
            if (payload instanceof Response) return payload;
            const projectId = Number(payload.projectId || 0);
            const mapId = Number(payload.mapId || 0);
            const replaceAll = payload.replaceAll !== false;
            if (!projectId || !mapId) return errorResponse('缺少画布信息', 400, corsHeaders);

            const detail = await getBoothMapDetail(env, projectId, mapId);
            if (!detail) return errorResponse('展位图不存在', 404, corsHeaders);

            const incomingItems = Array.isArray(payload.items) ? payload.items : [];
            if (incomingItems.length > MAX_BOOTH_MAP_ITEMS) {
                return errorResponse(`单次最多保存 ${MAX_BOOTH_MAP_ITEMS} 个展位`, 400, corsHeaders);
            }
            if (Array.isArray(payload.deleted_booth_codes) && payload.deleted_booth_codes.length > MAX_DELETED_BOOTH_CODES) {
                return errorResponse(`单次最多删除 ${MAX_DELETED_BOOTH_CODES} 个展位`, 400, corsHeaders);
            }
            const normalizedItems = incomingItems.map((item, index) =>
                normalizeBoothMapItemPayload(item, detail.map, index)
            );
            const boothCodes = normalizedItems.map((item) => item.booth_code);
            const requestedDeletedBoothCodes = Array.from(new Set(
                (Array.isArray(payload.deleted_booth_codes) ? payload.deleted_booth_codes : [])
                    .map((code) => normalizeBoothCode(code))
                    .filter(Boolean)
            ));
            const duplicateBoothCodes = boothCodes.filter((code, index) => boothCodes.indexOf(code) !== index);
            if (duplicateBoothCodes.length > 0) {
                return errorResponse(`展位号重复：${duplicateBoothCodes[0]}`, 400, corsHeaders);
            }

            if (boothCodes.length > 0) {
                const occupiedRows = await getOccupiedBoothMapRows(env, projectId, mapId, boothCodes);
                if (occupiedRows.length > 0) {
                    return errorResponse(`展位 ${occupiedRows[0].booth_code} 已存在于其他展位图中`, 400, corsHeaders);
                }
            }

            const existingRows = ((await env.DB.prepare(`
              SELECT booth_code
              FROM BoothMapItems
              WHERE project_id = ? AND map_id = ?
            `).bind(projectId, mapId).all()).results || []);
            const existingBoothCodes = existingRows.map((row) => normalizeBoothCode(row.booth_code)).filter(Boolean);
            const removedBoothCodes = replaceAll
                ? existingBoothCodes.filter((code) => !boothCodes.includes(code))
                : requestedDeletedBoothCodes.filter((code) => existingBoothCodes.includes(code) && !boothCodes.includes(code));
            const renamedPreviousBoothCodes = Array.from(new Set(
                normalizedItems.map((item, index) => {
                    const previousBoothCode = normalizeBoothCode(incomingItems[index]?.previous_booth_code);
                    return previousBoothCode && previousBoothCode !== item.booth_code ? previousBoothCode : '';
                }).filter(Boolean)
            ));
            const estimatedD1CallCount = estimateBoothMapSaveD1CallCount({
                itemCount: normalizedItems.length,
                removedCount: removedBoothCodes.length,
                renamedCount: renamedPreviousBoothCodes.length,
                occupiedReadCalls: boothCodes.length > 0 ? chunkItems(boothCodes).length : 0,
                removedReferencedReadCalls: removedBoothCodes.length > 0 ? chunkItems(removedBoothCodes).length : 0,
                renamedReferencedReadCalls: renamedPreviousBoothCodes.length > 0 ? chunkItems(renamedPreviousBoothCodes).length : 0
            });
            if (estimatedD1CallCount > D1_FREE_TIER_CALL_BUDGET) {
                return errorResponse('本次展位图变更过大，请拆分后重试', 400, corsHeaders);
            }

            const referencedRemovedBoothCodes = await getReferencedBoothCodes(env, projectId, removedBoothCodes);
            if (referencedRemovedBoothCodes.length > 0) {
                const previewText = referencedRemovedBoothCodes.slice(0, 5).join('、');
                const suffix = referencedRemovedBoothCodes.length > 5 ? ' 等' : '';
                return errorResponse(`以下展位已被订单引用，不能从展位图中删除：${previewText}${suffix}`, 400, corsHeaders);
            }
            const referencedRenamedBoothCodes = await getReferencedBoothCodes(env, projectId, renamedPreviousBoothCodes);
            if (referencedRenamedBoothCodes.length > 0) {
                return errorResponse(`展位 ${referencedRenamedBoothCodes[0]} 已被订单引用，暂时不能改展位号`, 400, corsHeaders);
            }

            const nowText = getChinaTimestamp();
            const statements = [];
            removedBoothCodes.forEach((boothCode) => {
                statements.push(
                    env.DB.prepare('DELETE FROM BoothMapItems WHERE project_id = ? AND map_id = ? AND booth_code = ?')
                        .bind(projectId, mapId, boothCode)
                );
                statements.push(
                    env.DB.prepare('DELETE FROM Booths WHERE project_id = ? AND booth_map_id = ? AND id = ?')
                        .bind(projectId, mapId, boothCode)
                );
            });

            for (let index = 0; index < normalizedItems.length; index += 1) {
                const item = normalizedItems[index];
                const previousBoothCode = normalizeBoothCode(incomingItems[index]?.previous_booth_code);
                if (previousBoothCode && previousBoothCode !== item.booth_code) {
                    statements.push(
                        env.DB.prepare('DELETE FROM BoothMapItems WHERE project_id = ? AND map_id = ? AND booth_code = ?')
                            .bind(projectId, mapId, previousBoothCode)
                    );
                    statements.push(
                        env.DB.prepare('DELETE FROM Booths WHERE project_id = ? AND booth_map_id = ? AND id = ?')
                            .bind(projectId, mapId, previousBoothCode)
                    );
                }
                statements.push(env.DB.prepare(`
                  INSERT INTO BoothMapItems (
                    project_id, map_id, booth_code, hall, booth_type, opening_type,
                    width_m, height_m, area, x, y, rotation, stroke_width,
                    shape_type, points_json, label_style_json, z_index, hidden, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(project_id, booth_code) DO UPDATE SET
                    map_id = excluded.map_id,
                    hall = excluded.hall,
                    booth_type = excluded.booth_type,
                    opening_type = excluded.opening_type,
                    width_m = excluded.width_m,
                    height_m = excluded.height_m,
                    area = excluded.area,
                    x = excluded.x,
                    y = excluded.y,
                    rotation = excluded.rotation,
                    stroke_width = excluded.stroke_width,
                    shape_type = excluded.shape_type,
                    points_json = excluded.points_json,
                    label_style_json = excluded.label_style_json,
                    z_index = excluded.z_index,
                    hidden = excluded.hidden,
                    updated_at = excluded.updated_at
                `).bind(
                    projectId,
                    mapId,
                    item.booth_code,
                    item.hall,
                    item.booth_type,
                    item.opening_type || null,
                    item.width_m,
                    item.height_m,
                    item.area,
                    item.x,
                    item.y,
                    item.rotation,
                    item.stroke_width,
                    item.shape_type,
                    item.points_json,
                    item.label_style_json,
                    item.z_index,
                    item.hidden,
                    nowText,
                    nowText
                ));
                statements.push(env.DB.prepare(`
                  INSERT INTO Booths (
                    id, project_id, hall, type, area, price_unit, base_price, status,
                    width_m, height_m, opening_type, booth_map_id, source
                  ) VALUES (?, ?, ?, ?, ?, ?, 0, '可售', ?, ?, ?, ?, 'map')
                  ON CONFLICT(id, project_id) DO UPDATE SET
                    hall = excluded.hall,
                    type = excluded.type,
                    area = excluded.area,
                    price_unit = excluded.price_unit,
                    width_m = excluded.width_m,
                    height_m = excluded.height_m,
                    opening_type = excluded.opening_type,
                    booth_map_id = excluded.booth_map_id,
                    source = excluded.source
                `).bind(
                    item.booth_code,
                    projectId,
                    item.hall,
                    item.booth_type,
                    item.area,
                    item.booth_type === '光地' ? '平米' : '个',
                    item.width_m,
                    item.height_m,
                    item.opening_type || null,
                    mapId
                ));
            }

            statements.push(
                env.DB.prepare('UPDATE BoothMaps SET updated_at = ? WHERE id = ? AND project_id = ?')
                    .bind(nowText, mapId, projectId)
            );

            await executeStatementsInChunks(env, statements);
            return jsonResponse({
                success: true,
                saved_count: normalizedItems.length,
                synced_booth_count: normalizedItems.length,
                updated_at: nowText
            }, corsHeaders);
        } catch (error) {
            console.error('Save booth map items failed:', error);
            if (error instanceof Error && error.message) {
                return errorResponse(error.message, 400, corsHeaders);
            }
            return internalErrorResponse(corsHeaders);
        }
    }

    return null;
}
