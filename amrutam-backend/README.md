# Amrutam Backend

Telemedicine REST API built with Node.js, Express, and PostgreSQL. Patients can register, log in, discover approved doctors, book appointments, view bookings, and cancel eligible appointments. Doctors can maintain profiles and availability.

## Setup

1. Install Node.js 20+ and PostgreSQL 15+.
2. From `amrutam-backend`, run `npm ci`.
3. Create a local database and copy `.env.example` to `.env`. Set `DATABASE_URL` and a random `JWT_SECRET` of at least 32 characters. Never commit `.env`.
4. Run `npm run migrate` to apply pending migrations 001–004. The runner tracks migrations and recognizes previously applied manual migrations. Review SQL before applying it to an existing environment.
5. Run `npm run dev` (development) or `npm start`.

`JWT_EXPIRES_IN` defaults to `15m`, with a maximum of `24h`. Health is at `/api/v1/health`; database readiness is at `/api/v1/health/ready`.

## API

All paths use `/api/v1`. See `../API_CONTRACT.md` for schemas and errors.

| Group | Routes |
|---|---|
| Authentication | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Doctor discovery | `GET /doctors`, `GET /doctors/:doctorId` |
| Doctor profile | `PATCH /doctors/me` |
| Availability | `GET /doctors/:doctorId/slots`, `POST /doctors/me/slots`, `PATCH /doctors/me/slots/:slotId`, `DELETE /doctors/me/slots/:slotId` |
| Bookings | `POST /bookings`, `GET /bookings/me`, `GET /bookings/:bookingId`, `POST /bookings/:bookingId/cancel` |

Protected requests use `Authorization: Bearer <token>`. Registration allows only patient/doctor roles; it does not issue a token. Doctors create their profile with `PATCH /doctors/me`, supplying `fullName` and `specialty`. New profiles are pending; approval requires a controlled administrative database process. There is no public approval endpoint.

Booking requires a patient token and `{ "slotId": "uuid" }`. An optional `Idempotency-Key` (1–200 characters after trimming) makes retries safe. Keys are scoped to the patient and retained with the consultation; do not reuse a key for a new appointment. Identical retries return the original creation representation even after cancellation; fetch the booking to read its current status. Without a key, duplicate booking attempts return a slot conflict.

Cancellation permits the owning patient, assigned doctor, or admin, and only scheduled bookings. Future slots become available; elapsed slots become unavailable. A repeated cancellation returns `409`. Migration 004 permits rebooking a cancelled slot without deleting consultation history. Referenced slot timings cannot be edited; create a new slot for different times.

## Tests

- `npm test`: 100 regression tests; database calls are mocked. Test-only configuration is supplied automatically, so `.env` is not required.
- `npm run test:integration`: 12 tests against real PostgreSQL, including competing bookings, concurrent idempotency, cancellation/rebooking, authorization, audit-failure rollback, precise pagination, slot overlap races, and migration reconciliation.

The integration runner uses local `TEST_ADMIN_DATABASE_URL`, or local development `DATABASE_URL` from `.env`, to create a uniquely named disposable database. The database role must have `CREATEDB` permission. It applies all migrations to that database, runs tests, and drops only the database it created. Existing application data is never used as fixtures. Remote servers and `NODE_ENV=production` are rejected. No additional packages or Docker are required.

## Current scope and limitations

Phases 1–4 are implemented and verified. MFA/security hardening, consultation transitions, prescriptions, payment APIs, admin analytics, OpenAPI, CI, containers, and production observability remain planned. SQL and domain logic currently live in route modules; the separate service/repository layers in the architecture are a target design.

The global rate limiter is process-local (100 requests/15 minutes), and production TLS, secrets management, backups, deployment, and performance targets still require implementation or verification. Historical dependency audit findings remain unresolved; this phase did not upgrade dependencies or rerun an online audit.
