const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshExpiryDate() {
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
  const match = /^([0-9]+)([smhd])$/.exec(expiresIn);
  if (!match) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return new Date(Date.now() + Number(match[1]) * multipliers[match[2]]);
}

async function issueRefreshToken(client, user) {
  const tokenId = crypto.randomUUID();
  const token = signRefreshToken(user, tokenId);
  await client.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenId, user.id, hashRefreshToken(token), refreshExpiryDate()]
  );
  return token;
}

const signupSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(8).max(15),
  email: z.string().email().optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    // bcrypt silently ignores any bytes past 72 — capping here means a
    // user's password is never truncated without their knowledge, which
    // would otherwise be a confusing "my password doesn't work" bug for
    // anyone with an unusually long passphrase.
    .max(72, 'Password must be 72 characters or fewer')
    .regex(/[a-zA-Z]/, 'Password must include at least one letter')
    .regex(/[0-9]/, 'Password must include at least one number'),
});

async function signup(req, res) {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0].message);
  }
  const { name, phone, email, password } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 12);

  const { rows } = await pool.query(
    `INSERT INTO users (name, phone, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, email, role, created_at`,
    [name, phone, email || null, passwordHash]
  );
  const user = rows[0];

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(pool, user);

  res.status(201).json({ user, accessToken, refreshToken });
}

const loginSchema = z.object({
  phone: z.string().min(8),
  password: z.string().min(1),
});

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0].message);
  }
  const { phone, password } = parsed.data;

  const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
  const user = rows[0];

  // Same error for "no such user" and "wrong password" — don't leak
  // which one it was.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'Invalid phone or password');
  }

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(pool, user);

  res.json({
    user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  });
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError(400, 'refreshToken is required');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'Invalid or expired refresh token');
  }

  if (!payload.jti) throw new AppError(401, 'Invalid or expired refresh token');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND token_hash = $3
         AND revoked_at IS NULL AND expires_at > now()
       RETURNING id`,
      [payload.jti, payload.sub, hashRefreshToken(refreshToken)]
    );
    if (!rows[0]) throw new AppError(401, 'Refresh token has been revoked or already used');

    const { rows: userRows } = await client.query('SELECT id, role FROM users WHERE id = $1', [payload.sub]);
    const user = userRows[0];
    if (!user) throw new AppError(401, 'User no longer exists');

    const nextRefreshToken = await issueRefreshToken(client, user);
    await client.query(
      'UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2',
      [jwtIdFromToken(nextRefreshToken), payload.jti]
    );
    await client.query('COMMIT');
    res.json({ accessToken: signAccessToken(user), refreshToken: nextRefreshToken });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function jwtIdFromToken(token) {
  return verifyRefreshToken(token).jti;
}

async function logout(req, res) {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1',
      [hashRefreshToken(refreshToken)]
    );
  }
  res.status(204).send();
}

/*
 * The refresh token is rotated inside one transaction. A replayed token
 * therefore fails the UPDATE and cannot mint another access token.
 */
module.exports = { signup, login, refresh, logout };
