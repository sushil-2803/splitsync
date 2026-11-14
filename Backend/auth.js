import crypto from 'crypto';

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export function readAuthConfiguration(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const frontendOrigin = (env.FRONTEND_ORIGIN || 'http://localhost:5173').trim();
  const secure = env.COOKIE_SECURE === 'true' || (production && env.COOKIE_SECURE !== 'false');
  const sameSite = (env.COOKIE_SAME_SITE || 'lax').toLowerCase();
  const cookieName = env.SESSION_COOKIE_NAME || 'splitSyncSession';
  // An unset development secret is random on each start, never a public constant.
  const secret = env.SESSION_SECRET || (production ? '' : crypto.randomBytes(32).toString('hex'));

  if (!googleClientId || !/^[^\s]+\.apps\.googleusercontent\.com$/i.test(googleClientId)
      || /^(your-|replace[_-]?with)/i.test(googleClientId)) {
    throw new Error('GOOGLE_CLIENT_ID must be a valid Google OAuth web client ID');
  }
  if (Buffer.byteLength(secret, 'utf8') < 32 || /^(dev-only|change-me|replace[_-]?with)/i.test(secret)
      || new Set(secret).size < 8) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes; generate it with crypto.randomBytes(32)');
  }
  let origin;
  try { origin = new URL(frontendOrigin); } catch { throw new Error('FRONTEND_ORIGIN must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== frontendOrigin) {
    throw new Error('FRONTEND_ORIGIN must be an exact HTTP or HTTPS origin without a path');
  }
  if (production && (origin.protocol !== 'https:' || !secure)) {
    throw new Error('Production requires an HTTPS FRONTEND_ORIGIN and secure cookies');
  }
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');
  }
  if (sameSite === 'none' && !secure) throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookieName) || (cookieName.startsWith('__Host-') && !secure)) {
    throw new Error('SESSION_COOKIE_NAME must be a valid cookie name; __Host- cookies require HTTPS');
  }
  return {
    googleClientId, frontendOrigin, secret, cookieName,
    cookieOptions: { path: '/', httpOnly: true, secure, sameSite, maxAge: SESSION_MAX_AGE_MS },
  };
}

export function createSessionManager(configuration, database) {
  const { secret, cookieName, cookieOptions } = configuration;
  const { maxAge, expires, ...deletionOptions } = cookieOptions;
  const tokenHash = req => {
    const token = req.cookies?.[cookieName];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
  };

  return {
    clearCookies(res) {
      res.clearCookie(cookieName, deletionOptions);
      res.clearCookie('userId', { path: '/' });
    },
    async getUser(req) {
      const hash = tokenHash(req);
      return hash ? database.session.authenticate({ tokenHash: hash, idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS }) : null;
    },
    async issue(req, res, userId) {
      const previousHash = tokenHash(req);
      const token = crypto.randomBytes(32).toString('base64url');
      const hash = crypto.createHmac('sha256', secret).update(token).digest('hex');
      await database.session.create({
        tokenHash: hash, userId, expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS), previousTokenHash: previousHash,
      });
      res.cookie(cookieName, token, cookieOptions);
      res.clearCookie('userId', { path: '/' });
    },
    async revoke(req) {
      const hash = tokenHash(req);
      if (hash) await database.session.revoke({ tokenHash: hash });
    },
    async revokeAll(userId) {
      await database.session.revokeAll({ userId });
    },
  };
}
