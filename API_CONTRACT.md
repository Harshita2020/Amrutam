# Amrutam Telemedicine Backend — API Contract

**Document type:** API contract and endpoint reference  
**Status:** Phase 2 authentication endpoints and Phase 3 doctor profiles, discovery search, and availability endpoints are implemented and tested; other endpoints remain planned unless explicitly verified in the repository  
**Base path:** `/api/v1`  
**Protocol:** HTTPS in deployed environments; JSON request/response bodies  
**Architecture:** Node.js, Express, PostgreSQL, modular monolith

## 1. Purpose and authority

This contract translates the original Amrutam assignment and `ARCHITECTURE.md` into a consistent REST API plan.

The assignment requires:
- User lifecycle, authentication, and roles.
- Doctor availability and booking.
- Consultation lifecycle and prescriptions.
- Search and filtering.
- Compliance and audit trails.
- Admin analytics.
- Input validation, rate limiting, idempotency for writes, and secure configuration.
- Security controls including encryption, MFA, and RBAC.

**Source-of-truth rule:** The original assignment specifies the workflows and broad requirements, but it does not specify every URL, field, status code, or JSON shape. Those details below are proposed contract decisions based on the architecture. They must be reconciled with the existing source code and then implemented/tested. Do not describe a proposed endpoint as implemented until code and tests verify it.

Related documents:
- `ARCHITECTURE.md` — component boundaries, data model, security, transactions, and scaling.
- `Amrutam_Backend_Implementation_Roadmap.md` — implementation sequence.
- `Amrutam_Backend_Development_Change_Log.md` — verified changes and current state.

## 2. Global API conventions

### 2.1 Base URL and content

- Local base URL: `http://localhost:<configured-port>/api/v1`.
- Deployed environments must use HTTPS.
- Request and response bodies use `application/json` unless otherwise documented.
- Do not expose stack traces, SQL errors, secrets, password hashes, access tokens, or unnecessary health information.
- Timestamps use ISO 8601 UTC values, for example `2026-10-22T12:30:00Z`.
- IDs are opaque strings to API clients. The database's actual ID type must be checked before implementation.

### 2.2 Authentication

Protected endpoints require:

```http
Authorization: Bearer <access-token>
```

The access token is issued by the login endpoint after credentials are verified. The server validates its signature and expiry and derives the caller's identity and role from the verified token, not from request-body fields.

MFA is a required assignment security control but is scheduled for Phase 5. Until implemented and tested, the API must not claim MFA support.

### 2.3 Roles

- `patient`
- `doctor`
- `admin`

Public registration may create only allowed non-admin roles. Admin accounts must be provisioned through a controlled administrative process; public callers cannot set their own role to `admin`.

Role checks do not replace resource-level authorization. For example, patients may access only their own bookings, consultations, and prescriptions; doctors may access only their assigned consultations and permitted own profile/availability resources.

### 2.4 Pagination and filtering

List endpoints should support bounded pagination using:

- `limit`: optional positive integer; server applies a default and maximum.
- `cursor` or `offset`: choose one convention consistently when implementing. Cursor pagination is preferred for large or changing datasets.
- Filters must be validated and allow-listed; arbitrary SQL fields or sort expressions are never accepted from clients.

Exact pagination response fields must be finalized with implementation and OpenAPI.

### 2.5 Idempotency

Critical write endpoints, especially booking creation and payment initiation, should accept:

```http
Idempotency-Key: <client-generated-unique-value>
```

Contract behavior:
- Same key and same logical request: return the stored original outcome without duplicating the operation.
- Same key with a different request: return `409 Conflict`.
- Key scope, retention period, and persistence are implementation details that must be documented and tested.
- Database constraints and transactions remain required; idempotency keys are not a substitute for concurrency control.

### 2.6 Standard success and error shapes

Success responses use a resource or result object. A simple proposed pattern is:

```json
{
  "data": {
    "id": "resource-id"
  }
}
```

List responses may use:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": null
  }
}
```

Errors use the existing starter's observed error convention where possible:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed"
  }
}
```

Validation errors may include safe field-level details, but never echo secrets or sensitive submitted values. Keep the actual response shape aligned with the centralized error handler.
Malformed JSON and invalid authentication request fields return `400 VALIDATION_ERROR`; unexpected server/database errors return a generic `500 INTERNAL_SERVER_ERROR` without SQL details or stack traces.

### 2.7 HTTP status conventions

| Status | Meaning |
|---|---|
| `200 OK` | Successful read or update with a response body |
| `201 Created` | Resource created |
| `202 Accepted` | Work accepted for asynchronous processing |
| `204 No Content` | Successful operation without a response body |
| `400 Bad Request` | Malformed request or invalid input |
| `401 Unauthorized` | Missing, invalid, or expired authentication |
| `403 Forbidden` | Authenticated caller lacks permission |
| `404 Not Found` | Resource not found, or intentionally concealed because caller cannot access it |
| `409 Conflict` | Slot conflict, invalid state transition, or idempotency-key reuse with a different request |
| `422 Unprocessable Entity` | Optional convention for syntactically valid input that violates a domain rule; use consistently if adopted |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected server failure with no sensitive internals exposed |
| `503 Service Unavailable` | Required dependency unavailable |

## 3. Endpoint inventory

Authentication and doctor/availability paths in this section are implemented and verified. Other paths remain proposed targets, not a claim that the routes already exist. The readiness path is `/api/v1/health/ready`; `/api/v1/ready` is not registered.

| Method | Path | Access | Purpose | Roadmap phase |
|---|---|---|---|---|
| `GET` | `/health` | Public | Basic process/service health | 1 |
| `GET` | `/health/ready` | Operational/internal as appropriate | Check readiness, including database connectivity | 1 |
| `POST` | `/auth/register` | Public, global rate limit | Register patient or doctor | 2 — implemented |
| `POST` | `/auth/login` | Public, global rate limit | Verify credentials and issue access token | 2 — implemented |
| `GET` | `/auth/me` | Authenticated | Get current user's safe profile | 2 — implemented |
| `GET` | `/doctors` | Public discovery | Search/filter doctors | 3 — implemented |
| `GET` | `/doctors/:doctorId` | Public discovery | Read public doctor profile | 3 — implemented |
| `PATCH` | `/doctors/me` | Authenticated Doctor | Update own permitted profile fields | 3 — implemented |
| `GET` | `/doctors/:doctorId/slots` | Public discovery | List available slots | 3 — implemented |
| `POST` | `/doctors/me/slots` | Authenticated Doctor | Create availability slots | 3 — implemented |
| `PATCH` | `/doctors/me/slots/:slotId` | Authenticated Doctor | Update an eligible own slot | 3 — implemented |
| `DELETE` | `/doctors/me/slots/:slotId` | Authenticated Doctor | Remove an eligible own unbooked slot | 3 — implemented |
| `POST` | `/bookings` | Patient | Book a slot; idempotent and concurrency-safe | 4 |
| `GET` | `/bookings/me` | Patient | List own bookings | 4 |
| `GET` | `/bookings/:bookingId` | Patient/assigned doctor/admin per policy | Read booking with resource checks | 4 |
| `POST` | `/bookings/:bookingId/cancel` | Owner/authorized actor | Cancel if lifecycle rules allow | 4 |
| `PATCH` | `/consultations/:consultationId/status` | Assigned doctor/authorized actor | Perform permitted status transition | 6 |
| `GET` | `/consultations/:consultationId` | Patient/assigned doctor/admin per policy | Read consultation | 6 |
| `GET` | `/consultations/me` | Authenticated patient or doctor | List caller's permitted consultations | 6 |
| `POST` | `/consultations/:consultationId/prescriptions` | Assigned doctor | Create prescription | 6 |
| `GET` | `/consultations/:consultationId/prescriptions` | Patient/assigned doctor/admin per policy | List accessible prescriptions | 6 |
| `POST` | `/consultations/:consultationId/payments` | Patient | Initiate payment if provider integration is configured | 7 |
| `GET` | `/payments/:paymentId` | Owner/authorized admin | Read payment status | 7 |
| `POST` | `/payments/webhooks/:provider` | Provider-authenticated/signature-verified | Process provider callback idempotently | 7 |
| `GET` | `/admin/analytics` | Admin | Read aggregate operational analytics | 7 |

Do not expose a public endpoint to arbitrarily create or edit audit events. Audit entries should be written by trusted server-side services when sensitive actions occur.

## 4. Phase 2 — Authentication contract

### 4.1 `POST /auth/register`

**Purpose:** Create a patient or doctor account.

**Access:** Public, rate-limited.

**Request:**

```json
{
  "email": "person@example.com",
  "password": "A-strong-password-123",
  "role": "patient"
}
```

Rules:
- Email is trimmed and lowercased before storage and lookup. Migration `002_normalized_user_email.sql` adds a database unique index over `lower(btrim(email))`.
- Passwords must contain at least 12 characters and no more than 72 UTF-8 bytes; they are hashed with bcryptjs (cost 12).
- Only `patient` and `doctor` roles are accepted. `admin`, unknown roles, missing fields, and unexpected request fields are rejected with `400 VALIDATION_ERROR`.
- Admins must be provisioned through a controlled database/administrative process. There is no public role-update endpoint.
- Doctor profile details and verification are handled in a later phase.
- Registration does not issue an access token; clients log in separately.
- Do not return password hashes or secrets.

**Success:** `201 Created`, with safe user fields only.

**Errors:** `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_EXISTS`, `429 RATE_LIMITED`.

**Response example:**

```json
{
  "data": {
    "id": "user-id",
    "email": "person@example.com",
    "role": "patient",
    "isActive": true
  }
}
```

The account-active field reflects the existing `users.is_active` column.

### 4.2 `POST /auth/login`

**Purpose:** Verify credentials and issue an access token.

**Access:** Public, rate-limited.

**Request:**

```json
{
  "email": "person@example.com",
  "password": "user-password"
}
```

Rules:
- Return a generic credential error for invalid email/password combinations.
- Disabled accounts are rejected with the same generic error.
- The existing global Express rate limit applies to login and registration: 100 requests per 15 minutes per process/IP configuration. There is no dedicated authentication rate limiter or distributed rate-limit store.
- JWTs are signed with HS256 using `JWT_SECRET` (required, minimum 32 characters). `JWT_EXPIRES_IN` controls expiry, defaults to `15m`, and is limited to at most 24 hours.
- Token claims are limited to `sub` (user UUID), `role`, `iat`, and `exp`. The response's `expiresIn` is seconds.
- Do not log credentials or tokens.
- MFA is a later phase and must be added before claiming full assignment security completion.

**Success:** `200 OK`.

**Response example:**

```json
{
  "data": {
    "accessToken": "signed-access-token",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "user": {
      "id": "user-id",
      "email": "person@example.com",
      "role": "patient"
    }
  }
}
```

`expiresIn` defaults to 900 seconds and changes with `JWT_EXPIRES_IN`.

**Errors:** `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS` (same status/message for unknown email, incorrect password, and inactive account), `429 RATE_LIMITED`.

### 4.3 `GET /auth/me`

**Purpose:** Return the authenticated user's safe identity/profile.

**Access:** Authenticated.

**Request:** `Authorization: Bearer <access-token>`.

**Success:** `200 OK`, returning `id`, normalized `email`, `role`, and `isActive`.

The middleware accepts only `Authorization: Bearer <token>`, verifies HS256 signature and expiry, requires valid identity claims, and checks that the referenced account remains active and has the token's current role. Missing, malformed, invalid, expired, inactive, or stale-role tokens return `401 UNAUTHENTICATED`. The reusable `requireRole(...roles)` middleware returns `403 FORBIDDEN` for authenticated users without an allowed role; no role-restricted business endpoint exists yet.

**Errors:** `401 UNAUTHENTICATED`; unexpected database failures return a generic `500 INTERNAL_SERVER_ERROR` without database details.

## 5. Phase 3 — Doctor discovery, profiles, and availability contract

### 5.1 `GET /doctors`

**Purpose:** Search and filter discoverable doctor profiles with cursor-based pagination.

**Access:** Public.

**Query parameters:**
- `specialty` or `specialization` (string, optional, 1–100 chars): case-insensitive match against doctor specialization.
- `q` (string, optional, 1–100 chars): substring search matching doctor `full_name`, `specialization`, or `bio`.
- `limit` (integer, optional, default: 10, min: 1, max: 50): maximum number of profiles returned.
- `cursor` (string, optional): base64-encoded token `{ "createdAt": "...", "id": "..." }` for deterministic descending pagination.

**Discoverability policy:**
- A doctor profile is returned in search results if and only if `users.is_active = TRUE` and `doctor_profiles.verification_status = 'approved'`.
- Unapproved (`pending`, `rejected`) or inactive doctors are omitted.

**Success:** `200 OK`.

```json
{
  "data": [
    {
      "id": "uuid",
      "fullName": "Dr. Aisha Sharma",
      "specialty": "Ayurvedic Medicine",
      "specialization": "Ayurvedic Medicine",
      "bio": "Expert in herbal medicine",
      "createdAt": "2026-10-22T10:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "nextCursor": "eyj..."
  }
}
```

**Errors:** `400 VALIDATION_ERROR` (invalid limit, malformed cursor, or unaccepted filter parameters).

### 5.2 `GET /doctors/:doctorId`

**Purpose:** Read a single doctor's public profile.

**Access:** Public.

**Path parameter:**
- `doctorId`: UUID string.

**Rules:**
- Requires valid UUID; invalid format yields `400 INVALID_ID`.
- Requires the doctor to be active and approved (`verification_status = 'approved'`). If not found, inactive, or unapproved, returns `404 DOCTOR_NOT_FOUND`.

**Success:** `200 OK`.

```json
{
  "data": {
    "id": "uuid",
    "fullName": "Dr. Aisha Sharma",
    "specialty": "Ayurvedic Medicine",
    "specialization": "Ayurvedic Medicine",
    "bio": "Expert in herbal medicine",
    "createdAt": "2026-10-22T10:00:00.000Z"
  }
}
```

**Errors:** `400 INVALID_ID`, `404 DOCTOR_NOT_FOUND`.

### 5.3 `PATCH /doctors/me`

**Purpose:** Authenticated doctor updates permitted fields on their own profile.

**Access:** Authenticated user with role `doctor`.

**Headers:** `Authorization: Bearer <access-token>`.

**Request body:**
```json
{
  "fullName": "Dr. Aisha Sharma",
  "specialty": "Clinical Ayurveda",
  "bio": "Updated professional bio"
}
```

**Rules:**
- Role must be `doctor`; patients receive `403 FORBIDDEN`.
- Caller identity is derived strictly from verified JWT `sub` (`req.auth.userId`).
- Strict allow-list of editable fields: `fullName` (1–120 chars), `specialty`/`specialization` (1–100 chars), `bio` (null or up to 1000 chars).
- Reject privileged and unknown fields (`role`, `userId`, `verificationStatus`, `verification_status`, `is_active`, `password`, etc.) with `400 VALIDATION_ERROR`. Doctors cannot self-approve or escalate privileges.
- At least one field must be supplied.

**Success:** `200 OK`.

```json
{
  "data": {
    "id": "uuid",
    "fullName": "Dr. Aisha Sharma",
    "specialty": "Clinical Ayurveda",
    "specialization": "Clinical Ayurveda",
    "bio": "Updated professional bio",
    "createdAt": "2026-10-22T10:00:00.000Z",
    "updatedAt": "2026-10-22T11:00:00.000Z"
  }
}
```

**Errors:** `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 DOCTOR_NOT_FOUND`.

### 5.4 `GET /doctors/:doctorId/slots`

**Purpose:** List future available slots for a discoverable doctor.

**Access:** Public.

**Path parameter:** `doctorId` (UUID).

**Query parameters:**
- `from` (ISO 8601 string, optional): filter slots starting at or after timestamp.
- `to` (ISO 8601 string, optional): filter slots ending at or before timestamp.
- `limit` (integer, optional, default: 50, max: 100).

**Rules:**
- Requires discoverable doctor (`verification_status = 'approved'` and `is_active = TRUE`), else `404 DOCTOR_NOT_FOUND`.
- Returns only slots where `status = 'available'` and `starts_at >= NOW()`. Elapsed, booked, and unavailable slots are excluded.
- Ordered by `starts_at ASC`.

**Success:** `200 OK`.

```json
{
  "data": [
    {
      "id": "slot-uuid",
      "doctorId": "doctor-uuid",
      "startsAt": "2026-10-25T09:00:00.000Z",
      "endsAt": "2026-10-25T09:30:00.000Z",
      "status": "available",
      "createdAt": "2026-10-22T10:00:00.000Z"
    }
  ]
}
```

**Errors:** `400 INVALID_ID`, `400 VALIDATION_ERROR`, `404 DOCTOR_NOT_FOUND`.

### 5.5 `POST /doctors/me/slots`

**Purpose:** Authenticated doctor creates an availability slot.

**Access:** Authenticated user with role `doctor`.

**Headers:** `Authorization: Bearer <access-token>`.

**Request body:**
```json
{
  "startsAt": "2026-10-25T09:00:00Z",
  "endsAt": "2026-10-25T09:30:00Z"
}
```

**Rules:**
- `endsAt` must be strictly after `startsAt`.
- `startsAt` must be in the future (`startsAt > NOW()`).
- Database concurrency control: acquires row lock on `doctor_profiles` for the acting doctor inside a transaction (`SELECT user_id FROM doctor_profiles WHERE user_id = $1 FOR UPDATE`) to serialize slot writes.
- Enforces non-overlap against all non-unavailable slots of that doctor: `starts_at < new_ends_at AND ends_at > new_starts_at`.
- Overlapping intervals return `409 SLOT_OVERLAP`.

**Success:** `201 Created`.

```json
{
  "data": {
    "id": "slot-uuid",
    "doctorId": "doctor-uuid",
    "startsAt": "2026-10-25T09:00:00.000Z",
    "endsAt": "2026-10-25T09:30:00.000Z",
    "status": "available",
    "createdAt": "2026-10-22T10:00:00.000Z"
  }
}
```

**Errors:** `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 DOCTOR_NOT_FOUND`, `409 SLOT_OVERLAP`.

### 5.6 `PATCH /doctors/me/slots/:slotId`

**Purpose:** Owning doctor updates timing or availability status of an unbooked slot.

**Access:** Authenticated user with role `doctor`.

**Path parameter:** `slotId` (UUID).

**Request body:**
```json
{
  "startsAt": "2026-10-25T10:00:00Z",
  "endsAt": "2026-10-25T10:30:00Z",
  "status": "unavailable"
}
```

**Rules:**
- Doctor identity derived from token. If `slot.doctor_id !== req.auth.userId`, returns `403 FORBIDDEN`.
- Booked slots (`status = 'booked'`) cannot be modified; returns `409 SLOT_ALREADY_BOOKED`.
- If timing is updated, checks `endsAt > startsAt`, `startsAt > NOW()`, and validates non-overlap against other active slots.
- Status may be toggled between `'available'` and `'unavailable'`. Cannot be set to `'booked'` by doctor.

**Success:** `200 OK`.

**Errors:** `400 INVALID_ID`, `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 SLOT_NOT_FOUND`, `409 SLOT_ALREADY_BOOKED`, `409 SLOT_OVERLAP`.

### 5.7 `DELETE /doctors/me/slots/:slotId`

**Purpose:** Owning doctor deletes an unbooked, unreferenced slot.

**Access:** Authenticated user with role `doctor`.

**Path parameter:** `slotId` (UUID).

**Rules:**
- Slot must belong to authenticated doctor (`403 FORBIDDEN` if owned by another doctor).
- Booked slots cannot be deleted (`409 SLOT_ALREADY_BOOKED`).
- Slots referenced by existing `consultations` cannot be deleted (`409 SLOT_REFERENCED`).
- Performs hard deletion of eligible slot record.

**Success:** `200 OK`.

```json
{
  "data": {
    "id": "slot-uuid",
    "deleted": true
  }
}
```

**Errors:** `400 INVALID_ID`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 SLOT_NOT_FOUND`, `409 SLOT_ALREADY_BOOKED`, `409 SLOT_REFERENCED`.

## 6. Phase 4 — Booking contract

### 6.1 `POST /bookings`

**Purpose:** Book an available slot.

**Access:** Patient.

**Headers:**

```http
Authorization: Bearer <access-token>
Idempotency-Key: <unique-value>
Content-Type: application/json
```

**Proposed request:**

```json
{
  "slotId": "slot-id"
}
```

The server derives the patient identity from the token. A client-supplied `patientId` must not be trusted.

**Success:** `201 Created`; a repeat with the same idempotency key and request replays the original outcome.

**Potential errors:**
- `400 VALIDATION_ERROR`
- `401 UNAUTHENTICATED`
- `403 FORBIDDEN`
- `404 SLOT_NOT_FOUND`
- `409 SLOT_UNAVAILABLE` or `IDEMPOTENCY_KEY_REUSED`
- `429 RATE_LIMITED`
- `503 SERVICE_UNAVAILABLE`

**Required behavior:**
- Reserve the slot and create the booking/consultation atomically.
- Prevent two requests from booking the same slot.
- Persist/check idempotency state.
- Record an audit event for the booking.
- Trigger notifications only after the transaction commits, preferably through an outbox/worker if configured.

### 6.2 `GET /bookings/me`

Returns only the authenticated patient's bookings, with pagination and optional validated status/date filters.

### 6.3 `GET /bookings/:bookingId`

Returns a booking only after checking that the caller is the patient owner, assigned doctor, or a permitted admin.

### 6.4 `POST /bookings/:bookingId/cancel`

Cancels a booking only if the current state and cancellation policy permit it. Define whether cancellation releases the slot, what happens to payments, and which audit events are required. Use a transaction and idempotent behavior where appropriate.

## 7. Phase 6 — Consultation and prescription contract

### 7.1 `GET /consultations/:consultationId`

Returns the consultation to an authorized patient, assigned doctor, or permitted admin. Enforce resource-level access checks before returning sensitive details.

### 7.2 `GET /consultations/me`

Returns only consultations the authenticated user is permitted to see. The server determines the applicable patient/doctor identity from the token.

### 7.3 `PATCH /consultations/:consultationId/status`

Proposed request:

```json
{
  "status": "in_progress"
}
```

Allowed status values and transitions must be defined as a state machine before implementation. The server must reject invalid transitions with `409 INVALID_STATE_TRANSITION`. A client must not be allowed to bypass the state machine by submitting an arbitrary status.

### 7.4 `POST /consultations/:consultationId/prescriptions`

**Access:** Assigned doctor.

Proposed body shape (illustrative; finalize before implementation):

```json
{
  "items": [
    {
      "medicationName": "Example medication",
      "instructions": "Use as prescribed",
      "quantity": 1
    }
  ],
  "notes": "Optional clinical note"
}
```

Rules:
- Validate each item and all lengths/types.
- Verify the doctor is assigned to the consultation and the consultation is in an eligible state.
- Keep sensitive details out of logs.
- Record the action in the audit log.
- Define whether prescriptions are immutable or amended through versioned records; do not silently overwrite clinically significant history.

### 7.5 `GET /consultations/:consultationId/prescriptions`

Returns prescriptions only to authorized callers with a valid relationship to the consultation.

## 8. Phase 7 — Payments and admin analytics

### 8.1 Payment endpoints

Payment endpoints are conditional on the selected provider and assignment scope. Do not invent a live gateway or claim real payment processing without one.

`POST /consultations/:consultationId/payments` starts a payment attempt for an eligible consultation. It must be idempotent and verify the caller can pay for that consultation.

`GET /payments/:paymentId` returns status only to an authorized owner/admin.

`POST /payments/webhooks/:provider` accepts provider callbacks only after provider-specific signature verification. Validate amount, currency, provider reference, and current state; process callbacks idempotently. Do not trust a browser redirect as proof of payment and do not store raw card details.

### 8.2 `GET /admin/analytics`

**Access:** Admin only.

Returns documented aggregate operational metrics, such as consultation counts by status or time period. Validate date ranges and bound query costs. Avoid exposing identifiable medical information unless specifically required and authorized. Administrative access should be audited.

## 9. Audit behavior

Audit events are generated by server-side services for sensitive actions, including:
- Registration and authentication security events as appropriate.
- Role/permission changes.
- Doctor profile/verification changes.
- Slot creation, modification, and booking/cancellation.
- Consultation status changes.
- Prescription creation/amendment.
- Payment status changes.
- Administrative access and sensitive analytics operations.

Each event should capture only the minimum useful metadata: actor ID (when known), action, resource type/ID, timestamp, outcome, and correlation/request ID. Never log passwords, bearer tokens, secrets, or unnecessary clinical content. Restrict audit access and define retention/integrity controls.

## 10. Security requirements applying to all endpoints

- HTTPS in deployed environments.
- Input validation on path, query, headers, and body.
- Parameterized SQL and least-privilege database credentials.
- Authentication plus resource-level authorization for protected operations.
- Rate limits for public and expensive endpoints, especially registration/login and writes.
- Request-size limits and safe timeouts.
- Safe, consistent errors; no stack traces or database internals in responses.
- Secrets supplied through environment/deployment secret management and excluded from Git.
- Dependency scanning and timely vulnerability review.
- Encrypt sensitive data in transit and use encryption at rest/backups where supported by the deployment.
- Define key rotation and incident response procedures.
- MFA must be implemented in the designated security-hardening phase before claiming full compliance with the assignment.
- Add negative security tests for role escalation and cross-user resource access.

## 11. Performance, reliability, and operations

- Target requirements from the assignment: p95 reads under 200 ms, p95 writes under 500 ms, 100,000 daily consultations, and 99.95% availability.
- These are targets, not guarantees. Record workload, test environment, duration, latency percentiles, error rates, and resource use when benchmarking.
- Index actual filter/join/order patterns and inspect slow queries.
- Paginate collection endpoints and cap page sizes.
- Use transactions and database constraints for booking correctness.
- Use bounded exponential backoff with jitter for transient failures only; retries must be safe and bounded.
- Use background jobs for slow work and idempotent workers for retries.
- Use structured logs, metrics, and traces; redact sensitive data.
- Keep liveness and readiness distinct. Confirm the actual registered health/readiness paths from code; do not assume route names.
- Define and test backup restoration and disaster recovery.

## 12. Contract testing and acceptance criteria

For each implemented endpoint:
- Test successful and invalid requests.
- Test missing, invalid, and expired authentication where applicable.
- Test role and resource ownership boundaries.
- Test validation and safe error shapes.
- Test idempotency for critical writes.
- Test database conflicts and concurrency for booking.
- Keep OpenAPI and this contract synchronized with actual behavior.
- Run tests in CI and use an isolated test database.

A contract entry is considered **implemented** only when the route exists, its behavior matches the contract, and automated tests verify it. If implementation requires a contract change, update this document and record the reason in the development change log.

## 13. Current verified state

As of the latest development log:
- Express server starts.
- PostgreSQL 16 database `amrutam` is configured.
- Initial migration was executed.
- Health endpoint returned `{"status":"ok","service":"amrutam-backend"}`.
- The actual readiness endpoint returned `{"status":"ready","database":"connected"}` after fixing `.env` connection settings.
- Phase 2 migration `002_normalized_user_email.sql` was applied and its unique index verified in the configured non-production database.
- Authentication tests exercise database calls through mocks; they do not perform user writes against the configured database.
- Registration, login, and `/auth/me` are implemented; basic role middleware is tested directly because no role-restricted business endpoint exists yet.
- MFA, account lockout, password reset, email verification, refresh tokens, doctor search, availability, booking, consultation, prescription, payment, and admin endpoints have not been implemented in Phase 2.
- The npm audit reported 6 vulnerabilities; remediation remains open.

## 14. Next implementation task

Implement **Phase 2 — Authentication Part 1: Core Identity**:
1. Inspect current routes, schema, dependencies, and tests.
2. Confirm or migrate the user schema without silently rewriting an applied migration.
3. Implement patient/doctor registration, password hashing, login, JWT verification, and basic RBAC.
4. Prevent admin self-registration.
5. Add tests for success cases, invalid credentials, invalid/missing tokens, role restrictions, and attempted admin self-registration.
6. Update this contract, `ARCHITECTURE.md`, and `Amrutam_Backend_Development_Change_Log.md` based on actual implementation and test results.
