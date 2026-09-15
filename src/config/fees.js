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

module.exports = {
  computeSplit,
  PLATFORM_FEE_FLAT,
  PLATFORM_FEE_PERCENT,
  HOST_COMMISSION_PERCENT,
};
