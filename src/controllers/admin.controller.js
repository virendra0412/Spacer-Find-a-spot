const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

// Single-call platform snapshot — the numbers a business actually needs
// day to day: how many people are on the platform, how much parking is
// listed, how bookings are trending, and what the platform has actually
// earned (platform_fee only — NOT total money moved, which would
// overstate revenue by including money that passes through to hosts).
async function getOverview(req, res) {
  const [users, listings, bookings, revenue, disputes] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE role = 'host' OR role = 'both')::int AS hosts,
             COUNT(*) FILTER (WHERE is_admin)::int AS admins
      FROM users
    `),
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'active')::int AS active,
             COUNT(*) FILTER (WHERE status = 'removed')::int AS removed
      FROM listings
    `),
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
             COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
             COUNT(*) FILTER (WHERE status IN ('reserved', 'active'))::int AS upcoming
      FROM bookings
    `),
    pool.query(`
      SELECT COALESCE(SUM(platform_fee) FILTER (WHERE b.status = 'completed'), 0) AS platform_revenue,
             COALESCE(SUM(subtotal) FILTER (WHERE b.status = 'completed'), 0) AS gmv,
             COALESCE(SUM(amount) FILTER (WHERE b.status = 'cancelled' AND p.amount > 0), 0) AS cancellation_fees_collected
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
    `),
    pool.query(`SELECT COUNT(*)::int AS open FROM disputes WHERE status = 'open'`),
  ]);

  res.json({
    users: users.rows[0],
    listings: listings.rows[0],
    bookings: bookings.rows[0],
    revenue: revenue.rows[0],
    disputes: disputes.rows[0],
  });
}

const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

async function listUsers(req, res) {
  const { limit, offset } = paginationSchema.parse(req.query);
  const { rows } = await pool.query(
    `SELECT id, name, phone, email, role, rating_avg, is_admin, created_at
     FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
}

const setAdminSchema = z.object({ is_admin: z.boolean() });

// Promote or demote a user's admin access. This is the endpoint that
// replaces "run an UPDATE by hand in psql" — every grant/revoke goes
// through here, gets validated, and is recorded in admin_audit_log
// instead of leaving no trace of who did it or when.
async function setUserAdmin(req, res) {
  const parsed = setAdminSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { is_admin } = parsed.data;

  // Blocks an admin from revoking their own access by mistake (or via a
  // mis-tapped button) and locking themselves out with no other admin
  // able to fix it. Demoting yourself still requires a *different* admin
  // to do it.
  if (req.params.id === req.user.id && !is_admin) {
    throw new AppError(400, "You can't remove your own admin access. Ask another admin to do it.");
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE users SET is_admin = $1 WHERE id = $2
       RETURNING id, name, phone, email, role, is_admin`,
      [is_admin, req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      throw new AppError(404, 'User not found');
    }

    await client.query(
      `INSERT INTO admin_audit_log (actor_id, action, target_user_id, detail)
       VALUES ($1, $2, $3, $4)`,
      [
        req.user.id,
        is_admin ? 'grant_admin' : 'revoke_admin',
        req.params.id,
        `${is_admin ? 'Granted' : 'Revoked'} admin access for ${rows[0].name} (${rows[0].phone})`,
      ]
    );

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Recent admin actions — the audit trail itself. Kept simple (no
// filtering yet) since admin action volume is low; add filters if that
// stops being true.
async function listAuditLog(req, res) {
  const { limit, offset } = paginationSchema.parse(req.query);
  const { rows } = await pool.query(
    `SELECT al.id, al.action, al.detail, al.created_at,
            ua.name AS actor_name, ua.phone AS actor_phone,
            ut.name AS target_name, ut.phone AS target_phone
     FROM admin_audit_log al
     JOIN users ua ON ua.id = al.actor_id
     LEFT JOIN users ut ON ut.id = al.target_user_id
     ORDER BY al.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
}

// All listings across every host, for moderation — the host-facing
// GET /listings/mine deliberately only shows your own.
async function listAllListings(req, res) {
  const { limit, offset } = paginationSchema.parse(req.query);
  const { rows } = await pool.query(
    `SELECT l.id, l.title, l.status, l.price_per_hour, l.vehicle_type, l.created_at,
            u.name AS host_name, u.phone AS host_phone,
            COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed_bookings
     FROM listings l
     JOIN users u ON u.id = l.host_id
     LEFT JOIN bookings b ON b.listing_id = l.id
     GROUP BY l.id, u.name, u.phone
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
}

const moderateSchema = z.object({
  status: z.enum(['active', 'paused', 'removed']),
});

// Deliberately separate from the host's own PATCH /listings/:id — that
// route checks host_id = req.user.id, which an admin moderating someone
// else's bad listing should NOT need to satisfy. Scoped to status only:
// an admin shouldn't be able to silently rewrite a host's price or
// description, just take it down.
async function moderateListing(req, res) {
  const parsed = moderateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);

  const { rows } = await pool.query(
    'UPDATE listings SET status = $1 WHERE id = $2 RETURNING id, title, status',
    [parsed.data.status, req.params.id]
  );
  if (!rows[0]) throw new AppError(404, 'Listing not found');
  res.json(rows[0]);
}

// Recent bookings across the whole platform — for looking into a
// dispute ("host says driver never showed") without a raw DB query.
async function listAllBookings(req, res) {
  const { limit, offset } = paginationSchema.parse(req.query);
  const { rows } = await pool.query(
    `SELECT b.id, b.status, b.start_at, b.end_at, b.estimated_cost, b.final_cost, b.created_at,
            l.title AS listing_title, uh.name AS host_name, ud.name AS driver_name, ud.phone AS driver_phone
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN users uh ON uh.id = l.host_id
     JOIN users ud ON ud.id = b.driver_id
     ORDER BY b.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
}

async function listVerifications(req, res) {
  const { limit, offset } = paginationSchema.parse(req.query);
  const { rows } = await pool.query(
    `SELECT v.id, v.user_id, v.document_url, v.selfie_url, v.status,
            v.review_note, v.submitted_at, v.reviewed_at,
            u.name, u.phone, u.email
     FROM identity_verifications v
     JOIN users u ON u.id = v.user_id
     ORDER BY (v.status = 'pending') DESC, v.submitted_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
}

const verificationReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  review_note: z.string().max(1000).optional(),
});

async function reviewVerification(req, res) {
  const parsed = verificationReviewSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { rows } = await pool.query(
    `UPDATE identity_verifications
     SET status = $1, review_note = $2, reviewed_at = now(), reviewed_by = $3
     WHERE user_id = $4
     RETURNING id, user_id, status, review_note, submitted_at, reviewed_at`,
    [parsed.data.status, parsed.data.review_note || null, req.user.id, req.params.userId]
  );
  if (!rows[0]) throw new AppError(404, 'Verification submission not found');
  res.json(rows[0]);
}

module.exports = {
  getOverview, listUsers, setUserAdmin, listAuditLog, listAllListings, moderateListing, listAllBookings,
  listVerifications, reviewVerification,
};
