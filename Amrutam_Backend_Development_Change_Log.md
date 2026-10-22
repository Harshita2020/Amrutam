# Amrutam Backend — Development Change Log

**Project:** Amrutam Pharmaceuticals Backend Developer Take-Home Assignment  
**Stack:** Node.js, Express, PostgreSQL, REST API  
**Purpose:** Track completed setup, changes and reasons, verification, known issues, and upcoming work.

> This log records progress reported during development. Items marked “verified” were explicitly tested or observed. Items marked “inspect” should be checked against the source code before relying on implementation details.

---

## Current Status

**Phase 1 — Foundation and Database: COMPLETE**

Confirmed so far:
- Project directory: `D:\Amrutam\amrutam-backend`.
- Dependencies installed with `npm install`.
- Development server starts with `npm run dev`.
- Health endpoint responds successfully.
- Initial SQL migration was executed in the `amrutam` database using pgAdmin.
- Readiness endpoint returns `{"status":"ready","database":"connected"}`.
- Existing test suite passes: 1 test file, 2 tests.

**Phase 2 — Core Authentication: COMPLETE (verified).**
- Patient/doctor registration, password hashing, login/JWT, auth middleware, RBAC helper, and protected identity endpoint are implemented.
- Additive normalized-email unique-index migration 002 was applied and verified.
- Final regression run: `npm test` — 2 files passed, 27 tests passed.
- Git was initialized at `D:\Amrutam`; files remain untracked and nothing is staged or committed.

## Running Change Log

### 1. Starter project established

**Change:** Began with the supplied Amrutam backend starter scaffold.

**Reason:** Establish a working base for the take-home assignment instead of starting from an empty repository.

**Reported starter components — verify in source before modifying:**
- Express application and centralized error handling.
- Environment-variable configuration.
- PostgreSQL connection pool.
- Health endpoint and initial tests.
- Basic security headers, CORS, and rate limiting.
- Initial SQL migration at `src/db/migrations/001_initial_schema.sql`.
- `.env.example` and README.

### 2. Dependencies installed

**Change:** Ran `npm install`; installation completed successfully and installed 198 packages.

**Reason:** Install the dependencies required to run the server and tests.

**Follow-up:** npm reported 6 audit vulnerabilities (1 moderate, 3 high, 2 critical). Attempts to update `vitest` and `nodemon` with `npm install -D vitest@latest nodemon@latest` failed with the npm internal error `Cannot read properties of null (reading 'edgesOut')`. `npm audit fix --force` was deliberately not used because the proposed changes appeared potentially disruptive.

**Status:** Dependency audit issues are unresolved. Revisit them carefully after core functionality is working; do not claim they are fixed.

### 3. Environment file created

**Change:** Created `.env` using the structure from `.env.example`.

**Reason:** Keep local configuration, database connection details, and the JWT secret outside source code.

**Configuration notes:**
- `NODE_ENV=development` is used for local development.
- `CORS_ORIGIN=http://localhost:5173` was configured for a potential local frontend development server.
- `JWT_SECRET` was configured with a generated secret.
- `DATABASE_URL` was corrected to include the PostgreSQL connection details, including the password and correct port.

**Security note:** Do not commit or share `.env` or its secrets. Confirm `.gitignore` excludes it. Never paste actual passwords, connection strings, or JWT secrets into the repository or chat.

### 4. PostgreSQL database configured

**Change:** Used PostgreSQL 16 through pgAdmin 4 and created the `amrutam` database. Executed the initial migration SQL through pgAdmin's Query Tool.

**Reason:** The backend needs a persistent relational database for users, doctor profiles, availability, consultations, prescriptions, payments, and audit records.

**Tooling note:** The `psql` command-line tool was not recognized in PowerShell, so pgAdmin Query Tool was used for database setup.

### 5. Baseline tests run

**Change:** Ran `npm test`.

**Verified result:**
- `tests/health.test.js` passed.
- `GET /api/v1/health` returns service health without requiring a database connection.
- Unknown routes return a consistent 404 response.
- Total: 1 test file passed, 2 tests passed.

**Reason:** Establish a baseline for basic HTTP behavior and unknown-route error handling.

### 6. Development server and health endpoint verified

**Change:** Started the server with `npm run dev` and opened the health endpoint.

**Verified response:**
```json
{
  "status": "ok",
  "service": "amrutam-backend"
}
```

**Reason:** Confirm that the HTTP server starts and responds to requests.

**Important distinction:** The health endpoint checks basic service health; it does not by itself prove PostgreSQL is reachable.

### 7. Database readiness debugging

**Change:** Initially tried `GET /api/v1/ready`, which returned a 404 because that URL was not the registered readiness route.

**Follow-up:** Used the actual readiness route. It initially reported:
```json
{
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is unavailable"
  }
}
```

The connection settings in `.env` were corrected. The database password had been missing, and the port needed to match the configured PostgreSQL instance.

**Final verified response:**
```json
{
  "status": "ready",
  "database": "connected"
}
```

**Reason:** Verify actual database connectivity rather than relying only on the health endpoint.

**Outcome:** Database readiness is confirmed.

---

## Phase 1 Completion Summary

- [x] Dependencies installed.
- [x] `.env` created and configured for local development.
- [x] PostgreSQL 16 `amrutam` database created.
- [x] Initial migration executed.
- [x] Development server starts.
- [x] Health endpoint responds successfully.
- [x] Readiness endpoint confirms database connectivity.
- [x] Existing baseline tests pass (2/2).

**Git status:** Git was initialized at the workspace root after Phase 2. `.env`, `node_modules`, and `coverage` are ignored by the backend `.gitignore`. The secret scan found local credentials only in ignored `.env`; `.env.example` uses placeholder values. No files have been staged or committed.

## Decisions and Rationale

| Decision | Reason |
|---|---|
| Use Node.js and Express | Aligns with the project scaffold and the user's existing MERN/Node.js experience. |
| Use PostgreSQL | Relational data and transactional booking constraints fit the assignment domain. |
| Use REST | Provides a straightforward API surface to document with OpenAPI. |
| Keep local secrets/configuration in `.env` | Avoid hardcoding credentials and secrets in source code. |
| Verify readiness separately from health | A running HTTP server does not guarantee a working database connection. |
| Avoid `npm audit fix --force` for now | The proposed changes appeared disruptive; defer dependency changes until they can be assessed safely. |

## Known Issues and Follow-ups

1. **npm audit:** 6 reported vulnerabilities remain unresolved (2 critical, 3 high, 1 moderate). No broad dependency remediation was attempted.
2. **Authentication follow-ups:** MFA, password reset, email verification, account lockout, refresh-token rotation/revocation, and a dedicated authentication rate limit remain out of scope.
3. **Rate limiting:** The existing 100-request/15-minute limit is process-local and shared across routes.
4. **Testing boundary:** Authentication tests mock PostgreSQL; no concurrent-registration stress test was run against an isolated test database.
5. **RBAC:** Role middleware is directly tested, but no role-restricted business endpoint exists yet.
6. **Git:** Repository initialized at `D:\Amrutam`; all project files are currently untracked. No files have been staged or committed. A pre-commit secret scan was performed; `.env` is ignored.
7. **Phase 1 routes:** The readiness endpoint is `/api/v1/health/ready`; `/api/v1/ready` is not registered.

## Phase 2 — Authentication Part 1 (Core Identity)

**Implemented:**
- Patient and doctor registration with trimmed/lowercased email, bcryptjs password hashes (cost 12), and safe `201` responses. Registration does not issue a token.
- Login with generic credential failures and signed HS256 JWTs. `JWT_SECRET` is required (minimum 32 characters); `JWT_EXPIRES_IN` defaults to 15 minutes and is capped at 24 hours.
- Reusable Bearer-token authentication and role middleware. Authentication checks JWT claims/signature/expiry and re-checks the current database user role and active status.
- `GET /api/v1/auth/me` returns only the authenticated user's ID, email, role, and active status.
- Public admin registration and role escalation are blocked.
- Added and applied `002_normalized_user_email.sql`; migration 001 was not modified.
- Centralized error handling does not return internal error details or log query strings.

**Verification:**
- Baseline before changes: `npm test` — 1 file, 2 tests passed.
- Final regression suite: `npm test` — 2 files, 27 tests passed (including existing health/404 regressions). An earlier focused run passed 24 tests before the final validation cases were added.
- Read-only schema precheck found the `users` table and zero groups with duplicate `lower(btrim(email))` values.
- Applied migration 002 to the configured non-production database and verified `users_email_normalized_uidx` exists.
- Authentication HTTP tests use mocked database calls and do not write users to the configured database.
- Verified startup rejects a missing `JWT_SECRET` and configuration rejects token expiry beyond 24 hours.
- `npm audit --json` reported 6 unresolved package findings (2 critical, 3 high, 1 moderate); no dependency upgrades were performed.
- Initialized Git at the workspace root (`D:\Amrutam`). Verified `.env`, `node_modules`, and `coverage` are ignored. The local `.env` was not included in the untracked project contents; no staging or commit was performed.

## Next Phase — Phase 3: Doctor Profiles, Availability, and Search: COMPLETE (verified)

## Phase 3 — Doctor Profiles, Availability, and Search

**Implemented:**
- Public doctor discovery and search endpoint (`GET /api/v1/doctors`):
  - Filters by `specialty` / `specialization` (case-insensitive exact match) and `q` (substring match across `full_name`, `specialization`, and `bio`).
  - Strict allow-list of query parameters to reject SQL injection and unexpected filters.
  - Bounded cursor-based pagination (default `limit: 10`, max `50`) using base64 tokens with deterministic ordering (`created_at DESC, user_id DESC`).
  - Discoverability policy enforced: only active (`users.is_active = TRUE`) and approved (`doctor_profiles.verification_status = 'approved'`) doctor profiles are discoverable.
- Public doctor profile endpoint (`GET /api/v1/doctors/:doctorId`):
  - Validates UUID; returns safe public fields (`id`, `fullName`, `specialty`, `specialization`, `bio`, `createdAt`).
  - Omits internal fields, password hashes, and user roles. Returns `404 DOCTOR_NOT_FOUND` if doctor does not exist, is inactive, or not approved.
- Doctor profile update endpoint (`PATCH /api/v1/doctors/me`):
  - Requires `doctor` role and extracts identity exclusively from verified JWT (`req.auth.userId`).
  - Allows editing only `fullName`, `specialty`/`specialization`, and `bio`.
  - Rejects unknown or privileged fields (`role`, `userId`, `verificationStatus`, `verification_status`, `is_active`, `password`) with `400 VALIDATION_ERROR`. Self-approval and privilege escalation are completely prevented.
- Doctor availability slot management:
  - Create slot (`POST /api/v1/doctors/me/slots`): validates ISO timestamps, enforces `endsAt > startsAt` and `startsAt > NOW()`. Uses transactional concurrency control with doctor row lock (`SELECT user_id FROM doctor_profiles WHERE user_id = $1 FOR UPDATE`) to eliminate race conditions and reject overlapping intervals (`409 SLOT_OVERLAP`).
  - Update slot (`PATCH /api/v1/doctors/me/slots/:slotId`): verifies ownership (`403 FORBIDDEN` for other doctors), validates new interval, checks overlap, and blocks updates on booked slots (`409 SLOT_ALREADY_BOOKED`).
  - Delete slot (`DELETE /api/v1/doctors/me/slots/:slotId`): verifies ownership, ensures slot is not booked (`409 SLOT_ALREADY_BOOKED`), and ensures slot is not referenced by consultations (`409 SLOT_REFERENCED`).
  - Public slot listing (`GET /api/v1/doctors/:doctorId/slots`): lists available slots where `status = 'available'` and `starts_at >= NOW()`, excluding elapsed, booked, and unavailable slots. Supports optional `from` and `to` ISO date filters.
- Database & Migrations:
  - Created additive migration `src/db/migrations/003_doctor_profiles_and_slots.sql` with `ADD COLUMN IF NOT EXISTS verification_status`, `updated_at`, and query performance indexes.
  - User applied Migration 003 manually in pgAdmin.
  - Verified live database state using read-only catalog query (`src/db/verify_schema.js`), confirming all columns and indexes in PostgreSQL 16 without re-executing migrations.
  - Upgraded `src/db/migrate.js` to implement safe migration history tracking via `schema_migrations`, with automated baseline reconciliation for manual pgAdmin runs (001, 002, 003) and transactional execution for pending migrations. Hardened baseline checks to require all artifacts (8 tables for 001; index for 002; 3 columns and 2 indexes for 003) to prevent false-positive baselines on partial schemas.
- Route mounting & Zod Modernization:
  - Mounted `doctorsRouter` at `/api/v1/doctors` in `src/app.js`.
  - Replaced deprecated Zod `.datetime({ offset: true })` with Zod 4 recommended `z.iso.datetime({ offset: true })` across slot query and create/update schemas in `src/routes/doctors.js`.

**Verification:**
- Vitest suite run: `npm test` executed across all suites.
- Results: 4 test files passed, 63 tests passed (0 failures).
  - `tests/health.test.js`: 2 passed (health check and 404 handler).
  - `tests/auth.test.js`: 25 passed (Phase 2 identity and RBAC regressions).
  - `tests/doctors.test.js`: 21 passed (profile reading, update, validation, discoverability policy, pagination, and search filters).
  - `tests/slots.test.js`: 15 passed (slot creation, overlap conflict detection, past date rejection, ownership authorization, booked/referenced deletion protections, and public slot listing).
- Test isolation: HTTP tests mock database pool and do not mutate the local PostgreSQL database.
- Database catalog verification: Inspected `information_schema.columns` and `pg_indexes` for `doctor_profiles` and `availability_slots`, confirming columns (`verification_status`, `updated_at`) and indexes (`idx_doctor_profiles_discoverable`, `idx_slots_doctor_status_start`) in PostgreSQL 16.
- Manual verification: The developer is currently conducting manual HTTP verification using Thunder Client before committing.

## Next Phase — Phase 4: Appointment Booking

Implement slot reservation, booking transactions, idempotency key tracking, and concurrency protection against double-booking.

## Working Rule

**Record what actually changed, why it changed, and how it was verified. Keep planned work separate from completed work. Never record a requirement as implemented until code or test evidence confirms it.**
