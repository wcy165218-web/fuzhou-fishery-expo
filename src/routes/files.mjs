import {
    normalizeUploadExtension,
    validateUploadFile
} from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';
import { CONTRACT_UPLOAD_BODY_LIMIT, readFormDataBody } from '../utils/request.mjs';

export async function handleFileRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/upload' && request.method === 'POST') {
        const contentType = String(request.headers.get('content-type') || '').toLowerCase();
        let uploadBody = null;
        let file = null;

        if (contentType.includes('multipart/form-data')) {
            const formData = await readFormDataBody(request, corsHeaders, { maxBytes: CONTRACT_UPLOAD_BODY_LIMIT });
            if (formData instanceof Response) return formData;
            file = formData.get('file');
            if (!file) return errorResponse('没有找到文件', 400, corsHeaders);
            uploadBody = await file.arrayBuffer();
        } else {
            try {
                uploadBody = await request.arrayBuffer();
            } catch (error) {
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
        }

        if (!uploadBody || Number(uploadBody.byteLength || 0) <= 0) {
            return errorResponse('没有找到文件', 400, corsHeaders);
        }
        if (Number(uploadBody.byteLength || 0) > CONTRACT_UPLOAD_BODY_LIMIT) {
            return errorResponse('请求体过大，请压缩后重试', 413, corsHeaders);
        }

        const uploadError = validateUploadFile(file);
        if (uploadError) return errorResponse(uploadError, 400, corsHeaders);
        const fileExt = normalizeUploadExtension(file.name);
        const fileKey = `contract_${Date.now()}_${crypto.randomUUID()}.${fileExt}`;
        try {
            await env.BUCKET.put(fileKey, uploadBody, {
                httpMetadata: {
                    contentType: String(file.type || 'application/pdf').trim() || 'application/pdf'
                }
            });
        } catch (error) {
            console.error('File upload failed:', error);
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
