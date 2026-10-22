-- Migration 004: Booking enhancements and cancellation indexes
-- Supports rebooking previously cancelled slots and optimizes booking status queries.

-- 1. Drop the strict UNIQUE (slot_id) constraint if it exists,
-- and replace it with a partial unique index that only enforces uniqueness for non-cancelled bookings.
-- This allows a cancelled slot to be safely re-released and rebooked.
ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_slot_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS consultations_active_slot_uidx
  ON consultations (slot_id)
  WHERE status != 'cancelled';

-- 2. Performance indexes for patient bookings queries and status filtering
CREATE INDEX IF NOT EXISTS idx_consultations_patient_status
  ON consultations (patient_id, status);

CREATE INDEX IF NOT EXISTS idx_consultations_status
  ON consultations (status);
