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

## What's stubbed for Phase 2

- **Payments**: `POST /payments/:bookingId/mark-paid` is a manual stand-in.
  Replace with a real Razorpay order + signature-verified webhook, and
  either remove this endpoint or lock it behind an admin/test flag.
- **Push notifications**: fires to Expo's push endpoint if a device token
  exists; failures are swallowed (`.catch(() => {})`) so a bad push never
  breaks a booking. No delivery tracking yet.
- **Sessions "about to exceed expected time"** notification (mentioned in
  the plan) isn't implemented — needs a scheduled job (e.g. a cron hitting
  bookings where `now() > start_at + expected_duration`), not a request-cycle
  concern.

## Known gaps to close before this is production-grade

- No test suite yet (the flows above were verified manually via curl —
  worth turning into a Jest/Supertest suite against a test database).
- No pagination on `/listings/mine` or `/listings/:id/reviews`.
- `rating_avg` recompute in `reviews.controller.js` runs a full aggregate
  query on every review — fine at MVP scale, revisit if review volume grows.
- Rate limiting is only on `/auth/*`; consider it for `/bookings` too once
  you have real traffic patterns to tune against.
- No refresh-token revocation/rotation — a leaked refresh token is valid
  until it expires (30d default). Fine for MVP, not for a mature product.
