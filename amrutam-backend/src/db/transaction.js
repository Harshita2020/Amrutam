export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function audit(db, actor, action, resourceType, resourceId, metadata = {}) {
  await db.query(`INSERT INTO audit_logs (actor_user_id,action,resource_type,resource_id,metadata)
    VALUES ($1,$2,$3,$4,$5)`, [actor, action, resourceType, resourceId, JSON.stringify(metadata)]);
}
