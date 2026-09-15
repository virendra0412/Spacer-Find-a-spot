-- Replaces the sedan/hatchback/suv classification with 2w/4w/6w. This is
-- a better fit for a parking marketplace: what determines whether a spot
-- fits a vehicle is its footprint (two-wheeler vs car vs truck/tempo),
-- not the car's body style — a hatchback and an SUV need the same spot.
CREATE TYPE vehicle_class AS ENUM ('2w', '4w', '6w', 'any');

ALTER TABLE listings ALTER COLUMN vehicle_size DROP DEFAULT;

ALTER TABLE listings ALTER COLUMN vehicle_size TYPE vehicle_class
  USING (
    CASE vehicle_size::text
      WHEN 'hatchback' THEN '4w'
      WHEN 'sedan' THEN '4w'
      WHEN 'suv' THEN '4w'
      ELSE 'any'
    END
  )::vehicle_class;

ALTER TABLE listings ALTER COLUMN vehicle_size SET DEFAULT 'any';
ALTER TABLE listings RENAME COLUMN vehicle_size TO vehicle_type;
DROP TYPE vehicle_size;

-- Listing photos — one-to-many so a host can add more than one angle
-- later, even though v1 only requires/uploads a single cover photo.
CREATE TABLE listing_photos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_listing_photos_listing ON listing_photos (listing_id);
