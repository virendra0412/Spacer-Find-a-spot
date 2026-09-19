CREATE TYPE dispute_category AS ENUM (
  'no_show_host', 'no_show_driver', 'spot_occupied', 'payment_issue', 'damage', 'other'
);
CREATE TYPE dispute_status AS ENUM ('open', 'resolved', 'dismissed');

CREATE TABLE disputes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  raised_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category         dispute_category NOT NULL,
  description      TEXT,
  status           dispute_status NOT NULL DEFAULT 'open',
  resolution_note  TEXT,
  resolved_by      UUID REFERENCES users(id),
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_disputes_booking ON disputes (booking_id);
CREATE INDEX idx_disputes_status ON disputes (status);
