import {
    buildJwtPayloadForUser,
    hashPassword,
    isDefaultPasswordHash,
    isModernPasswordHash,
    signJWT,
    verifyPassword
} from '../utils/crypto.mjs';
import {
    getLoginAttemptContext,
    formatChinaDateTime,
    parseChinaDateTime,
    validateNewPassword
} from '../utils/helpers.mjs';
import { errorResponse } from '../utils/response.mjs';

const DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$150000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;

async function getLoginAttempt(env, attemptKey) {
    return env.DB.prepare('SELECT * FROM LoginAttempts WHERE attempt_key = ?').bind(attemptKey).first();
}

async function clearLoginAttempt(env, attemptKey) {
    await env.DB.prepare('DELETE FROM LoginAttempts WHERE attempt_key = ?').bind(attemptKey).run();
}

async function recordLoginFailure(env, context) {
    const existing = await getLoginAttempt(env, context.key);
    const nextCount = Number(existing?.failed_count || 0) + 1;
    const lockedUntil = nextCount >= LOGIN_MAX_FAILURES
        ? formatChinaDateTime(new Date(Date.now() + (LOGIN_LOCK_MINUTES * 60 * 1000)))
        : null;
    const nowText = formatChinaDateTime();

    await env.DB.prepare(`
        INSERT INTO LoginAttempts (attempt_key, username, ip_address, failed_count, last_failed_at, locked_until)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_key) DO UPDATE SET
            failed_count = excluded.failed_count,
            last_failed_at = excluded.last_failed_at,
            locked_until = excluded.locked_until
    `).bind(context.key, context.username, context.ipAddress, nextCount, nowText, lockedUntil).run();

    return {
        failedCount: nextCount,
        lockedUntil
    };
}

export async function handleAuthRoutes({
    request,
    env,
    url,
    currentUser,
    corsHeaders,
    jwtSecret
}) {
    if (request.method === 'POST') {
        if (url.pathname === '/api/login') {
            const { username, password } = await request.json();
            const loginContext = getLoginAttemptContext(request, username);
            const loginAttempt = await getLoginAttempt(env, loginContext.key);
            const lockedUntilMs = parseChinaDateTime(loginAttempt?.locked_until);
            if (lockedUntilMs && lockedUntilMs > Date.now()) {
                return errorResponse(`登录失败次数过多，请于 ${loginAttempt.locked_until} 后重试`, 429, corsHeaders);
            }
            const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ?').bind(username).first();
            let passwordMatches = false;
            if (user) {
                passwordMatches = await verifyPassword(password, user.password);
                if (!isModernPasswordHash(user.password)) {
                    await verifyPassword(password, DUMMY_PASSWORD_HASH);
                }
            } else {
                await verifyPassword(password, DUMMY_PASSWORD_HASH);
            }
            if (!user || !passwordMatches) {
                const failure = await recordLoginFailure(env, loginContext);
                if (failure.lockedUntil) {
                    return errorResponse(`连续输错 ${LOGIN_MAX_FAILURES} 次，账号已临时锁定至 ${failure.lockedUntil}`, 429, corsHeaders);
                }
                return errorResponse(`账号或密码错误，已连续失败 ${failure.failedCount} 次`, 401, corsHeaders);
            }
            await clearLoginAttempt(env, loginContext.key);
            const token = await signJWT(buildJwtPayloadForUser(user), jwtSecret);
            const mustChangePassword = await isDefaultPasswordHash(user.password);
            return new Response(JSON.stringify({
                user: {
                    name: user.name,
                    role: user.role,
                    token,
                    must_change_password: mustChangePassword
                }
            }), { headers: corsHeaders });
        }

        if (url.pathname === '/api/change-password') {
            const { staffName, oldPass, newPass } = await request.json();
            if (staffName && staffName !== currentUser.name) {
                return errorResponse('只能修改当前登录账号的密码', 403, corsHeaders);
            }
            const passwordError = validateNewPassword(newPass);
            if (passwordError) return errorResponse(passwordError, 400, corsHeaders);
            const user = await env.DB.prepare('SELECT * FROM Staff WHERE name = ?').bind(currentUser.name).first();
            if (!user) return errorResponse('账号不存在', 404, corsHeaders);
            const oldPasswordMatches = await verifyPassword(oldPass, user.password);
            if (!oldPasswordMatches) return errorResponse('原密码错误', 400, corsHeaders);
            if (oldPass === newPass) return errorResponse('新密码不能与原密码相同', 400, corsHeaders);
            const hashedNew = await hashPassword(newPass);
            await env.DB.prepare('UPDATE Staff SET password = ?, token_index = COALESCE(token_index, 0) + 1 WHERE name = ?').bind(hashedNew, currentUser.name).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
    }

    return null;
}
