# Operations and recovery

## Local run

Use Node.js 22 (local validation also ran on Node 20.19) and PostgreSQL 15+. From `amrutam-backend`: `npm ci`, configure `.env`, run `npm run migrate`, then `npm start`. Run `npm run worker` in a separate terminal for asynchronous analytics. Health: `/api/v1/health`; readiness: `/api/v1/health/ready`; schema: `/api/v1/openapi.json`.

Generate JWT and MFA keys independently with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The MFA key must be exactly 64 hex characters. Never commit these values. The local helper `node scripts/configure-local-mfa.js` only adds a missing MFA key to an existing ignored `.env`; it never rotates an existing key.

## Containers and deployment

The Docker image runs as non-root and contains production dependencies only. Set `POSTGRES_PASSWORD` (URL-safe), `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, and optionally `CORS_ORIGIN` in an ignored deployment `.env`. Run `docker compose up --build -d`. Database readiness precedes the one-shot migration service; API/worker start only after migrations succeed. PostgreSQL data persists in a named volume. Do not run `docker compose down -v` against data you need.

The development stack binds HTTP and Jaeger UI to localhost. For an operator-provisioned host with public DNS, set `DOMAIN` and use `docker compose -f compose.yaml -f compose.production.yaml up -d`; Caddy provides HTTPS. Configure the firewall and restrict access to Docker/SSH. This is single-host container infrastructure, not a validated highly available cloud cluster. Review images, least-privilege DB roles, secrets delivery, backup storage and capacity before production use.

CI runs install, unit/integration tests, OpenAPI validation, npm audit and image build. The manually dispatched publication workflow pushes a commit-tagged GHCR image. Neither remote CI execution nor public deployment is implied by checking these files in. Use immutable image tags for rollout/rollback; apply forward-compatible schema changes first. Do not roll back a database by dropping clinical data.

## Metrics, logs and traces

- Structured JSON request logs contain request ID, route template, status and duration. Application errors include a safe error name; bodies, tokens and secrets are excluded.
- `GET /api/v1/admin/metrics` exposes Prometheus counters/histograms and process metrics to an MFA-authenticated administrator. For a scraper, configure a Bearer token securely and renew it before expiry. No long-lived unauthenticated metrics endpoint is provided.
- Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector>:4318` to enable HTTP/Express/PostgreSQL tracing. The start/worker commands preload instrumentation. Compose points to its Jaeger collector; UI is available at `http://localhost:16686`. Local tests verify metrics; end-to-end collector export must be verified in the selected deployment.
- Suggested alerts: sustained 5xx ratio >1%, read/write latency over target, readiness failures, pool saturation, increasing failed jobs, and repeated authentication failures. These alert thresholds are planning values, not measured SLOs.

## Asynchronous work

Clinical transitions and new prescriptions enqueue aggregate-refresh jobs in the same transaction. Run the worker to drain `outbox_jobs`. Jobs use transactional claims and idempotent snapshot replacement. Transient errors retry with exponential backoff/jitter, at most five attempts; permanent failures remain `failed`. Review errors before manually rescheduling failed rows. There are no external email/SMS/payment providers configured.

## Backup and disaster recovery

Use managed encrypted backups and continuous WAL archiving/PITR where supported. Store encrypted backup copies off-host and separate encryption keys from backups. Limit backup read permissions and define retention with the business. Proposed RPO 15 minutes/RTO 1 hour require validation; neither is achieved evidence.

Example operator procedure (substitute safe environment variables; do not paste credentials):

1. Take a logical backup with `pg_dump --format=custom --file=amrutam.backup "$DATABASE_URL"` or the equivalent PowerShell command.
2. Encrypt the backup with the organization's approved key-management tool and transfer it to restricted off-host storage.
3. Restore into a newly created isolated database using `pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" amrutam.backup`.
4. Validate migration history, primary/foreign keys, active-slot/prescription uniqueness, table counts, health/readiness, and representative authorized workflows.
5. Record backup timestamp, restore completion, recovery point, errors and operator approval. Never test destructive restores against the developer/production database.

No backup/restore drill or 99.95% availability measurement has been performed for this submission. A real incident runbook must include accountable owners, escalation, legal/privacy review and patient communication policy.
