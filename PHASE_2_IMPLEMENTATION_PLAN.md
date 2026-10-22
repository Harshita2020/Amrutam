# Amrutam Backend --- Phase 2 Implementation Plan

**Phase:** 2 --- Authentication Part 1: Core Identity\
**Status:** Ready for implementation\
**Stack:** Node.js, Express, PostgreSQL, REST API\
**Primary implementer:** Antigravity\
**Scope rule:** Implement only the work listed in this plan. Inspect the
repository first and adapt to its existing conventions. The code,
applied migrations, and test results are the source of truth.

## 1. Objective

Establish a trustworthy user identity layer that later phases can use to
protect doctor profiles, availability, bookings, consultations,
prescriptions, and admin functionality.

At the end of this phase, patients and doctors must be able to register
and log in securely; the API must be able to verify access tokens and
enforce basic roles; public registration must never grant admin
privileges.

## 2. Sources of truth and implementation order

Read these files before coding:

1.  `PRD` / original Amrutam assignment.
2.  `Amrutam_Backend_Development_Change_Log.md`.
3.  `Amrutam_Backend_Implementation_Roadmap.md`.
4.  `ARCHITECTURE.md`.
5.  `API_CONTRACT.md`.

Then inspect the actual repository, especially `package.json`, the `src`
tree, route registration, database connection/configuration, the initial
migration, error handling, validation utilities, and tests.

If a document conflicts with existing verified behavior or the database
has already been migrated, do not blindly overwrite it. Explain the
conflict, choose the smallest safe adjustment, and update the relevant
documentation to match the decision. Do not rewrite an applied
migration; create a new numbered migration when a schema change is
needed.

## 3. In scope

### 3.1 User schema and persistence

-   Inspect the current schema and reuse compatible tables/columns where
    possible.
-   Ensure persisted user records support, at minimum, a stable
    identifier, unique normalized email, password hash, role, and
    created/updated timestamps, subject to the existing schema
    conventions.
-   Support only the roles `patient`, `doctor`, and `admin`. Use a
    database constraint or equivalent application-level validation where
    appropriate.
-   Store only password hashes, never plaintext passwords.
-   Ensure email uniqueness is enforced by the database, not just by a
    pre-insert check.
-   Add a migration only if the existing schema does not already satisfy
    these requirements.
-   Keep role/profile modelling consistent with the existing
    architecture. Do not invent extra profile fields without need for
    Phase 2.

### 3.2 Patient and doctor registration

Proposed route: `POST /api/v1/auth/register`

-   Allow registration as `patient` or `doctor` only.
-   Validate required fields and email format; trim and normalize email
    consistently before lookup/storage.
-   Validate password against a documented minimum policy; do not log
    passwords or request bodies containing credentials.
-   Hash passwords using a suitable password-hashing library already
    present in the project, if appropriate. If none exists, choose a
    maintained library compatible with the current runtime and explain
    the choice.
-   Return a safe user representation and an access token only if that
    behavior is consistent with the API contract; otherwise keep
    registration and login separate. Make the behavior explicit in
    `API_CONTRACT.md`.
-   Never return the password hash.
-   Handle duplicate email with a consistent client error without
    leaking database details.
-   Reject `admin`, unknown roles, missing role, and malformed inputs
    according to one clearly documented policy. Do not silently accept a
    client-supplied admin role.

### 3.3 Login and token issuance

Proposed route: `POST /api/v1/auth/login`

-   Accept email and password.
-   Normalize email the same way as registration.
-   Verify the submitted password against the stored hash.
-   On success, issue a signed JWT using the configured secret/key and a
    documented expiration.
-   Include only the minimum claims required by the app, such as user
    ID, role, issue time, and expiry. Do not put passwords, password
    hashes, or personal/medical data in the token.
-   Read token secret and expiry configuration from environment
    variables; never hardcode secrets or provide insecure production
    defaults.
-   Fail closed if required authentication configuration is missing or
    invalid.
-   Return a consistent generic authentication error for an unknown
    email or incorrect password; do not reveal which part failed.
-   Do not log tokens or credentials.

### 3.4 Authentication middleware

-   Implement reusable middleware that extracts a Bearer token and
    verifies its signature and expiry.
-   Reject missing, malformed, invalid, or expired tokens with the API's
    standard `401` error shape.
-   Attach a minimal trusted identity object to the request, derived
    only from the verified token.
-   Never trust `userId`, `role`, or similar identity claims supplied
    separately in a request body or query.
-   Use the existing centralized error-handling approach rather than
    returning ad hoc error formats.
-   Keep the middleware reusable by later route modules.

### 3.5 Basic role-based access control (RBAC)

-   Implement reusable role-checking middleware/helper for `patient`,
    `doctor`, and `admin`.
-   Missing/invalid authentication is `401`; an authenticated user with
    an insufficient role is `403`.
-   Add a minimal protected identity endpoint, proposed as
    `GET /api/v1/auth/me`, so token verification can be exercised
    through the API. It returns the authenticated user's safe public
    fields only.
-   Test role-checking logic directly if no appropriate role-restricted
    business endpoint exists yet. Do not create fake production
    endpoints solely to test RBAC.
-   Admin accounts must be provisioned through a controlled, non-public
    process. No public admin registration endpoint or role escalation
    path is allowed.

### 3.6 Validation, errors, and tests

-   Follow existing validation and error-handling conventions.
-   Validate request bodies and reject malformed or unexpected role
    values.
-   Ensure auth-related errors follow the standard API error contract
    and never expose stack traces, SQL messages, password hashes,
    tokens, or secrets.
-   Add automated tests for the cases in Section 6.
-   Use the existing test runner and test patterns; avoid adding a new
    framework unless necessary.
-   Tests that need PostgreSQL must use a documented isolated test
    database or a safe existing test setup. Never run destructive test
    setup against a developer's normal database without explicit
    safeguards.

### 3.7 Documentation and change log

After implementation and tests: - Update `API_CONTRACT.md` to describe
actual request/response fields, status codes, token claims/expiry
policy, and errors. - Update `ARCHITECTURE.md` only where the
implemented authentication design differs from the documented target. -
Append to `Amrutam_Backend_Development_Change_Log.md`: files changed,
migration details, security decisions, commands run, exact test results,
and unresolved issues. - Update the implementation roadmap's Phase 2
status only when the exit criteria are verified. - Keep planned and
implemented features clearly distinguished.

## 4. Explicitly out of scope for Phase 2

Do **not** implement these in this phase:

-   MFA or one-time-password enrollment/verification (planned for Phase
    5).
-   Full login rate limiting, account lockout, password reset, email
    verification, refresh-token rotation, or session/device management
    unless already present and required to avoid breaking existing code.
    Record these as follow-ups rather than expanding scope.
-   Doctor profile management, availability, doctor search/filtering.
-   Booking, cancellation, idempotency for booking, or concurrency
    handling.
-   Consultation lifecycle, prescriptions, payments, webhooks, or admin
    analytics.
-   Full audit-log implementation, tracing/metrics, background jobs,
    Redis, caching, Docker/IaC, or deployment work.
-   Broad refactors, unrelated dependency upgrades, or
    `npm audit fix --force`.
-   Claiming production readiness or MFA compliance based only on basic
    JWT authentication.

Basic safe error handling and the existing security middleware still
apply. If an existing critical issue blocks safe implementation, report
it clearly and make only the smallest necessary fix.

## 5. API contract targets

These are proposed targets and must be reconciled with the existing code
before implementation.

### `POST /api/v1/auth/register`

Example request:

``` json
{
  "email": "patient@example.com",
  "password": "A-strong-password",
  "role": "patient"
}
```

Expected behavior: - Accept only `patient` or `doctor`. - Reject invalid
input and duplicate normalized email. - Persist a password hash, never
plaintext. - Return a safe user object; never expose the hash. - Decide
and document whether registration returns a token or requires a
subsequent login.

### `POST /api/v1/auth/login`

Example request:

``` json
{
  "email": "patient@example.com",
  "password": "A-strong-password"
}
```

Expected behavior: - Successful credentials return a signed access token
and safe user information. - Invalid credentials return a generic `401`
response. - No token or credential appears in logs.

### `GET /api/v1/auth/me`

Request header:

``` http
Authorization: Bearer <access-token>
```

Expected behavior: - Valid token returns the current authenticated
user's safe identity fields. - Missing, malformed, invalid, or expired
token returns `401`. - The endpoint derives identity from the verified
token, not from caller-supplied identifiers.

Do not treat the examples as a mandate to duplicate existing routes. If
the repository already has equivalent paths, preserve compatible
existing paths and document the decision.

## 6. Required acceptance tests

At minimum, add tests for:

### Registration

-   Valid patient registration succeeds.
-   Valid doctor registration succeeds.
-   Duplicate email is rejected, including case/whitespace normalization
    behavior.
-   Missing or malformed email is rejected.
-   Missing/weak/invalid password is rejected according to the
    documented policy.
-   `role: "admin"` is rejected.
-   Unknown or malformed role is rejected.
-   Password hash is persisted, and plaintext password/hash are not
    returned.
-   Database uniqueness prevents duplicate users under concurrent
    registration attempts where practical to test.

### Login and JWT

-   Valid credentials succeed and issue a verifiable token.
-   Wrong password fails.
-   Unknown email fails with the same generic authentication
    message/status as wrong password.
-   Missing required authentication configuration fails safely at
    startup or refuses token operations, according to project
    conventions.
-   Token has an expiry and contains no password or sensitive
    personal/medical data.
-   Missing, malformed, invalid-signature, and expired tokens are
    rejected.

### Identity and RBAC

-   `GET /api/v1/auth/me` works with a valid token.
-   It rejects requests with no token and invalid/expired tokens.
-   Role helper allows an explicitly permitted role and rejects a
    disallowed role with `403`.
-   Public registration cannot create an admin or change an existing
    user's role.
-   A request-supplied `role` or `userId` cannot override the verified
    identity.

### Regression and safety

-   Existing health/readiness behavior continues to work.
-   Existing baseline tests continue to pass.
-   Error responses do not leak stack traces, SQL errors, password
    hashes, JWT secrets, or tokens.
-   Tests are repeatable and do not depend on production data.

## 7. Implementation sequence

Work in small steps; run focused tests after each step.

1.  **Reconnaissance:** inspect project structure, schema/migration
    history, auth dependencies, environment validation, error handling,
    route registration, and test setup. Report any conflicts before
    changing architecture.
2.  **Schema:** add only the missing user/auth schema requirements via a
    new migration if needed. Verify it applies cleanly.
3.  **Password utility:** implement and test password hashing and
    verification using a maintained compatible library.
4.  **Registration:** implement validation, normalized email, allowed
    roles, unique-email handling, and safe response.
5.  **Login/JWT:** implement credential verification and token issuance
    using environment configuration.
6.  **Middleware/RBAC:** implement Bearer-token verification, request
    identity, role checks, and `GET /auth/me`.
7.  **Tests:** add the acceptance tests; fix failures before proceeding.
8.  **Review:** inspect diff for accidental secrets, unsafe role
    assignment, token/password logging, inconsistent errors, and
    unrelated changes.
9.  **Documentation:** update the API contract, change log, architecture
    only if needed, and roadmap status based on verified results.
10. **Final report:** list changed files, migrations, commands executed,
    actual test results, remaining risks, and any blockers. Do not claim
    a test passed unless it was actually run.

## 8. Environment and Git safety

-   Do not ask the user to share `.env` contents or secrets.
-   Do not print secrets in logs or reports.
-   Confirm `.env` is ignored by Git; do not stage or commit it.
-   Use the existing local PostgreSQL setup unless a safe test database
    is configured.
-   Never delete or reset the user's database as part of this phase.
-   Do not alter applied migration files; use a new migration for
    changes.
-   Do not use forceful dependency remediation without reviewing the
    proposed package changes and explaining the risk.

## 9. Definition of done / exit criteria

Phase 2 is complete only when all of the following are true:

-   [ ] Patient and doctor registration work and are validated.
-   [ ] Passwords are securely hashed and never returned or logged.
-   [ ] Login verifies credentials and issues expiring signed JWTs.
-   [ ] Token verification middleware rejects missing, malformed,
    invalid, and expired tokens.
-   [ ] Basic RBAC helper works and returns correct `401`/`403`
    semantics.
-   [ ] Admin self-registration and role escalation are blocked.
-   [ ] Required acceptance tests are implemented and run successfully.
-   [ ] Existing baseline tests still pass.
-   [ ] No applied migration was rewritten and no secret was committed.
-   [ ] `API_CONTRACT.md` and the change log match actual behavior.
-   [ ] Roadmap status is updated based on evidence, with remaining gaps
    recorded.

## 10. Handoff prompt for Antigravity

Use this prompt together with the five project reference files:

> Implement **Phase 2 --- Authentication Part 1: Core Identity** in the
> current Amrutam backend workspace, strictly following
> `PHASE_2_IMPLEMENTATION_PLAN.md`.
>
> First read the original assignment/PRD,
> `Amrutam_Backend_Development_Change_Log.md`,
> `Amrutam_Backend_Implementation_Roadmap.md`, `ARCHITECTURE.md`, and
> `API_CONTRACT.md`. Inspect the existing source tree, schema,
> migrations, package scripts/dependencies, environment validation,
> error handling, and test setup before editing.
>
> Treat repository code, applied migrations, and executed tests as the
> source of truth. Preserve existing conventions. Do not rewrite applied
> migrations; add a new numbered migration only if necessary. Implement
> patient/doctor registration, secure password hashing, login/JWT
> issuance, reusable JWT verification middleware, basic RBAC, a
> protected identity endpoint, input validation, and the acceptance
> tests specified in the plan. Public admin registration and role
> escalation must be impossible.
>
> Do not implement MFA, booking, doctor availability/search,
> consultations, prescriptions, payments, analytics, deployment, or
> unrelated refactors in this phase. Do not expose or request secrets;
> do not modify/reset the user's database destructively.
>
> Run the relevant tests and existing regression tests. Update
> `API_CONTRACT.md`, `Amrutam_Backend_Development_Change_Log.md`,
> `ARCHITECTURE.md` only if necessary, and roadmap status based on
> verified results. Do not claim tests or features are complete unless
> you verified them.
>
> Finish with a concise report of: files changed, migration added (if
> any), endpoints implemented, tests actually run and their results,
> remaining risks/follow-ups, and blockers. If repository structure or
> the existing schema conflicts with the plan, explain the conflict and
> make the smallest safe decision instead of guessing.
