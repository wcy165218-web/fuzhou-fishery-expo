import {
    getJwtSecret,
    verifyJWT,
} from './src/utils/crypto.mjs';
import {
    getStaffAuthState,
    isSuperAdmin
} from './src/utils/auth.mjs';
import {
    buildCorsHeaders,
    buildSecurityHeaders,
    errorResponse,
    internalErrorResponse,
    withResponseHeaders
} from './src/utils/response.mjs';
import { dispatchApiRoutes } from './src/router.mjs';
import {
    migrateAllLegacyErpSessionCookies,
} from './src/services/erp.mjs';

let legacyErpSecretMigrationScheduled = false;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
        const assetResponse = await env.ASSETS.fetch(request);
        return withResponseHeaders(assetResponse, buildSecurityHeaders({ includeCsp: true }));
    }

    const corsHeaders = buildCorsHeaders(request, url, env);

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    let currentUser = null;
    let jwtSecret = '';

    try {
      jwtSecret = getJwtSecret(env);
    } catch (err) {
      console.error('JWT secret missing:', err);
      return errorResponse('系统未完成安全配置，请联系管理员', 500, corsHeaders);
    }

	    if (url.pathname !== '/api/login') {
	      const authHeader = request.headers.get('Authorization');
	      if (!authHeader || !authHeader.startsWith('Bearer ')) {
	          return errorResponse('未登录或登录已过期', 401, corsHeaders);
	      }
	      const token = authHeader.split(' ')[1];
	      try {
	        currentUser = await verifyJWT(token, jwtSecret);
	        const currentStaffState = await getStaffAuthState(env, currentUser?.name);
	        if (!currentStaffState) {
	          return errorResponse('账号不存在或已被停用，请重新登录', 401, corsHeaders);
	        }
	        if (Number(currentUser?.token_index ?? 0) !== Number(currentStaffState?.token_index ?? 0)) {
	          return errorResponse('登录状态已失效，请重新登录', 401, corsHeaders);
	        }
	        currentUser = {
	          ...currentUser,
	          name: currentStaffState.name,
	          role: currentStaffState.role,
	          token_index: Number(currentStaffState.token_index || 0)
	        };
	        if (isSuperAdmin(currentUser) && !legacyErpSecretMigrationScheduled) {
	          legacyErpSecretMigrationScheduled = true;
	          ctx.waitUntil(
	            migrateAllLegacyErpSessionCookies(env).catch((migrationError) => {
	              console.warn('Background ERP secret migration failed:', migrationError);
	              legacyErpSecretMigrationScheduled = false;
	            })
	          );
	        }
	      } catch (err) {
	        return errorResponse('登录状态已失效，请重新登录', 401, corsHeaders);
	      }
	    }

	    try {
	      const routeResponse = await dispatchApiRoutes({
	        request,
	        env,
	        url,
	        currentUser,
	        corsHeaders,
	        jwtSecret
	      });
	      if (routeResponse) return routeResponse;

	      return errorResponse('接口不存在', 404, corsHeaders);

    } catch (err) {
      console.error('Unhandled API error:', err);
      return internalErrorResponse(corsHeaders);
    }
  }
};
