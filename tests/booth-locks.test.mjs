import assert from 'node:assert/strict';
import {
  acquireBoothLocks,
  normalizeBoothLockTargets,
  releaseBoothLocks
} from '../src/services/booth-locks.mjs';

function createFakeEnv(initialLocks = []) {
  const state = {
    locks: initialLocks.map((lock) => ({ ...lock }))
  };

  return {
    DB: {
      state,
      prepare(query) {
        const sql = String(query || '');
        return {
          params: [],
          bind(...params) {
            this.params = params;
            return this;
          },
          async run() {
            if (sql.includes('DELETE FROM BoothLocks')) {
              const [projectId, ...rest] = this.params;
              const trailingValue = rest.pop();
              const boothIds = rest.map((item) => String(item));
              const beforeCount = state.locks.length;
              if (sql.includes('expires_at <=')) {
                state.locks = state.locks.filter((lock) => {
                  return !(
                    Number(lock.project_id) === Number(projectId)
                    && boothIds.includes(String(lock.booth_id))
                    && String(lock.expires_at) <= String(trailingValue)
                  );
                });
              } else {
                state.locks = state.locks.filter((lock) => {
                  return !(
                    Number(lock.project_id) === Number(projectId)
                    && boothIds.includes(String(lock.booth_id))
                    && String(lock.lock_token) === String(trailingValue)
                  );
                });
              }
              return {
                meta: {
                  changes: beforeCount - state.locks.length
                }
              };
            }

            if (sql.includes('INSERT INTO BoothLocks')) {
              const [projectId, boothId, lockToken, expiresAt, createdAt] = this.params;
              const exists = state.locks.some((lock) => {
                return Number(lock.project_id) === Number(projectId)
                  && String(lock.booth_id) === String(boothId);
              });
              if (exists) {
                return { meta: { changes: 0 } };
              }
              state.locks.push({
                project_id: Number(projectId),
                booth_id: String(boothId),
                lock_token: String(lockToken),
                expires_at: String(expiresAt),
                created_at: String(createdAt)
              });
              return { meta: { changes: 1 } };
            }

            throw new Error(`Unexpected SQL in test double: ${sql}`);
          }
        };
      }
    }
  };
}

async function runTests() {
  assert.deepEqual(
    normalizeBoothLockTargets([' 2a01 ', '1B02', '2A01', '', null, '1b02']),
    ['1B02', '2A01']
  );

  const emptyAcquire = await acquireBoothLocks(createFakeEnv(), 0, []);
  assert.deepEqual(emptyAcquire, {
    success: true,
    lockToken: '',
    boothIds: []
  });

  const env = createFakeEnv();
  const firstLock = await acquireBoothLocks(env, 1, ['2a01']);
  assert.equal(firstLock.success, true);
  assert.deepEqual(firstLock.boothIds, ['2A01']);
  assert.equal(env.DB.state.locks.length, 1);

  const conflictingLock = await acquireBoothLocks(env, 1, ['1A01', '2A01']);
  assert.equal(conflictingLock.success, false);
  assert.equal(conflictingLock.conflictedBoothId, '2A01');
  assert.deepEqual(
    env.DB.state.locks.map((item) => item.booth_id).sort(),
    ['2A01']
  );

  await releaseBoothLocks(env, 1, firstLock.boothIds, firstLock.lockToken);
  assert.equal(env.DB.state.locks.length, 0);

  const envWithExpiredLock = createFakeEnv([
    {
      project_id: 2,
      booth_id: '3C09',
      lock_token: 'old-token',
      expires_at: '2000-01-01 00:00:00',
      created_at: '1999-12-31 23:59:59'
    }
  ]);
  const refreshedLock = await acquireBoothLocks(envWithExpiredLock, 2, ['3c09']);
  assert.equal(refreshedLock.success, true);
  assert.equal(envWithExpiredLock.DB.state.locks.length, 1);
  assert.notEqual(envWithExpiredLock.DB.state.locks[0].lock_token, 'old-token');

  const crossProjectEnv = createFakeEnv();
  const projectOneLock = await acquireBoothLocks(crossProjectEnv, 8, ['5D01']);
  const projectTwoLock = await acquireBoothLocks(crossProjectEnv, 9, ['5D01']);
  assert.equal(projectOneLock.success, true);
  assert.equal(projectTwoLock.success, true);
  assert.equal(crossProjectEnv.DB.state.locks.length, 2);
}

await runTests();
console.log('Booth lock tests passed');
