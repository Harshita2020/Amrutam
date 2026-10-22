import { transaction, audit } from '../db/transaction.js';
import { httpError } from '../utils/http-error.js';

export function createClinicalService({ pool }) {
  async function accessible(db, id, actor, lock = false) {
    const result = await db.query(`SELECT c.*, s.starts_at, s.ends_at FROM consultations c
      JOIN availability_slots s ON s.id=c.slot_id WHERE c.id=$1 ${lock ? 'FOR UPDATE OF c' : ''}`, [id]);
    const row = result.rows[0];
    if (!row) throw httpError(404, 'CONSULTATION_NOT_FOUND', 'Consultation not found');
    if (!(actor.role === 'admin' || (actor.role === 'patient' && row.patient_id === actor.userId) ||
      (actor.role === 'doctor' && row.doctor_id === actor.userId))) {
      throw httpError(403, 'FORBIDDEN', 'You cannot access this consultation');
    }
    return row;
  }
  const view = c => ({ id: c.id, slotId: c.slot_id, patientId: c.patient_id, doctorId: c.doctor_id,
    status: c.status, startsAt: c.starts_at, endsAt: c.ends_at, createdAt: c.created_at, updatedAt: c.updated_at });
  async function approved(db, actor) {
    const doctor = await db.query("SELECT user_id FROM doctor_profiles WHERE user_id=$1 AND verification_status='approved'", [actor.userId]);
    if (!doctor.rowCount) throw httpError(403, 'DOCTOR_NOT_APPROVED', 'An approved doctor is required');
  }
  async function enqueue(db) { await db.query("INSERT INTO outbox_jobs (kind) VALUES ('refresh_analytics')"); }
  return {
    async read(id, actor) {
      const row = await accessible(pool, id, actor);
      await audit(pool, actor.userId, 'CONSULTATION_READ', 'consultation', id);
      return view(row);
    },
    async list(actor, query) {
      const column = actor.role === 'doctor' ? 'doctor_id' : 'patient_id';
      const result = await pool.query(`SELECT c.*,s.starts_at,s.ends_at FROM consultations c
        JOIN availability_slots s ON s.id=c.slot_id WHERE c.${column}=$1
        AND ($2::text IS NULL OR c.status=$2) ORDER BY c.created_at DESC,c.id DESC LIMIT $3 OFFSET $4`,
        [actor.userId, query.status ?? null, query.limit + 1, query.offset]);
      await audit(pool, actor.userId, 'CONSULTATION_LIST', 'user', actor.userId);
      return { data: result.rows.slice(0, query.limit).map(view),
        pagination: { limit: query.limit, offset: query.offset, hasMore: result.rows.length > query.limit } };
    },
    async transition(id, status, actor) {
      return transaction(pool, async db => {
        const current = await accessible(db, id, actor, true);
        await approved(db, actor);
        if (current.status === status) return view(current);
        const next = { scheduled: 'in_progress', in_progress: 'completed' }[current.status];
        if (next !== status) throw httpError(409, 'INVALID_STATE_TRANSITION', 'Invalid consultation status transition');
        const result = await db.query('UPDATE consultations SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [status, id]);
        await audit(db, actor.userId, 'CONSULTATION_STATUS_CHANGED', 'consultation', id, { from: current.status, to: status });
        await enqueue(db);
        return view({ ...current, ...result.rows[0] });
      });
    },
    async prescribe(id, details, key, actor) {
      return transaction(pool, async db => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['prescription', actor.userId, key])]);
        const current = await accessible(db, id, actor, true);
        await approved(db, actor);
        const previous = await db.query(`SELECT id,consultation_id AS "consultationId",doctor_id AS "doctorId",details,
          created_at AS "createdAt", details=$3::jsonb AS matches FROM prescriptions WHERE doctor_id=$1 AND idempotency_key=$2`,
          [actor.userId, key, JSON.stringify(details)]);
        if (previous.rowCount) {
          const { matches, ...record } = previous.rows[0];
          if (!matches || record.consultationId !== id) throw httpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused with a different payload');
          return record;
        }
        if (!['in_progress', 'completed'].includes(current.status)) throw httpError(409, 'INVALID_STATE_TRANSITION', 'Prescriptions require an in-progress or completed consultation');
        const result = await db.query(`INSERT INTO prescriptions (consultation_id,doctor_id,details,idempotency_key)
          VALUES ($1,$2,$3,$4) RETURNING id,consultation_id AS "consultationId",doctor_id AS "doctorId",details,created_at AS "createdAt"`,
          [id, actor.userId, JSON.stringify(details), key]);
        await audit(db, actor.userId, 'PRESCRIPTION_CREATED', 'prescription', result.rows[0].id, { consultationId: id });
        await enqueue(db);
        return result.rows[0];
      });
    },
    async prescriptions(id, actor, query) {
      await accessible(pool, id, actor);
      const result = await pool.query(`SELECT id,consultation_id AS "consultationId",doctor_id AS "doctorId",details,created_at AS "createdAt"
        FROM prescriptions WHERE consultation_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, [id, query.limit + 1, query.offset]);
      await audit(pool, actor.userId, 'PRESCRIPTION_READ', 'consultation', id);
      return { data: result.rows.slice(0, query.limit), pagination: { limit: query.limit, offset: query.offset, hasMore: result.rows.length > query.limit } };
    }
  };
}
