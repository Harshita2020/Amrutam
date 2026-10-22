ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_secret TEXT,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret TEXT,
  ADD COLUMN IF NOT EXISTS mfa_pending_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS mfa_recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS prescriptions_doctor_key_uidx
  ON prescriptions (doctor_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prescriptions_consultation ON prescriptions (consultation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_consultations_created_status ON consultations (created_at, status);

CREATE TABLE IF NOT EXISTS outbox_jobs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('refresh_analytics')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_jobs (available_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id INTEGER PRIMARY KEY CHECK (id=1),
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
