import Dexie from 'dexie';

export const ACCOUNT_DB_PREFIX = 'SplitExpensesDB:account:';
const LEGACY_DB_NAME = 'SplitExpensesDB';
const openDatabases = new Set();
const schema = {
  groups: 'id, name, createdAt, updatedAt',
  expenses: 'id, groupId, paidById, amount, description, date, splitType',
  splits: 'id, expenseId, userId, amount',
  payments: 'id, groupId, fromUserId, toUserId, amount, date',
  members: 'id, groupId, userId, role, joined',
  users: 'id, email, name, avatar',
  syncQueue: '++id, ownerId, timestamp',
  metadata: '&key',
};

export async function createAccountDatabase(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId) throw new Error('An account ID is required for device storage');
  const database = new Dexie(`${ACCOUNT_DB_PREFIX}${encodeURIComponent(ownerId)}`);
  Object.defineProperty(database, 'accountId', { value: ownerId });
  database.version(1).stores(schema);
  database.on('versionchange', () => database.close());
  try {
    await database.open();
    await database.transaction('rw', database.metadata, async () => {
      const owner = await database.metadata.get('ownerId');
      if (owner && owner.value !== ownerId) throw new Error('Device storage belongs to a different account');
      await database.metadata.put({ key: 'ownerId', value: ownerId });
    });
  } catch (error) {
    database.close();
    throw error;
  }
  openDatabases.add(database);
  return database;
}

// The old database has no trustworthy account owner. Do not import its cache or
// replay its unowned queue. Refresh server data and explain the reset to the user.
export async function retireLegacyDatabase() {
  if (!await Dexie.exists(LEGACY_DB_NAME)) return null;
  const legacy = new Dexie(LEGACY_DB_NAME);
  let pending = 0;
  try {
    await legacy.open();
    if (legacy.tables.some(table => table.name === 'syncQueue')) pending = await legacy.table('syncQueue').count();
  } finally {
    legacy.close();
  }
  await Dexie.delete(LEGACY_DB_NAME);
  return pending;
}

export async function clearDeviceAccountData() {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  const names = await Dexie.getDatabaseNames();
  for (const name of names) {
    if (name === LEGACY_DB_NAME || name.startsWith(ACCOUNT_DB_PREFIX)) await Dexie.delete(name);
  }
}

const validMutation = (action, table) => (
  table === 'expenses' && ['CREATE', 'UPDATE', 'DELETE'].includes(action)
  || ['groups', 'payments'].includes(table) && action === 'CREATE'
);

async function applyLocalChange(database, action, table, data, assertCurrent) {
  if (!validMutation(action, table) || typeof data?.id !== 'string' || !data.id) {
    throw new Error('Unsupported saved change');
  }
  assertCurrent();
  if (action === 'DELETE') await database.table(table).delete(data.id);
  else await database.table(table).put(data);
  assertCurrent();
  if (table === 'expenses') {
    await database.splits.where('expenseId').equals(data.id).delete();
    assertCurrent();
    if (action !== 'DELETE') {
      await database.splits.bulkPut((data.splits || []).map(split => ({
        ...split, id: split.id || `${data.id}:${split.userId}`, expenseId: data.id,
      })));
      assertCurrent();
    }
  }
  if (table === 'groups') {
    await database.members.put({
      id: `${data.id}:${database.accountId}`, groupId: data.id,
      userId: database.accountId, role: 'ADMIN', joined: true,
    });
    assertCurrent();
  }
}

export async function saveAccountMutation(database, action, table, data, assertCurrent) {
  const savedData = structuredClone(data);
  assertCurrent();
  await database.transaction('rw', database.tables, async () => {
    assertCurrent();
    if (table !== 'groups') {
      const group = await database.groups.get(savedData.groupId);
      assertCurrent();
      if (!group?.joined) throw new Error('Join the group before making changes');
    }
    await applyLocalChange(database, action, table, savedData, assertCurrent);
    assertCurrent();
    await database.syncQueue.add({
      ownerId: database.accountId, action, table, data: savedData, timestamp: Date.now(),
    });
    assertCurrent();
  });
}

export async function applyAccountSnapshot(database, data, assertCurrent) {
  if (data?.user?.id !== database.accountId || !Array.isArray(data.groups)) {
    throw new Error('Sync response belongs to a different account');
  }
  assertCurrent();
  await database.transaction('rw', database.tables, async () => {
    assertCurrent();
    const pending = await database.syncQueue.where('ownerId').equals(database.accountId).sortBy('id');
    assertCurrent();
    for (const table of database.tables) {
      if (!['syncQueue', 'metadata'].includes(table.name)) {
        await table.clear();
        assertCurrent();
      }
    }
    await database.users.put(data.user);
    assertCurrent();
    for (const { members, expenses, payments, ...group } of data.groups) {
      await database.groups.put(group);
      assertCurrent();
      // Pending invitations carry metadata only, including in the local cache.
      if (!group.joined) continue;
      await database.members.bulkPut((members || []).map(({ user, ...member }) => ({ ...member, groupId: group.id })));
      assertCurrent();
      await database.users.bulkPut((members || []).map(member => member.user).filter(Boolean));
      assertCurrent();
      await database.expenses.bulkPut(expenses || []);
      assertCurrent();
      await database.splits.bulkPut((expenses || []).flatMap(expense => (expense.splits || []).map(split => ({
        ...split, id: split.id || `${expense.id}:${split.userId}`, expenseId: expense.id,
      }))));
      assertCurrent();
      await database.payments.bulkPut(payments || []);
      assertCurrent();
    }
    // Refreshing the server snapshot must not erase changes still saved offline.
    for (const item of pending) {
      if (item.table !== 'groups') {
        const group = await database.groups.get(item.data.groupId);
        assertCurrent();
        if (!group?.joined) continue;
      }
      await applyLocalChange(database, item.action, item.table, item.data, assertCurrent);
      assertCurrent();
    }
  });
}
