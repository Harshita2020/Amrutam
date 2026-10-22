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

- Create and update doctor profiles.
- Manage available appointment slots.
- Search and filter doctors.
- Validate availability and permissions.
- Test endpoints and database queries.

**Exit criteria:** Authorized users can manage appropriate doctor/slot data, and search returns expected results.

## Phase 4 — Appointment Booking

- Book and cancel appointments.
- Prevent double booking with database constraints and transactions.
- Implement idempotency for booking writes.
- Test concurrent requests and failure scenarios.

**Exit criteria:** A slot cannot be booked twice, retries do not create duplicate bookings, and booking tests pass.

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
