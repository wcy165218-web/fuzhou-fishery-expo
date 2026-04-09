import { deriveBoothRuntimeStatus } from './booth-map-view.mjs';
import { normalizeBoothCode } from '../utils/booth-map.mjs';

const SQL_IN_CHUNK_SIZE = 80;
const BATCH_CHUNK_SIZE = 40;

function chunkItems(items = [], chunkSize = SQL_IN_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

export async function syncBoothStatusForOrder(env, orderId, projectId) {
    const order = await env.DB.prepare('SELECT booth_id, total_amount, paid_amount FROM Orders WHERE id = ? AND project_id = ?')
        .bind(Number(orderId), Number(projectId)).first();
    if (!order) return;
    await syncBoothStatusByBoothIds(env, Number(projectId), [normalizeBoothCode(order.booth_id)]);
}

export async function syncBoothStatusByBoothId(env, projectId, boothId) {
    await syncBoothStatusByBoothIds(env, projectId, [boothId]);
}

export async function syncBoothStatusByBoothIds(env, projectId, boothIds) {
    const normalizedProjectId = Number(projectId);
    const normalizedBoothIds = Array.from(new Set(
        (Array.isArray(boothIds) ? boothIds : [])
            .map((boothId) => normalizeBoothCode(boothId))
            .filter(Boolean)
    ));
    if (!normalizedProjectId || normalizedBoothIds.length === 0) return;

    const boothStatusMap = new Map();
    for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        const boothRows = ((await env.DB.prepare(`
            SELECT id, status
            FROM Booths
            WHERE project_id = ? AND id IN (${placeholders})
        `).bind(normalizedProjectId, ...boothIdChunk).all()).results || []);
        boothRows.forEach((row) => {
            const normalizedBoothId = normalizeBoothCode(row.id);
            if (normalizedBoothId) {
                boothStatusMap.set(normalizedBoothId, String(row.status || ''));
            }
        });
    }

    if (boothStatusMap.size === 0) return;

    const activeOrdersMap = new Map();
    for (const boothIdChunk of chunkItems(Array.from(boothStatusMap.keys()))) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        const orderRows = ((await env.DB.prepare(`
            SELECT booth_id, paid_amount, total_amount
            FROM Orders
            WHERE project_id = ? AND booth_id IN (${placeholders}) AND status = '正常'
        `).bind(normalizedProjectId, ...boothIdChunk).all()).results || []);
        orderRows.forEach((row) => {
            const normalizedBoothId = normalizeBoothCode(row.booth_id);
            if (!normalizedBoothId) return;
            if (!activeOrdersMap.has(normalizedBoothId)) {
                activeOrdersMap.set(normalizedBoothId, []);
            }
            activeOrdersMap.get(normalizedBoothId).push(row);
        });
    }

    const statements = [];
    boothStatusMap.forEach((storedStatus, boothId) => {
        const runtimeStatus = deriveBoothRuntimeStatus(storedStatus, activeOrdersMap.get(boothId) || []);
        statements.push(
            env.DB.prepare('UPDATE Booths SET status = ? WHERE id = ? AND project_id = ?')
                .bind(runtimeStatus.label, boothId, normalizedProjectId)
        );
    });

    for (const statementChunk of chunkItems(statements, BATCH_CHUNK_SIZE)) {
        if (statementChunk.length === 0) continue;
        await env.DB.batch(statementChunk);
    }
}
