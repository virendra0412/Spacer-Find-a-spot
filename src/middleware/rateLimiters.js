const rateLimit = require('express-rate-limit');

// Key by authenticated user id when available, falling back to IP for
// unauthenticated requests. Keying by IP alone is unreliable for a mobile
// app — many users sit behind the same carrier-grade NAT — so a per-IP
// limit would either let a shared IP block real users from each other,
// or be set so loose it stops protecting anything.
const keyGenerator = (req) => req.user?.id || req.ip;

// Booking mutations (create/start/end/extend/cancel/review/dispute) all
// touch money, slot locking, or another user's notifications. 60 per
// 15 minutes is far above anything a real user does in normal use, but
// tight enough to blunt a scripted abuse attempt hammering the endpoint.
const bookingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking requests. Please slow down and try again shortly.' },
});

// Payment mutations — fewer legitimate reasons to call these often than
// booking actions, so the cap is lower.
const paymentsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Please slow down and try again shortly.' },
});

module.exports = { bookingsLimiter, paymentsLimiter };
