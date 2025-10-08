const MIGRATION_ID = '2025100402_create_public_links';

function up({ db, dryRun }) {
  if (dryRun) {
    return;
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS public_links (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT,
      description TEXT,
      hashed_key TEXT NOT NULL UNIQUE,
      expires_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_public_links_project_id ON public_links(project_id)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_public_links_hashed_key ON public_links(hashed_key)
  `).run();
}

function down({ db, dryRun }) {
  if (dryRun) {
    return;
  }
  db.prepare('DROP TABLE IF EXISTS public_links').run();
}

module.exports = {
  id: MIGRATION_ID,
  description: 'Create public_links table for shared albums',
  up,
  down,
};
