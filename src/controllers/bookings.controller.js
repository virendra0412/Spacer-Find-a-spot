const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { notifyUser } = require('../services/notification.service');
const { computeSplit, isCancellationFree, computeCancellationFee } = require('../config/fees');

const createBookingSchema = z.object({
  listing_id: z.string().uuid(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
});

// The only thing standing between "product works" and "two drivers get
// the same spot" is this insert hitting the exclusion constraint from
// migration 004. If it throws a Postgres 23P01, errorHandler.js turns
// that into a clean 409 — we don't need to hand-roll the conflict check
// here, and shouldn't, since a hand-rolled check-then-insert has a race
// condition between the check and the insert.
async function createBooking(req, res) {
  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { listing_id, start_at, end_at } = parsed.data;

  if (new Date(end_at) <= new Date(start_at)) {
    throw new AppError(400, 'end_at must be after start_at');
  }

  const { rows: listingRows } = await pool.query(
    'SELECT id, host_id, price_per_hour FROM listings WHERE id = $1 AND status = $2',
    [listing_id, 'active']
  );
  const listing = listingRows[0];
  if (!listing) throw new AppError(404, 'Listing not found or inactive');

  const hours = (new Date(end_at) - new Date(start_at)) / (1000 * 60 * 60);
  const estimatedCost = Math.round(hours * listing.price_per_hour * 100) / 100;

  const { rows } = await pool.query(
    `INSERT INTO bookings (listing_id, driver_id, start_at, end_at, estimated_cost)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [listing_id, req.user.id, start_at, end_at, estimatedCost]
  );
  const booking = rows[0];

  // The split is computed and stored now, at the rates active right
  // now — not derived later from a `platform_fee` config value that
  // may have changed by the time anyone looks at this booking again.
  const split = computeSplit(estimatedCost);
  await pool.query(
    `INSERT INTO payments (booking_id, amount, subtotal, platform_fee, host_commission, host_payout)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [booking.id, split.grossAmount, split.subtotal, split.platformFee, split.hostCommission, split.hostPayout]
  );

  notifyUser(listing.host_id, 'New booking', 'Someone booked your spot.').catch(() => {});

  res.status(201).json(booking);
}

// Returns every booking where the caller is either the driver or the
// listing's host — this is what makes a "My Bookings" screen possible.
// Ordered so the currently-relevant ones (reserved/active) surface first,
// then everything else by recency.
async function myBookings(req, res) {
  const { rows } = await pool.query(
    `SELECT b.*, l.title AS listing_title, l.address_text,
            (l.host_id = $1) AS is_host
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     WHERE b.driver_id = $1 OR l.host_id = $1
     ORDER BY
       CASE b.status WHEN 'active' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END,
       b.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}

async function getBooking(req, res) {
  const { rows } = await pool.query(
    `SELECT b.*, l.title AS listing_title, l.address_text,
            ST_Y(l.location::geometry) AS listing_lat, ST_X(l.location::geometry) AS listing_lng
     FROM bookings b JOIN listings l ON l.id = b.listing_id
     WHERE b.id = $1 AND (b.driver_id = $2 OR l.host_id = $2)`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) throw new AppError(404, 'Booking not found');
  res.json(rows[0]);
}

async function startSession(req, res) {
  const { rows } = await pool.query(
    `UPDATE bookings SET status = 'active'
     WHERE id = $1 AND driver_id = $2 AND status = 'reserved'
     RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) throw new AppError(400, 'Booking not found or not in a startable state');
  res.json(rows[0]);
}

async function endSession(req, res) {
  const { rows: existingRows } = await pool.query(
    `SELECT b.*, l.price_per_hour, l.host_id FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     WHERE b.id = $1 AND b.driver_id = $2 AND b.status = 'active'`,
    [req.params.id, req.user.id]
  );
  const existing = existingRows[0];
  if (!existing) throw new AppError(400, 'Booking not found or not active');

  const actualEnd = new Date();
  const hours = (actualEnd - new Date(existing.start_at)) / (1000 * 60 * 60);
  const finalCost = Math.round(hours * existing.price_per_hour * 100) / 100;

  const { rows } = await pool.query(
    `UPDATE bookings SET status = 'completed', end_at = $1, final_cost = $2
     WHERE id = $3
     RETURNING *`,
    [actualEnd.toISOString(), finalCost, existing.id]
  );

  // Actual parked duration is almost never exactly the reserved window,
  // so the payment split computed at booking time (against the
  // estimate) is now stale — recompute and overwrite it against what
  // actually happened. Without this, a driver who books 4 hours but
  // leaves after 1 would still be charged (and the host paid out) for 4.
  const split = computeSplit(finalCost);
  await pool.query(
    `UPDATE payments
     SET amount = $1, subtotal = $2, platform_fee = $3, host_commission = $4, host_payout = $5
     WHERE booking_id = $6`,
    [split.grossAmount, split.subtotal, split.platformFee, split.hostCommission, split.hostPayout, existing.id]
  );

  notifyUser(
    existing.host_id,
    'Booking completed',
    `Session ended. You'll receive ₹${split.hostPayout} for this booking.`
  ).catch(() => {});

  res.json(rows[0]);
}

// Either side can cancel a reserved booking (not once it's active/completed).
// Cancelling flips status to 'cancelled', which frees the slot immediately
// since the exclusion constraint only applies WHERE status != 'cancelled'.
const extendSchema = z.object({
  additional_hours: z.number().positive().max(24),
});

// Extends an already-active session by pushing end_at further out. This
// reuses the exact same protection createBooking gets for free: the
// UPDATE below still has to satisfy the exclusion constraint from
// migration 004, so extending into a window someone else already has
// reserved on this listing fails with a clean 409 — there's no need to
// hand-roll a second conflict check here.
async function extendSession(req, res) {
  const parsed = extendSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);

  const { rows: existingRows } = await pool.query(
    `SELECT b.*, l.price_per_hour, l.host_id FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     WHERE b.id = $1 AND b.driver_id = $2 AND b.status = 'active'`,
    [req.params.id, req.user.id]
  );
  const existing = existingRows[0];
  if (!existing) throw new AppError(400, 'Booking not found or not active');

  const newEndAt = new Date(new Date(existing.end_at).getTime() + parsed.data.additional_hours * 60 * 60 * 1000);
  const totalHours = (newEndAt - new Date(existing.start_at)) / (1000 * 60 * 60);
  const newEstimatedCost = Math.round(totalHours * existing.price_per_hour * 100) / 100;

  const { rows } = await pool.query(
    `UPDATE bookings SET end_at = $1, estimated_cost = $2 WHERE id = $3 RETURNING *`,
    [newEndAt.toISOString(), newEstimatedCost, existing.id]
  );

  // Keep the payment's live estimate in sync too — endSession will still
  // true this up against actual elapsed time when the session finishes,
  // same as it always does.
  const split = computeSplit(newEstimatedCost);
  await pool.query(
    `UPDATE payments
     SET amount = $1, subtotal = $2, platform_fee = $3, host_commission = $4, host_payout = $5
     WHERE booking_id = $6`,
    [split.grossAmount, split.subtotal, split.platformFee, split.hostCommission, split.hostPayout, existing.id]
  );

  notifyUser(
    existing.host_id,
    'Booking extended',
    `A driver extended their session at your spot by ${parsed.data.additional_hours}h.`
  ).catch(() => {});

  res.json(rows[0]);
}

async function cancelBooking(req, res) {  const { rows } = await pool.query(
    `SELECT b.*, l.host_id, p.status AS payment_status
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN payments p ON p.booking_id = b.id
     WHERE b.id = $1 AND (b.driver_id = $2 OR l.host_id = $2) AND b.status = 'reserved'`,
    [req.params.id, req.user.id]
  );
  const booking = rows[0];
  if (!booking) throw new AppError(400, 'Booking not found or not cancellable');

  // A booking whose payment has already been marked paid needs a real
  // refund, which isn't built yet (no gateway is wired in for phase 1).
  // Blocking here is honest about that limitation instead of silently
  // cancelling a booking that was already charged for.
  if (booking.payment_status === 'paid') {
    throw new AppError(400, 'This booking has already been paid — contact support to cancel and refund it.');
  }

  const isHostCancelling = booking.host_id === req.user.id;
  // A host backing out isn't the driver's fault, so it's always free to
  // them — the fee (and the grace-period/before-start exemptions) only
  // apply when the driver is the one cancelling.
  const free = isHostCancelling || isCancellationFree({ createdAt: booking.created_at, startAt: booking.start_at });
  const fee = free ? 0 : computeCancellationFee(Number(booking.estimated_cost));

  const { rows: updated } = await pool.query(
    `UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING *`,
    [booking.id]
  );

  // The fee (if any) goes entirely to the host, no platform commission —
  // see the comment in config/fees.js for why. Status becomes 'refunded'
  // when there's nothing owed, or stays 'pending' at the reduced fee
  // amount when there is.
  await pool.query(
    `UPDATE payments
     SET amount = $1, subtotal = 0, platform_fee = 0, host_commission = 0, host_payout = $1,
         status = $2
     WHERE booking_id = $3`,
    [fee, fee > 0 ? 'pending' : 'refunded', booking.id]
  );

  const notifyTargetId = isHostCancelling ? booking.driver_id : booking.host_id;
  const notifyMessage = isHostCancelling
    ? 'The host cancelled your reserved booking. No charge.'
    : fee > 0
      ? `Booking cancelled. A ₹${fee} late-cancellation fee applies.`
      : 'A booking was cancelled — no fee, it was within the free cancellation window.';
  notifyUser(notifyTargetId, 'Booking cancelled', notifyMessage).catch(() => {});

  res.json({ ...updated[0], cancellation_fee: fee });
}

module.exports = { createBooking, myBookings, getBooking, startSession, endSession, extendSession, cancelBooking };
