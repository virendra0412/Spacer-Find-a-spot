const { verifyAccessToken } = require('../utils/jwt');
const { AppError } = require('../utils/AppError');

// Protects a route: requires a valid access token, attaches { id, role }
// to req.user for downstream handlers.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError(401, 'Missing or malformed Authorization header'));
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    next(new AppError(401, 'Invalid or expired access token'));
  }
}

module.exports = { requireAuth };
