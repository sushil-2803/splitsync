import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, beforeEach, after, afterEach } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createApp } from '../Backend/app.js';
import { A, B, D, fixtureDatabase, OfflineGoogleClient, googleToken, environment, clientId } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fixture, browser, vite, origin;
const contexts = [];
const pageErrors = [];
before(async () => {
  fixture = await fixtureDatabase();
  let app;
  vite = await createServer({
    configFile: path.join(root, 'Frontend/vite.config.js'), root: path.join(root, 'Frontend'), mode: 'test',
    logLevel: 'error',
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(''), 'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(clientId) },
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
    plugins: [{ name: 'isolated-security-api', configureServer(server) {
      server.middlewares.use((request, response, next) => request.url?.startsWith('/api/') ? app(request, response, next) : next());
    } }],
  });
  await vite.listen();
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  app = createApp({
    database: fixture.prisma, googleClient: new OfflineGoogleClient(),
    env: { ...environment(origin), NODE_ENV: 'test', COOKIE_SECURE: 'false' },
  });
  const channel = process.env.SECURITY_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
});
beforeEach(async () => { pageErrors.length = 0; await fixture.reset(); });
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  assert.deepEqual(pageErrors, [], 'browser runtime errors');
});
after(async () => { await browser?.close(); await vite?.close(); await fixture?.close(); });

async function profile() {
  const context = await browser.newContext();
  contexts.push(context);
  // Every identity is synthetic; neither Google nor deployment services are used.
  await context.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  return context;
}
async function signIn(page, user) {
  await page.waitForFunction(() => typeof window.handleCredentialResponse === 'function');
  await page.evaluate(token => window.handleCredentialResponse({ credential: token }), googleToken(user));
}
async function groupVisible(page, name) {
  await page.getByRole('heading', { name, exact: true }).waitFor({ state: 'visible' });
}
async function groupAbsent(page, name) {
  assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 0);
}
async function api(context, route, user, method = 'GET', data) {
  return context.request.fetch(`${origin}${route}`, { method, headers: { 'X-SplitSync-Account': user.id }, ...(data ? { data } : {}) });
}

test('independent browser profiles keep private groups and invitations isolated', async () => {
  const first = await profile(), second = await profile();
  const pageA = await first.newPage(), pageB = await second.newPage();
  await pageA.goto(origin); await signIn(pageA, A);
  await pageB.goto(origin); await signIn(pageB, B);
  await groupVisible(pageA, 'A confidential group');
  await groupVisible(pageB, 'B confidential group');
  await groupAbsent(pageA, 'B confidential group');
  await groupAbsent(pageB, 'A confidential group');
  assert.equal((await api(second, '/api/groups/private-A/invite', B, 'POST', { email: B.email })).status(), 403);
  assert.equal((await api(second, '/api/groups/private-A', B)).status(), 403);
});

test('pending invitees see acceptance metadata and receive expenses only after joining', async () => {
  const context = await profile(), page = await context.newPage();
  await page.goto(origin); await signIn(page, D);
  await page.getByText('Invite to A confidential group', { exact: true }).waitFor();
  await groupAbsent(page, 'A confidential group');
  assert.equal((await api(context, '/api/groups/private-A', D)).status(), 403);
  assert.equal((await api(context, '/api/expenses/expense-A', D)).status(), 403);
  const pending = await (await api(context, '/api/sync', D)).json();
  assert.equal(pending.groups[0].expenses, undefined);
  assert.equal(pending.groups[0].members, undefined);
  await page.getByRole('button', { name: 'Accept Join', exact: true }).click();
  await groupVisible(page, 'A confidential group');
  await page.getByRole('heading', { name: 'A confidential group', exact: true }).click();
  await page.getByText('A private expense', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'members', exact: true }).click();
  assert.equal(await page.getByText('Invite New Contributor', { exact: true }).count(), 0);
});

test('two tabs sharing cookies reject stale mutations and discard a delayed A response after B signs in', async () => {
  const context = await profile(), first = await context.newPage();
  await first.goto(origin); await signIn(first, A);
  await groupVisible(first, 'A confidential group');
  const second = await context.newPage();
  await second.goto(origin);
  await groupVisible(second, 'A confidential group');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let captured = false;
  await first.route('**/api/sync', async route => {
    if (captured) return route.continue();
    captured = true;
    const response = await route.fetch();
    await gate;
    try { await route.fulfill({ response }); } catch { /* The account generation aborts this old request. */ }
  });
  await first.reload();
  await first.waitForFunction(() => document.body.textContent.includes('Account A'));
  while (!captured) await new Promise(resolve => setTimeout(resolve, 10));
  // Drive the actual sign-in controller while another tab is already signed in.
  // This models a Google sign-in completing in a second tab with shared cookies.
  await second.evaluate(async token => {
    const { AccountSession } = await import('/src/session.js');
    const signingIn = new AccountSession();
    await signingIn.signIn(token);
    signingIn.dispose();
  }, googleToken(B));
  await groupVisible(second, 'B confidential group');
  await groupVisible(first, 'B confidential group');
  const stale = await api(context, '/api/groups', A, 'POST', { id: crypto.randomUUID(), name: 'A stale queued secret' });
  assert.equal(stale.status(), 409);
  release();
  await groupAbsent(first, 'A confidential group');
  await groupAbsent(second, 'A confidential group');
  assert.equal((await fixture.pool.query('SELECT count(*) FROM groups WHERE name = $1', ['A stale queued secret'])).rows[0].count, 0);
});

test('startup with a B cookie does not replay A queue before /api/me completes', async () => {
  const context = await profile(), page = await context.newPage();
  await page.goto(origin); await signIn(page, A);
  await groupVisible(page, 'A confidential group');
  await context.setOffline(true);
  await page.evaluate(async user => {
    const { createAccountDatabase } = await import('/src/db.js');
    const database = await createAccountDatabase(user.id);
    await database.syncQueue.add({ ownerId: user.id, action: 'CREATE', table: 'groups', timestamp: Date.now(), data: {
      id: crypto.randomUUID(), name: 'A startup queued secret', joined: true, role: 'ADMIN', createdAt: new Date().toISOString(),
    } });
    database.close();
  }, A);
  const loginB = await context.request.post(`${origin}/api/auth/google`, { data: { token: googleToken(B) } });
  assert.equal(loginB.status(), 200);
  let release, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/me', async route => {
    held = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await context.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  while (!held) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await fixture.pool.query('SELECT count(*) FROM groups WHERE name = $1', ['A startup queued secret'])).rows[0].count, 0);
  await groupAbsent(page, 'A confidential group');
  release();
  await groupVisible(page, 'B confidential group');
  await groupAbsent(page, 'A confidential group');
  assert.equal((await fixture.pool.query('SELECT count(*) FROM groups WHERE name = $1', ['A startup queued secret'])).rows[0].count, 0);
});

test('a 500 logout clears device data, remains locked on reload, and does not claim server revocation', async () => {
  const context = await profile(), page = await context.newPage();
  await page.goto(origin); await signIn(page, A);
  await groupVisible(page, 'A confidential group');
  const copied = (await context.cookies()).find(cookie => cookie.name === 'splitSyncSession').value;
  await context.route('**/api/auth/logout', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic server failure' }) }));
  await page.getByTitle('Sign out and remove saved data and pending changes from this device', { exact: true }).click();
  await page.getByText(/Server sign-out has not been confirmed/).waitFor();
  await groupAbsent(page, 'A confidential group');
  assert.equal(await page.evaluate(async () => (await indexedDB.databases()).filter(database => database.name.startsWith('SplitExpensesDB')).length), 0);
  await page.reload();
  await page.getByText(/Server sign-out has not been confirmed/).waitFor();
  await groupAbsent(page, 'A confidential group');
  const stillValid = await fetch(`${origin}/api/me`, { headers: { Cookie: `splitSyncSession=${copied}` } });
  assert.equal(stillValid.status, 200, 'failure must not be represented as successful revocation');
  await signIn(page, B);
  await groupVisible(page, 'B confidential group');
  assert.equal((await fetch(`${origin}/api/me`, { headers: { Cookie: `splitSyncSession=${copied}` } })).status, 401);
});

test('offline logout locks every tab and revokes the copied cookie after reconnecting', async () => {
  const context = await profile(), first = await context.newPage();
  await first.goto(origin); await signIn(first, A);
  await groupVisible(first, 'A confidential group');
  const second = await context.newPage();
  await second.goto(origin);
  await groupVisible(second, 'A confidential group');
  const copied = (await context.cookies()).find(cookie => cookie.name === 'splitSyncSession').value;
  await context.setOffline(true);
  await first.getByTitle('Sign out and remove saved data and pending changes from this device', { exact: true }).click();
  for (const page of [first, second]) {
    await page.getByText(/Server sign-out has not been confirmed/).waitFor();
    await groupAbsent(page, 'A confidential group');
  }
  await context.setOffline(false);
  await first.getByText(/Saved data and pending changes were removed/).waitFor();
  assert.equal((await fetch(`${origin}/api/me`, { headers: { Cookie: `splitSyncSession=${copied}` } })).status, 401);
  await first.reload();
  await first.waitForFunction(() => typeof window.handleCredentialResponse === 'function');
  await groupAbsent(first, 'A confidential group');
});
