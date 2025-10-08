const fs = require('fs');
const path = require('path');
const makeLogger = require('../../utils/logger2');

function sortMigrations(entries) {
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function loadMigrationModules(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => path.join(migrationsDir, file));

  return files.map((filePath) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(filePath);
    if (!mod || typeof mod.id !== 'string' || typeof mod.up !== 'function') {
      throw new Error(`Migration file ${filePath} must export { id, description?, up, down? }`);
    }
    return {
      id: mod.id,
      description: mod.description || '',
      up: mod.up,
      down: typeof mod.down === 'function' ? mod.down : null,
      path: filePath,
    };
  });
}

class MigrationRunner {
  constructor(options = {}) {
    const {
      db,
      migrationsDir = path.join(__dirname, 'migrations'),
      logger = makeLogger('migrationRunner'),
    } = options;

    if (!db) {
      throw new Error('MigrationRunner requires a better-sqlite3 db instance');
    }

    this.db = db;
    this.logger = logger;
    this.migrationsDir = migrationsDir;
    this.migrations = sortMigrations(loadMigrationModules(migrationsDir));
  }

  listMigrations() {
    return this.migrations.map(({ id, description, path: filePath }) => ({ id, description, filePath }));
  }

  runAll({ dryRun = false } = {}) {
    this.logger.info('migration_start', { count: this.migrations.length, dryRun });
    for (const migration of this.migrations) {
      this.runMigration(migration.id, { dryRun });
    }
  }

  runMigration(id, { dryRun = false } = {}) {
    const migration = this.migrations.find((m) => m.id === id);
    if (!migration) {
      throw new Error(`Migration ${id} not found`);
    }

    this.logger.info('migration_apply', {
      id: migration.id,
      description: migration.description,
      dryRun,
    });

    if (dryRun) {
      migration.up({ db: this.db, dryRun: true });
      return;
    }

    const txn = this.db.transaction(() => {
      migration.up({ db: this.db, dryRun: false });
    });

    txn();
    this.logger.info('migration_complete', { id: migration.id });
  }

  rollbackMigration(id, { dryRun = false } = {}) {
    const migration = this.migrations.find((m) => m.id === id);
    if (!migration) {
      throw new Error(`Migration ${id} not found`);
    }
    if (!migration.down) {
      throw new Error(`Migration ${id} does not implement a down() handler`);
    }

    this.logger.info('migration_rollback', { id: migration.id, dryRun });

    if (dryRun) {
      migration.down({ db: this.db, dryRun: true });
      return;
    }

    const txn = this.db.transaction(() => {
      migration.down({ db: this.db, dryRun: false });
    });

    txn();
    this.logger.info('migration_rollback_complete', { id: migration.id });
  }
}

module.exports = {
  MigrationRunner,
};
