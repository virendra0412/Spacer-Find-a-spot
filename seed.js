/**
 * Seed script — fills the database with realistic dummy data so you can
 * test the app immediately without manually signing up users and
 * creating listings through the API.
 *
 * Usage:
 *   node seed.js
 *
 * Safe to re-run: it deletes any previous seed data (matched by the
 * reserved 9999000xxx phone numbers below) before reinserting, so running
 * it twice won't leave duplicates.
 *
 * Requires the same DATABASE_URL as the rest of the app (reads from .env)
 * and assumes migrations have already been run (`npm run migrate`).
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Reserved phone-number range for seed data — never used by real signups,
// which makes this script's cleanup step safe and idempotent.
const SEED_PHONES = [
  '9999000001', '9999000002', '9999000003', // hosts
  '9999000011', '9999000012',               // drivers
];

async function createUser(client, passwordHash, { name, phone, email }) {
  const { rows } = await client.query(
    `INSERT INTO users (name, phone, email, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, phone, email, passwordHash]
  );
  return rows[0].id;
}

async function createListing(client, hostId, opts) {
  const { rows } = await client.query(
    `INSERT INTO listings
       (host_id, title, description, location, address_text, vehicle_size,
        covered, has_cctv, price_per_hour, price_flat_night)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
             $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      hostId, opts.title, opts.description || null, opts.lng, opts.lat,
      opts.address, opts.vehicleSize || 'any', opts.covered || false,
      opts.cctv || false, opts.price, opts.flatNight || null,
    ]
  );
  return rows[0].id;
}

async function addDailySlot(client, listingId, day, start, end) {
  await client.query(
    `INSERT INTO availability_slots (listing_id, day_of_week, start_time, end_time, is_available)
     VALUES ($1, $2, $3, $4, true)`,
    [listingId, day, start, end]
  );
}

async function createBooking(client, { listingId, driverId, startAt, endAt, status, pricePerHour }) {
  const hours = (endAt - startAt) / (1000 * 60 * 60);
  const estimatedCost = Math.round(hours * pricePerHour * 100) / 100;
  const finalCost = status === 'completed' ? estimatedCost : null;

  const { rows } = await client.query(
    `INSERT INTO bookings (listing_id, driver_id, start_at, end_at, status, estimated_cost, final_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [listingId, driverId, startAt.toISOString(), endAt.toISOString(), status, estimatedCost, finalCost]
  );
  const bookingId = rows[0].id;

  await client.query(
    `INSERT INTO payments (booking_id, amount, status) VALUES ($1, $2, $3)`,
    [bookingId, finalCost ?? estimatedCost, status === 'completed' ? 'paid' : 'pending']
  );

  return bookingId;
}

async function main() {
  console.log('Seeding Spacer dev data...\n');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Cascades to listings, bookings, payments, reviews, devices for
    // these users — safe to run this script repeatedly.
    await client.query('DELETE FROM users WHERE phone = ANY($1)', [SEED_PHONES]);

    const passwordHash = await bcrypt.hash('password123', 12);

    const hostAshok = await createUser(client, passwordHash, {
      name: 'Ashok Patel', phone: '9999000001', email: 'ashok@example.com',
    });
    const hostPriya = await createUser(client, passwordHash, {
      name: 'Priya Shah', phone: '9999000002', email: 'priya@example.com',
    });
    const hostRahul = await createUser(client, passwordHash, {
      name: 'Rahul Mehta', phone: '9999000003', email: 'rahul@example.com',
    });
    const driverMihir = await createUser(client, passwordHash, {
      name: 'Mihir Joshi', phone: '9999000011', email: 'mihir@example.com',
    });
    const driverNeha = await createUser(client, passwordHash, {
      name: 'Neha Kulkarni', phone: '9999000012', email: 'neha@example.com',
    });

    // Four listings spread around a small area (Ahmedabad — CG Road /
    // Navrangpura / Riverfront) so a "search nearby" query returns
    // multiple results with varied distances.
    const listing1 = await createListing(client, hostAshok, {
      title: 'Shivam Corporate Park - B2',
      description: 'Secure basement parking, empty after 6pm on weekdays.',
      lat: 23.0225, lng: 72.5714, address: 'CG Road, Ahmedabad',
      vehicleSize: 'any', covered: true, cctv: true, price: 15, flatNight: 80,
    });
    const listing2 = await createListing(client, hostAshok, {
      title: 'Shivam Corporate Park - Rooftop',
      description: 'Open rooftop parking, best for smaller cars.',
      lat: 23.0231, lng: 72.5720, address: 'CG Road, Ahmedabad',
      vehicleSize: 'hatchback', covered: false, cctv: false, price: 10,
    });
    const listing3 = await createListing(client, hostPriya, {
      title: 'Ambar Apartments B-Wing Driveway',
      description: 'Private driveway, free during work hours.',
      lat: 23.0300, lng: 72.5650, address: 'Navrangpura, Ahmedabad',
      vehicleSize: 'sedan', covered: false, cctv: false, price: 12,
    });
    const listing4 = await createListing(client, hostRahul, {
      title: 'Hotel Riverside Basement',
      description: 'CCTV monitored, covered, close to the riverfront.',
      lat: 23.0180, lng: 72.5800, address: 'Riverfront Road, Ahmedabad',
      vehicleSize: 'suv', covered: true, cctv: true, price: 20, flatNight: 120,
    });

    // Availability: listing1 mimics the real use case (open evenings +
    // overnight on weekdays, open all day on weekends). The rest are
    // simply open all day, every day, to keep "available_now" search
    // results non-empty no matter when you test.
    for (const day of [1, 2, 3, 4, 5]) {
      await addDailySlot(client, listing1, day, '18:00', '23:59');
      await addDailySlot(client, listing1, day, '00:00', '08:00');
    }
    for (const day of [0, 6]) {
      await addDailySlot(client, listing1, day, '00:00', '23:59');
    }
    for (const listingId of [listing2, listing3, listing4]) {
      for (let day = 0; day < 7; day++) {
        await addDailySlot(client, listingId, day, '00:00', '23:59');
      }
    }

    // One completed booking + review, so ListingDetail/host rating have
    // real data to display.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const completedBooking = await createBooking(client, {
      listingId: listing1,
      driverId: driverMihir,
      startAt: new Date(yesterday.getTime() - 2 * 60 * 60 * 1000),
      endAt: yesterday,
      status: 'completed',
      pricePerHour: 15,
    });
    await client.query(
      `INSERT INTO reviews (booking_id, author_id, rating, comment) VALUES ($1, $2, $3, $4)`,
      [completedBooking, driverMihir, 5, 'Easy access, exactly as described.']
    );
    await client.query(`UPDATE users SET rating_avg = 5.0 WHERE id = $1`, [hostAshok]);

    // One "reserved" booking starting now, so the active-session screen
    // has something to show without you needing to book one by hand.
    const now = new Date();
    const reservedEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const reservedBookingId = await createBooking(client, {
      listingId: listing3,
      driverId: driverNeha,
      startAt: now,
      endAt: reservedEnd,
      status: 'reserved',
      pricePerHour: 12,
    });

    await client.query('COMMIT');

    console.log('Seed complete.\n');
    console.log('Listings created:');
    console.log(`  ${listing1}  Shivam Corporate Park - B2      (₹15/hr, host: Ashok)`);
    console.log(`  ${listing2}  Shivam Corporate Park - Rooftop (₹10/hr, host: Ashok)`);
    console.log(`  ${listing3}  Ambar Apartments B-Wing         (₹12/hr, host: Priya)`);
    console.log(`  ${listing4}  Hotel Riverside Basement        (₹20/hr, host: Rahul)`);
    console.log(`\nReserved booking (for testing the active-session screen): ${reservedBookingId}`);
    console.log('\nTest accounts — all use password: password123');
    console.log('  Host    Ashok Patel     phone 9999000001');
    console.log('  Host    Priya Shah      phone 9999000002');
    console.log('  Host    Rahul Mehta     phone 9999000003');
    console.log('  Driver  Mihir Joshi     phone 9999000011');
    console.log('  Driver  Neha Kulkarni   phone 9999000012');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
