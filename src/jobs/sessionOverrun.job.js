const cron = require('node-cron');
const { pool } = require('../config/db');
const { notifyUser } = require('../services/notification.service');

// Finds every 'active' booking whose planned end_at has already passed
// and we haven't yet notified about, notifies both the driver (nudge to
// wrap up) and the host (their listing is occupied longer than booked),
// then marks it so this doesn't fire again on the next tick.
//
// Deliberately does NOT auto-end the session or charge anything extra —
// that's still the driver's action via POST /bookings/:id/end. This job
// only closes the "driver has no idea time is up" notification gap;
// it doesn't make billing decisions.
async function checkOverrunSessions() {
  const { rows: overrun } = await pool.query(
    `SELECT b.id, b.driver_id, b.end_at, l.host_id, l.title AS listing_title
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     WHERE b.status = 'active'
       AND b.end_at < now()
       AND b.overrun_notified_at IS NULL`
  );

  for (const booking of overrun) {
    await notifyUser(
      booking.driver_id,
      'Your parking session is running long',
      `You booked "${booking.listing_title}" until ${new Date(booking.end_at).toLocaleTimeString()}. End your session when you're done to avoid confusion with the host.`
    ).catch(() => {});

    await notifyUser(
      booking.host_id,
      'A booking is running past its scheduled time',
      `A driver's booking at "${booking.listing_title}" is still active past its scheduled end time.`
    ).catch(() => {});

    // Marked even if a notifyUser call above failed — this job runs
    // frequently, so a transient push failure isn't worth retrying by
    // spamming the same overrun on every subsequent tick.
    await pool.query('UPDATE bookings SET overrun_notified_at = now() WHERE id = $1', [booking.id]);
  }

  return overrun.length;
}

// Runs every 5 minutes. Not scheduled for immediate execution here —
// call start() from server.js only, so importing this module (e.g. from
// a future test file) doesn't silently start a background timer.
function start() {
  cron.schedule('*/5 * * * *', () => {
    checkOverrunSessions().catch((err) => {
      console.error('[sessionOverrun job] failed:', err);
    });
  });
  console.log('Session overrun job scheduled (every 5 minutes).');
}

module.exports = { start, checkOverrunSessions };
