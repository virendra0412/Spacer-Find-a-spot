const bcrypt = require('bcrypt');
const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');

const signupSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(8).max(15),
  email: z.string().email().optional(),
  password: z.string().min(8),
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
      RETURNING id, name, phone, email, role, is_admin, created_at`,
    [name, phone, email || null, passwordHash]
  );
  const user = rows[0];

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

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
  const refreshToken = signRefreshToken(user);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      is_admin: user.is_admin,
    },
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

  const { rows } = await pool.query('SELECT id, role FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user) throw new AppError(401, 'User no longer exists');

  res.json({ accessToken: signAccessToken(user) });
}

module.exports = { signup, login, refresh };
