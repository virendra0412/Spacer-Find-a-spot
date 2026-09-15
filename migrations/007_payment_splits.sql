-- A single `amount` column can't answer "how much did the platform
-- make," "what does this host get paid," or survive an audit — those
-- all need the split stored as real columns, not recomputed later from
-- a fee percentage that may have since changed.
ALTER TABLE payments
  ADD COLUMN subtotal        NUMERIC(10,2),
  ADD COLUMN platform_fee    NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN host_commission NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN host_payout     NUMERIC(10,2);

-- Backfill existing rows: no fee model applied retroactively to
-- bookings made before this migration — they keep whatever `amount`
-- they already had, with the platform having earned nothing on them.
UPDATE payments
SET subtotal = amount, host_payout = amount
WHERE subtotal IS NULL;
