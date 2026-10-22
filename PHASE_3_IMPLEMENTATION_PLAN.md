# Amrutam Backend — Phase 3 Implementation Plan

**Phase:** 3 — Doctor Profiles, Availability, and Search  
**Application directory:** `amrutam-backend/`  
**Documentation/repository root:** `D:\Amrutam`  
**Status:** Complete (verified via automated regression test suite; manual Thunder Client testing in progress)

## 1. Goal

Build the doctor discovery and availability layer on top of the completed core identity layer from Phase 2. Authorized doctors should be able to maintain their permitted profiles and create/manage their availability. Clients should be able to search discoverable doctors and view their public profiles and available slots.

The work must fit the existing Express/PostgreSQL structure. The current source code, applied migrations, and test results take precedence over assumptions in this plan.

## 2. Read first and inspect before editing

Read:
1. Original assignment / `PRD.md`
2. `Amrutam_Backend_Development_Change_Log.md`
3. `Amrutam_Backend_Implementation_Roadmap.md`
4. `ARCHITECTURE.md`
5. `API_CONTRACT.md`
6. `PHASE_2_IMPLEMENTATION_PLAN.md`

Inspect inside `amrutam-backend/`:
- Existing user/auth routes and middleware from Phase 2
- `001_initial_schema.sql` and all later migrations, plus current table definitions
- Existing profile, doctor, and availability-slot tables/columns/indexes/constraints
- `package.json`, environment config, validation patterns, centralized errors, and test patterns
- Git status and ignore rules

Do not assume the logical schema in `ARCHITECTURE.md` is fully present in the database. Do not change an applied migration. Use a new numbered migration if a schema change is required. Never reset or drop the local database.

## 3. In scope

### 3.1 Doctor profile persistence

- Reuse existing tables and compatible fields where possible.
- Confirm how a doctor account maps to a doctor profile and how profile identity relates to the authenticated user ID.
- Ensure a doctor profile is linked to exactly the appropriate user and has consistent foreign-key/uniqueness rules.
- If required tables/columns are missing, add a safe, additive migration with appropriate foreign keys, `NOT NULL` / `CHECK` constraints, indexes, and timestamps where justified.
- Define a small, documented allow-list of doctor-editable profile fields based on the actual schema and assignment. Suitable fields may include specialty and non-sensitive professional profile details only if those fields exist or are safely added.
- Do not allow doctors to update their account role, user ID, verification/approval status, or other privileged/internal fields through profile update.
- Do not expose password hashes, account secrets, internal flags, or private fields in public responses.

### 3.2 Endpoints to implement

These are the target routes from `API_CONTRACT.md`. Reuse any equivalent existing routes rather than creating duplicates, and update the API contract if an evidence-based change is needed.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/doctors` | Public discovery, subject to profile visibility policy | Search/filter doctor profiles |
| `GET` | `/api/v1/doctors/:doctorId` | Public discovery, subject to profile visibility policy | Read a safe public profile |
| `PATCH` | `/api/v1/doctors/me` | Authenticated doctor | Update own permitted profile fields |
| `GET` | `/api/v1/doctors/:doctorId/slots` | Public or the existing contract's policy | List available slots for a discoverable doctor |
| `POST` | `/api/v1/doctors/me/slots` | Authenticated doctor | Create an availability slot |
| `PATCH` | `/api/v1/doctors/me/slots/:slotId` | Authenticated owning doctor | Update an eligible own slot |
| `DELETE` | `/api/v1/doctors/me/slots/:slotId` | Authenticated owning doctor | Remove an eligible own unbooked slot |

Use the Phase 2 JWT middleware. Derive the acting user from the verified token; do not accept a caller-supplied doctor/user ID as proof of identity. If admin slot management is required by an existing route/policy, implement it only through an explicit, authorization-checked route; do not accidentally grant admin access through a `/me` endpoint.

### 3.3 Profile update validation

- Require the doctor role and an existing profile linked to that authenticated user.
- Validate each accepted field and length/type/range.
- Reject unknown and privileged fields (including `role`, `userId`, `verificationStatus`, and equivalent database names).
- Do not allow public or self-service updates to approve or verify a doctor.
- Use parameterized database queries and consistent success/error shapes.
- Return only safe profile fields.

### 3.4 Doctor search and profile read

- Support validated `specialty` filtering and the documented `q` text-search parameter only across intentional public-search fields.
- Support bounded pagination using the convention chosen in `API_CONTRACT.md` (prefer the documented cursor design if the existing code can support it cleanly). Apply a server-side default and maximum `limit`.
- Allow-list sort/filter options; never interpolate client-supplied SQL columns or sort expressions.
- Exclude non-discoverable/unapproved profiles according to a clearly documented visibility policy. Do not let a doctor self-approve. If approval is not implemented in this phase, record how a local development/test doctor may be marked discoverable without exposing an unsafe public approval endpoint.
- Return deterministic ordering and only intended public fields.
- Return a consistent not-found response for invalid or unavailable doctor profiles, following the project's existing error conventions.

### 3.5 Availability slots

Create slots using a request compatible with the API contract, such as:

```json
{
  "startsAt": "2026-10-25T09:00:00Z",
  "endsAt": "2026-10-25T09:30:00Z"
}
```

Requirements:
- Parse/validate timestamps and store/compare them consistently using PostgreSQL timezone-aware timestamps where compatible with the existing schema.
- Require `endsAt` to be later than `startsAt`.
- Reject malformed dates, invalid intervals, past slots if that is the chosen policy, duplicate slots, and overlapping slots for the same doctor.
- Define and document slot status values based on the actual schema; create new status values only when justified.
- Prefer enforcing overlap/duplicate safety at the database level or with correct transactional/concurrency control, not only a pre-insert application check.
- A doctor must only update/delete their own slots. A guessed slot ID belonging to another doctor must not allow modification.
- Do not delete a slot that is already referenced by a booking/consultation or otherwise protected by the current schema. Booking is Phase 4; do not implement booking in this phase.
- List only genuinely available slots in public discovery results, according to the chosen status/time rules.
- Make update/delete behavior and error codes consistent and document whether deletion is hard delete, soft delete, or a status change.

## 4. Explicitly out of scope

Do not implement in Phase 3:
- Appointment booking/cancellation, idempotency keys, payment, or booking concurrency workflows (Phase 4).
- Consultation lifecycle, prescriptions, and clinical record access (Phase 6).
- MFA, account recovery, refresh-token rotation, email verification, or the complete security-hardening phase (Phase 5), except fixes that are necessary to preserve existing safe authentication.
- A public doctor-approval endpoint or a full admin review portal.
- Notifications, Redis, background workers, advanced caching, metrics/tracing, deployment/IaC, or broad refactoring.
- Unrelated dependency upgrades or `npm audit fix --force`.

## 5. Required tests

Add automated tests using the existing test framework. Follow existing mocking/integration patterns; database-backed tests must use a safe test setup and must not write to the developer's normal database unintentionally.

### Doctor profiles
- Authenticated doctor can update permitted fields on their own profile.
- Patient and unauthenticated caller cannot update a doctor profile.
- Doctor cannot update another doctor's profile.
- Attempts to change role, owner/user ID, verification/approval status, or unsupported fields are rejected.
- Invalid field values return safe validation errors.
- Public profile response omits private/internal fields and does not expose secrets.

### Search
- Doctor list returns expected results.
- Specialty and `q` filters return correct matches.
- Invalid filters and invalid pagination are rejected.
- Pagination is bounded, deterministic, and does not duplicate entries across pages.
- Non-discoverable profiles are excluded according to the documented policy.
- SQL injection-like filter/sort input cannot alter the query.
- Missing/invalid doctor ID produces the documented safe error.

### Availability
- Doctor can create a valid slot.
- `endsAt <= startsAt`, malformed timestamps, and invalid intervals are rejected.
- Duplicate and overlapping slots for the same doctor are rejected, including a database/concurrency test where practical.
- Doctor A cannot update/delete Doctor B's slot.
- Patient and unauthenticated caller cannot create or mutate slots.
- Attempts to update/delete nonexistent slots return the documented response.
- A protected/booked/referenced slot cannot be deleted if such references are possible in the existing schema.
- Slot listing excludes cancelled, elapsed, or otherwise unavailable slots according to the documented rule.
- Existing Phase 2 and health/readiness regression tests continue to pass.

## 6. Implementation sequence

1. **Inspect:** Read docs and inspect real routes, migrations, schema, auth middleware, and tests. Report any conflict before making schema decisions.
2. **Data model:** Confirm profile/doctor/slot tables. Add only missing schema with a numbered additive migration, and verify the migration safely.
3. **Profile service and validation:** Add profile read/update logic with an explicit field allow-list and safe response projection.
4. **Doctor search:** Add list/detail endpoints, validated filters, bounded pagination, public-field projection, and discoverability rules.
5. **Availability service:** Add slot list/create/update/delete endpoints with owner checks, timestamp validation, overlap protection, and status rules.
6. **Tests:** Add required happy-path, validation, authorization, visibility, and conflict tests. Fix failures before proceeding.
7. **Regression/security review:** Run focused tests and then the full existing test suite. Review SQL parameterization, owner-ID derivation, public field exposure, migration safety, and secret handling.
8. **Documentation:** Update `API_CONTRACT.md` to match the implementation; update `ARCHITECTURE.md` only where the real design/schema differs; append verified work and test results to `Amrutam_Backend_Development_Change_Log.md`; update the roadmap Phase 3 status only when its exit criteria pass.
9. **Report:** State changed files, migration(s), endpoints, exact tests/results, known risks, and blockers. Never claim unrun tests or unimplemented behaviors as complete.

## 7. Definition of done

- [x] Doctors can update their own permitted profiles.
- [x] Public doctor search and detail endpoints work with safe field projection and documented discoverability rules.
- [x] Search filters/pagination are validated, bounded, and tested.
- [x] Doctors can create, list, update, and remove eligible availability slots under the documented rules.
- [x] Role checks and profile/slot ownership checks pass negative tests.
- [x] Invalid and overlapping slot intervals are rejected safely.
- [x] Database changes, if any, are additive and successfully verified.
- [x] All new tests and existing regression tests pass (63/63 tests passing).
- [x] `API_CONTRACT.md`, change log, and roadmap reflect verified behavior.
- [x] Booking, payments, consultations, and MFA remain out of scope for this phase.

> **Verification status:** Automated regression test suite is complete and passing (63 tests). Thunder Client manual verification is being conducted separately by the developer prior to git commit.

## 8. Antigravity handoff prompt

> Implement **Phase 3 — Doctor Profiles, Availability, and Search** strictly following `PHASE_3_IMPLEMENTATION_PLAN.md`.
>
> First read the original PRD, `Amrutam_Backend_Development_Change_Log.md`, `Amrutam_Backend_Implementation_Roadmap.md`, `ARCHITECTURE.md`, `API_CONTRACT.md`, and `PHASE_2_IMPLEMENTATION_PLAN.md`. Inspect the actual source, all migrations, current database schema, authentication middleware, and tests before editing.
>
> Reuse the Phase 2 identity layer. Implement the doctor profile, search, and availability endpoints and all acceptance tests in this plan. Never rewrite an applied migration, reset the database, expose private profile fields, allow self-approval/role escalation, or let one doctor modify another doctor's profile/slots. Use additive migrations only if needed.
>
> Do not implement booking, consultations, prescriptions, payments, MFA, deployment, or unrelated refactors. Do not print or ask for `.env` secrets. Do not change dependencies unless a clear blocker requires it; explain first.
>
> Run focused tests and the full regression suite. Update `API_CONTRACT.md`, `Amrutam_Backend_Development_Change_Log.md`, and the roadmap only with verified results. Update `ARCHITECTURE.md` only if needed.
>
> Finish with a concise report listing changed files, endpoints, migrations, actual test commands/results, remaining risks, and blockers. Begin by inspecting the repository, then continue through the implementation unless a destructive action or critical ambiguity requires approval.
