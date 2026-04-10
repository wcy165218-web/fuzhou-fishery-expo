import { errorResponse } from './response.mjs';

export const DEFAULT_JSON_BODY_LIMIT = 256 * 1024;
export const CONTRACT_UPLOAD_BODY_LIMIT = 9 * 1024 * 1024;
export const BOOTH_MAP_IMAGE_UPLOAD_BODY_LIMIT = 11 * 1024 * 1024;
export const REQUEST_BODY_TOO_LARGE_MESSAGE = '请求体过大，请压缩后重试';
export const REQUEST_BODY_INVALID_MESSAGE = '请求体格式错误，请检查后重试';

const TEXT_ENCODER = new TextEncoder();
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getContentType(request) {
    return String(request.headers.get('content-type') || '').toLowerCase();
}

function getNumericContentLength(request) {
    const rawValue = request.headers.get('content-length');
    if (rawValue === null) return null;
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

export function getMaxBodyBytesForPath(pathname) {
    if (pathname === '/api/upload') return CONTRACT_UPLOAD_BODY_LIMIT;
    if (pathname === '/api/upload-booth-map-background') return BOOTH_MAP_IMAGE_UPLOAD_BODY_LIMIT;
    return DEFAULT_JSON_BODY_LIMIT;
}

export function enforceRequestBodyHeaderLimit(request, url, corsHeaders) {
    if (!BODY_METHODS.has(String(request.method || '').toUpperCase())) return null;
    const contentType = getContentType(request);
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
        return null;
    }
    const contentLength = getNumericContentLength(request);
    if (contentLength === null) return null;
    const maxBytes = getMaxBodyBytesForPath(url.pathname);
    if (contentLength > maxBytes) {
        return errorResponse(REQUEST_BODY_TOO_LARGE_MESSAGE, 413, corsHeaders);
    }
    return null;
}

export async function readJsonBody(request, corsHeaders, { maxBytes = DEFAULT_JSON_BODY_LIMIT } = {}) {
    try {
        const rawText = await request.text();
        if (TEXT_ENCODER.encode(rawText).length > maxBytes) {
            return errorResponse(REQUEST_BODY_TOO_LARGE_MESSAGE, 413, corsHeaders);
        }
        if (!rawText.trim()) return {};
        return JSON.parse(rawText);
    } catch (error) {
        return errorResponse(REQUEST_BODY_INVALID_MESSAGE, 400, corsHeaders);
    }
}

export async function readFormDataBody(request, corsHeaders, { maxBytes } = {}) {
    try {
        const contentLength = getNumericContentLength(request);
        if (contentLength !== null && Number.isFinite(maxBytes) && contentLength > Number(maxBytes)) {
            return errorResponse(REQUEST_BODY_TOO_LARGE_MESSAGE, 413, corsHeaders);
        }
        return await request.formData();
    } catch (error) {
        return errorResponse(REQUEST_BODY_INVALID_MESSAGE, 400, corsHeaders);
    }
}
