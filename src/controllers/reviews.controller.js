const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});

// A review can only be left by someone who was actually party to a
// completed booking (driver or host), and only once per booking per author.
async function createReview(req, res) {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);

  const { rows: bookingRows } = await pool.query(
    `SELECT b.*, l.host_id FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     WHERE b.id = $1 AND b.status = 'completed' AND (b.driver_id = $2 OR l.host_id = $2)`,
    [req.params.id, req.user.id]
  );
  const booking = bookingRows[0];
  if (!booking) throw new AppError(400, 'Booking not found, not completed, or not yours to review');

  const { rows: existing } = await pool.query(
    'SELECT id FROM reviews WHERE booking_id = $1 AND author_id = $2',
    [req.params.id, req.user.id]
  );
  if (existing[0]) throw new AppError(409, 'You already reviewed this booking');

  const { rows } = await pool.query(
    `INSERT INTO reviews (booking_id, author_id, rating, comment)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, req.user.id, parsed.data.rating, parsed.data.comment || null]
  );

  // The subject of the review is "whoever isn't the author" on this
  // booking — driver reviews the host (rates the listing), host reviews
  // the driver. Recompute that person's average from all reviews they've
  // received across every booking they've been party to.
  const subjectId = booking.driver_id === req.user.id ? booking.host_id : booking.driver_id;
  await pool.query(
    `UPDATE users SET rating_avg = (
       SELECT ROUND(AVG(r.rating)::numeric, 1)
       FROM reviews r
       JOIN bookings b2 ON b2.id = r.booking_id
       JOIN listings l2 ON l2.id = b2.listing_id
       WHERE (b2.driver_id = $1 AND l2.host_id = r.author_id)
          OR (l2.host_id = $1 AND b2.driver_id = r.author_id)
     )
     WHERE id = $1`,
    [subjectId]
  );

  res.status(201).json(rows[0]);
}

const reviewsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
});

async function listListingReviews(req, res) {
  const parsed = reviewsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { limit, offset } = parsed.data;

  // Total is fetched separately (not as a window function on every row)
  // so the client can show an accurate "N reviews" count even when it
  // only requests a small page — e.g. ListingDetail asks for limit=3 to
  // show inline, but still needs the true total for its header text.
  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS author_name
       FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       JOIN users u ON u.id = r.author_id
       WHERE b.listing_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM reviews r
       JOIN bookings b ON b.id = r.booking_id
       WHERE b.listing_id = $1`,
      [req.params.id]
    ),
  ]);

  res.json({ reviews: rows, total: countRows[0].total, limit, offset });
}

module.exports = { createReview, listListingReviews };
