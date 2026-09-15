const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

const PROFILE_COLUMNS = 'id, name, phone, email, role, rating_avg, created_at';

// This is what AuthContext.js on the frontend was left with a TODO for:
// on app relaunch, the client can silently refresh its access token, but
// it had no way to re-fetch *who that token belongs to* without asking
// the user to log in again. This endpoint is that missing piece.
async function getMe(req, res) {
  const { rows } = await pool.query(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`,
    [req.user.id]
  );
  if (!rows[0]) throw new AppError(404, 'User not found');
  res.json(rows[0]);
}

const updateMeSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });
// Phone is intentionally not editable here — it's the login identifier
// and unique key; changing it needs its own verification flow (OTP etc.),
// not a plain profile-edit form. Same reasoning for role/rating_avg —
// role is a driver/host distinction the backend derives from usage, not
// something to hand-edit, and rating_avg is computed from reviews only.

async function updateMe(req, res) {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const d = parsed.data;

  const fields = [];
  const values = [];
  let i = 1;
  if (d.name !== undefined) { fields.push(`name = $${i++}`); values.push(d.name); }
  if (d.email !== undefined) { fields.push(`email = $${i++}`); values.push(d.email); }

  values.push(req.user.id);
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING ${PROFILE_COLUMNS}`,
    values
  );
  res.json(rows[0]);
}

// Two separate totals rather than one merged number — someone who both
// drives and hosts shouldn't have "bookings used" and "bookings served"
// conflated into a single misleading count.
async function getMyStats(req, res) {
  const driverQuery = pool.query(
    `SELECT COUNT(*) FILTER (WHERE b.status = 'completed') AS completed_bookings,
            COALESCE(SUM(p.amount) FILTER (WHERE b.status = 'completed'), 0) AS total_spent
     FROM bookings b
     LEFT JOIN payments p ON p.booking_id = b.id
     WHERE b.driver_id = $1`,
    [req.user.id]
  );

  const hostQuery = pool.query(
    `SELECT COUNT(DISTINCT l.id) AS listings_count,
            COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed_bookings,
            COUNT(DISTINCT b.driver_id) FILTER (WHERE b.status = 'completed') AS unique_customers,
            COALESCE(SUM(p.host_payout) FILTER (WHERE b.status = 'completed'), 0) AS total_earned
     FROM listings l
     LEFT JOIN bookings b ON b.listing_id = l.id
     LEFT JOIN payments p ON p.booking_id = b.id
     WHERE l.host_id = $1`,
    [req.user.id]
  );

  const [driverResult, hostResult] = await Promise.all([driverQuery, hostQuery]);

  res.json({
    as_driver: driverResult.rows[0],
    as_host: hostResult.rows[0],
  });
}

// Reviews *about* this user, from either side of a booking — a driver
// reviewing a host's listing, or a host reviewing a driver. Mirrors the
// subject-matching logic in reviews.controller.js's rating_avg update,
// since both need to answer "who is this review actually about."
async function getMyReviews(req, res) {
  const { rows } = await pool.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS author_name,
            CASE WHEN b.driver_id = $1 THEN 'host' ELSE 'driver' END AS author_role,
            l.title AS listing_title
     FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     JOIN listings l ON l.id = b.listing_id
     JOIN users u ON u.id = r.author_id
     WHERE (b.driver_id = $1 AND l.host_id = r.author_id)
        OR (l.host_id = $1 AND b.driver_id = r.author_id)
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
}

module.exports = { getMe, updateMe, getMyStats, getMyReviews };