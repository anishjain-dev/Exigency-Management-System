/**
 * authService.js
 *
 * Minimal admin-only auth for the Settings tab (specifically, changing who
 * outgoing mail appears to come from). No user accounts/DB table — a single
 * admin identity lives in .env (ADMIN_USERNAME/ADMIN_PASSWORD), consistent
 * with how SMTP_PASS is already handled. Tokens are HMAC-signed and carry
 * their own expiry, so no server-side session store is needed; a server
 * restart does NOT invalidate already-issued tokens (as long as
 * ADMIN_TOKEN_SECRET is unchanged), unlike an in-memory token set.
 */

const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSecret() {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) throw new Error('ADMIN_TOKEN_SECRET is not set in .env');
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function verifyCredentials(username, password) {
  const expectedUser = process.env.ADMIN_USERNAME || '';
  const expectedPass = process.env.ADMIN_PASSWORD || '';
  if (!expectedUser || !expectedPass) return false;
  // Constant-time-ish comparison to avoid trivial timing leaks.
  const userOk = String(username || '').length === expectedUser.length &&
    crypto.timingSafeEqual(Buffer.from(String(username || '')), Buffer.from(expectedUser));
  const passOk = String(password || '').length === expectedPass.length &&
    crypto.timingSafeEqual(Buffer.from(String(password || '')), Buffer.from(expectedPass));
  return userOk && passOk;
}

function issueToken(username) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${username}.${expiresAt}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return false;
    const [username, expiresAtStr, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
    const expectedSignature = sign(`${username}.${expiresAtStr}`);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

/** Express middleware: 200s with {ok:true} if the presented token is valid — used by the frontend to check an existing token on load. */
function verifyAdmin(req, res) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) return res.status(401).json({ error: 'Invalid or expired session.' });
  res.json({ ok: true });
}

/** Express middleware: rejects with 401 unless a valid admin token is presented. */
function requireAdmin(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Admin login required.' });
  }
  next();
}

module.exports = { verifyCredentials, issueToken, verifyToken, requireAdmin, verifyAdmin };
