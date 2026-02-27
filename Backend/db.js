import pg from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';

const { Pool } = pg;

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const toUser = row => row ? {
  id: row.id,
  email: row.email,
  name: row.name,
  avatar: row.avatar,
} : null;

const toGroup = row => row ? {
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
} : null;

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar TEXT
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      joined BOOLEAN NOT NULL DEFAULT false,
      UNIQUE(user_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      paid_by_id TEXT NOT NULL REFERENCES users(id),
      amount DOUBLE PRECISION NOT NULL,
      description TEXT NOT NULL,
      comments TEXT,
      date TIMESTAMPTZ NOT NULL DEFAULT now(),
      split_type TEXT NOT NULL DEFAULT 'EQUAL'
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      id TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      amount DOUBLE PRECISION NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_user_id TEXT NOT NULL REFERENCES users(id),
      to_user_id TEXT NOT NULL REFERENCES users(id),
      amount DOUBLE PRECISION NOT NULL,
      date TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS comments TEXT');
}

export const prisma = {
  user: {
    findUnique: async ({ where }) => {
      if (where.id) {
        const rows = await query('SELECT * FROM users WHERE id = $1', [where.id]);
        return toUser(rows[0]);
      }
      if (where.email) {
        const rows = await query('SELECT * FROM users WHERE email = $1', [where.email]);
        return toUser(rows[0]);
      }
      return null;
    },
    create: async ({ data }) => {
      const id = crypto.randomUUID();
      const rows = await query(
        'INSERT INTO users (id, email, name, avatar) VALUES ($1, $2, $3, $4) RETURNING *',
        [id, data.email, data.name || null, data.avatar || null],
      );
      return toUser(rows[0]);
    },
  },

  groupMember: {
    findMany: async ({ where, include, select } = {}) => {
      if (where?.userId && select?.groupId) {
        return query('SELECT group_id AS "groupId" FROM group_members WHERE user_id = $1', [where.userId]);
      }

      if (where?.userId) {
        const rows = await query(`
          SELECT gm.id, gm.user_id, gm.group_id, gm.role, gm.joined,
                 g.name AS group_name, g.created_at AS group_created_at, g.updated_at AS group_updated_at
          FROM group_members gm
          JOIN groups g ON gm.group_id = g.id
          WHERE gm.user_id = $1
          ORDER BY g.created_at DESC
        `, [where.userId]);

        return rows.map(row => ({
          id: row.id,
          userId: row.user_id,
          groupId: row.group_id,
          role: row.role,
          joined: row.joined,
          ...(include?.group ? {
            group: {
              id: row.group_id,
              name: row.group_name,
              createdAt: row.group_created_at,
              updatedAt: row.group_updated_at,
            },
          } : {}),
        }));
      }

      if (where?.groupId) {
        const rows = await query('SELECT * FROM group_members WHERE group_id = $1', [where.groupId]);
        return rows.map(row => ({
          id: row.id,
          userId: row.user_id,
          groupId: row.group_id,
          role: row.role,
          joined: row.joined,
        }));
      }

      return [];
    },
    create: async ({ data }) => {
      const id = crypto.randomUUID();
      const rows = await query(`
        INSERT INTO group_members (id, user_id, group_id, role, joined)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [id, data.userId, data.groupId, data.role || 'MEMBER', !!data.joined]);

      const row = rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        groupId: row.group_id,
        role: row.role,
        joined: row.joined,
      };
    },
    update: async ({ where, data }) => {
      const rows = await query(`
        UPDATE group_members
        SET joined = $1
        WHERE user_id = $2 AND group_id = $3
        RETURNING *
      `, [!!data.joined, where.userId_groupId.userId, where.userId_groupId.groupId]);

      if (!rows[0]) throw new Error('Membership record not found');
      return {
        id: rows[0].id,
        userId: rows[0].user_id,
        groupId: rows[0].group_id,
        role: rows[0].role,
        joined: rows[0].joined,
      };
    },
  },

  group: {
    create: async ({ data, include }) => transaction(async client => {
      const groupId = crypto.randomUUID();
      const groupRows = await client.query(
        'INSERT INTO groups (id, name) VALUES ($1, $2) RETURNING *',
        [groupId, data.name],
      );

      const members = [];
      if (data.members?.create) {
        const member = data.members.create;
        const memberRows = await client.query(`
          INSERT INTO group_members (id, user_id, group_id, role, joined)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `, [crypto.randomUUID(), member.userId, groupId, member.role || 'MEMBER', !!member.joined]);

        members.push({
          id: memberRows.rows[0].id,
          userId: memberRows.rows[0].user_id,
          groupId: memberRows.rows[0].group_id,
          role: memberRows.rows[0].role,
          joined: memberRows.rows[0].joined,
        });
      }

      return {
        ...toGroup(groupRows.rows[0]),
        ...(include?.members ? { members } : {}),
      };
    }),

    findUnique: async ({ where, include }) => {
      const groupRows = await query('SELECT * FROM groups WHERE id = $1', [where.id]);
      const group = toGroup(groupRows[0]);
      if (!group) return null;

      if (include?.members) {
        const rows = await query(`
          SELECT gm.*, u.email, u.name, u.avatar
          FROM group_members gm
          JOIN users u ON gm.user_id = u.id
          WHERE gm.group_id = $1
        `, [group.id]);

        group.members = rows.map(row => ({
          id: row.id,
          userId: row.user_id,
          groupId: row.group_id,
          role: row.role,
          joined: row.joined,
          user: toUser({ id: row.user_id, email: row.email, name: row.name, avatar: row.avatar }),
        }));
      }

      if (include?.expenses) {
        group.expenses = await loadExpenses([group.id], true);
      }

      if (include?.payments) {
        group.payments = await loadPayments([group.id], true);
      }

      return group;
    },

    findMany: async ({ where, include }) => {
      const ids = where?.id?.in || [];
      if (ids.length === 0) return [];

      const rows = await query('SELECT * FROM groups WHERE id = ANY($1) ORDER BY created_at DESC', [ids]);
      const groups = rows.map(toGroup);

      if (include?.members) {
        const rows = await query(`
          SELECT gm.*, u.email, u.name, u.avatar
          FROM group_members gm
          JOIN users u ON gm.user_id = u.id
          WHERE gm.group_id = ANY($1)
        `, [ids]);
        for (const group of groups) {
          group.members = rows
            .filter(row => row.group_id === group.id)
            .map(row => ({
              id: row.id,
              userId: row.user_id,
              groupId: row.group_id,
              role: row.role,
              joined: row.joined,
              user: toUser({ id: row.user_id, email: row.email, name: row.name, avatar: row.avatar }),
            }));
        }
      }

      if (include?.expenses) {
        const expenses = await loadExpenses(ids, false);
        for (const group of groups) {
          group.expenses = expenses.filter(expense => expense.groupId === group.id);
        }
      }

      if (include?.payments) {
        const payments = await loadPayments(ids, false);
        for (const group of groups) {
          group.payments = payments.filter(payment => payment.groupId === group.id);
        }
      }

      return groups;
    },
  },

  expense: {
    create: async ({ data, include }) => transaction(async client => {
      const expenseId = data.id || crypto.randomUUID();
      const expenseRows = await client.query(`
        INSERT INTO expenses (id, group_id, paid_by_id, amount, description, comments, date, split_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        expenseId,
        data.groupId,
        data.paidById,
        data.amount,
        data.description,
        data.comments || null,
        data.date || new Date(),
        data.splitType || 'EQUAL',
      ]);

      const splits = [];
      for (const split of data.splits?.create || []) {
        const splitRows = await client.query(`
          INSERT INTO expense_splits (id, expense_id, user_id, amount)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `, [crypto.randomUUID(), expenseId, split.userId, split.amount]);
        splits.push({
          id: splitRows.rows[0].id,
          expenseId: splitRows.rows[0].expense_id,
          userId: splitRows.rows[0].user_id,
          amount: splitRows.rows[0].amount,
        });
      }

      return {
        id: expenseRows.rows[0].id,
        groupId: expenseRows.rows[0].group_id,
        paidById: expenseRows.rows[0].paid_by_id,
        amount: expenseRows.rows[0].amount,
        description: expenseRows.rows[0].description,
        comments: expenseRows.rows[0].comments,
        date: expenseRows.rows[0].date,
        splitType: expenseRows.rows[0].split_type,
        ...(include?.splits ? { splits } : {}),
      };
    }),
    findUnique: async ({ where, include }) => {
      const expenses = await loadExpenseById(where.id, include?.paidBy || include?.splits?.include?.user);
      return expenses[0] || null;
    },
    update: async ({ where, data, include }) => transaction(async client => {
      const rows = await client.query(`
        UPDATE expenses
        SET amount = $1,
            description = $2,
            comments = $3,
            date = $4,
            split_type = $5
        WHERE id = $6
        RETURNING *
      `, [
        data.amount,
        data.description,
        data.comments || null,
        data.date || new Date(),
        data.splitType || 'EQUAL',
        where.id,
      ]);

      if (!rows.rows[0]) throw new Error('Expense not found');

      await client.query('DELETE FROM expense_splits WHERE expense_id = $1', [where.id]);
      const splits = [];
      for (const split of data.splits?.create || []) {
        const splitRows = await client.query(`
          INSERT INTO expense_splits (id, expense_id, user_id, amount)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `, [crypto.randomUUID(), where.id, split.userId, split.amount]);
        splits.push({
          id: splitRows.rows[0].id,
          expenseId: splitRows.rows[0].expense_id,
          userId: splitRows.rows[0].user_id,
          amount: splitRows.rows[0].amount,
        });
      }

      return {
        id: rows.rows[0].id,
        groupId: rows.rows[0].group_id,
        paidById: rows.rows[0].paid_by_id,
        amount: rows.rows[0].amount,
        description: rows.rows[0].description,
        comments: rows.rows[0].comments,
        date: rows.rows[0].date,
        splitType: rows.rows[0].split_type,
        ...(include?.splits ? { splits } : {}),
      };
    }),
    delete: async ({ where }) => {
      const rows = await query('DELETE FROM expenses WHERE id = $1 RETURNING *', [where.id]);
      if (!rows[0]) throw new Error('Expense not found');
      return {
        id: rows[0].id,
        groupId: rows[0].group_id,
        paidById: rows[0].paid_by_id,
        amount: rows[0].amount,
        description: rows[0].description,
        comments: rows[0].comments,
        date: rows[0].date,
        splitType: rows[0].split_type,
      };
    },
  },

  payment: {
    create: async ({ data }) => {
      const rows = await query(`
        INSERT INTO payments (id, group_id, from_user_id, to_user_id, amount, date)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [data.id || crypto.randomUUID(), data.groupId, data.fromUserId, data.toUserId, data.amount, data.date || new Date()]);

      return {
        id: rows[0].id,
        groupId: rows[0].group_id,
        fromUserId: rows[0].from_user_id,
        toUserId: rows[0].to_user_id,
        amount: rows[0].amount,
        date: rows[0].date,
      };
    },
  },
};

async function loadExpenses(groupIds, includeUsers) {
  const rows = await query(`
    SELECT e.*, u.email AS paid_by_email, u.name AS paid_by_name, u.avatar AS paid_by_avatar
    FROM expenses e
    JOIN users u ON e.paid_by_id = u.id
    WHERE e.group_id = ANY($1)
    ORDER BY e.date DESC
  `, [groupIds]);

  if (rows.length === 0) return [];

  const splitRows = await query(`
    SELECT es.*, u.email, u.name, u.avatar
    FROM expense_splits es
    JOIN users u ON es.user_id = u.id
    WHERE es.expense_id = ANY($1)
  `, [rows.map(row => row.id)]);

  return rows.map(row => ({
    id: row.id,
    groupId: row.group_id,
    paidById: row.paid_by_id,
    amount: row.amount,
    description: row.description,
    comments: row.comments,
    date: row.date,
    splitType: row.split_type,
    ...(includeUsers ? {
      paidBy: toUser({
        id: row.paid_by_id,
        email: row.paid_by_email,
        name: row.paid_by_name,
        avatar: row.paid_by_avatar,
      }),
    } : {}),
    splits: splitRows
      .filter(split => split.expense_id === row.id)
      .map(split => ({
        id: split.id,
        expenseId: split.expense_id,
        userId: split.user_id,
        amount: split.amount,
        ...(includeUsers ? {
          user: toUser({
            id: split.user_id,
            email: split.email,
            name: split.name,
            avatar: split.avatar,
          }),
        } : {}),
      })),
  }));
}

async function loadExpenseById(expenseId, includeUsers) {
  const rows = await query(`
    SELECT e.*, u.email AS paid_by_email, u.name AS paid_by_name, u.avatar AS paid_by_avatar
    FROM expenses e
    JOIN users u ON e.paid_by_id = u.id
    WHERE e.id = $1
  `, [expenseId]);

  if (rows.length === 0) return [];

  const splitRows = await query(`
    SELECT es.*, u.email, u.name, u.avatar
    FROM expense_splits es
    JOIN users u ON es.user_id = u.id
    WHERE es.expense_id = $1
  `, [expenseId]);

  return rows.map(row => ({
    id: row.id,
    groupId: row.group_id,
    paidById: row.paid_by_id,
    amount: row.amount,
    description: row.description,
    comments: row.comments,
    date: row.date,
    splitType: row.split_type,
    ...(includeUsers ? {
      paidBy: toUser({
        id: row.paid_by_id,
        email: row.paid_by_email,
        name: row.paid_by_name,
        avatar: row.paid_by_avatar,
      }),
    } : {}),
    splits: splitRows.map(split => ({
      id: split.id,
      expenseId: split.expense_id,
      userId: split.user_id,
      amount: split.amount,
      ...(includeUsers ? {
        user: toUser({
          id: split.user_id,
          email: split.email,
          name: split.name,
          avatar: split.avatar,
        }),
      } : {}),
    })),
  }));
}

async function loadPayments(groupIds, includeUsers) {
  if (groupIds.length === 0) return [];

  const rows = await query(`
    SELECT p.*,
           from_user.email AS from_email, from_user.name AS from_name, from_user.avatar AS from_avatar,
           to_user.email AS to_email, to_user.name AS to_name, to_user.avatar AS to_avatar
    FROM payments p
    JOIN users from_user ON p.from_user_id = from_user.id
    JOIN users to_user ON p.to_user_id = to_user.id
    WHERE p.group_id = ANY($1)
    ORDER BY p.date DESC
  `, [groupIds]);

  return rows.map(row => ({
    id: row.id,
    groupId: row.group_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amount: row.amount,
    date: row.date,
    ...(includeUsers ? {
      fromUser: toUser({
        id: row.from_user_id,
        email: row.from_email,
        name: row.from_name,
        avatar: row.from_avatar,
      }),
      toUser: toUser({
        id: row.to_user_id,
        email: row.to_email,
        name: row.to_name,
        avatar: row.to_avatar,
      }),
    } : {}),
  }));
}
