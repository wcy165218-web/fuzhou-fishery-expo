import { ORDER_FIELD_SETTINGS, getChinaTimestamp } from '../utils/helpers.mjs';

export async function getOrderFieldSettings(env, projectId) {
    const rows = (await env.DB.prepare(`
        SELECT field_key, enabled, required
        FROM ProjectOrderFieldSettings
        WHERE project_id = ?
    `).bind(Number(projectId)).all()).results || [];
    const rowMap = Object.fromEntries(rows.map((row) => [String(row.field_key), row]));
    return ORDER_FIELD_SETTINGS.map((item) => {
        const stored = rowMap[item.key];
        return {
            key: item.key,
            enabled: item.immutable ? 1 : Number(stored?.enabled ?? item.enabled ?? 1),
            required: item.immutable ? 1 : Number(stored?.required ?? item.required ?? 0)
        };
    });
}

export async function saveOrderFieldSettings(env, projectId, settings) {
    const normalizedSettings = ORDER_FIELD_SETTINGS.map((item) => {
        const incoming = Array.isArray(settings)
            ? settings.find((setting) => String(setting.key) === item.key)
            : null;
        return {
            key: item.key,
            enabled: item.immutable ? 1 : Number(incoming?.enabled ?? item.enabled ?? 1) ? 1 : 0,
            required: item.immutable ? 1 : Number(incoming?.required ?? item.required ?? 0) ? 1 : 0
        };
    });
    const nowText = getChinaTimestamp();
    const statements = normalizedSettings.map((item) => env.DB.prepare(`
        INSERT INTO ProjectOrderFieldSettings (project_id, field_key, enabled, required, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, field_key) DO UPDATE SET
            enabled = excluded.enabled,
            required = excluded.required,
            updated_at = excluded.updated_at
    `).bind(Number(projectId), item.key, item.enabled, item.required, nowText));
    if (statements.length > 0) {
        await env.DB.batch(statements);
    }
    return normalizedSettings;
}
