import express from 'express';
import cookieParser from 'cookie-parser';
import { OAuth2Client } from 'google-auth-library';
import { initDatabase, prisma } from './db.js';
import cors from 'cors';

const googleClient = new OAuth2Client();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

async function startServer() {
  const app = express();

  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('WARNING: GOOGLE_CLIENT_ID is missing. Google Login will fail.');
  } else {
    console.log('GOOGLE_CLIENT_ID detected.');
  }

  if (!process.env.DATABASE_URL) {
    console.warn('WARNING: DATABASE_URL is missing. PostgreSQL connection will fail.');
  }

  await initDatabase();

  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }));
  // Helper to trap async route handler errors
  const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  // Auth Middleware
  const authRequired = async (req, res, next) => {
    try {
      const userId = req.cookies.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      req.user = user;
      next();
    } catch (error) {
      console.error('Authentication check failed:', error);
      res.status(500).json({ error: 'Internal Auth Error: ' + error.message });
    }
  };

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Google Login
  app.post('/api/auth/google', asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token missing' });
    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error('Auth Error: GOOGLE_CLIENT_ID not configured on server');
      return res.status(500).json({ error: 'Server auth configuration missing' });
    }

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      
      let user = await prisma.user.findUnique({
        where: { email: payload.email },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: payload.email,
            name: payload.name,
            avatar: payload.picture,
          },
        });
      }

      res.cookie('userId', user.id, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json(user);
    } catch (error) {
      console.error('Google Auth Error:', error);
      res.status(401).json({ error: 'Invalid token' });
    }
  }));

  app.get('/api/me', asyncHandler(async (req, res) => {
    const userId = req.cookies.userId;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    
    res.json(user);
  }));

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('userId');
    res.json({ success: true });
  });

  // Groups
  app.get('/api/groups', authRequired, asyncHandler(async (req, res) => {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.id },
      include: { group: true },
    });
    res.json(memberships.map(m => ({ ...m.group, role: m.role, joined: m.joined })));
  }));

  app.post('/api/groups', authRequired, asyncHandler(async (req, res) => {
    const { name } = req.body;
    const group = await prisma.group.create({
      data: {
        name,
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
    res.json(group);
  }));

  app.get('/api/groups/:id', authRequired, asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({
      where: { id: req.params.id },
      include: {
        members: { include: { user: true } },
        expenses: { include: { paidBy: true, splits: { include: { user: true } } }, orderBy: { date: 'desc' } },
        payments: { include: { fromUser: true, toUser: true }, orderBy: { date: 'desc' } },
      },
    });
    
    if (!group) return res.status(404).json({ error: 'Group not found' });
    
    // Check membership
    const isMember = group.members.some(m => m.userId === req.user.id);
    if (!isMember) return res.status(403).json({ error: 'Not a member' });

    res.json(group);
  }));

  app.post('/api/groups/:id/invite', authRequired, asyncHandler(async (req, res) => {
    const { email } = req.body;
    
    // Try to find user, if not exists, we can't invite them in this simplified version
    // In a real app, you might send an email invite.
    let targetUser = await prisma.user.findUnique({ where: { email } });
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
      res.status(400).json({ error: 'Already invited or member' });
    }
  }));

  app.post('/api/groups/:groupId/join', authRequired, asyncHandler(async (req, res) => {
    try {
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
    } catch (error) {
      console.error('Join Error:', error);
      res.status(400).json({ error: 'Could not join group. Membership might not exist.' });
    }
  }));

  // Expenses
  const assertExpenseAccess = async (expenseId, userId) => {
    const expense = await prisma.expense.findUnique({
      where: { id: expenseId },
      include: { paidBy: true, splits: { include: { user: true } } },
    });
    if (!expense) return null;

    const membership = await prisma.groupMember.findMany({ where: { userId } });
    const isMember = membership.some(m => m.groupId === expense.groupId);
    return isMember ? expense : false;
  };

  app.post('/api/expenses', authRequired, asyncHandler(async (req, res) => {
    const { id, groupId, amount, description, comments, date, splitType, splits } = req.body;
    
    const expense = await prisma.expense.create({
      data: {
        id,
        groupId,
        paidById: req.user.id,
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

    const { amount, description, comments, date, splitType, splits } = req.body;
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
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
    const { id, groupId, toUserId, amount, date } = req.body;
    const payment = await prisma.payment.create({
      data: {
        id,
        groupId,
        fromUserId: req.user.id,
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
    const groupIds = memberships.map(m => m.groupId);
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
      groups: groups.map(group => {
        const membership = membershipByGroupId.get(group.id);
        return {
          ...group,
          role: membership?.role,
          joined: membership?.joined ?? false,
        };
      }),
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
    res.status(500).json({
      error: 'Unhandled server error',
      message: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend API running on http://localhost:${PORT}`);
  });
}

startServer().catch(error => {
  const details = error.errors?.map(item => `${item.code} ${item.address}:${item.port}`).join(', ');
  console.error('Backend startup failed:', details || error.message || error);
  process.exit(1);
});
