-- Migration 003: Doctor profile verification status, timestamps, and indexes
ALTER TABLE doctor_profiles
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE availability_slots
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_doctor_profiles_discoverable
  ON doctor_profiles (verification_status, specialization);

CREATE INDEX IF NOT EXISTS idx_slots_doctor_status_start
  ON availability_slots (doctor_id, status, starts_at);
