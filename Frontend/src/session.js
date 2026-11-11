import {
  createAccountDatabase, retireLegacyDatabase, clearDeviceAccountData,
  saveAccountMutation, applyAccountSnapshot,
} from './db.js';

export const AUTH_STATE_KEY = 'splitSync:authState:v2';
export const OFFLINE_ACCESS_MS = 5 * 24 * 60 * 60 * 1000;
const LEGACY_AUTH_KEY = 'splitSync:lastAuthedUserId';
const endpointByTable = { groups: '/api/groups', expenses: '/api/expenses', payments: '/api/payments' };

class StaleAccountError extends Error {
  constructor() { super('The active account changed'); this.name = 'StaleAccountError'; }
}

// Own every request and database handle with one account generation. Changing
// identity invalidates the generation synchronously, before any asynchronous work.
export class AccountSession {
  constructor({
    apiUrl = path => path, fetcher = (...args) => globalThis.fetch(...args),
    storage = globalThis.localStorage, online = () => globalThis.navigator.onLine,
    eventTarget = globalThis.window, locks = globalThis.navigator?.locks,
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('splitSync:auth'),
    now = () => Date.now(), databaseFactory = createAccountDatabase,
    clearDeviceData = clearDeviceAccountData, retireLegacy = retireLegacyDatabase,
  } = {}) {
    Object.assign(this, { apiUrl, fetcher, storage, online, eventTarget, locks, channel, now, databaseFactory, clearDeviceData, retireLegacy });
    this.listeners = new Set();
    this.generation = 0;
    this.active = null;
    this.authController = null;
    this.snapshot = { user: null, database: null, verified: false, loading: true, notice: '', migrationNotice: '', isOnline: online() };
    this.getSnapshot = () => this.snapshot;
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.authChanged = () => {
      const record = this.readRecord();
      if (record?.revision === this.seenRevision) return;
      this.seenRevision = record?.revision;
      this.invalidate({ loading: false });
      if (record?.locked) {
        this.emit({ notice: record.reason === 'signin' ? 'Signing in in another tab…' : this.lockedNotice(record) });
      } else {
        void this.checkAuth();
      }
    };
    this.storageChanged = event => { if (event.key === AUTH_STATE_KEY || event.key === null) this.authChanged(); };
    this.wentOnline = () => { this.emit({ isOnline: true }); void this.checkAuth(); };
    this.wentOffline = () => {
      if (this.active) this.active.verified = false;
      this.emit({ isOnline: false, verified: false });
    };
    this.focused = () => {
      if (this.online() && !this.readRecord()?.locked) void (this.active?.verified ? this.sync() : this.checkAuth());
    };
  }

  emit(update) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }

  readRecord() {
    try {
      const raw = this.storage.getItem(AUTH_STATE_KEY);
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (!record || typeof record.revision !== 'string' || typeof record.locked !== 'boolean') throw new Error('Invalid auth state');
      return record;
    } catch {
      return { locked: true, reason: 'invalid' };
    }
  }

  publish(record) {
    this.storage.setItem(AUTH_STATE_KEY, JSON.stringify(record));
    this.storage.removeItem(LEGACY_AUTH_KEY);
    this.seenRevision = record.revision;
    this.channel?.postMessage({ revision: record.revision });
    return record;
  }

  invalidate(update = {}) {
    this.generation += 1;
    this.authController?.abort();
    this.authController = null;
    this.active?.controller.abort();
    this.active?.database.close();
    this.active = null;
    clearTimeout(this.expiryTimer);
    this.emit({ user: null, database: null, verified: false, ...update });
    return this.generation;
  }

  lockedNotice(record) {
    if (record?.logoutPending) return 'Signed out on this device. Server sign-out has not been confirmed. Reconnect to finish signing out.';
    if (record?.reason === 'logout') return 'Signed out. Saved data and pending changes were removed from this device.';
    return 'Please sign in to continue. Pending changes stay with their original account.';
  }

  lock(reason, notice, extra = {}) {
    this.invalidate({ loading: false, notice });
    return this.publish({ revision: crypto.randomUUID(), locked: true, reason, ...extra });
  }

  isCurrent(context) {
    const record = this.readRecord();
    return this.active === context && context.generation === this.generation
      && !context.controller.signal.aborted && !record?.locked
      && record?.revision === context.revision && record.userId === context.user.id;
  }

  assertCurrent(context) {
    if (!this.isCurrent(context)) throw new StaleAccountError();
    const record = this.readRecord();
    if (!context.verified && !this.offlineAllowed(record)) {
      this.lock('expired', 'Offline access expired. Reconnect and sign in to continue.');
      throw new StaleAccountError();
    }
  }

  offlineAllowed(record) {
    const elapsed = this.now() - record?.verifiedAt;
    return record && !record.locked && typeof record.userId === 'string'
      && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < OFFLINE_ACCESS_MS;
  }

  withAuthLock(work) {
    return this.locks ? this.locks.request('splitSync:authentication', work) : work();
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 12000);
    try {
      const response = await this.fetcher(this.apiUrl(path), { ...options, signal: controller.signal, credentials: 'include', cache: 'no-store' });
      const body = await response.text();
      return {
        ok: response.ok, status: response.status, headers: response.headers,
        json: async () => {
          if (!(response.headers.get('Content-Type') || '').includes('application/json')) {
            throw new Error(`The API returned ${response.status} instead of JSON. Check the configured API URL.`);
          }
          return JSON.parse(body);
        },
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async start() {
    this.eventTarget?.addEventListener('storage', this.storageChanged);
    this.eventTarget?.addEventListener('online', this.wentOnline);
    this.eventTarget?.addEventListener('offline', this.wentOffline);
    this.eventTarget?.addEventListener('focus', this.focused);
    this.channel?.addEventListener('message', this.authChanged);
    this.retryTimer = setInterval(this.focused, 30000);
    this.retryTimer.unref?.();
    const generation = this.generation;
    try {
      const retired = await this.withAuthLock(() => this.retireLegacy());
      if (generation !== this.generation) return;
      if (retired !== null) this.emit({ migrationNotice: 'Security update: the old device cache was reset. Older offline changes could not be safely assigned to an account and were removed.' });
      await this.checkAuth();
    } catch {
      this.lock('storage', 'Device storage could not be prepared safely. Clear this site’s saved data before signing in.');
    }
  }

  dispose() {
    this.invalidate({ loading: false });
    clearInterval(this.retryTimer);
    this.eventTarget?.removeEventListener('storage', this.storageChanged);
    this.eventTarget?.removeEventListener('online', this.wentOnline);
    this.eventTarget?.removeEventListener('offline', this.wentOffline);
    this.eventTarget?.removeEventListener('focus', this.focused);
    this.channel?.removeEventListener('message', this.authChanged);
    this.channel?.close();
  }

  async activate(user, verified, record, generation) {
    if (typeof user?.id !== 'string' || !user.id) throw new Error('The authentication server did not return an account');
    const database = await this.databaseFactory(user.id);
    if (generation !== this.generation || this.readRecord()?.revision !== record.revision || this.readRecord()?.locked) {
      database.close();
      return null;
    }
    const context = { user, verified, database, revision: record.revision, generation, controller: new AbortController() };
    this.active = context;
    await database.users.put(user);
    if (!this.isCurrent(context)) return null;
    this.emit({ user, database, verified, loading: false, accountGeneration: generation });
    this.armExpiry(context);
    return context;
  }

  armExpiry(context) {
    clearTimeout(this.expiryTimer);
    const remaining = this.readRecord().verifiedAt + OFFLINE_ACCESS_MS - this.now();
    this.expiryTimer = setTimeout(() => {
      if (!this.isCurrent(context)) return;
      if (this.online()) void this.checkAuth();
      else this.lock('expired', 'Offline access expired. Reconnect and sign in to continue.');
    }, Math.max(remaining, 1));
    this.expiryTimer.unref?.();
  }

  async restoreOffline(record, generation) {
    if (!this.offlineAllowed(record)) {
      if (record?.userId) this.lock('expired', 'Offline access expired. Reconnect and sign in to continue.');
      else this.emit({ loading: false });
      return;
    }
    const database = await this.databaseFactory(record.userId);
    const user = await database.users.get(record.userId);
    database.close();
    if (generation !== this.generation || this.readRecord()?.revision !== record.revision) return;
    if (user?.id === record.userId) await this.activate(user, false, record, generation);
    else this.emit({ loading: false });
  }

  async checkAuth() {
    const record = this.readRecord();
    const generation = this.invalidate({ loading: true });
    this.seenRevision = record?.revision;
    if (record?.locked) {
      this.emit({ loading: false, notice: this.lockedNotice(record) });
      if (record.clearPending || record.logoutPending && this.online()) await this.finishLogout(record);
      return;
    }
    if (!this.online()) return this.restoreOffline(record, generation);
    const controller = new AbortController();
    this.authController = controller;
    let expectedRevision = record?.revision;
    let identityVerified = false;
    const stillCurrent = () => generation === this.generation && !controller.signal.aborted
      && this.readRecord()?.revision === expectedRevision && !this.readRecord()?.locked;
    try {
      const response = await this.request('/api/me', { signal: controller.signal });
      if (!stillCurrent()) return;
      if (response.status === 401) {
        this.lock('expired', 'Your session ended. Sign in again to resume changes saved for your account.');
        return;
      }
      if (!response.ok) throw new Error('Authentication unavailable');
      const user = await response.json();
      if (!stillCurrent()) return;
      if (typeof user?.id !== 'string' || !user.id) throw new Error('Invalid identity response');
      identityVerified = true;
      const nextRecord = this.publish({
        revision: record?.userId === user.id ? record.revision : crypto.randomUUID(),
        locked: false, userId: user.id, verifiedAt: this.now(),
      });
      expectedRevision = nextRecord.revision;
      const context = await this.activate(user, true, nextRecord, generation);
      if (context) void this.sync();
    } catch (error) {
      if (!stillCurrent()) return;
      if (identityVerified) {
        this.lock('storage', 'Device storage could not be prepared safely. Clear this site’s saved data before signing in.');
        return;
      }
      this.emit({ notice: 'Connection unavailable. Saved data can be used for up to 5 days after verification.' });
      await this.restoreOffline(record, generation);
    }
  }

  async signIn(token) {
    // Lock every tab before changing the shared cookie. A failed login stays locked.
    const previousRecord = this.readRecord();
    const record = this.lock('signin', 'Signing in…', { clearPending: previousRecord?.clearPending === true });
    const generation = this.generation;
    await this.logoutTask;
    return this.withAuthLock(async () => {
      if (generation !== this.generation || this.readRecord()?.revision !== record.revision) throw new StaleAccountError();
      const controller = new AbortController();
      this.authController = controller;
      let identityVerified = false;
      try {
        if (record.clearPending) await this.clearDeviceData();
        if (generation !== this.generation || this.readRecord()?.revision !== record.revision) throw new StaleAccountError();
        const response = await this.request('/api/auth/google', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: controller.signal,
        });
        const data = await response.json();
        if (generation !== this.generation || this.readRecord()?.revision !== record.revision) throw new StaleAccountError();
        if (!response.ok || data.error) throw new Error(data.error || 'Google sign-in failed');
        if (typeof data?.id !== 'string' || !data.id) throw new Error('The authentication server did not return an account');
        identityVerified = true;
        const nextRecord = this.publish({ revision: crypto.randomUUID(), locked: false, userId: data.id, verifiedAt: this.now() });
        const context = await this.activate(data, true, nextRecord, generation);
        if (context) {
          this.emit({ notice: '' });
          void this.sync();
        }
      } catch (error) {
        if (generation === this.generation) {
          if (identityVerified) this.lock('storage', 'Device storage could not be prepared safely. Clear this site’s saved data before signing in.');
          else {
            this.publish({ ...record, revision: crypto.randomUUID(), reason: 'signin-failed' });
            this.emit({ loading: false, notice: 'Sign-in did not complete. Please try again.' });
          }
        }
        throw error;
      }
    });
  }

  async finishLogout(record) {
    return this.withAuthLock(async () => {
      if (this.readRecord()?.revision !== record.revision || !this.readRecord()?.locked) return;
      let cleared = !record.clearPending;
      let revoked = !record.logoutPending;
      try { if (!cleared) { await this.clearDeviceData(); cleared = true; } } catch { /* The persistent lock still hides all saved data. */ }
      try {
        if (this.online() && !revoked) {
          const response = await this.request('/api/auth/logout', { method: 'POST' });
          revoked = response.ok && (await response.json()).success === true;
        }
      } catch { /* Keep revocation pending while offline or after a server error. */ }
      if (this.readRecord()?.revision !== record.revision) return;
      const changed = record.logoutPending !== !revoked || record.clearPending !== !cleared;
      const nextRecord = this.publish({
        ...record, revision: changed ? crypto.randomUUID() : record.revision,
        logoutPending: !revoked, clearPending: !cleared,
      });
      this.emit({ notice: cleared ? this.lockedNotice(nextRecord) : 'Signed out on this device. Saved data stays locked because device cleanup could not complete.' });
    });
  }

  async signOut() {
    const record = this.lock('logout', 'Signed out on this device. Confirming server sign-out…', { logoutPending: true, clearPending: true });
    this.logoutTask = this.finishLogout(record);
    try { await this.logoutTask; } finally { this.logoutTask = null; }
  }

  async authenticatedRequest(context, path, options = {}) {
    this.assertCurrent(context);
    if (!context.verified || !this.online()) throw new Error('Reconnect to perform this action');
    const response = await this.request(path, {
      ...options, signal: context.controller.signal,
      headers: { ...options.headers, 'X-SplitSync-Account': context.user.id },
    });
    this.assertCurrent(context);
    if (response.status === 401) {
      this.lock('expired', 'Your session ended. Sign in again to resume changes saved for your account.');
      throw new StaleAccountError();
    }
    const data = await response.json();
    this.assertCurrent(context);
    if (data.code === 'ACCOUNT_CHANGED' || response.headers.get('X-SplitSync-User') !== context.user.id) {
      this.lock('changed', 'The signed-in account changed. Sign in again. Pending changes stay with their original account.');
      throw new StaleAccountError();
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async sync() {
    const context = this.active;
    if (!context || !this.isCurrent(context) || !context.verified || !this.online()) return;
    if (context.syncTask) return context.syncTask;
    const run = async () => {
      let failedChange = false;
      try {
        this.assertCurrent(context);
        const items = await context.database.syncQueue.where('ownerId').equals(context.user.id).sortBy('id');
        for (const item of items) {
          this.assertCurrent(context);
          if (item.ownerId !== context.user.id) throw new StaleAccountError();
          const endpoint = endpointByTable[item.table];
          if (!endpoint || !['CREATE', 'UPDATE', 'DELETE'].includes(item.action)) throw new Error('Unsupported saved change');
          const method = item.action === 'UPDATE' ? 'PUT' : item.action === 'DELETE' ? 'DELETE' : 'POST';
          const path = method === 'POST' ? endpoint : `${endpoint}/${encodeURIComponent(item.data.id)}`;
          try {
            await this.authenticatedRequest(context, path, {
              method, headers: { 'Content-Type': 'application/json' },
              body: method === 'DELETE' ? undefined : JSON.stringify(item.data),
            });
            this.assertCurrent(context);
            await context.database.transaction('rw', context.database.syncQueue, async () => {
              this.assertCurrent(context);
              await context.database.syncQueue.delete(item.id);
              this.assertCurrent(context);
            });
          } catch (error) {
            if (!this.isCurrent(context)) throw error;
            failedChange = true;
            this.emit({ notice: `A change could not sync: ${error.message}. It remains saved for this account.` });
            break;
          }
        }
        this.assertCurrent(context);
        const data = await this.authenticatedRequest(context, '/api/sync');
        if (data.user?.id !== context.user.id) {
          this.lock('changed', 'The sync account changed. Sign in again to continue.');
          return;
        }
        await applyAccountSnapshot(context.database, data, () => this.assertCurrent(context));
        this.assertCurrent(context);
        context.user = data.user;
        const record = this.readRecord();
        this.publish({ ...record, verifiedAt: this.now() });
        this.emit({ user: data.user, ...(failedChange ? {} : { notice: '' }) });
        this.armExpiry(context);
      } catch (error) {
        if (this.isCurrent(context) && error.name !== 'StaleAccountError') {
          this.emit({ notice: 'Sync is unavailable. Changes remain saved for this account.' });
        }
      }
    };
    const work = () => this.locks
      ? this.locks.request(`splitSync:sync:${context.user.id}`, { ifAvailable: true }, lock => lock ? run() : undefined)
      : run();
    context.syncTask = work();
    try { await context.syncTask; } finally {
      context.syncTask = null;
      if (context.needsSync && this.isCurrent(context)) {
        context.needsSync = false;
        void this.sync();
      }
    }
  }

  async saveMutation(action, table, data, expectedUserId) {
    const context = this.active;
    if (!context || context.user.id !== expectedUserId) throw new StaleAccountError();
    this.assertCurrent(context);
    await saveAccountMutation(context.database, action, table, data, () => this.assertCurrent(context));
    this.assertCurrent(context);
    if (context.verified && this.online()) {
      if (context.syncTask) context.needsSync = true;
      else void this.sync();
    }
  }

  async joinGroup(groupId, expectedUserId) {
    const context = this.active;
    if (!context || context.user.id !== expectedUserId) throw new StaleAccountError();
    await this.authenticatedRequest(context, `/api/groups/${encodeURIComponent(groupId)}/join`, { method: 'POST' });
    await context.syncTask;
    this.assertCurrent(context);
    await this.sync();
  }

  async inviteMember(groupId, email, expectedUserId) {
    const context = this.active;
    if (!context || context.user.id !== expectedUserId) throw new StaleAccountError();
    await this.authenticatedRequest(context, `/api/groups/${encodeURIComponent(groupId)}/invite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    await context.syncTask;
    this.assertCurrent(context);
    await this.sync();
  }
}
