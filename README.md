# Spacer Backend (MVP)

Peer-to-peer parking marketplace backend. Node.js + Express + PostgreSQL/PostGIS.
Every endpoint below has been run against a real Postgres+PostGIS instance and verified working, including the exclusion-constraint conflict check, cancel/rebook, session lifecycle, payment stub, and reviews.

## Quick start

```bash
# 1. Start Postgres+PostGIS locally
docker compose up -d

# 2. Install deps
npm install

# 3. Configure env
cp .env.example .env
# edit .env if you changed docker-compose credentials or ports

# 4. Run migrations
npm run migrate

# 5. Start the server
npm run dev      # with nodemon
# or
npm start
```

Health check: `GET http://localhost:4000/health` → `{"ok": true}`

## Project layout

```
src/
  config/db.js              Postgres pool
  middleware/auth.js         JWT verification (req.user)
  middleware/errorHandler.js Central error → HTTP status mapping
  controllers/                One file per resource, thin & explicit
  routes/                     Express routers, wired in app.js
  services/notification.service.js  Expo push, fire-and-forget
  utils/                      AppError, asyncHandler, jwt helpers
migrations/                   Plain numbered .sql files + a tiny runner
  migrate.js                  `node migrations/migrate.js up`
```

No ORM. Raw SQL via `pg`, migrations tracked in a `schema_migrations` table.
This is a deliberate choice for an MVP: fewer abstractions between you and
what the database is actually doing, especially around the exclusion
constraint that makes double-booking impossible.

## The core guarantee

`bookings` has a Postgres `EXCLUDE USING gist` constraint on
`(listing_id, tstzrange(start_at, end_at))`. Two overlapping, non-cancelled
bookings for the same listing cannot both exist — the database itself
rejects the second insert with error code `23P01`, which `errorHandler.js`
turns into a clean `409`. This is race-condition-proof in a way a
"check then insert" application-level guard is not.

## API reference

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | `{ name, phone, password, email? }` → user + tokens |
| POST | `/auth/login` | `{ phone, password }` → user + tokens |
| POST | `/auth/refresh` | `{ refreshToken }` → new access token |

### Listings
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/listings` | host | create a listing |
| PATCH | `/listings/:id` | host (owner) | partial update |
| POST | `/listings/:id/availability` | host (owner) | replace weekly schedule |
| GET | `/listings/mine` | host | own listings + completed-booking counts |
| GET | `/listings/search?lat=&lng=&radius_km=&available_now=` | — | nearby search |
| GET | `/listings/:id` | — | listing detail |
| GET | `/listings/:id/reviews` | — | reviews for a listing |

### Bookings
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/bookings` | driver | `{ listing_id, start_at, end_at }` → 409 on overlap |
| GET | `/bookings/:id` | driver or host | |
| POST | `/bookings/:id/start` | driver | reserved → active |
| POST | `/bookings/:id/end` | driver | active → completed, computes `final_cost` |
| POST | `/bookings/:id/cancel` | driver or host | only while `reserved`; frees the slot |
| POST | `/bookings/:id/review` | driver or host | only once, only after `completed` |

### Payments (Phase 1 stub — see below)
| Method | Path | Notes |
|---|---|---|
| GET | `/payments/:bookingId` | view payment status |
| POST | `/payments/:bookingId/mark-paid` | driver manually settles (stand-in for a real gateway) |

### Devices
| Method | Path | Notes |
|---|---|---|
| POST | `/devices` | register/refresh an Expo push token |

## Cloudinary media storage

Listing photos and identity-verification images are uploaded by the backend
to Cloudinary. Set these server-only variables in `.env`:

```text
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Run `npm run migrate` before starting the server. New listings remain paused
until their first photo upload succeeds. Identity submissions are reviewed
from the admin app and store only Cloudinary URLs and public IDs in Postgres.

## What's stubbed for Phase 2

- **Payments**: `POST /payments/:bookingId/mark-paid` is still a manual stand-in.
  Replace it with a real Razorpay order and signature-verified webhook.
- **Push delivery tracking**: push failures are swallowed so notifications
  cannot break booking flows; delivery receipts are not stored yet.

## Known gaps to close before this is production-grade

- No automated Jest/Supertest suite or CI pipeline yet.
- No pagination on `/listings/mine`.
- `rating_avg` recompute in `reviews.controller.js` runs a full aggregate
  query on every review; fine at MVP scale, revisit with larger volume.
- Refresh-token rotation and revocation are implemented, but old sessions
  must log in again after the first migration.
