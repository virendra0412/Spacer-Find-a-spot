CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE booking_status AS ENUM ('reserved', 'active', 'completed', 'cancelled');

CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  driver_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at        TIMESTAMPTZ NOT NULL,
  -- while a booking is 'reserved' or 'active' we still need an end boundary
  -- for the exclusion constraint, so it defaults to a provisional value
  -- and is overwritten with the real end time when the session closes.
  end_at          TIMESTAMPTZ NOT NULL,
  status          booking_status NOT NULL DEFAULT 'reserved',
  estimated_cost  NUMERIC(10,2) NOT NULL,
  final_cost      NUMERIC(10,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- THE CORE GUARANTEE: no two non-cancelled bookings for the same listing
  -- can have overlapping time ranges. This is enforced by Postgres itself,
  -- not by application code — a race condition cannot slip through it.
  EXCLUDE USING gist (
    listing_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status != 'cancelled')
);

CREATE INDEX idx_bookings_listing ON bookings (listing_id);
CREATE INDEX idx_bookings_driver ON bookings (driver_id);
