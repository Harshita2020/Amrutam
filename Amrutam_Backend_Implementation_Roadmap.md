# Amrutam Telemedicine Backend — Implementation Roadmap

**Project:** Amrutam Pharmaceuticals Backend Developer Take-Home Assignment  
**Stack:** Node.js, Express, PostgreSQL, REST API  
**Purpose:** Build the backend in dependency order, with authentication split into core identity and security hardening.

## Phase 1 — Foundation and Database

**Status: Complete (verified)**

- Express application setup and environment configuration.
- PostgreSQL connection and initial database schema/migrations.
- Centralized error handling and health endpoints.
- Basic security middleware.
- Confirm database readiness and ensure existing tests pass.

**Exit criteria:** The server starts reliably, connects to PostgreSQL, and the baseline tests pass.

## Phase 2 — Authentication Part 1: Core Identity

**Status: Complete (verified)**

- Patient and doctor registration.
- Secure password hashing and login.
- JWT issuance and verification middleware.
- Basic role-based access control for patient, doctor, and admin roles.
- Input validation and authentication tests.
- Prevent users from self-registering as admins.

**Why here:** Subsequent endpoints need a trusted user identity.

**Exit criteria:** Registration and login work; protected endpoints reject missing or invalid tokens; basic role checks are tested.

**Verified implementation:** Authentication endpoints and role middleware are implemented, migration `002_normalized_user_email.sql` is applied, and automated tests pass. MFA and advanced authentication hardening remain in Phase 5.

## Phase 3 — Doctor Profiles, Availability, and Search

**Status: Complete (verified)**

- Create and update doctor profiles with strict field allow-listing (`fullName`, `specialty`/`specialization`, `bio`).
- Exclude privileged fields (`role`, `userId`, `verificationStatus`) to prevent self-approval or privilege escalation.
- Public search and filtering by specialty and full-text substring (`q`), with cursor-based pagination.
- Discoverability policy enforced: only active (`is_active = TRUE`) and approved (`verification_status = 'approved'`) doctors are public.
- Doctor availability slot management: create, list, update, and delete.
- Slot validation and transactional overlap prevention using row-level locking (`SELECT ... FOR UPDATE`) to prevent race conditions.
- Strict ownership and resource authorization: doctors cannot update or delete other doctors' slots or profiles.
- Deletion protection: booked and consultation-referenced slots cannot be deleted.
- Additive migration `003_doctor_profiles_and_slots.sql` added and manually applied via pgAdmin; migration runner `src/db/migrate.js` proposed with `schema_migrations` tracking and baselining.
- Automated tests: 4 test suites, 63 tests passing (including regression for Phase 1 health and Phase 2 auth).

**Exit criteria:** Authorized users can manage appropriate doctor/slot data, and search returns expected results. (Verified).

## Phase 4 — Appointment Booking

**Status: Complete — hardened and verified 2026-10-22**

- Book and cancel appointments (`POST /api/v1/bookings`, `GET /api/v1/bookings/me`, `GET /api/v1/bookings/:bookingId`, `POST /api/v1/bookings/:bookingId/cancel`).
- Prevent double booking with PostgreSQL transactions, row-level locking (`SELECT ... FOR UPDATE`), and database constraints (`consultations_slot_id_key` / partial unique index).
- Implement idempotency for booking writes: replay identical requests with stored outcomes (`201 Created`), and reject key reuse with differing payloads (`409 IDEMPOTENCY_KEY_REUSED`).
- Enforce doctor approval check and patient profile existence before booking.
- Cancellation state transitions: allow cancellation of `scheduled` appointments; reject `cancelled`, `completed`, or `in_progress` appointments with conflict errors; release future slots back to `available`.
- Migration `004_booking_and_cancellations.sql` applied and verified in the local development database, preserving existing row counts.
- 100 regression tests and 12 real PostgreSQL integration tests pass. Disposable test databases cover real concurrent requests, idempotency replays/conflicts, ownership, audit-failure rollback, cancellation/rebooking, slot overlap races, history preservation, and precise pagination.
- Shared doctor locks serialize slot creation/updates; patient/key advisory locks serialize first booking attempts and retries. Unique-error recovery rolls back before reading. Idempotency creation responses remain stable after cancellation.

**Exit criteria:** A slot cannot have two active bookings, identical keyed retries replay without duplicates, and booking tests pass against real PostgreSQL. Satisfied for Phase 4; production performance remains unmeasured.

## Phase 5 — Authentication Part 2: Security Hardening

- Add multi-factor authentication (MFA), as required by the assignment.
- Strengthen authorization for sensitive resources.
- Enforce patient, doctor, and admin access boundaries.
- Add account recovery and email verification workflows, if required by the final product policy.
- Review login protections, dedicated/distributed rate limiting, token revocation/refresh handling, and secret management.
- Add security tests and a threat-model checklist.

**Why here:** Complete stronger controls before expanding access to sensitive medical records and prescriptions. Basic authentication and authorization must already exist from Phase 2.

**Exit criteria:** MFA and sensitive-resource access controls are implemented and tested, or any remaining gaps are explicitly documented.

**Phase 2 follow-ups carried forward:** MFA, password reset, email verification, account lockout, refresh-token rotation/revocation, and dedicated authentication throttling are not implemented and remain security-hardening work. The current global rate limit is process-local.

## Phase 6 — Consultations and Prescriptions

- Implement consultation status transitions.
- Allow authorized doctors to create prescriptions.
- Enforce ownership and access permissions.
- Record important actions in audit logs.
- Test valid and invalid workflow transitions.

**Exit criteria:** Consultation lifecycle rules, prescription permissions, and audit events behave as expected.

## Phase 7 — Payments and Admin Capabilities

- Implement the appropriate payment workflow, or clearly document the payment-provider integration boundary if a real gateway is out of scope.
- Add admin analytics and operational summaries.
- Complete audit logging and access restrictions.
- Test failure handling and sensitive operations.

**Exit criteria:** Admin-only capabilities are protected, audit events are recorded, and payment behavior or limitations are documented honestly.

## Phase 8 — API Documentation and Quality

- Complete automated unit and integration tests.
- Document endpoints with OpenAPI.
- Standardize validation, error handling, and response formats.
- Add CI checks for tests and code quality.

**Note:** Add tests throughout development; this phase is for closing gaps and making quality checks repeatable.

**Exit criteria:** OpenAPI matches implemented endpoints and the automated checks run successfully.

## Phase 9 — Observability and Resilience

- Structured logs, metrics, tracing, and health checks.
- Retry and backoff policies where appropriate.
- Background jobs for suitable asynchronous work.
- Document caching, concurrency, and failure-recovery decisions.

**Exit criteria:** Operational signals are available for implemented features, and resilience choices and limitations are documented.

## Phase 10 — Deployment, Architecture, and Submission

- Docker and infrastructure as code.
- Deployment and CI/CD configuration.
- Architecture document, ER diagram, and booking sequence diagram.
- Security checklist, threat model, backup, and disaster-recovery plan.
- README with setup and run instructions.
- Final test run and five-minute demo video.
- Document performance targets and measured results honestly.

**Exit criteria:** A reviewer can set up the project, understand the architecture and security decisions, run tests, and follow the demo.

---

## Priority order if time is limited

1. **Core functionality:** foundation, core authentication, doctor availability, booking, concurrency protection, and essential tests.
2. **Security and clinical workflows:** MFA, sensitive-data authorization, consultation lifecycle, prescriptions, and audit trails.
3. **Submission essentials:** OpenAPI, architecture and security documents, README, and demo.
4. **Operational maturity:** deployment, CI/CD, observability, performance testing, and advanced resilience.

These are implementation priorities, not permission to claim unfinished requirements are complete. Clearly identify what is implemented, what is tested, and what remains incomplete.

## Immediate next action

Inspect the current source tree before creating or changing files. In the VS Code PowerShell terminal, run:

```powershell
Get-ChildItem src -Recurse
```

Use the output to decide where the authentication modules, routes, middleware, and tests should live. Build incrementally: implement one piece, test it, fix failures, then continue.

## Working rule

**Build in dependency order. Test as you go. Document honestly. Do not overbuild a phase while core workflows remain unfinished.**
