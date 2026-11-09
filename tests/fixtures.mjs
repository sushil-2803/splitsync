import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { OAuth2Client } from 'google-auth-library';
import { createDatabase } from '../Backend/db.js';

export const A = { id: 'security-A', email: 'a@security.invalid', name: 'Account A' };
export const B = { id: 'security-B', email: 'b@security.invalid', name: 'Account B' };
export const C = { id: 'security-C', email: 'c@security.invalid', name: 'Accepted member C' };
export const D = { id: 'security-D', email: 'd@security.invalid', name: 'Pending member D' };
export const E = { id: 'security-E', email: 'e@security.invalid', name: 'Pending admin E' };
export const clientId = 'security-fixture.apps.googleusercontent.com';
export const secret = 'synthetic-security-test-secret-never-used-by-any-deployment';
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' });

export class OfflineGoogleClient extends OAuth2Client {
  async getFederatedSignonCertsAsync() { return { certs: { security: publicKey } }; }
}

export function googleToken(user, overrides = {}, signingKey = keyPair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'security' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: clientId, sub: `google-${user.id}`,
    iat: now - 5, exp: now + 3600, email: user.email, email_verified: true, name: user.name, ...overrides,
  })).toString('base64url');
  const body = `${header}.${payload}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), signingKey).toString('base64url')}`;
}

export const environment = (origin = 'https://security.invalid') => ({
  NODE_ENV: 'production', GOOGLE_CLIENT_ID: clientId, FRONTEND_ORIGIN: origin,
  SESSION_SECRET: secret, COOKIE_SECURE: 'true',
});

// PGlite runs the PostgreSQL engine in isolation. This pool shim serializes its
// one connection while executing the application's actual SQL and transactions.
export async function fixtureDatabase() {
  const engine = new PGlite();
  await engine.waitReady;
  let tail = Promise.resolve();
  const acquire = async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const previous = tail;
    tail = previous.then(() => gate);
    await previous;
    return release;
  };
  const query = async (sql, params = []) => {
    if (params.length) return engine.query(sql, params);
    const results = await engine.exec(sql);
    return results.at(-1) || { rows: [] };
  };
  const pool = {
    async query(sql, params) {
      const release = await acquire();
      try { return await query(sql, params); } finally { release(); }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
  };
  const database = createDatabase(pool);
  await database.initDatabase();
  return {
    ...database, pool,
    async reset() {
      await pool.query('TRUNCATE users, groups, group_members, expenses, expense_splits, payments, sessions CASCADE');
      for (const user of [A, B, C, D, E]) {
        await pool.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [user.id, user.email, user.name]);
      }
      for (const [id, name] of [['private-A', 'A confidential group'], ['private-B', 'B confidential group']]) {
        await pool.query('INSERT INTO groups (id, name) VALUES ($1, $2)', [id, name]);
      }
      for (const [user, groupId, role, joined] of [
        [A, 'private-A', 'ADMIN', true], [C, 'private-A', 'MEMBER', true],
        [D, 'private-A', 'MEMBER', false], [E, 'private-A', 'ADMIN', false], [B, 'private-B', 'ADMIN', true],
      ]) {
        await pool.query('INSERT INTO group_members (id, user_id, group_id, role, joined) VALUES ($1, $2, $3, $4, $5)',
          [`member-${user.id}`, user.id, groupId, role, joined]);
      }
      await pool.query('INSERT INTO expenses (id, group_id, paid_by_id, amount, description) VALUES ($1, $2, $3, $4, $5)',
        ['expense-A', 'private-A', A.id, 100, 'A private expense']);
      await pool.query('INSERT INTO expense_splits (id, expense_id, user_id, amount) VALUES ($1, $2, $3, $4)',
        ['split-A', 'expense-A', C.id, 100]);
    },
    async close() { await engine.close(); },
  };
}

export const expenseData = (overrides = {}) => ({
  id: crypto.randomUUID(), groupId: 'private-A', paidById: A.id,
  amount: 100, description: 'Synthetic expense', splitType: 'EQUAL',
  splits: [{ userId: C.id, amount: 100 }], ...overrides,
});
export const paymentData = (overrides = {}) => ({
  id: crypto.randomUUID(), groupId: 'private-A', fromUserId: A.id, toUserId: C.id, amount: 10, ...overrides,
});
