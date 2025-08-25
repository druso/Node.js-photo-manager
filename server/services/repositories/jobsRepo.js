// Jobs repository for durable async pipeline
// Provides enqueue, claim, progress updates, and listing helpers

const { getDb, withTransaction } = require('../db');

function nowISO() {
  return new Date().toISOString();
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    type: row.type,
    status: row.status,
    priority: row.priority ?? 0,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    progress_total: row.progress_total,
    progress_done: row.progress_done,
    payload_json: row.payload_json ? JSON.parse(row.payload_json) : null,
    error_message: row.error_message,
    worker_id: row.worker_id,
    heartbeat_at: row.heartbeat_at,
    attempts: row.attempts ?? 0,
    max_attempts: row.max_attempts ?? null,
    last_error_at: row.last_error_at ?? null,
  };
}

function getById(id) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
  return rowToJob(row);
}

function listByProject(project_id, { limit = 50, offset = 0, status, type } = {}) {
  const db = getDb();
  const conds = ['project_id = ?'];
  const params = [project_id];
  if (status) { conds.push('status = ?'); params.push(status); }
  if (type) { conds.push('type = ?'); params.push(type); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map(rowToJob);
}

function enqueue({ tenant_id, project_id, type, payload = null, progress_total = null, priority = 0 }) {
  const db = getDb();
  const created_at = nowISO();
  const info = db.prepare(`INSERT INTO jobs (tenant_id, project_id, type, status, created_at, progress_total, progress_done, payload_json, attempts, priority)
    VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, 0, ?)
  `).run(tenant_id, project_id, type, created_at, progress_total, payload ? JSON.stringify(payload) : null, priority);
  return getById(info.lastInsertRowid);
}

function enqueueWithItems({ tenant_id, project_id, type, payload = null, items = [], priority = 0 }) {
  // items: array of { photo_id?, filename?, status? }
  return withTransaction(() => {
    const job = enqueue({ tenant_id, project_id, type, payload, progress_total: items.length, priority });
    const db = getDb();
    const now = nowISO();
    const stmt = db.prepare(`INSERT INTO job_items (tenant_id, job_id, photo_id, filename, status, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of items) {
      stmt.run(tenant_id, job.id, it.photo_id ?? null, it.filename ?? null, it.status || 'pending', null, now, now);
    }
    return job;
  });
}

function claimNext({ workerId = null, tenant_id = null, minPriority = null, maxPriority = null } = {}) {
  const db = getDb();
  // Get next queued job honoring optional tenant and priority range
  const conds = ["status = 'queued'"];
  const params = [];
  if (tenant_id) { conds.push('tenant_id = ?'); params.push(tenant_id); }
  if (minPriority != null) { conds.push('priority >= ?'); params.push(minPriority); }
  if (maxPriority != null) { conds.push('priority <= ?'); params.push(maxPriority); }
  const where = `WHERE ${conds.join(' AND ')}`;
  const candidate = db.prepare(`SELECT id FROM jobs ${where} ORDER BY priority DESC, created_at ASC LIMIT 1`).get(...params);
  if (!candidate) return null;
  const started = nowISO();
  const info = db.prepare(`UPDATE jobs SET status='running', started_at=?, worker_id=?, heartbeat_at=? WHERE id = ? AND status='queued'`).run(started, workerId, started, candidate.id);
  if (info.changes === 1) return getById(candidate.id);
  return null; // lost the race
}

function heartbeat(id) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET heartbeat_at=? WHERE id = ? AND status='running'`).run(nowISO(), id);
}

function updateProgress(id, { done, total }) {
  const db = getDb();
  const sets = [];
  const params = [];
  if (typeof done === 'number') { sets.push('progress_done = ?'); params.push(done); }
  if (typeof total === 'number') { sets.push('progress_total = ?'); params.push(total); }
  if (!sets.length) return getById(id);
  params.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getById(id);
}

function updatePayload(id, payload) {
  const db = getDb();
  const now = nowISO();
  const json = payload ? JSON.stringify(payload) : null;
  db.prepare(`UPDATE jobs SET payload_json = ?, updated_at = ? WHERE id = ?`).run(json, now, id);
  return getById(id);
}

function complete(id) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET status='completed', finished_at=? WHERE id = ?`).run(nowISO(), id);
  return getById(id);
}

function fail(id, error_message) {
  const db = getDb();
  const now = nowISO();
  db.prepare(`UPDATE jobs SET status='failed', error_message=?, finished_at=?, last_error_at=? WHERE id = ?`).run(String(error_message || '').slice(0, 1000), now, now, id);
  return getById(id);
}

function cancel(id) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET status='canceled', finished_at=? WHERE id = ?`).run(nowISO(), id);
  return getById(id);
}

function cancelByProject(project_id) {
  const db = getDb();
  const now = nowISO();
  // Best-effort: mark any non-terminal jobs for this project as canceled
  db.prepare(`UPDATE jobs SET status='canceled', finished_at=? WHERE project_id = ? AND status IN ('queued','running')`).run(now, project_id);
}

function listItems(job_id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM job_items WHERE job_id = ? ORDER BY id ASC`).all(job_id);
}

function updateItemStatus(item_id, { status, message = null }) {
  const db = getDb();
  const now = nowISO();
  db.prepare(`UPDATE job_items SET status=?, message=?, updated_at=? WHERE id = ?`).run(status, message, now, item_id);
}

function nextPendingItem(job_id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM job_items WHERE job_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1`).get(job_id);
}

module.exports = {
  getById,
  listByProject,
  enqueue,
  enqueueWithItems,
  claimNext,
  heartbeat,
  updateProgress,
  updatePayload,
  complete,
  fail,
  cancel,
  cancelByProject,
  listItems,
  updateItemStatus,
  nextPendingItem,
};

// ---- Retry/Recovery helpers ----
function setDefaultMaxAttempts(id, maxAttempts) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET max_attempts = COALESCE(max_attempts, ?) WHERE id = ?`).run(maxAttempts, id);
}

function incrementAttempts(id) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET attempts = COALESCE(attempts, 0) + 1 WHERE id = ?`).run(id);
}

function clearRunFields(id) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET started_at=NULL, finished_at=NULL, worker_id=NULL, heartbeat_at=NULL WHERE id = ?`).run(id);
}

function requeue(id) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, worker_id=NULL, heartbeat_at=NULL WHERE id = ?`).run(id);
  return getById(id);
}

function requeueStaleRunning({ staleSeconds = 60 } = {}) {
  const db = getDb();
  const rows = db.prepare(`SELECT id FROM jobs WHERE status='running' AND heartbeat_at IS NOT NULL AND (strftime('%s','now') - strftime('%s', heartbeat_at)) > ?`).all(staleSeconds);
  const ids = rows.map(r => r.id);
  const stmt = db.prepare(`UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, worker_id=NULL, heartbeat_at=NULL WHERE id = ?`);
  const trx = db.transaction((arr) => { for (const i of arr) stmt.run(i); });
  trx(ids);
  return ids;
}

module.exports.setDefaultMaxAttempts = setDefaultMaxAttempts;
module.exports.incrementAttempts = incrementAttempts;
module.exports.clearRunFields = clearRunFields;
module.exports.requeue = requeue;
module.exports.requeueStaleRunning = requeueStaleRunning;
