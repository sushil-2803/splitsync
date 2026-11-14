import express from 'express';
import cookieParser from 'cookie-parser';
import { OAuth2Client } from 'google-auth-library';
import { prisma as defaultDatabase } from './db.js';
import cors from 'cors';
import { createSessionManager, readAuthConfiguration } from './auth.js';

export function createApp({ database = defaultDatabase, googleClient = new OAuth2Client(), env = process.env } = {}) {
  const prisma = database;
  const configuration = readAuthConfiguration(env);
  const sessions = createSessionManager(configuration, database);
  const GOOGLE_CLIENT_ID = configuration.googleClientId;
  const FRONTEND_ORIGIN = configuration.frontendOrigin;
  const app = express();
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || origin === FRONTEND_ORIGIN) return callback(null, true);
      return callback(Object.assign(new Error('CORS origin is not allowed'), { status: 403 }));
    },
    credentials: true,
    exposedHeaders: ['X-SplitSync-User'],
  }));
  // Helper to trap async route handler errors
  const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  // Auth Middleware
  const authRequired = async (req, res, next) => {
    try {
      const user = await sessions.getUser(req);
      if (!user) {
        sessions.clearCookies(res);
        return res.status(401).json({ error: 'Unauthorized' });
      }
      res.set('X-SplitSync-User', user.id);
      const expectedUserId = req.get('X-SplitSync-Account');
      if (expectedUserId && expectedUserId !== user.id) {
        return res.status(409).json({ error: 'The signed-in account changed. Please sign in again.', code: 'ACCOUNT_CHANGED' });
      }
      // Bind mutations to the verified client identity, even if another tab
      // changes the shared HttpOnly cookie immediately before the request.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !expectedUserId) {
        return res.status(400).json({ error: 'A verified account is required for this request.', code: 'ACCOUNT_REQUIRED' });
      }
      req.user = user;
      next();
    } catch (error) {
      console.error('Authentication check failed:', error);
      res.status(500).json({ error: 'Authentication is temporarily unavailable' });
    }
  };

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Google Login
  app.post('/api/auth/google', asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token missing', code: 'TOKEN_MISSING' });
    if (!GOOGLE_CLIENT_ID) {
      console.error('Auth Error: GOOGLE_CLIENT_ID not configured on server');
      return res.status(500).json({ error: 'Server auth configuration missing' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (error) {
      console.error('Google Auth Error:', error);
      return res.status(401).json({ error: 'Invalid Google token', code: 'TOKEN_INVALID' });
    }
    if (!payload || payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      return res.status(401).json({ error: 'Invalid token issuer', code: 'TOKEN_ISSUER_INVALID' });
    }
    if (!payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: 'A verified Google email is required', code: 'EMAIL_NOT_VERIFIED' });
    }
    if (!payload.exp || payload.exp * 1000 <= Date.now()) {
      return res.status(401).json({ error: 'Google token expired', code: 'TOKEN_EXPIRED' });
    }
    const email = payload.email.trim().toLowerCase();
    
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: payload.name,
          avatar: payload.picture,
        },
      });
    }

    await sessions.issue(req, res, user.id);
    res.json(user);
  }));

  app.get('/api/me', authRequired, (req, res) => res.json(req.user));

  app.post('/api/auth/logout', asyncHandler(async (req, res) => {
    await sessions.revoke(req);
    sessions.clearCookies(res);
    res.json({ success: true });
  }));

  app.post('/api/auth/logout-all', authRequired, asyncHandler(async (req, res) => {
    await sessions.revokeAll(req.user.id);
    sessions.clearCookies(res);
    res.json({ success: true });
  }));

  const invitationDetails = membership => ({
    id: membership.groupId,
    name: membership.group.name,
    createdAt: membership.group.createdAt,
    role: membership.role,
    joined: false,
  });

  const getAcceptedMembership = async (groupId, userId) => {
    const memberships = await prisma.groupMember.findMany({ where: { groupId, userId, joined: true } });
    return memberships.find(member => member.groupId === groupId && member.userId === userId && member.joined === true);
  };

  // Groups
  app.get('/api/groups', authRequired, asyncHandler(async (req, res) => {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.id },
      include: { group: true },
    });
    res.json(memberships.map(m => m.joined ? { ...m.group, role: m.role, joined: true } : invitationDetails(m)));
  }));

  app.post('/api/groups', authRequired, asyncHandler(async (req, res) => {
    const { id, name } = req.body;
    if (typeof name !== 'string' || !name.trim() || (id !== undefined && (typeof id !== 'string' || !id || id.length > 128))) {
      return res.status(400).json({ error: 'A group name and valid ID are required' });
    }
    // Reuse client IDs so queued expenses can reference a group created offline.
    if (id) {
      const existing = await prisma.group.findUnique({ where: { id }, include: { members: true } });
      if (existing) {
        const membership = await getAcceptedMembership(id, req.user.id);
        if (membership?.role !== 'ADMIN') return res.status(409).json({ error: 'Group ID already exists' });
        return res.json({ ...existing, role: membership.role, joined: true });
      }
    }
    const group = await prisma.group.create({
      data: {
        id,
        name: name.trim(),
        members: {
          create: {
            userId: req.user.id,
            role: 'ADMIN',
            joined: true,
          },
        },
      },
      include: { members: true },
    });
    res.json({ ...group, role: 'ADMIN', joined: true });
  }));

  app.get('/api/groups/:id', authRequired, asyncHandler(async (req, res) => {
    if (!await getAcceptedMembership(req.params.id, req.user.id)) {
      return res.status(403).json({ error: 'An accepted group membership is required' });
    }
    const group = await prisma.group.findUnique({
      where: { id: req.params.id },
      include: {
        members: { include: { user: true } },
        expenses: { include: { paidBy: true, splits: { include: { user: true } } }, orderBy: { date: 'desc' } },
        payments: { include: { fromUser: true, toUser: true }, orderBy: { date: 'desc' } },
      },
    });
    
    if (!group) return res.status(404).json({ error: 'Group not found' });
    
    res.json(group);
  }));

  app.post('/api/groups/:id/invite', authRequired, asyncHandler(async (req, res) => {
    const caller = await getAcceptedMembership(req.params.id, req.user.id);
    if (caller?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only accepted group administrators can invite members' });
    }
    const { email } = req.body;
    if (typeof email !== 'string' || !email.trim()) return res.status(400).json({ error: 'Email is required' });
    
    // Try to find user, if not exists, we can't invite them in this simplified version
    // In a real app, you might send an email invite.
    const targetUser = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!targetUser) {
      // Create a skeleton user or error
      return res.status(404).json({ error: 'User not found. They must login once first.' });
    }

    try {
      const membership = await prisma.groupMember.create({
        data: {
          groupId: req.params.id,
          userId: targetUser.id,
          role: 'MEMBER',
          joined: false,
        },
      });
      res.json(membership);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Already invited or member' });
      throw e;
    }
  }));

  app.post('/api/groups/:groupId/join', authRequired, asyncHandler(async (req, res) => {
    const invitations = await prisma.groupMember.findMany({ where: { userId: req.user.id, groupId: req.params.groupId } });
    if (!invitations.length) return res.status(403).json({ error: 'A group invitation is required' });
    const membership = await prisma.groupMember.update({
      where: {
        userId_groupId: {
          userId: req.user.id,
          groupId: req.params.groupId,
        },
      },
      data: { joined: true },
    });
    res.json(membership);
  }));

  // Expenses
  const assertExpenseAccess = async (expenseId, userId) => {
    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
      include: { paidBy: true, splits: { include: { user: true } } },
    });
    if (!expense) return null;

    return await getAcceptedMembership(expense.groupId, userId) ? expense : false;
  };

  const assertGroupExpenseUsers = async (groupId, creatorId, paidById, splits = []) => {
    const groupMembers = await prisma.groupMember.findMany({ where: { groupId, joined: true } });
    const memberIds = new Set(groupMembers.map(member => member.userId));
    if (!memberIds.has(creatorId)) {
      return { status: 403, error: 'Not a group member' };
    }
    if (!memberIds.has(paidById)) {
      return { status: 400, error: 'Paid by must be a group member' };
    }
    const invalidSplit = splits.find(split => !memberIds.has(split.userId));
    if (invalidSplit) {
      return { status: 400, error: 'Expense splits must use group members' };
    }
    return null;
  };

  app.post('/api/expenses', authRequired, asyncHandler(async (req, res) => {
    const { id, groupId, paidById, amount, description, comments, date, splitType, splits } = req.body;
    const selectedPaidById = paidById || req.user.id;
    const validationError = await assertGroupExpenseUsers(groupId, req.user.id, selectedPaidById, splits || []);
    if (validationError) {
      return res.status(validationError.status).json({ error: validationError.error });
    }
    
    const expense = await prisma.expense.create({
      data: {
        id,
        groupId,
        paidById: selectedPaidById,
        amount,
        description,
        comments,
        date: date ? new Date(date) : new Date(),
        splitType,
        splits: {
          create: (splits || []).map(s => ({
            userId: s.userId,
            amount: s.amount,
          })),
        },
      },
      include: { splits: true },
    });
    res.json(expense);
  }));

  app.get('/api/expenses/:id', authRequired, asyncHandler(async (req, res) => {
    const expense = await assertExpenseAccess(req.params.id, req.user.id);
    if (expense === null) return res.status(404).json({ error: 'Expense not found' });
    if (expense === false) return res.status(403).json({ error: 'Not a group member' });
    res.json(expense);
  }));

  app.put('/api/expenses/:id', authRequired, asyncHandler(async (req, res) => {
    const existing = await assertExpenseAccess(req.params.id, req.user.id);
    if (existing === null) return res.status(404).json({ error: 'Expense not found' });
    if (existing === false) return res.status(403).json({ error: 'Not a group member' });

    const { paidById, amount, description, comments, date, splitType, splits } = req.body;
    const selectedPaidById = paidById || existing.paidById;
    const validationError = await assertGroupExpenseUsers(existing.groupId, req.user.id, selectedPaidById, splits || []);
    if (validationError) {
      return res.status(validationError.status).json({ error: validationError.error });
    }

    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        paidById: selectedPaidById,
        amount,
        description,
        comments,
        date: date ? new Date(date) : new Date(),
        splitType,
        splits: {
          create: (splits || []).map(s => ({
            userId: s.userId,
            amount: s.amount,
          })),
        },
      },
      include: { splits: true },
    });
    res.json(expense);
  }));

  app.delete('/api/expenses/:id', authRequired, asyncHandler(async (req, res) => {
    const existing = await assertExpenseAccess(req.params.id, req.user.id);
    if (existing === null) return res.status(404).json({ error: 'Expense not found' });
    if (existing === false) return res.status(403).json({ error: 'Not a group member' });

    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  }));

  // Payments (Settle Up)
  app.post('/api/payments', authRequired, asyncHandler(async (req, res) => {
    const { id, groupId, fromUserId, toUserId, amount, date } = req.body;
    if (!groupId || !fromUserId || !toUserId || !amount) {
      return res.status(400).json({ error: 'groupId, fromUserId, toUserId, and amount are required' });
    }
    if (fromUserId === toUserId) {
      return res.status(400).json({ error: 'Payer and receiver must be different members' });
    }

    const groupMembers = await prisma.groupMember.findMany({ where: { groupId, joined: true } });
    const memberIds = new Set(groupMembers.map(member => member.userId));
    if (!memberIds.has(req.user.id)) {
      return res.status(403).json({ error: 'Not a group member' });
    }
    if (!memberIds.has(fromUserId) || !memberIds.has(toUserId)) {
      return res.status(400).json({ error: 'Payment users must be group members' });
    }

    const payment = await prisma.payment.create({
      data: {
        id,
        groupId,
        fromUserId,
        toUserId,
        amount,
        date: date ? new Date(date) : new Date(),
      },
    });
    res.json(payment);
  }));

  // Full Sync Data
  app.get('/api/sync', authRequired, asyncHandler(async (req, res) => {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.id },
      include: { group: true },
    });
    const groupIds = memberships.filter(m => m.joined === true).map(m => m.groupId);
    const membershipByGroupId = new Map(memberships.map(m => [m.groupId, m]));

    const groups = await prisma.group.findMany({
      where: { id: { in: groupIds } },
      include: {
        members: { include: { user: true } },
        expenses: { include: { splits: true } },
        payments: true,
      },
    });

    res.json({
      groups: [...groups.map(group => {
        const membership = membershipByGroupId.get(group.id);
        return {
          ...group,
          role: membership?.role,
          joined: membership?.joined ?? false,
        };
      }), ...memberships.filter(m => !m.joined).map(invitationDetails)],
      user: req.user,
    });
  }));

  //
  app.get('/', (req, res) => {
    res.send('Splitsync Backend API');
  });

  // Global Unhandled Error Handler
  app.use((err, req, res, next) => {
    console.error('UNHANDLED SERVER ROUTE ERROR:', err);
    res.status(err.status || 500).json({
      error: 'Unhandled server error',
      message: err.message,
      stack: env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  });

  return app;
}
