const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
].join('; ');

export function errorResponse(msg, status = 400, extraHeaders = {}) {
    return new Response(JSON.stringify({ success: false, error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders }
    });
}

export function buildSecurityHeaders({ includeCsp = false } = {}) {
    const headers = {
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin'
    };
    if (includeCsp) {
        headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY;
    }
    return headers;
}

export function withResponseHeaders(response, extraHeaders = {}) {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(extraHeaders || {})) {
        headers.set(key, value);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

export function buildCorsHeaders(request, url, env) {
    const requestOrigin = request.headers.get('Origin');
    const configuredOrigins = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const allowedOrigins = Array.from(new Set([url.origin, ...configuredOrigins]));
    const allowOrigin = requestOrigin
        ? (allowedOrigins.includes(requestOrigin) ? requestOrigin : '')
        : (allowedOrigins[0] || url.origin);

    const headers = {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Vary': 'Origin',
        ...buildSecurityHeaders()
    };
    if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
    return headers;
}

export function internalErrorResponse(corsHeaders) {
    return errorResponse('系统内部错误，请稍后重试', 500, corsHeaders);
}
