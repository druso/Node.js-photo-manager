# SQL Migration Plan

This plan replaces all manifest.json usage with a SQLite database, using a per-user DB file and a normalized schema. It is designed for current single-user development (user_0) and future multi-user support.

## 1) Database Overview

- Engine: SQLite (via `better-sqlite3`).
- Location: `.projects/db/user_0.sqlite` (per-user DB file; abstractable later).
- Pragmas: `journal_mode=WAL`, `foreign_keys=ON` for concurrency and integrity.
- Access Layer: `server/services/db.js` initializes schema and exposes helpers.
- Repositories:
  - `server/services/repositories/projectsRepo.js`
  - `server/services/repositories/photosRepo.js`
  - `server/services/repositories/tagsRepo.js`
  - `server/services/repositories/photoTagsRepo.js`

## 2) Project Structure Notes

- Projects live under `.projects/<project_folder>/` on disk.
- The DB stores a stable `projects.id` primary key and the immutable folder name in `projects.project_folder` (UNIQUE).
- Display name is `projects.project_name` and may not be unique.
- Photo metadata previously in `manifest.json` now resides in `photos`, `tags`, and `photo_tags`.

## 3) Schema (DDL)

Executed at server start by `server/services/db.js`:

```sql
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
```

## 4) Step-by-Step Refactor

1. Add dependency and DB service
   - Add `better-sqlite3` to `package.json`.
   - Implement `server/services/db.js` (done).
   - Create repository modules (done).

2. Projects routes (`server/routes/projects.js`)
   - Replace manifest lookups with `projectsRepo` and `photosRepo` aggregations.
   - Endpoints:
     - Create project: insert into `projects`; create folder on disk; return new `project_id`.
     - List projects: `projectsRepo.list()` + counts from `photos` per project.
     - Delete project: delete from `projects` (cascades) and remove folder on disk.

3. Uploads routes (`server/routes/uploads.js`)
   - On new file: compute fields (basename/ext, availability flags, EXIF → `meta_json` and promoted fields), then `photosRepo.upsertPhoto(project_id, photo)`.
   - On analysis/scan: same as above for all discovered files.
   - Derivatives: update `thumbnail_status`/`preview_status` via `photosRepo.updateDerivativeStatus`.

4. Tags routes (`server/routes/tags.js`)
   - Add/remove tags: `tagsRepo.getOrCreateTag`, `photoTagsRepo.addTagToPhoto/removeTagFromPhoto`.
   - List tags: `tagsRepo.listTags(project_id)`; counts via `photo_tags` join (optional).

5. Assets routes (`server/routes/assets.js`)
   - Before serving thumbnails/previews, validate availability via `photosRepo.getByFilename(project_id, filename)`.
   - Update derivative status as needed.

6. Keep flags (`server/routes/keep.js`)
   - Update `keep_jpg`/`keep_raw` via `photosRepo.updateKeepFlags`.

7. New paging endpoint (optional now)
   - `GET /api/projects/:project/list?sort=...&dir=...&limit=...&cursor=...` → `photosRepo.listPaged`.
   - Start with OFFSET cursor; switch to keyset later if needed.

8. Cleanup
   - Remove `server/services/manifest.js` and any `loadManifest/saveManifest` usage.
   - Remove manifest schema helpers from `server.js` unless needed elsewhere.

## 5) Security & Validation

- Validate `:project` → resolve to `project_id` via `projectsRepo.getByFolder()` and reject if unknown.
- Validate filenames and tag names (whitelist characters, length caps).
- Use prepared statements exclusively (repositories already do).
- Transactions for multi-step updates to avoid partial state (DB service exposes `withTransaction`).

## 6) Performance Guidance

- WAL mode improves concurrent reads during writes.
- Keep queries narrow with proper indexes.
- Batch write operations in transactions (e.g., scan/import).
- Consider keyset pagination for very large sets later.

## 7) Testing Checklist

- Repositories
  - Create/list/delete project.
  - Upsert photo; update derivative status; update keep flags.
  - Tags: create/list/delete; link/unlink tag to photo; query photos by tag.
- Routes
  - Upload a file → row created with correct fields and EXIF metadata extracted.
  - List photos → sorted deterministically, pagination works.
  - Tagging endpoints → tag appears in `tags`, link in `photo_tags`.
  - Keep flags and asset-serving flows update/reflect DB state.
- Concurrency
  - Run a background job that updates derivative statuses while listing photos from the API.

## 8) Rollback/Recovery

- DB file backup: copy `.projects/db/user_0.sqlite` and WAL files while server is stopped.
- To reset in dev: delete the DB file; it will be recreated on next start.

## 9) Future Enhancements

- Multi-user: open `user_<id>.sqlite` based on authenticated user.
- Keyset pagination and additional indexes as data grows.
- Optional manifest history table if you need versioned snapshots.
- Background job table (queue) if you want to schedule and track work in-DB.
