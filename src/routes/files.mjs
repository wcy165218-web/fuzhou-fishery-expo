import {
    normalizeUploadExtension,
    validateUploadFile
} from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';
import { CONTRACT_UPLOAD_BODY_LIMIT, readFormDataBody, readJsonBody } from '../utils/request.mjs';

function decodeBase64ToUint8Array(base64Value) {
    const normalized = String(base64Value || '').trim();
    if (!normalized) return new Uint8Array(0);
    const binaryString = atob(normalized);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
        bytes[index] = binaryString.charCodeAt(index);
    }
    return bytes;
}

function normalizeUploadId(value) {
    const normalized = String(value || '').trim();
    return /^[A-Za-z0-9_-]{12,96}$/.test(normalized) ? normalized : '';
}

export async function handleFileRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/upload' && request.method === 'POST') {
        const startedAt = Date.now();
        const uploadTraceId = crypto.randomUUID().slice(0, 8);
        const uploadDebugEnabled = String(env.UPLOAD_DEBUG || '').trim() === '1';
        const debugUpload = (stage, data = {}) => {
            if (uploadDebugEnabled) console.log(`[upload] ${stage}`, { traceId: uploadTraceId, ...data });
        };
        const contentType = String(request.headers.get('content-type') || '').toLowerCase();
        const contentLength = String(request.headers.get('content-length') || '').trim();
        let uploadBody = null;
        let file = null;
        let uploadId = '';

        debugUpload('start', {
            contentType: contentType || 'none',
            contentLength: contentLength || 'unknown'
        });

        if (contentType.includes('application/json')) {
            debugUpload('parsing-json-body');
            const payload = await readJsonBody(request, corsHeaders, { maxBytes: CONTRACT_UPLOAD_BODY_LIMIT });
            if (payload instanceof Response) return payload;
            const fileName = String(payload.fileName || payload.filename || 'contract.pdf').trim() || 'contract.pdf';
            const mimeType = String(payload.mimeType || payload.contentType || 'application/pdf').trim() || 'application/pdf';
            uploadId = normalizeUploadId(payload.uploadId);
            try {
                uploadBody = decodeBase64ToUint8Array(String(payload.contentBase64 || ''));
            } catch (error) {
                console.warn('[upload] invalid-base64', { traceId: uploadTraceId, error: String(error?.message || error) });
                return errorResponse('请求体格式错误，请检查后重试', 400, corsHeaders);
            }
            file = {
                name: fileName,
                type: mimeType,
                size: Number(uploadBody?.byteLength || 0)
            };
        } else if (contentType.includes('multipart/form-data')) {
            debugUpload('parsing-form-data');
            const formData = await readFormDataBody(request, corsHeaders, { maxBytes: CONTRACT_UPLOAD_BODY_LIMIT });
            if (formData instanceof Response) return formData;
            file = formData.get('file');
            uploadId = normalizeUploadId(formData.get('uploadId'));
            if (!file) return errorResponse('没有找到文件', 400, corsHeaders);
            uploadBody = await file.arrayBuffer();
        } else {
            try {
                debugUpload('reading-array-buffer');
                uploadBody = await request.arrayBuffer();
            } catch (error) {
                console.warn('[upload] read-body-failed', { traceId: uploadTraceId, error: String(error?.message || error) });
                return errorResponse('请求体格式错误，请检查后重试', 400, corsHeaders);
            }
            const rawFileName = String(request.headers.get('X-File-Name') || 'contract.pdf').trim();
            let decodedFileName = rawFileName;
            try {
                decodedFileName = decodeURIComponent(rawFileName);
            } catch (error) {}
            file = {
                name: decodedFileName || 'contract.pdf',
                type: contentType.split(';')[0].trim() || 'application/pdf',
                size: Number(uploadBody?.byteLength || 0)
            };
            uploadId = normalizeUploadId(request.headers.get('X-Upload-Id'));
        }

        debugUpload('body-ready', {
            fileType: String(file?.type || ''),
            fileSize: Number(uploadBody?.byteLength || 0)
        });

        if (!uploadBody || Number(uploadBody.byteLength || 0) <= 0) {
            console.warn('[upload] empty-body', { traceId: uploadTraceId });
            return errorResponse('没有找到文件', 400, corsHeaders);
        }
        if (Number(uploadBody.byteLength || 0) > CONTRACT_UPLOAD_BODY_LIMIT) {
            console.warn('[upload] body-too-large', {
                traceId: uploadTraceId,
                fileSize: Number(uploadBody.byteLength || 0),
                limit: CONTRACT_UPLOAD_BODY_LIMIT
            });
            return errorResponse('请求体过大，请压缩后重试', 413, corsHeaders);
        }

        const uploadError = validateUploadFile(file);
        if (uploadError) {
            console.warn('[upload] validation-failed', { traceId: uploadTraceId, uploadError });
            return errorResponse(uploadError, 400, corsHeaders);
        }
        const fileExt = normalizeUploadExtension(file.name);
        const fileKey = uploadId
            ? `contract_${uploadId}.${fileExt}`
            : `contract_${Date.now()}_${crypto.randomUUID()}.${fileExt}`;
        try {
            debugUpload('writing-r2', { hasUploadId: !!uploadId });
            await env.BUCKET.put(fileKey, uploadBody, {
                httpMetadata: {
                    contentType: String(file.type || 'application/pdf').trim() || 'application/pdf'
                }
            });
            debugUpload('success', {
                hasUploadId: !!uploadId,
                durationMs: Date.now() - startedAt
            });
        } catch (error) {
            console.error('File upload failed:', {
                traceId: uploadTraceId,
                durationMs: Date.now() - startedAt,
                error: String(error?.message || error)
            });
            return errorResponse('合同上传失败，请稍后重试', 500, corsHeaders);
        }
        return new Response(JSON.stringify({ success: true, fileKey }), { headers: corsHeaders });
    }

    if (url.pathname.startsWith('/api/file/')) {
        const key = url.pathname.replace('/api/file/', '');
        const orderId = url.searchParams.get('orderId');
        if (!orderId) return errorResponse('缺少订单信息', 400, corsHeaders);
        const order = await env.DB.prepare('SELECT sales_name, contract_url FROM Orders WHERE id = ?').bind(orderId).first();
        if (!order || order.contract_url !== key) return errorResponse('文件不存在', 404, corsHeaders);
        if (currentUser.role !== 'admin' && order.sales_name !== currentUser.name) {
            return errorResponse('无合同预览权限', 403, corsHeaders);
        }
        try {
            const object = await env.BUCKET.get(key);
            if (!object) return errorResponse('文件不存在', 404, corsHeaders);
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set('etag', object.httpEtag);
            headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']);
            headers.set('Vary', 'Origin');
            return new Response(object.body, { headers });
        } catch (error) {
            console.error('File download failed:', error);
            return errorResponse('合同读取失败，请稍后重试', 500, corsHeaders);
        }
    }

    return null;
}
