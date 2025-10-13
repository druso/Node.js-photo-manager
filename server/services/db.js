// SQLite database service using better-sqlite3
// Initializes per-user DB file, applies schema, and exposes helpers

const path = require('path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');
const makeLogger = require('../utils/logger2');
const log = makeLogger('db');

// For now we use a single default user DB. Later this can be parameterized.
const DB_DIR = path.join(__dirname, '../../.db');
const DEFAULT_DB_FILE = path.join(DB_DIR, 'user_0.sqlite');

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  fs.ensureDirSync(DB_DIR);
  const db = new Database(DEFAULT_DB_FILE);
  db.pragma('journal_mode = WAL'); // better concurrency for readers+writes
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 30000'); // Wait up to 30 seconds for locks
  db.pragma('wal_autocheckpoint = 100'); // Checkpoint more frequently

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

  CREATE TABLE IF NOT EXISTS photo_public_hashes (
    photo_id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL,
    rotated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_photo_public_hashes_expires_at ON photo_public_hashes(expires_at);

  CREATE TABLE IF NOT EXISTS public_links (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    hashed_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_public_links_hashed_key ON public_links(hashed_key);

  CREATE TABLE IF NOT EXISTS photo_public_links (
    photo_id INTEGER NOT NULL,
    public_link_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (photo_id, public_link_id),
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY(public_link_id) REFERENCES public_links(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_photo_public_links_photo_id ON photo_public_links(photo_id);
  CREATE INDEX IF NOT EXISTS idx_photo_public_links_link_id ON photo_public_links(public_link_id);

  CREATE INDEX IF NOT EXISTS idx_photos_project_id ON photos(project_id);
  CREATE INDEX IF NOT EXISTS idx_photos_filename ON photos(project_id, filename);
  CREATE INDEX IF NOT EXISTS idx_photos_basename ON photos(project_id, basename);
  CREATE INDEX IF NOT EXISTS idx_photos_ext ON photos(project_id, ext);
  CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(project_id, date_time_original);
  CREATE INDEX IF NOT EXISTS idx_photos_raw ON photos(project_id, raw_available);
  CREATE INDEX IF NOT EXISTS idx_photos_orientation ON photos(project_id, orientation);

  -- Durable async jobs (global queue)
  -- Note: project_id is now optional to support cross-project and global jobs
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    project_id INTEGER,
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
    -- scope indicates the job's operational context: 'project', 'photo_set', 'global'
    scope TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
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
  // Projects: add status and archived_at for soft-delete/archive semantics
  ensureColumn(db, 'projects', 'status', "ALTER TABLE projects ADD COLUMN status TEXT");
  ensureColumn(db, 'projects', 'archived_at', "ALTER TABLE projects ADD COLUMN archived_at TEXT");
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`); } catch (e) { try { log.warn('index_create_failed', { index: 'idx_projects_status', error: e && e.message }); } catch {} }
  ensureColumn(db, 'jobs', 'attempts', "ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, 'jobs', 'max_attempts', "ALTER TABLE jobs ADD COLUMN max_attempts INTEGER");
  ensureColumn(db, 'jobs', 'last_error_at', "ALTER TABLE jobs ADD COLUMN last_error_at TEXT");
  ensureColumn(db, 'jobs', 'priority', "ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
  // Some code paths update jobs.updated_at (e.g., updating payload). Ensure the column exists for older DBs.
  ensureColumn(db, 'jobs', 'updated_at', "ALTER TABLE jobs ADD COLUMN updated_at TEXT");
  ensureColumn(db, 'photos', 'visibility', "ALTER TABLE photos ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
  // Create composite index after ensuring the column exists (for existing DBs)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created ON jobs(status, priority DESC, created_at ASC)`);
  } catch (e) {
    try { log.warn('index_create_failed', { index: 'idx_jobs_status_priority_created', error: e && e.message }); } catch {}
  }
  // Add index for scope-based queries
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_scope_status ON jobs(scope, status, created_at DESC)`);
  } catch (e) {
    try { log.warn('index_create_failed', { index: 'idx_jobs_scope_status', error: e && e.message }); } catch {}
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_tenant_scope ON jobs(tenant_id, scope, status, created_at DESC)`);
  } catch (e) {
    try { log.warn('index_create_failed', { index: 'idx_jobs_tenant_scope', error: e && e.message }); } catch {}
  }

  // Index to support cross-project photos ordering (taken_at DESC, id DESC)
  // taken_at is COALESCE(date_time_original, created_at); we index both date_time_original and created_at with id
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_taken_created_id ON photos(date_time_original DESC, created_at DESC, id DESC)`);
  } catch (e) {
    try { log.warn('index_create_failed', { index: 'idx_photos_taken_created_id', error: e && e.message }); } catch {}
  }

  // Add manifest_version column for new folder management system
  ensureColumn(db, 'projects', 'manifest_version', "ALTER TABLE projects ADD COLUMN manifest_version TEXT DEFAULT '1.0'");
  
  // Add index on project_folder for fast lookups during folder discovery
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_folder ON projects(project_folder)`);
  } catch (e) {
    try { log.warn('index_create_failed', { index: 'idx_projects_folder', error: e && e.message }); } catch {}
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
    try { log.warn('ensure_column_failed', { table, column, error: e && e.message }); } catch {}
  }
}
