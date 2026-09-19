const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { notifyUser } = require('../services/notification.service');

const CATEGORIES = ['no_show_host', 'no_show_driver', 'spot_occupied', 'payment_issue', 'damage', 'other'];

const raiseSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().max(1000).optional(),
});

// Either side of a booking can raise a dispute — checked the same way
// getBooking already does (driver_id = me OR listing's host_id = me),
// so this can't be opened against a booking you had no part in.
async function raiseDispute(req, res) {
  const parsed = raiseSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);

  const { rows: bookingRows } = await pool.query(
    `SELECT b.id, b.driver_id, l.host_id
     FROM bookings b JOIN listings l ON l.id = b.listing_id
     WHERE b.id = $1 AND (b.driver_id = $2 OR l.host_id = $2)`,
    [req.params.id, req.user.id]
  );
  const booking = bookingRows[0];
  if (!booking) throw new AppError(404, 'Booking not found');

  const { rows } = await pool.query(
    `INSERT INTO disputes (booking_id, raised_by, category, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [booking.id, req.user.id, parsed.data.category, parsed.data.description || null]
  );

  // Notify the other party to the booking, not the raiser.
  const otherPartyId = req.user.id === booking.driver_id ? booking.host_id : booking.driver_id;
  notifyUser(otherPartyId, 'A booking issue was reported', 'Someone reported an issue with a recent booking.').catch(() => {});

  res.status(201).json(rows[0]);
}

// Disputes on any booking where I'm the driver or the host — not just
// ones I personally raised, so I can see the status of one the other
// party opened against a booking I was part of.
async function myDisputes(req, res) {
  const { rows } = await pool.query(
    `SELECT d.*, b.start_at, b.end_at, l.title AS listing_title, u.name AS raised_by_name
     FROM disputes d
     JOIN bookings b ON b.id = d.booking_id
     JOIN listings l ON l.id = b.listing_id
     JOIN users u ON u.id = d.raised_by
     WHERE b.driver_id = $1 OR l.host_id = $1
     ORDER BY d.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}

// Admin: every dispute platform-wide, open ones first.
async function listDisputes(req, res) {
  const { rows } = await pool.query(
    `SELECT d.*, b.start_at, b.end_at, l.title AS listing_title,
            ur.name AS raised_by_name, ur.phone AS raised_by_phone
     FROM disputes d
     JOIN bookings b ON b.id = d.booking_id
     JOIN listings l ON l.id = b.listing_id
     JOIN users ur ON ur.id = d.raised_by
     ORDER BY (d.status = 'open') DESC, d.created_at DESC`
  );
  res.json(rows);
}

const resolveSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution_note: z.string().max(1000).optional(),
});

// Deliberately does NOT touch payments/bookings automatically — a real
// refund or fee reversal here needs a human decision about who was
// actually at fault, not an automatic action. This records the
// decision; acting on it (e.g. issuing a refund) is still a manual
// step for now — see the backend README.
async function resolveDispute(req, res) {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);

  const { rows } = await pool.query(
    `UPDATE disputes
     SET status = $1, resolution_note = $2, resolved_by = $3, resolved_at = now()
     WHERE id = $4
     RETURNING *`,
    [parsed.data.status, parsed.data.resolution_note || null, req.user.id, req.params.id]
  );
  if (!rows[0]) throw new AppError(404, 'Dispute not found');

  const dispute = rows[0];
  notifyUser(
    dispute.raised_by,
    'Your reported issue was reviewed',
    parsed.data.status === 'resolved' ? 'Your report has been resolved.' : 'Your report was reviewed and closed.'
  ).catch(() => {});

  res.json(dispute);
}

module.exports = { raiseDispute, myDisputes, listDisputes, resolveDispute };
