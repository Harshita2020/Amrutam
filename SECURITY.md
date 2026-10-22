# Security checklist and threat model

## Trust boundaries and data classification

Untrusted clients cross the HTTPS edge into the API. Verified tokens do not replace resource authorization. The API/worker access PostgreSQL through configured credentials. The OTLP collector and container registry are operational boundaries. Future payment callbacks require provider verification; no callback endpoint is currently exposed.

- Credentials: bcrypt password hashes, encrypted MFA seeds, hashed recovery codes, JWT/MFA keys. Never log or commit secrets.
- Health records: consultation/prescription content. Restrict to owner patient, assigned doctor, or explicitly permitted MFA-authenticated admin. Audit access; never put prescription details in ordinary logs.
- Personal data: email, name, phone. Bound inputs, minimize collection, restrict profile writes.
- Operational data: aggregate metrics, audit identifiers, logs. Metrics/audit APIs require admin MFA. Collector UIs bind to localhost in Compose.

## Implemented controls

- [x] bcrypt cost 12, normalized unique email, generic credential failures and dummy password comparison for unknown accounts.
- [x] HS256 signature/expiry checks, current account/role checks, session-version revocation.
- [x] TOTP enrollment and confirmation; authenticated encryption at rest for seeds; one-time recovery codes; replay prevention under row locks.
- [x] Dedicated auth rate limiter; global limiter with consistent 429 JSON; 100KB JSON limit; Helmet and explicit CORS.
- [x] Public admin registration forbidden; privileged admin CLI requires operator-supplied environment credentials and never silently promotes an existing user.
- [x] Clinical doctor/admin access requires MFA; patients have resource ownership checks.
- [x] Strict request schemas and parameterized SQL; no client-supplied SQL columns.
- [x] Booking/prescription concurrency and idempotency backed by PostgreSQL locks/constraints.
- [x] Sensitive clinical reads/writes, MFA events, login success/failure, and admin actions audited.
- [x] Logs exclude credentials, tokens, query strings and clinical bodies. Tracing avoids parameter-value reporting.
- [x] Non-root application container; production TLS edge configuration; protected metrics endpoint.
- [x] Lockfile and automated dependency audit in CI; no critical findings are knowingly accepted.

## Threats and residual risks

| Threat / OWASP category | Control | Residual work |
|---|---|---|
| Broken object authorization | Role plus owner/assigned-doctor checks, negative tests | Periodic authorization review; constrain admin privileges further if policy demands |
| Credential stuffing | Password hashing, MFA, IP throttle, generic errors | Distributed account/IP throttling; abuse monitoring; no password reset/email verification provider yet |
| Token theft | Short lifetime, revoke-all, MFA enrollment invalidation | Secure client-side token storage; refresh tokens intentionally absent |
| SQL injection / mass assignment | Parameterized SQL, strict field allow-lists | Continue negative input tests for future modules |
| Double booking / duplicate clinical writes | Locks, transactions, unique indexes, idempotency | Benchmark high contention; define idempotency retention policy before deleting records |
| Secret/medical data disclosure | AES-GCM seeds, safe errors/logs, TLS configuration | Managed disk/backup encryption, key custody, retention policy and jurisdiction review |
| Audit tampering | Append-oriented application writes, restricted API | Separate least-privilege database role, archival integrity/WORM storage; DB owner can still alter records |
| Resource exhaustion | Bounded pages/body size, pool limits, rate limiting | Edge connection limits, distributed limits, measured autoscaling |
| Supply chain | npm lockfile/audit, test/build CI | Pin container/action digests for production and monitor advisories continuously |

## Key rotation and recovery

JWT key rotation invalidates all current tokens. Replace the secret through deployment configuration and restart API instances together. MFA encryption key rotation requires a controlled re-encryption migration: decrypt with the old key and encrypt with the new key in an isolated maintenance process, verify, then switch configuration. Do not replace the MFA key blindly or enrolled users will be locked out. Back up keys separately from encrypted database backups with restricted access.

Recovery codes are displayed once and stored only as hashes. There is no public MFA-disable or unauthenticated recovery bypass. Lost authenticator plus lost recovery codes requires an operator-assisted, identity-verified recovery policy; that workflow is not implemented. Healthcare compliance certification and production readiness are not claimed. Establish legal retention, access, consent, incident-response and breach-notification requirements before handling real patient data.
