# Five-minute submission demo

Record your screen and narration. Do not show `.env`, passwords, JWTs, authenticator seeds, recovery codes, or real patient data.

## 0:00–0:40 — Overview

Open `ARCHITECTURE_BRIEF.md`. Explain the three roles, modular monolith, PostgreSQL source of truth, and shared booking/consultation lifecycle. Point to the ER and booking sequence diagrams.

## 0:40–1:30 — Running API and contract

From `amrutam-backend`, start with `npm start`. In another terminal, request `/api/v1/health` and `/api/v1/health/ready`. Open `/api/v1/openapi.json` or import `openapi.json` into your API client. Show endpoint groups and exact request fields. Explain that doctor/admin clinical operations require MFA.

## 1:30–3:15 — Verified workflows

Run `npm run test:integration -- --reporter=verbose`. Explain that the runner creates a disposable PostgreSQL database, applies migrations, executes real HTTP/database flows, and removes the database afterward. Highlight tests for:

- Two patients competing for one slot and concurrent identical retries.
- Cancellation/rebooking without losing history.
- MFA enrollment, old-token invalidation, missing-factor rejection, recovery-code single use.
- Doctor-only consultation transitions, prescription idempotency, cross-patient denial.
- Audit rollback and asynchronous analytics jobs.

These tests execute the workflows; do not imply they are manual UI demonstrations. If you have time, use your API client for registration/login/booking with synthetic records, masking credentials and tokens.

## 3:15–4:10 — Quality and operations

Run `npm test`, `npm run validate:openapi`, and `npm audit --audit-level=moderate`. Show Dockerfile, Compose, and CI workflow. Explain metrics/logs/traces, protected metrics access, worker retry policy, and the optional Jaeger collector.

## 4:10–5:00 — Security and honest limits

Open `SECURITY.md` and `SUBMISSION.md`. Explain encrypted MFA seeds, recovery hashes, resource authorization, idempotency locks and secret handling. State that payment-provider integration, distributed throttling, cloud high availability, load targets, legal compliance certification and backup restore drills are not claimed. End with the repository URL and the exact test/build results recorded in the submission report.
