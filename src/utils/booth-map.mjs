export function normalizeHallLabel(rawValue) {
    const normalized = String(rawValue || '').trim();
    if (!normalized) return '';
    if (/号馆$/.test(normalized)) {
        return normalized;
    }
    if (/馆$/.test(normalized)) {
        return normalized.replace(/馆$/, '号馆');
    }
    return /^\d+$/.test(normalized) ? `${normalized}号馆` : normalized;
}

export function normalizeBoothCode(rawValue) {
    return String(rawValue || '').trim().toUpperCase();
}

export function deriveHallFromBoothCode(boothCode, fallbackValue = '') {
    const normalizedBoothCode = normalizeBoothCode(boothCode);
    const matched = normalizedBoothCode.match(/^(\d+)/);
    if (matched) return `${matched[1]}号馆`;
    return normalizeHallLabel(fallbackValue);
}

export function resolveHallFromMapName(rawValue) {
    const normalized = String(rawValue || '').trim();
    if (!normalized) return '';
    const matched = normalized.match(/\d+号馆/);
    return matched ? matched[0] : normalized;
}
