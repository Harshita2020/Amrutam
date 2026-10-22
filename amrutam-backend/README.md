# Amrutam Backend

Telemedicine REST API built with Node.js, Express, and PostgreSQL. Patients can register, log in, discover approved doctors, book appointments, view bookings, and cancel eligible appointments. Doctors can maintain profiles and availability.

## Setup

1. Install Node.js 20+ and PostgreSQL 15+.
2. From `amrutam-backend`, run `npm ci`.
3. Create a local database and copy `.env.example` to `.env`. Set `DATABASE_URL` and a random `JWT_SECRET` of at least 32 characters. Never commit `.env`.
4. Run `npm run migrate` to apply pending migrations 001–005. The runner tracks migrations and recognizes previously applied manual migrations. Review SQL before applying it to an existing environment.
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

- `npm test`: 107 regression/MFA/schema/security tests; database calls are mocked. Test-only configuration is supplied automatically, so `.env` is not required.
- `npm run test:integration`: 18 tests against real PostgreSQL, including competing bookings, concurrent idempotency, cancellation/rebooking, authorization, audit-failure rollback, precise pagination, slot overlap races, and migration reconciliation.

The integration runner uses local `TEST_ADMIN_DATABASE_URL`, or local development `DATABASE_URL` from `.env`, to create a uniquely named disposable database. The database role must have `CREATEDB` permission. It applies all migrations to that database, runs tests, and drops only the database it created. Existing application data is never used as fixtures. Remote servers and `NODE_ENV=production` are rejected. No additional packages or Docker are required.

## Current scope and limitations

Core workflows through clinical prescriptions and admin analytics are implemented, along with MFA, OpenAPI, CI/container definitions and observability. Payment APIs, production deployment verification and advanced operational guarantees remain outside the delivered scope. Older route modules retain direct SQL; clinical and MFA services have separate boundaries.

The global rate limiter is process-local (100 requests/15 minutes), and production TLS, secrets management, backups, deployment, and performance targets still require implementation or verification. Dependency audit findings were remediated during the submission pass; the latest full audit reported zero vulnerabilities.

## Phases 5–10 submission additions

Use Node.js 22 for the container/CI environment. `npm run dev` now uses Node's built-in watch mode; Nodemon was removed and Vitest upgraded to address the audit findings.

### Security and clinical API

- `POST /auth/mfa/enroll` with your current password returns an authenticator secret/URI. Configure an authenticator app, then `POST /auth/mfa/confirm` with its six-digit code. Save the returned recovery codes securely; confirmation revokes old tokens.
- Subsequent `/auth/login` requests supply email/password plus `code` or one `recoveryCode`. Codes cannot be reused. `POST /auth/logout-all` revokes all sessions.
- Doctor/admin clinical operations and all admin operations require an MFA-authenticated login. MFA remains optional for patients.
- `/consultations/me`, `/consultations/:id`, `/consultations/:id/status`, and `/consultations/:id/prescriptions` provide authorized clinical workflows. Prescription creation requires `Idempotency-Key`; prescriptions are immutable.
- Admin endpoints: `/admin/analytics`, `/admin/audit-logs`, `/admin/doctors/:id/verification`, `/admin/metrics`.
- `PATCH /users/me` updates a patient's full name and optional phone.

Set `MFA_ENCRYPTION_KEY` to 64 random hex characters before enrollment. Back it up securely; changing it without re-encrypting stored seeds locks out enrolled users. `node scripts/configure-local-mfa.js` can safely add a missing key to an existing ignored local `.env`.

For controlled admin provisioning, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the current shell (do not commit them), run `npm run admin:create`, then clear those variables. The command creates a new admin and never promotes an existing account. Log in and enroll MFA before using admin APIs.

### Submission tools

- `npm run generate:openapi` / `npm run validate:openapi`: generate and validate the checked-in schema; served at `/api/v1/openapi.json`.
- `npm run worker`: drain transactional aggregate-refresh jobs with bounded retries.
- `node scripts/smoke-observability.js`: verify HTTP smoke checks and OTLP trace export to a temporary local receiver.
- `docker build -t amrutam-backend:submission .`: build the non-root production image.
- `docker compose up --build -d`: start PostgreSQL, migrations, API, worker and Jaeger after configuring required environment values.

See `../SUBMISSION.md`, `../SECURITY.md`, `../OPERATIONS.md`, `../DEMO.md`, and the four-page `../ARCHITECTURE_SUBMISSION.pdf` for delivery details and limitations.
