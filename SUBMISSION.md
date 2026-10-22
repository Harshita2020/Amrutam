# Submission status — Amrutam telemedicine backend

Verified locally on 22 October 2026. Original assignment supplied as `Backend Developer Assignment (3).pdf`; its requirements take priority over inferred phase labels.

## Deliverables

| Assignment requirement | Delivered artifact / status |
|---|---|
| Code and infrastructure | Express/PostgreSQL source, five SQL migrations, Dockerfile, Compose stack and TLS overlay |
| README/setup | Root and backend README, environment example, migration/admin scripts |
| OpenAPI | `amrutam-backend/openapi.json`; schema validation command and CI check |
| Architecture (2–4 pages) | Four-page `ARCHITECTURE_SUBMISSION.pdf`; editable `ARCHITECTURE_BRIEF.md`; detailed `ARCHITECTURE.md` |
| Tests and CI | Regression/MFA tests, disposable PostgreSQL integration suites, GitHub Actions quality pipeline |
| Observability | JSON request logs, protected Prometheus metrics, optional OpenTelemetry/Jaeger tracing configuration |
| Security/threat model | `SECURITY.md`, MFA, session revocation, authorization, audit trails, dependency scan |
| Five-minute demo | `DEMO.md` recording sequence; recording and submission are the developer's remaining actions |

## Implemented workflows

- Patient/doctor registration, bcrypt login, JWT identity/role checks, current-account checks and session revocation.
- Authenticator MFA enrollment/confirmation, encrypted seeds, one-use TOTP windows and hashed recovery codes.
- Public approved-doctor discovery, profile management, availability and overlap protection.
- Booking/list/read/cancel, concurrent idempotency and preserved cancelled history.
- Patient consultation history, assigned-doctor lifecycle transitions, immutable prescriptions and idempotent prescription creation.
- MFA-protected admin analytics, doctor verification, audit access and metrics.
- Patient profile updates and asynchronous aggregate refresh through a transactional outbox worker.

## Verification evidence

- `npm test`: 107 tests passed across seven regression/security suites.
- `npm run test:integration -- --reporter=verbose`: 18 real PostgreSQL tests passed; database provisioned separately and removed afterward.
- `npm run validate:openapi`: OpenAPI 3.0.3 validated for 27 paths.
- `npm audit`: zero vulnerabilities after removing Nodemon and upgrading Vitest.
- Docker image build and runtime smoke passed: UID 1000 (non-root), health 200, OpenAPI 200, protected clinical route 401. Compose syntax validated with placeholder configuration.
- Actual OpenTelemetry export to a temporary local HTTP receiver passed; no external collector or clinical data was used.
- Local migration 005 applied; verified seven security columns, worker tables, and valid unique index definitions/predicates. User, consultation, prescription and audit counts were unchanged.

## Explicit limitations

This is a submission implementation, not evidence of production-grade uptime or compliance. 100k consultations/day, read/write latency targets, 99.95% availability, backup restore objectives, hosted encryption, and cloud disaster recovery have not been measured or certified. Remote CI/publication/deployment has not been run from this chat. A five-minute video is not automatically created.

Payments have a schema only; a live gateway, refunds and signed webhooks are not configured. Password-reset/email-verification delivery, refresh tokens, operator-assisted MFA recovery, distributed rate limiting, replica/cache/partition infrastructure and retention enforcement remain future work. Audit logs are append-oriented in application code, not tamper-proof against a database owner. Existing booking/auth handlers retain direct SQL; new clinical/MFA modules use explicit service boundaries.

## Before submitting

1. Run the commands above if you want a fresh local confirmation.
2. Review `git diff`; never stage `.env` or generated secrets. Commit the new work.
3. Push the repository and verify remote CI when available.
4. Record the walkthrough in `DEMO.md`, attach/share the video, and submit the repository with the architecture PDF and docs.
