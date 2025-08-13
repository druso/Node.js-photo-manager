// SQLite database service using better-sqlite3
// Initializes per-user DB file, applies schema, and exposes helpers

const path = require('path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');

// For now we use a single default user DB. Later this can be parameterized.
const DB_DIR = path.join(__dirname, '../../.projects/db');
const DEFAULT_DB_FILE = path.join(DB_DIR, 'user_0.sqlite');

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  fs.ensureDirSync(DB_DIR);
  const db = new Database(DEFAULT_DB_FILE);
  db.pragma('journal_mode = WAL'); // better concurrency for readers+writes
  db.pragma('foreign_keys = ON');

  applySchema(db);
  dbInstance = db;
  return dbInstance;
}

function applySchema(db) {
  const ddl = `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    project_folder TEXT NOT NULL UNIQUE,
    project_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    schema_version TEXT
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    manifest_id TEXT UNIQUE,
    filename TEXT NOT NULL,
    basename TEXT,
    ext TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    date_time_original TEXT,
    jpg_available INTEGER NOT NULL,
    raw_available INTEGER NOT NULL,
    other_available INTEGER NOT NULL,
    keep_jpg INTEGER NOT NULL,
    keep_raw INTEGER NOT NULL,
    thumbnail_status TEXT,
    preview_status TEXT,
    orientation INTEGER,
    meta_json TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(project_id, name),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS photo_tags (
    photo_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (photo_id, tag_id),
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_photos_project_id ON photos(project_id);
  CREATE INDEX IF NOT EXISTS idx_photos_filename ON photos(project_id, filename);
  CREATE INDEX IF NOT EXISTS idx_photos_basename ON photos(project_id, basename);
  CREATE INDEX IF NOT EXISTS idx_photos_ext ON photos(project_id, ext);
  CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(project_id, date_time_original);
  CREATE INDEX IF NOT EXISTS idx_photos_raw ON photos(project_id, raw_available);
  CREATE INDEX IF NOT EXISTS idx_photos_orientation ON photos(project_id, orientation);

  -- Durable async jobs (global queue)
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    progress_total INTEGER,
    progress_done INTEGER,
    payload_json TEXT,
    error_message TEXT,
    worker_id TEXT,
    heartbeat_at TEXT,
    -- priority is part of the fresh-start schema; ensure for new DBs
    priority INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS job_items (
    id INTEGER PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    job_id INTEGER NOT NULL,
    photo_id INTEGER,
    filename TEXT,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_tenant_created ON jobs(tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON jobs(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id);
  CREATE INDEX IF NOT EXISTS idx_job_items_tenant ON job_items(tenant_id);
  `;

  db.exec(ddl);
  // Lightweight migrations for new columns (SQLite lacks IF NOT EXISTS for columns)
  ensureColumn(db, 'jobs', 'attempts', "ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, 'jobs', 'max_attempts', "ALTER TABLE jobs ADD COLUMN max_attempts INTEGER");
  ensureColumn(db, 'jobs', 'last_error_at', "ALTER TABLE jobs ADD COLUMN last_error_at TEXT");
  ensureColumn(db, 'jobs', 'priority', "ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
  // Create composite index after ensuring the column exists (for existing DBs)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created ON jobs(status, priority DESC, created_at ASC)`);
  } catch (e) {
    try { console.warn('[db] failed to create idx_jobs_status_priority_created:', e.message); } catch {}
  }
}

function withTransaction(fn) {
  const db = getDb();
  const trx = db.transaction(fn);
  return trx();
}

module.exports = {
  getDb,
  withTransaction,
  DB_DIR,
  DEFAULT_DB_FILE,
};

// ---- Helpers ----
function ensureColumn(db, table, column, alterSql) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    const hasCol = rows.some(r => r.name === column);
    if (!hasCol) {
      db.exec(alterSql);
    }
  } catch (e) {
    // Best effort; log and continue
    try { console.warn(`[db] ensureColumn failed for ${table}.${column}:`, e.message); } catch {}
  }
}
