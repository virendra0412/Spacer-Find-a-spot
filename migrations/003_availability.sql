CREATE TABLE availability_slots (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id     UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  day_of_week    INT CHECK (day_of_week BETWEEN 0 AND 6), -- null when specific_date is set
  specific_date  DATE,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  is_available   BOOLEAN NOT NULL DEFAULT true,
  CHECK (day_of_week IS NOT NULL OR specific_date IS NOT NULL)
);

CREATE INDEX idx_availability_listing ON availability_slots (listing_id);
