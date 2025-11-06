const path = require('node:path');
const fs = require('fs-extra');
const { getDb } = require('../../services/db');

const PROJECTS_ROOT = path.join(__dirname, '..', '..', '..', '.projects', 'user_0');
const DEFAULT_MAX_RETRIES = 5;

function ensureProjectsRoot() {
  fs.ensureDirSync(PROJECTS_ROOT);
  return PROJECTS_ROOT;
}

function createFixtureTracker() {
  ensureProjectsRoot();

  const tracked = {
    projectIds: new Set(),
    projectFolders: new Set(),
    linkIds: new Set(),
  };

  function registerProject(projectOrId, maybeFolder) {
    if (!projectOrId) {
      return;
    }
    if (typeof projectOrId === 'object') {
      if (projectOrId.id !== undefined && projectOrId.id !== null) {
        tracked.projectIds.add(projectOrId.id);
      }
      if (projectOrId.project_folder) {
        tracked.projectFolders.add(projectOrId.project_folder);
      }
    } else {
      tracked.projectIds.add(projectOrId);
      if (maybeFolder) {
        tracked.projectFolders.add(maybeFolder);
      }
    }
  }

  function registerProjectId(id) {
    if (id !== undefined && id !== null) {
      tracked.projectIds.add(id);
    }
  }

  function registerProjectFolder(folder) {
    if (folder) {
      tracked.projectFolders.add(folder);
    }
  }

  function registerLink(linkOrId) {
    if (!linkOrId) {
      return;
    }
    if (typeof linkOrId === 'object') {
      if (linkOrId.id) {
        tracked.linkIds.add(linkOrId.id);
      }
    } else {
      tracked.linkIds.add(linkOrId);
    }
  }

  function resetTracked() {
    tracked.projectIds.clear();
    tracked.projectFolders.clear();
    tracked.linkIds.clear();
  }

  function cleanup() {
    const db = getDb();
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (_) {
      // ignore checkpoint errors
    }

    const linkIds = Array.from(tracked.linkIds);
    const projectIds = Array.from(tracked.projectIds);

    let attempt = 0;
    while (attempt < DEFAULT_MAX_RETRIES) {
      try {
        if (linkIds.length > 0) {
          const placeholders = linkIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM photo_public_links WHERE public_link_id IN (${placeholders})`).run(...linkIds);
          db.prepare(`DELETE FROM public_links WHERE id IN (${placeholders})`).run(...linkIds);
        }

        if (projectIds.length > 0) {
          const placeholders = projectIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM photo_public_hashes WHERE photo_id IN (SELECT id FROM photos WHERE project_id IN (${placeholders}))`).run(...projectIds);
          db.prepare(`DELETE FROM photos WHERE project_id IN (${placeholders})`).run(...projectIds);
          db.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...projectIds);
        }

        break;
      } catch (err) {
        if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_BUSY_SNAPSHOT') {
          attempt += 1;
          if (attempt < DEFAULT_MAX_RETRIES) {
            const delay = 50 * Math.pow(2, attempt);
            const start = Date.now();
            while (Date.now() - start < delay) {
              // busy wait to give SQLite time to release locks
            }
          } else {
            console.error('Fixture cleanup failed after retries:', err.message);
          }
        } else {
          throw err;
        }
      }
    }

    const projectFolders = Array.from(tracked.projectFolders);
    for (const folder of projectFolders) {
      const projectDir = path.join(PROJECTS_ROOT, folder);
      try {
        if (fs.existsSync(projectDir)) {
          fs.removeSync(projectDir);
        }
      } catch (_) {
        // ignore filesystem cleanup errors
      }
    }

    resetTracked();
  }

  return {
    PROJECTS_ROOT,
    registerProject,
    registerProjectId,
    registerProjectFolder,
    registerLink,
    cleanup,
    reset: resetTracked,
  };
}

module.exports = {
  PROJECTS_ROOT,
  ensureProjectsRoot,
  createFixtureTracker,
};
