const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

const registerSchema = z.object({ expo_push_token: z.string().min(10) });

async function registerDevice(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);

  await pool.query(
    `INSERT INTO devices (user_id, expo_push_token)
     VALUES ($1, $2)
     ON CONFLICT (user_id, expo_push_token) DO UPDATE SET updated_at = now()`,
    [req.user.id, parsed.data.expo_push_token]
  );

  res.status(204).send();
}

module.exports = { registerDevice };
