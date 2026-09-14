const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

// Phase 1 stub: no real payment gateway yet. This lets the app mark a
// booking's payment as settled (e.g. cash on arrival, or a manual test)
// so the rest of the flow — receipts, host payout view — can be built
// against a real `paid` state before Razorpay is wired in.
//
// Phase 2: replace this with POST /payments/webhook verifying Razorpay's
// signature, and drop this manual endpoint (or restrict it to admin/testing).
async function getPayment(req, res) {
  const { rows } = await pool.query(
    `SELECT p.* FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN listings l ON l.id = b.listing_id
     WHERE p.booking_id = $1 AND (b.driver_id = $2 OR l.host_id = $2)`,
    [req.params.bookingId, req.user.id]
  );
  if (!rows[0]) throw new AppError(404, 'Payment not found');
  res.json(rows[0]);
}

async function markPaid(req, res) {
  const { rows: bookingRows } = await pool.query(
    `SELECT b.driver_id FROM bookings b WHERE b.id = $1`,
    [req.params.bookingId]
  );
  const booking = bookingRows[0];
  if (!booking) throw new AppError(404, 'Booking not found');
  if (booking.driver_id !== req.user.id) {
    throw new AppError(403, 'Only the driver can settle this payment');
  }

  const { rows } = await pool.query(
    `UPDATE payments SET status = 'paid', provider_ref = $1
     WHERE booking_id = $2 AND status = 'pending'
     RETURNING *`,
    [`manual-${Date.now()}`, req.params.bookingId]
  );
  if (!rows[0]) throw new AppError(400, 'Payment not found or not pending');

  res.json(rows[0]);
}

module.exports = { getPayment, markPaid };
