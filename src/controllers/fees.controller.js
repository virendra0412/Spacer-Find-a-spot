const { PLATFORM_FEE_FLAT, PLATFORM_FEE_PERCENT, HOST_COMMISSION_PERCENT, computeSplit } = require('../config/fees');

// Public and read-only — lets the app show "you'll pay ₹X" before
// booking without hardcoding a second copy of the fee formula on the
// client that could silently drift from what the server actually
// charges. host_commission_percent is included too since it's not
// sensitive — it's the same transparency a host sees on their own
// earnings.
function getCurrentFees(req, res) {
  res.json({
    platform_fee_flat: PLATFORM_FEE_FLAT,
    platform_fee_percent: PLATFORM_FEE_PERCENT,
    host_commission_percent: HOST_COMMISSION_PERCENT,
  });
}

function estimate(req, res) {
  const subtotal = Number(req.query.subtotal);
  if (!subtotal || subtotal <= 0) {
    return res.status(400).json({ error: 'subtotal must be a positive number' });
  }
  res.json(computeSplit(subtotal));
}

module.exports = { getCurrentFees, estimate };
