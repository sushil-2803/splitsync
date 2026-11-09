import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import Dexie from 'dexie';
import { AccountSession, AUTH_STATE_KEY } from '../Frontend/src/session.js';
import { createAccountDatabase, clearDeviceAccountData } from '../Frontend/src/db.js';
import { A, B } from './fixtures.mjs';

const sessions = [];
beforeEach(clearDeviceAccountData);
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  await clearDeviceAccountData();
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Expected account state did not arrive');
}
function storageHub() {
  const values = new Map();
  const tabs = [];
  return {
    tab() {
      const target = new EventTarget();
      const emit = key => {
        for (const other of tabs) if (other !== target) queueMicrotask(() => {
          const event = new Event('storage');
          event.key = key;
          other.dispatchEvent(event);
        });
      };
      tabs.push(target);
      return {
        eventTarget: target,
        storage: {
          getItem: key => values.get(key) ?? null,
          setItem: (key, value) => { values.set(key, String(value)); emit(key); },
          removeItem: key => { values.delete(key); emit(key); },
        },
      };
    },
  };
}
const groupFor = user => ({
  id: user.id === A.id ? 'private-A' : 'private-B', name: user.id === A.id ? 'A confidential group' : 'B confidential group',
  role: 'ADMIN', joined: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  members: [{ id: `member-${user.id}`, groupId: user.id === A.id ? 'private-A' : 'private-B', userId: user.id, joined: true, role: 'ADMIN', user }],
  expenses: [], payments: [],
});
const jsonResponse = (data, user, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-SplitSync-User': user.id } : {}) },
});
class BrowserCookieServer {
  constructor(user = A) {
    this.user = user;
    this.online = true;
    this.calls = [];
    this.mutations = [];
    this.logout = 'success';
    this.syncError = false;
  }
  async fetch(path, options = {}) {
    this.calls.push({ path, options });
    if (path === '/api/auth/google') {
      this.user = JSON.parse(options.body).token === A.id ? A : B;
      return jsonResponse(this.user, this.user);
    }
    if (path === '/api/auth/logout') {
      if (this.logout === 'network') throw new Error('Connection failed');
      if (this.logout === '500') return jsonResponse({ error: 'Server unavailable' }, null, 500);
      this.user = null;
      return jsonResponse({ success: true });
    }
    if (!this.user) return jsonResponse({ error: 'Unauthorized' }, null, 401);
    const expected = options.headers?.['X-SplitSync-Account'];
    if (expected && expected !== this.user.id) return jsonResponse({ code: 'ACCOUNT_CHANGED', error: 'Account changed' }, this.user, 409);
    if (path === '/api/me') return jsonResponse(this.user, this.user);
    if (path === '/api/sync') return this.syncError
      ? jsonResponse({ error: 'Sync unavailable' }, this.user, 500)
      : jsonResponse({ user: this.user, groups: [groupFor(this.user)] }, this.user);
    this.mutations.push({ userId: this.user.id, path, data: options.body ? JSON.parse(options.body) : null });
    return jsonResponse(options.body ? JSON.parse(options.body) : { success: true }, this.user);
  }
}
function sessionFor(server, tab = storageHub().tab(), options = {}) {
  const session = new AccountSession({
    ...tab, channel: null, locks: null, online: () => server.online,
    fetcher: (path, request) => server.fetch(path, request), ...options,
  });
  sessions.push(session);
  return session;
}
function recordFor(user, verifiedAt = Date.now()) {
  return { revision: crypto.randomUUID(), locked: false, userId: user.id, verifiedAt };
}
async function seedAccount(user, pending = []) {
  const database = await createAccountDatabase(user.id);
  const { members, expenses, payments, ...group } = groupFor(user);
  await database.users.put(user);
  await database.groups.put(group);
  await database.members.bulkPut(members.map(({ user: ignored, ...member }) => member));
  for (const item of pending) await database.syncQueue.add({ ownerId: user.id, action: 'CREATE', table: 'groups', timestamp: Date.now(), ...item });
  database.close();
}
const queuedGroup = name => ({ data: { id: crypto.randomUUID(), name, joined: true, role: 'ADMIN', createdAt: new Date().toISOString() } });

test('AUTH-05: explicit account switching never submits the previous account queue', async () => {
  const server = new BrowserCookieServer();
  const session = sessionFor(server);
  await session.start();
  await session.sync();
  server.online = false;
  await session.saveMutation('CREATE', 'groups', queuedGroup('A saved secret').data, A.id);
  const original = await session.active.database.syncQueue.toArray();
  assert.equal(original.length, 1);
  assert.equal(original[0].ownerId, A.id);
  server.online = true;
  await session.signIn(B.id);
  await session.sync();
  assert.equal(session.getSnapshot().user.id, B.id);
  assert.equal(server.mutations.some(item => item.data?.name === 'A saved secret'), false);
  assert.equal((await session.active.database.groups.toArray()).some(group => group.name === 'A saved secret'), false);
  const accountA = await createAccountDatabase(A.id);
  assert.equal(await accountA.syncQueue.where('ownerId').equals(A.id).count(), 1);
  accountA.close();
  await session.signIn(A.id);
  await session.sync();
  assert.equal(server.mutations.find(item => item.data?.name === 'A saved secret').userId, A.id);
});

test('AUTH-05: startup never processes saved changes while /api/me is unresolved', async () => {
  const tab = storageHub().tab();
  tab.storage.setItem(AUTH_STATE_KEY, JSON.stringify(recordFor(A)));
  await seedAccount(A, [queuedGroup('A startup secret')]);
  const server = new BrowserCookieServer(B);
  const identity = deferred();
  let requested = false;
  const session = sessionFor(server, tab, { fetcher: async (path, options) => {
    if (path === '/api/me') { requested = true; return identity.promise; }
    return server.fetch(path, options);
  } });
  const started = session.start();
  await until(() => requested);
  await session.sync();
  assert.equal(session.getSnapshot().user, null);
  assert.equal(server.mutations.length, 0);
  identity.resolve(jsonResponse(B, B));
  await started;
  await session.sync();
  assert.equal(session.getSnapshot().user.id, B.id);
  assert.equal(server.mutations.length, 0);
});

test('AUTH-06: startup with B cookie and failed sync never displays A cached records', async () => {
  const tab = storageHub().tab();
  tab.storage.setItem(AUTH_STATE_KEY, JSON.stringify(recordFor(A)));
  await seedAccount(A);
  const server = new BrowserCookieServer(B);
  server.syncError = true;
  const session = sessionFor(server, tab);
  await session.start();
  await session.sync();
  assert.equal(session.getSnapshot().user.id, B.id);
  assert.equal(session.getSnapshot().database.accountId, B.id);
  assert.deepEqual(await session.active.database.groups.toArray(), []);
});

test('AUTH-06: a delayed A sync response cannot overwrite the B cache', async () => {
  const server = new BrowserCookieServer(A);
  const delayed = deferred();
  let held = false;
  const session = sessionFor(server, undefined, { fetcher: async (path, options) => {
    if (path === '/api/sync' && options.headers['X-SplitSync-Account'] === A.id && !held) {
      held = true;
      return delayed.promise;
    }
    return server.fetch(path, options);
  } });
  await session.start();
  await until(() => held);
  const oldTask = session.active.syncTask;
  await session.signIn(B.id);
  await session.sync();
  delayed.resolve(jsonResponse({ user: A, groups: [groupFor(A)] }, A));
  await oldTask;
  assert.equal(session.getSnapshot().user.id, B.id);
  assert.deepEqual((await session.active.database.groups.toArray()).map(group => group.id), ['private-B']);
});

test('AUTH-06: mismatched user IDs in sync bodies lock the UI without caching that account', async () => {
  const server = new BrowserCookieServer(A);
  const session = sessionFor(server, undefined, { fetcher: (path, options) => path === '/api/sync'
    ? jsonResponse({ user: B, groups: [groupFor(B)] }, A)
    : server.fetch(path, options) });
  await session.start();
  await until(() => session.getSnapshot().user === null);
  assert.equal(session.readRecord().locked, true);
  const accountA = await createAccountDatabase(A.id);
  assert.equal(await accountA.groups.get('private-B'), undefined);
  accountA.close();
});

test('AUTH-05: a 401 stops the batch and quarantines the remaining account queue', async () => {
  const tab = storageHub().tab();
  tab.storage.setItem(AUTH_STATE_KEY, JSON.stringify(recordFor(A)));
  await seedAccount(A, [queuedGroup('First A change'), queuedGroup('Second A change')]);
  const server = new BrowserCookieServer(A);
  let sent = 0;
  const session = sessionFor(server, tab, { fetcher: (path, options) => {
    if (path === '/api/groups') { sent++; return jsonResponse({ error: 'Unauthorized' }, null, 401); }
    return server.fetch(path, options);
  } });
  await session.start();
  await until(() => session.getSnapshot().user === null);
  assert.equal(sent, 1);
  assert.equal(session.readRecord().locked, true);
  const accountA = await createAccountDatabase(A.id);
  assert.equal(await accountA.syncQueue.count(), 2);
  accountA.close();
  server.online = false;
  const restarted = sessionFor(server, tab);
  await restarted.start();
  assert.equal(restarted.getSnapshot().user, null);
});

test('AUTH-05: identity is checked again between requests in a queued batch', async () => {
  const tab = storageHub().tab();
  tab.storage.setItem(AUTH_STATE_KEY, JSON.stringify(recordFor(A)));
  await seedAccount(A, [queuedGroup('A first'), queuedGroup('A second')]);
  const server = new BrowserCookieServer(A);
  const session = sessionFor(server, tab, { fetcher: async (path, options) => {
    const response = await server.fetch(path, options);
    if (path === '/api/groups' && server.mutations.length === 1) server.user = B;
    return response;
  } });
  await session.start();
  await until(() => session.getSnapshot().user === null);
  assert.equal(server.mutations.length, 1);
  assert.equal(server.mutations[0].userId, A.id);
  const accountA = await createAccountDatabase(A.id);
  assert.equal(await accountA.syncQueue.count(), 1);
  assert.equal(await accountA.groups.get('private-B'), undefined);
  accountA.close();
});

test('AUTH-06: two tabs adopt a verified account change without leaking or replaying A data', async () => {
  const hub = storageHub();
  const tab1 = hub.tab(), tab2 = hub.tab();
  const server = new BrowserCookieServer(A);
  const first = sessionFor(server, tab1), second = sessionFor(server, tab2);
  await first.start();
  await second.start();
  await first.sync();
  await second.sync();
  const initialMeCalls = server.calls.filter(call => call.path === '/api/me').length;
  assert.ok(initialMeCalls <= 3, 'same-account verification must not cause cross-tab reauthentication loops');
  server.online = false;
  await first.saveMutation('CREATE', 'groups', queuedGroup('A two-tab secret').data, A.id);
  server.online = true;
  await second.signIn(B.id);
  await until(() => first.getSnapshot().user?.id === B.id);
  await first.sync();
  await second.sync();
  for (const session of [first, second]) {
    assert.equal(session.getSnapshot().database.accountId, B.id);
    assert.deepEqual((await session.active.database.groups.toArray()).map(group => group.id), ['private-B']);
  }
  assert.equal(server.mutations.some(item => item.data?.name === 'A two-tab secret'), false);
});

for (const failure of ['network', '500']) test(`AUTH-04: ${failure} logout clears sensitive data and persists a lock across startup`, async () => {
  const tab = storageHub().tab();
  const server = new BrowserCookieServer(A);
  const session = sessionFor(server, tab);
  await session.start();
  await session.sync();
  server.online = false;
  await session.saveMutation('CREATE', 'groups', queuedGroup('Unsynced private change').data, A.id);
  server.online = true;
  server.logout = failure;
  await session.signOut();
  assert.equal(session.getSnapshot().user, null);
  assert.equal(session.getSnapshot().database, null);
  assert.equal(session.readRecord().locked, true);
  assert.equal(session.readRecord().logoutPending, true);
  assert.match(session.getSnapshot().notice, /not been confirmed/);
  assert.deepEqual((await Dexie.getDatabaseNames()).filter(name => name.startsWith('SplitExpensesDB')), []);
  const meCalls = server.calls.filter(call => call.path === '/api/me').length;
  session.dispose();
  const restarted = sessionFor(server, tab);
  await restarted.start();
  assert.equal(restarted.getSnapshot().user, null);
  assert.equal(server.calls.filter(call => call.path === '/api/me').length, meCalls);
  await restarted.signIn(B.id);
  await restarted.sync();
  assert.equal(restarted.getSnapshot().user.id, B.id);
  assert.equal(server.mutations.length, 0);
});

test('successful logout also removes queued changes and stops restoration', async () => {
  const server = new BrowserCookieServer(A);
  const session = sessionFor(server);
  await session.start();
  await session.sync();
  await session.signOut();
  assert.equal(session.getSnapshot().user, null);
  assert.equal(session.readRecord().locked, true);
  assert.equal(session.readRecord().logoutPending, false);
  assert.equal(server.user, null);
  assert.deepEqual((await Dexie.getDatabaseNames()).filter(name => name.startsWith('SplitExpensesDB')), []);
});

test('confirmed logout updates the result shown in other already-locked tabs', async () => {
  const hub = storageHub();
  const server = new BrowserCookieServer(A);
  const first = sessionFor(server, hub.tab()), second = sessionFor(server, hub.tab());
  await first.start();
  await second.start();
  await first.sync();
  await second.sync();
  server.logout = '500';
  await first.signOut();
  await until(() => second.getSnapshot().notice.includes('not been confirmed'));
  server.logout = 'success';
  await first.checkAuth();
  await until(() => second.getSnapshot().notice.includes('Saved data and pending changes were removed'));
  assert.equal(second.getSnapshot().user, null);
});

test('offline restoration lasts five days and never authorizes queue processing', async () => {
  const tab = storageHub().tab();
  const verifiedAt = Date.now();
  const day = 24 * 60 * 60 * 1000;
  tab.storage.setItem(AUTH_STATE_KEY, JSON.stringify(recordFor(A, verifiedAt)));
  await seedAccount(A, [queuedGroup('Offline account A')]);
  const server = new BrowserCookieServer(B);
  server.online = false;
  let now = verifiedAt + 4 * day;
  const session = sessionFor(server, tab, { now: () => now });
  await session.start();
  assert.equal(session.getSnapshot().user.id, A.id);
  assert.equal(session.getSnapshot().verified, false);
  await session.sync();
  assert.equal(server.calls.length, 0);
  now = verifiedAt + 5 * day - 1;
  await session.saveMutation('CREATE', 'groups', queuedGroup('Day five offline change').data, A.id);
  assert.equal(await session.active.database.syncQueue.count(), 2);
  assert.equal(server.calls.length, 0);
  now = verifiedAt + 5 * day;
  await assert.rejects(session.saveMutation('CREATE', 'groups', queuedGroup('Expired change').data, A.id));
  assert.equal(session.getSnapshot().user, null);
  assert.equal(session.readRecord().locked, true);
  const restarted = sessionFor(server, tab, { now: () => now });
  await restarted.start();
  assert.equal(restarted.getSnapshot().user, null);
});

test('refresh preserves account-owned local changes while they cannot sync', async () => {
  const server = new BrowserCookieServer(A);
  const session = sessionFor(server, undefined, { fetcher: (path, options) => path === '/api/groups'
    ? jsonResponse({ error: 'Temporary failure' }, A, 500)
    : server.fetch(path, options) });
  await session.start();
  await session.sync();
  server.online = false;
  const local = queuedGroup('Saved offline group').data;
  await session.saveMutation('CREATE', 'groups', local, A.id);
  server.online = true;
  await session.sync();
  assert.equal((await session.active.database.groups.get(local.id)).name, local.name);
  assert.equal(await session.active.database.syncQueue.where('ownerId').equals(A.id).count(), 1);
});

test('unowned legacy changes are retired with a visible explanation, never imported or submitted', async () => {
  const legacy = new Dexie('SplitExpensesDB');
  legacy.version(1).stores({ users: 'id', groups: 'id', syncQueue: '++id' });
  await legacy.users.put(A);
  await legacy.groups.put({ id: 'legacy-A', name: 'A legacy secret' });
  await legacy.syncQueue.add({ action: 'CREATE', table: 'groups', data: { name: 'A legacy secret' } });
  legacy.close();
  const server = new BrowserCookieServer(B);
  const session = sessionFor(server);
  await session.start();
  await session.sync();
  assert.equal(server.mutations.length, 0);
  assert.equal(await Dexie.exists('SplitExpensesDB'), false);
  assert.match(session.getSnapshot().migrationNotice, /Older offline changes/);
  assert.equal(session.getSnapshot().database.accountId, B.id);
});

test('stale UI actions and foreign-owner queue records cannot execute under the active account', async () => {
  const server = new BrowserCookieServer(A);
  const session = sessionFor(server);
  await session.start();
  await session.sync();
  await session.active.database.syncQueue.add({ ownerId: B.id, action: 'CREATE', table: 'groups', ...queuedGroup('Wrong owner') });
  await session.sync();
  assert.equal(server.mutations.length, 0);
  await session.signIn(B.id);
  await session.sync();
  await assert.rejects(session.saveMutation('CREATE', 'groups', queuedGroup('Stale UI secret').data, A.id), /account changed/);
  assert.equal(server.mutations.length, 0);
});

test('a verified identity cannot unlock a cache whose storage preparation fails', async () => {
  const server = new BrowserCookieServer(A);
  const session = sessionFor(server, undefined, { databaseFactory: async () => { throw new Error('Storage unavailable'); } });
  await session.start();
  assert.equal(session.getSnapshot().user, null);
  assert.equal(session.getSnapshot().loading, false);
  assert.equal(session.readRecord().locked, true);
  await assert.rejects(session.signIn(A.id), /Storage unavailable/);
  assert.equal(session.readRecord().locked, true);
});
