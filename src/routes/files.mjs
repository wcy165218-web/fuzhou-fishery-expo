import {
    normalizeUploadExtension,
    validateUploadFile
} from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';

export async function handleFileRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders
}) {
    if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) return errorResponse('没有找到文件', 400, corsHeaders);
        const uploadError = validateUploadFile(file);
        if (uploadError) return errorResponse(uploadError, 400, corsHeaders);
        const fileExt = normalizeUploadExtension(file.name);
        const fileKey = `contract_${Date.now()}_${crypto.randomUUID()}.${fileExt}`;
        try {
            await env.BUCKET.put(fileKey, file.stream());
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
        const object = await env.BUCKET.get(key);
        if (!object) return errorResponse('文件不存在', 404, corsHeaders);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']);
        headers.set('Vary', 'Origin');
        return new Response(object.body, { headers });
    }

    return null;
}
