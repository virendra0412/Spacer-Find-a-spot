-- Tracks whether we've already sent a "your session is running long"
-- notification for a booking, so the scheduled job (see
-- src/jobs/sessionOverrun.job.js) doesn't re-notify every time it ticks.
-- NULL means "not yet sent" — the natural default, no backfill needed
-- for existing rows.
ALTER TABLE bookings ADD COLUMN overrun_notified_at TIMESTAMPTZ;
