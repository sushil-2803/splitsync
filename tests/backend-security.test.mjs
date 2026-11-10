import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before, beforeEach, after, mock } from 'node:test';
import { createApp } from '../Backend/app.js';
import { readAuthConfiguration, SESSION_IDLE_TIMEOUT_MS, SESSION_MAX_AGE_MS } from '../Backend/auth.js';
import { A, B, C, D, E, fixtureDatabase, environment, OfflineGoogleClient, googleToken, expenseData, paymentData, secret } from './fixtures.mjs';

let fixture, server, base;
const cookies = new Map();
before(async () => {
  mock.method(console, 'error', () => {});
  fixture = await fixtureDatabase();
  const app = createApp({ database: fixture.prisma, googleClient: new OfflineGoogleClient(), env: environment() });
  server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await fixture.reset();
  cookies.clear();
  for (const user of [A, B, C, D, E]) cookies.set(user.id, await login(user));
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await fixture?.close();
  mock.restoreAll();
});

async function request(path, user = A, method = 'GET', data, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: 'https://security.invalid',
      ...(user ? { Cookie: cookies.get(user.id), 'X-SplitSync-Account': user.id } : {}),
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const body = await response.json();
  return { response, body, status: response.status };
}
async function login(user, cookie) {
  const response = await fetch(`${base}/api/auth/google`, {
    method: 'POST', headers: { Origin: 'https://security.invalid', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ token: googleToken(user) }),
  });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().find(value => value.startsWith('splitSyncSession=')).split(';')[0];
}

test('AUTH-01: outsiders, accepted nonadmins, and pending admins cannot invite or self-invite', async () => {
  const beforeCount = (await fixture.pool.query('SELECT count(*) FROM group_members')).rows[0].count;
  for (const caller of [B, C, D, E]) {
    for (const email of [caller.email, 'unknown@security.invalid']) {
      assert.equal((await request('/api/groups/private-A/invite', caller, 'POST', { email })).status, 403);
    }
  }
  assert.equal((await fixture.pool.query('SELECT count(*) FROM group_members')).rows[0].count, beforeCount);
  assert.equal((await request('/api/groups/private-A', B)).status, 403);
  assert.equal((await request('/api/groups/private-A/join', B, 'POST')).status, 403);
});

test('AUTH-02: pending members get invitation metadata and no private reads or financial mutations', async () => {
  const list = await request('/api/groups', D);
  const sync = await request('/api/sync', D);
  assert.equal(list.status, 200);
  assert.equal(sync.status, 200);
  for (const group of [list.body[0], sync.body.groups[0]]) {
    assert.deepEqual(Object.keys(group).sort(), ['createdAt', 'id', 'joined', 'name', 'role']);
    assert.equal(group.joined, false);
    assert.equal(group.id, 'private-A');
  }
  for (const [path, method, body] of [
    ['/api/groups/private-A', 'GET'], ['/api/expenses/expense-A', 'GET'],
    ['/api/expenses', 'POST', expenseData()], ['/api/expenses/expense-A', 'PUT', expenseData()],
    ['/api/expenses/expense-A', 'DELETE'], ['/api/payments', 'POST', paymentData()],
  ]) assert.equal((await request(path, D, method, body)).status, 403, `${method} ${path}`);
  assert.equal((await fixture.pool.query('SELECT description FROM expenses WHERE id = $1', ['expense-A'])).rows[0].description, 'A private expense');
  assert.equal((await fixture.pool.query('SELECT count(*) FROM payments')).rows[0].count, 0);
});

test('admin invitations normalize email and only acceptance grants group access', async () => {
  assert.equal((await request('/api/groups/private-A/invite', A, 'POST', { email: ' B@SECURITY.INVALID ' })).status, 200);
  assert.equal((await request('/api/groups/private-A', B)).status, 403);
  assert.equal((await request('/api/groups/private-A/invite', B, 'POST', { email: C.email })).status, 403);
  assert.equal((await request('/api/groups/private-A/join', B, 'POST')).status, 200);
  assert.equal((await request('/api/groups/private-A', B)).status, 200);
  assert.equal((await request('/api/groups/private-A/invite', A, 'POST', { email: B.email })).status, 409);
});

test('financial participants must have accepted their invitations', async () => {
  assert.equal((await request('/api/expenses', A, 'POST', expenseData({ paidById: D.id }))).status, 400);
  assert.equal((await request('/api/expenses', A, 'POST', expenseData({ splits: [{ userId: D.id, amount: 100 }] }))).status, 400);
  assert.equal((await request('/api/payments', A, 'POST', paymentData({ toUserId: D.id }))).status, 400);
  assert.equal((await request('/api/expenses', A, 'POST', expenseData({ paidById: B.id }))).status, 400);
  assert.equal((await request('/api/payments', A, 'POST', paymentData({ toUserId: B.id }))).status, 400);
});

test('accepted members retain the collaborative expense and payment workflow', async () => {
  const expense = expenseData();
  assert.equal((await request('/api/expenses', C, 'POST', expense)).status, 200);
  assert.equal((await request(`/api/expenses/${expense.id}`, C, 'GET')).status, 200);
  assert.equal((await request(`/api/expenses/${expense.id}`, C, 'PUT', { ...expense, description: 'Updated', splits: [{ userId: A.id, amount: 100 }] })).status, 200);
  const stored = (await request(`/api/expenses/${expense.id}`, A)).body;
  assert.equal(stored.description, 'Updated');
  assert.equal(stored.splits.length, 1);
  assert.equal(stored.splits[0].userId, A.id);
  assert.equal((await request('/api/payments', C, 'POST', paymentData())).status, 200);
  assert.equal((await request(`/api/expenses/${expense.id}`, C, 'DELETE')).status, 200);
});

test('AUTH-03 / AUTH-07: logout revokes copied cookies and emits an expired deletion cookie', async () => {
  const cookie = cookies.get(A.id);
  assert.match(cookie, /^splitSyncSession=[A-Za-z0-9_-]{43}$/);
  const logout = await request('/api/auth/logout', A, 'POST');
  assert.equal(logout.status, 200);
  const deletion = logout.response.headers.getSetCookie().find(value => value.startsWith('splitSyncSession='));
  assert.match(deletion, /Expires=Thu, 01 Jan 1970/i);
  assert.doesNotMatch(deletion, /Max-Age=2592000/);
  assert.match(deletion, /HttpOnly/);
  assert.match(deletion, /Secure/);
  assert.match(deletion, /SameSite=Lax/);
  assert.equal((await request('/api/me', A)).status, 401);
  assert.equal((await request('/api/sync', A)).status, 401);
  assert.equal((await request('/api/me', B)).status, 200);
});

test('sessions are stored as hashes with absolute and idle expiry enforced', async () => {
  const token = cookies.get(A.id).split('=')[1];
  const tokenHash = crypto.createHmac('sha256', secret).update(token).digest('hex');
  const row = (await fixture.pool.query('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash])).rows[0];
  assert.equal(row.user_id, A.id);
  assert.equal(row.token_hash.includes(token), false);
  assert.ok(new Date(row.expires_at) - new Date(row.created_at) <= SESSION_MAX_AGE_MS + 1000);
  await fixture.pool.query('UPDATE sessions SET last_seen_at = now() - ($1::double precision * interval \'1 millisecond\') WHERE token_hash = $2', [SESSION_IDLE_TIMEOUT_MS + 1000, tokenHash]);
  assert.equal((await request('/api/me', A)).status, 401);
  cookies.set(A.id, await login(A));
  const freshHash = crypto.createHmac('sha256', secret).update(cookies.get(A.id).split('=')[1]).digest('hex');
  await fixture.pool.query('UPDATE sessions SET expires_at = now() - interval \'1 second\' WHERE token_hash = $1', [freshHash]);
  assert.equal((await request('/api/me', A)).status, 401);
});

test('switching accounts revokes the previous cookie and logout-all revokes every account session', async () => {
  const oldA = cookies.get(A.id);
  const newB = await login(B, oldA);
  assert.equal((await request('/api/me', A)).status, 401);
  cookies.set(B.id, newB);
  const extraA = await login(A);
  cookies.set(A.id, await login(A));
  assert.equal((await request('/api/auth/logout-all', A, 'POST')).status, 200);
  assert.equal((await request('/api/me', A)).status, 401);
  assert.equal((await request('/api/me', null, 'GET', undefined, { headers: { Cookie: extraA } })).status, 401);
  assert.equal((await request('/api/me', B)).status, 200);
});

test('AUTH-05 / AUTH-06: a stale tab cannot mutate using another account cookie', async () => {
  const groupId = crypto.randomUUID();
  const mismatched = { headers: { Cookie: cookies.get(B.id), 'X-SplitSync-Account': A.id } };
  const result = await request('/api/groups', A, 'POST', { id: groupId, name: 'A queued secret' }, mismatched);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ACCOUNT_CHANGED');
  assert.equal((await fixture.pool.query('SELECT count(*) FROM groups WHERE id = $1', [groupId])).rows[0].count, 0);
  assert.equal((await request('/api/sync', A, 'GET', undefined, mismatched)).status, 409);
  assert.equal((await request('/api/groups', A, 'POST', { name: 'Unbound' }, { headers: { 'X-SplitSync-Account': '' } })).status, 400);
});

test('offline group IDs remain stable and retries never add another account', async () => {
  const id = crypto.randomUUID();
  assert.equal((await request('/api/groups', A, 'POST', { id, name: 'Offline group' })).body.id, id);
  assert.equal((await request('/api/groups', A, 'POST', { id, name: 'Offline group' })).body.id, id);
  assert.equal((await request('/api/groups', B, 'POST', { id, name: 'Offline group' })).status, 409);
  assert.equal((await fixture.pool.query('SELECT count(*) FROM group_members WHERE group_id = $1', [id])).rows[0].count, 1);
  assert.equal((await request('/api/expenses', A, 'POST', expenseData({ groupId: id, splits: [{ userId: A.id, amount: 100 }] }))).status, 200);
});

test('private responses are never cached and foreign origins are denied before writes', async () => {
  for (const path of ['/api/me', '/api/groups', '/api/groups/private-A', '/api/expenses/expense-A', '/api/sync']) {
    assert.equal((await request(path, A)).response.headers.get('Cache-Control'), 'no-store');
  }
  const result = await request('/api/groups/private-A/invite', A, 'POST', { email: B.email }, { headers: { Origin: 'https://foreign.invalid' } });
  assert.equal(result.status, 403);
  assert.equal((await fixture.pool.query('SELECT count(*) FROM group_members WHERE user_id = $1 AND group_id = $2', [B.id, 'private-A'])).rows[0].count, 0);
});

test('missing, unsigned, tampered, unknown, and legacy signed sessions are rejected', async () => {
  const legacyPayload = Buffer.from(JSON.stringify({ userId: A.id, exp: Date.now() + 100000 })).toString('base64url');
  const legacySignature = crypto.createHmac('sha256', secret).update(legacyPayload).digest('base64url');
  for (const cookie of ['', `userId=${A.id}`, 'splitSyncSession=invalid', `splitSyncSession=${crypto.randomBytes(32).toString('base64url')}`, `splitSyncSession=${legacyPayload}.${legacySignature}`]) {
    assert.equal((await request('/api/me', null, 'GET', undefined, { headers: { Cookie: cookie } })).status, 401);
  }
});

test('Google verification still rejects wrong audience, issuer, expiry, verification, and signatures', async () => {
  const wrongKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const now = Math.floor(Date.now() / 1000);
  for (const token of [
    googleToken(A, { aud: 'foreign.apps.googleusercontent.com' }), googleToken(A, { iss: 'https://foreign.invalid' }),
    googleToken(A, { iat: now - 7200, exp: now - 3600 }), googleToken(A, { email_verified: false }), googleToken(A, {}, wrongKey),
  ]) assert.equal((await request('/api/auth/google', null, 'POST', { token })).status, 401);
});

test('production configuration rejects weak secrets, nonorigins, and insecure cookie settings', () => {
  const valid = environment();
  for (const SESSION_SECRET of ['', 'x', 'x'.repeat(64), 'dev-only-session-secret', 'change-me-to-a-long-random-value']) {
    assert.throws(() => readAuthConfiguration({ ...valid, SESSION_SECRET }), /SESSION_SECRET/);
  }
  for (const overrides of [
    { FRONTEND_ORIGIN: 'http://security.invalid' }, { COOKIE_SECURE: 'false' },
    { FRONTEND_ORIGIN: 'https://security.invalid/path' }, { FRONTEND_ORIGIN: 'https://security.invalid/' },
  ]) assert.throws(() => readAuthConfiguration({ ...valid, ...overrides }));
  assert.equal(readAuthConfiguration({ ...valid, SESSION_COOKIE_NAME: '__Host-SplitSync' }).cookieName, '__Host-SplitSync');
  assert.throws(() => readAuthConfiguration({ ...valid, NODE_ENV: 'development', COOKIE_SECURE: 'false', COOKIE_SAME_SITE: 'none' }));
});
