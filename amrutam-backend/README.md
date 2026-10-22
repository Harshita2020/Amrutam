# Amrutam Backend

Starter backend for the Amrutam telemedicine assignment. Built with Node.js, Express, and PostgreSQL.

## Prerequisites
- Node.js 20+
- PostgreSQL 15+

## Setup
1. Install dependencies: `npm install`
2. Create a PostgreSQL database named `amrutam`.
3. Copy `.env.example` to `.env` and update `DATABASE_URL` and `JWT_SECRET`. `JWT_EXPIRES_IN` is optional and defaults to `15m` (maximum `24h`).
4. Apply the initial schema and Phase 2 migration using your PostgreSQL client:
   `psql "$DATABASE_URL" -f src/db/migrations/001_initial_schema.sql`
   `psql "$DATABASE_URL" -f src/db/migrations/002_normalized_user_email.sql`
5. Start development server: `npm run dev`
6. Run tests: `npm test`

## Initial endpoints
- `GET /api/v1/health` — process health check
- `GET /api/v1/health/ready` — readiness check including PostgreSQL connectivity
- `POST /api/v1/auth/register` — register a patient or doctor
- `POST /api/v1/auth/login` — verify credentials and issue a JWT access token
- `GET /api/v1/auth/me` — return the authenticated user's safe identity

## Security notes
- Never commit `.env` or real credentials.
- Use a long, random JWT secret; rotate secrets if exposed.
- The included rate limit is a basic single-process limit. Use a shared store such as Redis when deploying multiple instances.
- Production TLS, secret management, backups, monitoring, and deployment configuration still need to be completed and verified.

## Current scope
Core identity (patient/doctor registration, password hashing, JWT login, authentication middleware, and role checks) is implemented. This is not a finished production system: MFA, password recovery, email verification, refresh-token handling, booking, consultation, prescription, payments, admin analytics, OpenAPI documentation, CI, and full observability remain to be implemented.
