import assert from 'node:assert/strict';
import worker from '../_worker.js';
import { buildJwtPayloadForUser, signJWT } from '../src/utils/crypto.mjs';

function createMockEnv() {
    const rateLimitStore = new Map();
    return {
        JWT_SECRET: 'test-secret',
        ERP_CONFIG_SECRET: 'test-erp-secret',
        ASSETS: {
            async fetch() {
                return new Response('asset');
            }
        },
        rateLimitStore,
        DB: {
            prepare(sql) {
                const normalizedSql = String(sql || '');
                return {
                    params: [],
                    bind(...params) {
                        this.params = params;
                        return this;
                    },
                    async first() {
                        if (normalizedSql.includes('FROM Staff')) {
                            return {
                                name: String(this.params[0] || ''),
                                role: 'admin',
                                token_index: 0
                            };
                        }
                        if (normalizedSql.includes('FROM WriteRateLimits')) {
                            return rateLimitStore.get(this.params[0]) || null;
                        }
                        return null;
                    },
                    async run() {
                        if (normalizedSql.includes('INSERT INTO WriteRateLimits')) {
                            const [rateKey, now, threshold] = this.params;
                            const existing = rateLimitStore.get(rateKey);
                            if (!existing) {
                                rateLimitStore.set(rateKey, {
                                    rate_key: rateKey,
                                    request_count: 1,
                                    window_start: now
                                });
                            } else if (existing.window_start < threshold) {
                                existing.request_count = 1;
                                existing.window_start = now;
                            } else {
                                existing.request_count += 1;
                            }
                        }
                        return { meta: { changes: 1 } };
                    },
                    async all() {
                        return { results: [] };
                    }
                };
            }
        }
    };
}

async function createAuthHeaders(name = 'admin') {
    const token = await signJWT(buildJwtPayloadForUser({
        name,
        role: 'admin',
        token_index: 0
    }), 'test-secret');
    return {
        Authorization: `Bearer ${token}`
    };
}

async function callWorker(env, method, path, headers = {}) {
    return worker.fetch(new Request(`http://localhost${path}`, {
        method,
        headers
    }), env, { waitUntil() {} });
}

// Test 1: authenticated POST enters route handling and consumes quota.
{
    const env = createMockEnv();
    const response = await callWorker(env, 'POST', '/api/non-existent', await createAuthHeaders());
    assert.equal(response.status, 404);
    assert.equal(env.rateLimitStore.get('user:admin')?.request_count, 1);
}

// Test 2: authenticated POST is blocked on the 31st request within the same window.
{
    const env = createMockEnv();
    const headers = await createAuthHeaders();
    for (let index = 0; index < 30; index += 1) {
        const response = await callWorker(env, 'POST', '/api/non-existent', headers);
        assert.equal(response.status, 404, `request ${index + 1} should pass route dispatch`);
    }
    const blocked = await callWorker(env, 'POST', '/api/non-existent', headers);
    assert.equal(blocked.status, 429);
}

// Test 3: authenticated GET does not consume write quota.
{
    const env = createMockEnv();
    const response = await callWorker(env, 'GET', '/api/non-existent', await createAuthHeaders());
    assert.equal(response.status, 404);
    assert.equal(env.rateLimitStore.size, 0);
}

// Test 4: unauthenticated POST is rejected before touching write quota.
{
    const env = createMockEnv();
    const response = await callWorker(env, 'POST', '/api/non-existent');
    assert.equal(response.status, 401);
    assert.equal(env.rateLimitStore.size, 0);
}

console.log('Write rate limit tests passed');
