import Dexie from 'dexie';

export const db = new Dexie('SplitExpensesDB');

db.version(1).stores({
  groups: 'id, name, createdAt, updatedAt',
  expenses: 'id, groupId, paidById, amount, description, date, splitType',
  splits: 'id, expenseId, userId, amount',
  payments: 'id, groupId, fromUserId, toUserId, amount, date',
  members: 'id, groupId, userId, role, joined',
  users: 'id, email, name, avatar',
  syncQueue: '++id, action, table, data, timestamp'
});

export const addToSyncQueue = async (action, table, data) => {
  await db.syncQueue.add({
    action,
    table,
    data,
    timestamp: Date.now()
  });
};
