const { AppError } = require('../utils/AppError');

// Postgres error codes we want to translate into clean client responses
// rather than leaking raw DB errors.
const PG_UNIQUE_VIOLATION = '23505';
const PG_EXCLUSION_VIOLATION = '23P01'; // our double-booking guard

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    console.warn(`[${err.statusCode}] ${req.method} ${req.originalUrl} — ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err.code === PG_EXCLUSION_VIOLATION) {
    console.warn(`[409] ${req.method} ${req.originalUrl} — booking overlap rejected`);
    return res.status(409).json({
      error: 'That slot overlaps with an existing booking on this listing.',
    });
  }

  if (err.code === PG_UNIQUE_VIOLATION) {
    console.warn(`[409] ${req.method} ${req.originalUrl} — unique constraint violation`);
    return res.status(409).json({ error: 'That value is already in use.' });
  }

  console.error(`[500] ${req.method} ${req.originalUrl}`, err);
  return res.status(500).json({ error: 'Something went wrong on our end.' });
}

module.exports = { errorHandler };
