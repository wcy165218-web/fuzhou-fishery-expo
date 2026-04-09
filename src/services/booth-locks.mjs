import { formatChinaDateTime, hasMetaChanges } from '../utils/helpers.mjs';
import { normalizeBoothCode } from '../utils/booth-map.mjs';

const LOCK_SQL_CHUNK_SIZE = 80;

export const BOOTH_LOCK_TTL_SECONDS = 30;

function chunkItems(items = [], chunkSize = LOCK_SQL_CHUNK_SIZE) {
    const output = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        output.push(items.slice(index, index + chunkSize));
    }
    return output;
}

export function normalizeBoothLockTargets(rawBoothIds = []) {
    return Array.from(new Set(
        (Array.isArray(rawBoothIds) ? rawBoothIds : [])
            .map((boothId) => normalizeBoothCode(boothId))
            .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

async function deleteExpiredLocks(env, projectId, boothIds, nowText) {
    for (const boothIdChunk of chunkItems(boothIds)) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        await env.DB.prepare(`
            DELETE FROM BoothLocks
            WHERE project_id = ?
              AND booth_id IN (${placeholders})
              AND expires_at <= ?
        `).bind(Number(projectId), ...boothIdChunk, nowText).run();
    }
}

export async function releaseBoothLocks(env, projectId, boothIds, lockToken) {
    const normalizedBoothIds = normalizeBoothLockTargets(boothIds);
    if (!projectId || normalizedBoothIds.length === 0 || !lockToken) return;
    for (const boothIdChunk of chunkItems(normalizedBoothIds)) {
        const placeholders = boothIdChunk.map(() => '?').join(',');
        await env.DB.prepare(`
            DELETE FROM BoothLocks
            WHERE project_id = ?
              AND booth_id IN (${placeholders})
              AND lock_token = ?
        `).bind(Number(projectId), ...boothIdChunk, String(lockToken)).run();
    }
}

export async function acquireBoothLocks(env, projectId, boothIds, { ttlSeconds = BOOTH_LOCK_TTL_SECONDS } = {}) {
    const normalizedBoothIds = normalizeBoothLockTargets(boothIds);
    if (!projectId || normalizedBoothIds.length === 0) {
        return {
            success: true,
            lockToken: '',
            boothIds: []
        };
    }

    const nowText = formatChinaDateTime();
    const expiresAt = formatChinaDateTime(new Date(Date.now() + (Number(ttlSeconds || BOOTH_LOCK_TTL_SECONDS) * 1000)));
    const lockToken = crypto.randomUUID();
    const acquiredBoothIds = [];

    await deleteExpiredLocks(env, projectId, normalizedBoothIds, nowText);

    try {
        for (const boothId of normalizedBoothIds) {
            const result = await env.DB.prepare(`
                INSERT INTO BoothLocks (project_id, booth_id, lock_token, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(project_id, booth_id) DO NOTHING
            `).bind(Number(projectId), boothId, lockToken, expiresAt, nowText).run();
            if (hasMetaChanges(result) === 0) {
                await releaseBoothLocks(env, projectId, acquiredBoothIds, lockToken);
                return {
                    success: false,
                    lockToken: '',
                    boothIds: normalizedBoothIds,
                    conflictedBoothId: boothId
                };
            }
            acquiredBoothIds.push(boothId);
        }

        return {
            success: true,
            lockToken,
            boothIds: normalizedBoothIds
        };
    } catch (error) {
        await releaseBoothLocks(env, projectId, acquiredBoothIds, lockToken);
        throw error;
    }
}
