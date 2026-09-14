CREATE TYPE vehicle_size AS ENUM ('hatchback', 'sedan', 'suv', 'any');
CREATE TYPE listing_status AS ENUM ('active', 'paused', 'removed');

CREATE TABLE listings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  location         GEOGRAPHY(Point, 4326) NOT NULL,
  address_text     TEXT,
  vehicle_size     vehicle_size NOT NULL DEFAULT 'any',
  covered          BOOLEAN NOT NULL DEFAULT false,
  has_cctv         BOOLEAN NOT NULL DEFAULT false,
  price_per_hour   NUMERIC(10,2) NOT NULL,
  price_flat_night NUMERIC(10,2),
  status           listing_status NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Geospatial index — this is what makes "spots near me" fast
CREATE INDEX idx_listings_location ON listings USING GIST (location);
CREATE INDEX idx_listings_host ON listings (host_id);
