const MIGRATION_ID = '2025100403_create_photo_public_links';

function up({ db, dryRun }) {
  if (dryRun) {
    return;
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS photo_public_links (
      photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      public_link_id TEXT NOT NULL REFERENCES public_links(id) ON DELETE CASCADE,
      created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (photo_id, public_link_id)
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_photo_public_links_photo_id ON photo_public_links(photo_id)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_photo_public_links_link_id ON photo_public_links(public_link_id)
  `).run();
}

function down({ db, dryRun }) {
  if (dryRun) {
    return;
  }
  db.prepare('DROP TABLE IF EXISTS photo_public_links').run();
}

module.exports = {
  id: MIGRATION_ID,
  description: 'Create photo_public_links join table linking photos to public links',
  up,
  down,
};
