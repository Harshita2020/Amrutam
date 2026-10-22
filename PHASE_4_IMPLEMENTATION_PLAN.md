# Phase 4 Implementation Plan

**Project:** Amrutam Telemedicine Backend  
**Status:** Draft — validate against the repository PRD, API contract, roadmap, and existing Phase 4 plan before implementation.  
**Priority:** Submission-focused; implement only requirements supported by project documentation.

## 1. Objective

Implement the next documented phase without destabilizing completed Phase 3 work. Keep Phase 4 changes isolated, tested, and documented so Phase 3 can be committed as a clean checkpoint first.

## 2. Pre-implementation checks

- Read the PRD, API contract, architecture, roadmap, and any existing Phase 4 plan.
- Inspect the current schema, migrations, routes, middleware, and test conventions.
- Confirm the exact Phase 4 scope and dependencies on Phase 3.
- Preserve existing user changes and database data.
- Prefer committing Phase 3 as a clean checkpoint before Phase 4 implementation.

## 3. Candidate workstream: appointments/bookings

> Provisional only: validate against the repository's actual Phase 4 requirements. Remove or revise anything not in scope.

### 3.1 API and data model
- Define the booking lifecycle and permitted state transitions from the specification.
- Define request/response schemas and consistent error responses.
- Add a migration only if required; never reset or drop existing data.

### 3.2 Authorization and validation
- Require authentication for protected operations.
- Enforce role-based access and resource ownership.
- Validate identifiers, request bodies, and booking eligibility.
- Ensure only eligible, approved doctors and bookable slots can be selected if required by the specification.

### 3.3 Transaction and concurrency safety
- Prevent two requests from successfully claiming the same slot.
- Use PostgreSQL transactions and appropriate row locking and/or database constraints.
- Roll back failed operations cleanly and return a documented conflict response.

### 3.4 Lifecycle endpoints
- Implement only endpoints required by the existing API contract (for example, create, list/view, or cancel a booking if specified).
- Enforce allowed transitions and prevent invalid or repeated transitions.

## 4. Automated tests

Add tests following existing project conventions for in-scope behavior:

- Successful primary flow.
- Missing or invalid fields and malformed identifiers.
- Unauthenticated and unauthorized requests.
- Nonexistent resources and ownership violations.
- Already-booked/unavailable slots and conflicting requests.
- Concurrent booking attempts, where applicable.
- Valid and invalid lifecycle transitions, where applicable.
- Regression coverage for existing authentication, doctor, and slot endpoints.

Run relevant tests and the full test suite when practical. Report actual results; do not claim unrun tests passed.

## 5. Documentation

Update existing project documents rather than creating duplicates:

- Change log: Phase 4 changes, migrations, endpoints, and test results.
- API contract: methods, paths, authentication, request/response examples, and errors.
- Roadmap/phase plan: accurate status and remaining work.
- Architecture/schema notes: only where implementation changes them.
- README: setup or test instructions only if they change.

## 6. Safety and scope controls

- Do not drop, reset, or destructively modify the database.
- Review migrations before applying them to any environment.
- Do not introduce an admin dashboard or approval endpoint unless explicitly required.
- Avoid unrelated refactoring and dependency changes.
- Preserve Phase 3 behavior.
- Do not mark work complete until implementation and automated tests support that status.

## 7. Definition of done

- [ ] Implementation matches documented Phase 4 scope.
- [ ] Required migrations are reviewed and safely applied only in the intended environment.
- [ ] Authentication, authorization, validation, and conflict handling are covered.
- [ ] Relevant automated tests pass.
- [ ] Full test-suite result is recorded.
- [ ] Existing documentation is updated consistently.
- [ ] Changed files and known limitations are summarized.
- [ ] Phase 3 and Phase 4 changes remain clearly separable in Git history where practical.

## 8. Final report required from the implementation agent

1. Features implemented.
2. Files changed and why.
3. Migrations added and their effects.
4. Tests run and exact results.
5. Remaining issues or assumptions.
6. Safe next steps for review and submission.
