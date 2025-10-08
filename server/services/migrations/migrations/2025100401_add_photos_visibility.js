const MIGRATION_ID = '2025100401_add_photos_visibility';

function up({ db, dryRun }) {
  if (dryRun) {
    return;
  }
  const hasColumn = db
    .prepare("PRAGMA table_info('photos')")
    .all()
    .some((col) => col.name === 'visibility');

  if (!hasColumn) {
    db.prepare("ALTER TABLE photos ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'").run();
  }
}

function down({ db, dryRun }) {
  if (dryRun) {
    return;
  }
  // SQLite cannot drop columns directly; recreating the table is out of scope for rollback in this migration.
  throw new Error('Down migration not supported for photos.visibility');
}

module.exports = {
  id: MIGRATION_ID,
  description: 'Add photos.visibility for controlling public exposure',
  up,
  down,
};
