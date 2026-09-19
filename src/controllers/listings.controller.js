const { z } = require('zod');
const { pool } = require('../config/db');
const { AppError } = require('../utils/AppError');

const createListingSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  address_text: z.string().optional(),
  vehicle_type: z.enum(['2w', '4w', '6w', 'any']).default('any'),
  covered: z.boolean().default(false),
  has_cctv: z.boolean().default(false),
  price_per_hour: z.number().positive(),
  price_flat_night: z.number().positive().optional(),
});

async function createListing(req, res) {
  const parsed = createListingSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const d = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO listings
       (host_id, title, description, location, address_text, vehicle_type,
        covered, has_cctv, price_per_hour, price_flat_night)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
             $6, $7, $8, $9, $10, $11)
     RETURNING id, title, description, address_text, vehicle_type, covered,
               has_cctv, price_per_hour, price_flat_night, status, created_at`,
    [
      req.user.id, d.title, d.description || null, d.lng, d.lat,
      d.address_text || null, d.vehicle_type, d.covered, d.has_cctv,
      d.price_per_hour, d.price_flat_night || null,
    ]
  );

  res.status(201).json(rows[0]);
}

// Partial update — every field optional. Lat/lng must be provided together
// since they're stored as a single geography point.
const updateListingSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address_text: z.string().optional(),
  vehicle_type: z.enum(['2w', '4w', '6w', 'any']).optional(),
  covered: z.boolean().optional(),
  has_cctv: z.boolean().optional(),
  price_per_hour: z.number().positive().optional(),
  price_flat_night: z.number().positive().nullable().optional(),
  status: z.enum(['active', 'paused', 'removed']).optional(),
}).refine((d) => (d.lat === undefined) === (d.lng === undefined), {
  message: 'lat and lng must be provided together',
});

async function updateListing(req, res) {
  const parsed = updateListingSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const d = parsed.data;

  const listing = await getOwnedListingOr404(req.params.id, req.user.id);

  // A listing an admin has removed can only come back via an admin
  // action (PATCH /admin/listings/:id/status) — otherwise moderation
  // is pointless, since the host could just PATCH status back to
  // 'active' themselves the moment it's taken down. Editing other
  // fields on a removed listing is blocked too, not just status, so a
  // host can't dress up a moderated listing and reintroduce it later.
  if (listing.status === 'removed') {
    throw new AppError(403, 'This listing was removed by an admin and can no longer be edited. Contact support.');
  }

  const fields = [];
  const values = [];
  let i = 1;

  const simpleColumns = [
    'title', 'description', 'address_text', 'vehicle_type',
    'covered', 'has_cctv', 'price_per_hour', 'price_flat_night', 'status',
  ];
  for (const col of simpleColumns) {
    if (d[col] !== undefined) {
      fields.push(`${col} = $${i++}`);
      values.push(d[col]);
    }
  }
  if (d.lat !== undefined && d.lng !== undefined) {
    fields.push(`location = ST_SetSRID(ST_MakePoint($${i++}, $${i++}), 4326)::geography`);
    values.push(d.lng, d.lat);
  }

  if (fields.length === 0) throw new AppError(400, 'No fields to update');

  values.push(listing.id);
  // Select columns explicitly (as createListing does) instead of RETURNING *
  // — the raw `location` column comes back as PostGIS WKB hex, which is
  // useless to the client and would silently break anything trying to
  // redisplay a listing right after editing it.
  const { rows } = await pool.query(
    `UPDATE listings SET ${fields.join(', ')}
     WHERE id = $${i}
     RETURNING id, host_id, title, description, address_text, vehicle_type,
               covered, has_cctv, price_per_hour, price_flat_night, status, created_at,
               ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng`,
    values
  );

  res.json(rows[0]);
}

const availabilitySchema = z.object({
  slots: z.array(z.object({
    day_of_week: z.number().min(0).max(6).optional(),
    specific_date: z.string().optional(), // 'YYYY-MM-DD'
    start_time: z.string(), // 'HH:MM'
    end_time: z.string(),
    is_available: z.boolean().default(true),
  })).min(1),
});

async function setAvailability(req, res) {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);

  const listing = await getOwnedListingOr404(req.params.id, req.user.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Replace the whole weekly schedule in one call — simplest mental
    // model for a host editing "when am I open."
    await client.query('DELETE FROM availability_slots WHERE listing_id = $1', [listing.id]);
    for (const s of parsed.data.slots) {
      await client.query(
        `INSERT INTO availability_slots
           (listing_id, day_of_week, specific_date, start_time, end_time, is_available)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [listing.id, s.day_of_week ?? null, s.specific_date ?? null, s.start_time, s.end_time, s.is_available]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.status(204).send();
}

async function getOwnedListingOr404(listingId, hostId) {
  const { rows } = await pool.query(
    'SELECT * FROM listings WHERE id = $1 AND host_id = $2',
    [listingId, hostId]
  );
  if (!rows[0]) throw new AppError(404, 'Listing not found');
  return rows[0];
}

async function myListings(req, res) {
  const { rows } = await pool.query(
    `SELECT l.id, l.host_id, l.title, l.description, l.address_text, l.vehicle_type,
            l.covered, l.has_cctv, l.price_per_hour, l.price_flat_night, l.status, l.created_at,
            ST_Y(l.location::geometry) AS lat, ST_X(l.location::geometry) AS lng,
            COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed_bookings,
            COUNT(DISTINCT b.driver_id) FILTER (WHERE b.status = 'completed') AS unique_customers,
            COALESCE(SUM(p.host_payout) FILTER (WHERE b.status = 'completed'), 0) AS total_earned,
            (SELECT p2.url FROM listing_photos p2 WHERE p2.listing_id = l.id
               ORDER BY p2.sort_order LIMIT 1) AS cover_photo_url
     FROM listings l
     LEFT JOIN bookings b ON b.listing_id = l.id
     LEFT JOIN payments p ON p.booking_id = b.id
     WHERE l.host_id = $1
     GROUP BY l.id
     ORDER BY l.created_at DESC`,
    [req.user.id]
  );

  // Aggregated in JS rather than a second query — every number the
  // summary needs is already sitting in `rows` from the query above.
  const summary = rows.reduce(
    (acc, r) => ({
      total_earned: acc.total_earned + Number(r.total_earned),
      total_completed_bookings: acc.total_completed_bookings + Number(r.completed_bookings),
      total_listings: acc.total_listings + 1,
    }),
    { total_earned: 0, total_completed_bookings: 0, total_listings: 0 }
  );

  res.json({ summary, listings: rows });
}

// Search: nearby listings, optionally filtered to "available right now"
// and/or to listings that fit a given vehicle type.
// "Available now" = there's an availability_slot covering the current
// weekday+time, AND no active/reserved booking currently overlapping.
const searchSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radius_km: z.coerce.number().default(3),
  available_now: z.coerce.boolean().optional(),
  vehicle_type: z.enum(['2w', '4w', '6w']).optional(),
  max_price: z.coerce.number().positive().optional(),
  covered: z.coerce.boolean().optional(),
  sort_by: z.enum(['distance', 'price_asc', 'price_desc']).default('distance'),
});

async function search(req, res) {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { lat, lng, radius_km, available_now, vehicle_type, max_price, covered, sort_by } = parsed.data;

  const params = [lng, lat, radius_km * 1000];
  let availabilityClause = '';
  let vehicleClause = '';
  let priceClause = '';
  let coveredClause = '';

  if (available_now) {
    availabilityClause = `
      AND EXISTS (
        SELECT 1 FROM availability_slots a
        WHERE a.listing_id = l.id
          AND a.is_available = true
          AND (
            a.day_of_week = EXTRACT(DOW FROM now())::int
            OR a.specific_date = CURRENT_DATE
          )
          AND now()::time BETWEEN a.start_time AND a.end_time
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.listing_id = l.id
          AND b.status IN ('reserved', 'active')
          AND tstzrange(b.start_at, b.end_at) @> now()
      )
    `;
  }

  if (vehicle_type) {
    // A listing marked 'any' fits every vehicle type; otherwise it must
    // match exactly — a 2w spot doesn't fit a 4w car and vice versa.
    params.push(vehicle_type);
    vehicleClause = ` AND (l.vehicle_type = 'any' OR l.vehicle_type = $${params.length})`;
  }

  if (max_price !== undefined) {
    params.push(max_price);
    priceClause = ` AND l.price_per_hour <= $${params.length}`;
  }

  if (covered) {
    coveredClause = ' AND l.covered = true';
  }

  const orderBy = {
    distance: 'distance_m ASC',
    price_asc: 'l.price_per_hour ASC, distance_m ASC',
    price_desc: 'l.price_per_hour DESC, distance_m ASC',
  }[sort_by];

  const { rows } = await pool.query(
    `SELECT l.id, l.title, l.address_text, l.vehicle_type, l.covered, l.has_cctv,
            l.price_per_hour, l.price_flat_night,
            ST_Distance(l.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
            (SELECT p.url FROM listing_photos p WHERE p.listing_id = l.id
               ORDER BY p.sort_order LIMIT 1) AS cover_photo_url
     FROM listings l
     WHERE l.status = 'active'
       AND ST_DWithin(l.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
       ${availabilityClause}
       ${vehicleClause}
       ${priceClause}
       ${coveredClause}
     ORDER BY ${orderBy}
     LIMIT 50`,
    params
  );

  res.json(rows);
}

async function getListing(req, res) {
  const { rows } = await pool.query(
    `SELECT l.id, l.host_id, l.title, l.description, l.address_text, l.vehicle_type,
            l.covered, l.has_cctv, l.price_per_hour, l.price_flat_night, l.status, l.created_at,
            ST_Y(l.location::geometry) AS lat, ST_X(l.location::geometry) AS lng,
            u.name AS host_name, u.rating_avg AS host_rating,
            COALESCE(
              (SELECT json_agg(json_build_object('id', p.id, 'url', p.url) ORDER BY p.sort_order)
               FROM listing_photos p WHERE p.listing_id = l.id),
              '[]'
            ) AS photos
     FROM listings l JOIN users u ON u.id = l.host_id
     WHERE l.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new AppError(404, 'Listing not found');
  res.json(rows[0]);
}

module.exports = {
  createListing, updateListing, setAvailability, myListings, search, getListing,
};
