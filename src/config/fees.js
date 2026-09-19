// Centralizes the platform's fee model so booking creation, session end,
// and host earnings all compute the same numbers the same way — this
// file is the only place the formula lives.
//
// NOTE: these default rates are placeholders to make the split
// mechanism real and testable, not a business decision. Confirm actual
// numbers with whoever owns pricing before charging real money — a
// flat ₹3 or 2% fee (whichever is larger) on a ₹20 booking is a
// reasonable starting shape, but the exact figures need a real call.
//
// Rates are env-configurable so they can change without a code deploy,
// but there's no admin UI for this yet — changing them means editing
// the environment and restarting the server. Every payment stores the
// rates that produced it (see bookings.controller.js), so changing
// these going forward never rewrites the numbers on past bookings.
const PLATFORM_FEE_FLAT = Number(process.env.PLATFORM_FEE_FLAT ?? 3);
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT ?? 2) / 100;
const HOST_COMMISSION_PERCENT = Number(process.env.HOST_COMMISSION_PERCENT ?? 10) / 100;

// Cancellation policy: free within a short grace period after booking
// (so a mis-tap or change of mind costs nothing), and free any time up
// until shortly before the reserved start — the host hasn't lost
// anything from a cancellation that far out. Cancelling late (after the
// grace period, close to start time) charges a fee that goes entirely
// to the host as compensation for holding the slot — the platform takes
// no commission on it, since no parking actually happened.
const FREE_CANCELLATION_WINDOW_MINUTES = Number(process.env.FREE_CANCELLATION_WINDOW_MINUTES ?? 10);
const FREE_CANCELLATION_BEFORE_START_HOURS = Number(process.env.FREE_CANCELLATION_BEFORE_START_HOURS ?? 1);
const CANCELLATION_FEE_PERCENT = Number(process.env.CANCELLATION_FEE_PERCENT ?? 20) / 100;
const CANCELLATION_FEE_MIN = Number(process.env.CANCELLATION_FEE_MIN ?? 5);

function round2(n) {
  return Math.round(n * 100) / 100;
}

// subtotal = the actual parking cost (hours × price_per_hour) — what
// the booking is "worth" before any platform economics touch it.
function computeSplit(subtotal) {
  const platformFee = round2(Math.max(PLATFORM_FEE_FLAT, subtotal * PLATFORM_FEE_PERCENT));
  const hostCommission = round2(subtotal * HOST_COMMISSION_PERCENT);
  return {
    subtotal: round2(subtotal),
    platformFee,
    hostCommission,
    grossAmount: round2(subtotal + platformFee), // what the driver pays
    hostPayout: round2(subtotal - hostCommission), // what the host receives
  };
}

// True if cancelling right now costs nothing — either it's soon after
// booking (grace period) or the reserved start is still far enough away
// that the host hasn't effectively lost the slot.
function isCancellationFree({ createdAt, startAt, now = new Date() }) {
  const minutesSinceBooked = (now - new Date(createdAt)) / 60000;
  if (minutesSinceBooked <= FREE_CANCELLATION_WINDOW_MINUTES) return true;

  const hoursUntilStart = (new Date(startAt) - now) / 3600000;
  if (hoursUntilStart >= FREE_CANCELLATION_BEFORE_START_HOURS) return true;

  return false;
}

function computeCancellationFee(subtotal) {
  return round2(Math.max(CANCELLATION_FEE_MIN, subtotal * CANCELLATION_FEE_PERCENT));
}

module.exports = {
  computeSplit,
  PLATFORM_FEE_FLAT,
  PLATFORM_FEE_PERCENT,
  HOST_COMMISSION_PERCENT,
  FREE_CANCELLATION_WINDOW_MINUTES,
  FREE_CANCELLATION_BEFORE_START_HOURS,
  CANCELLATION_FEE_PERCENT,
  CANCELLATION_FEE_MIN,
  isCancellationFree,
  computeCancellationFee,
};
