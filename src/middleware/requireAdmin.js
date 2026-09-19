const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

// Runs after requireAuth. Looks up is_admin fresh from the DB on every
// request rather than trusting a flag baked into the JWT — that way,
// revoking admin access takes effect immediately instead of waiting for
// that user's access token to expire (up to 15 minutes, per
// JWT_ACCESS_EXPIRES_IN). Admin routes are low-traffic enough that the
// extra query per request is a non-issue.
async function requireAdmin(req, res, next) {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]?.is_admin) {
    return next(new AppError(403, 'Admin access required'));
  }
  next();
}

module.exports = { requireAdmin };
