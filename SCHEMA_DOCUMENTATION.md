# Data Schema Documentation

This project has migrated from a file-based `manifest.json` to a normalized SQLite database. The SQLite schema is the source of truth. The former manifest schema is documented below for legacy reference.

## SQLite Schema Overview (Current)

Tables and relationships:

- `projects`
  - Columns: `id`, `folder` (unique), `created_at`, `updated_at`

- `photos`
  - Columns (selected): `id`, `project_id` (FK), `filename`, `basename`, `ext`, `created_at`, `updated_at`,
    `date_time_original`, `jpg_available`, `raw_available`, `other_available`, `keep_jpg`, `keep_raw`,
    `thumbnail_status`, `preview_status`, `orientation`, `meta_json`
  - Indexes: filename, basename, ext, date, raw_available, orientation

- `tags`
  - Columns: `id`, `name` (unique)

- `photo_tags` (many-to-many)
  - Columns: `photo_id` (FK), `tag_id` (FK), PK(photo_id, tag_id)

Data access is through repository modules:

- `server/services/repositories/projectsRepo.js`
- `server/services/repositories/photosRepo.js`
- `server/services/repositories/tagsRepo.js`
- `server/services/repositories/photoTagsRepo.js`

Notes:

- Foreign keys and WAL are enabled in `server/services/db.js`.
- Routes (`projects.js`, `uploads.js`, `assets.js`, `tags.js`, `keep.js`) exclusively use repositories.

### Async Jobs (Queue)

Durable background jobs are stored in two tables: `jobs` and `job_items`.

- `jobs`
  - Columns: `id`, `tenant_id`, `project_id` (FK), `type`, `status`, `created_at`, `started_at`, `finished_at`,
    `progress_total`, `progress_done`, `payload_json`, `error_message`, `worker_id`, `heartbeat_at`,
    `attempts`, `max_attempts`, `last_error_at`.
  - Indexes: `(project_id, created_at DESC)`, `(status)`, `(tenant_id, created_at DESC)`, `(tenant_id, status)`.
  - Status values: `queued`, `running`, `completed`, `failed`, `canceled`.
  - Progress: `progress_total` and `progress_done` are nullable; workers should set both (or leave null for indeterminate).
  - Payload: arbitrary JSON (stringified) for worker‑specific params.

- `job_items`
  - Columns: `id`, `tenant_id`, `job_id` (FK), `photo_id` (FK nullable), `filename`, `status`, `message`,
    `created_at`, `updated_at`.
  - Indexes: `(job_id)`, `(tenant_id)`.
  - Use when a job processes multiple files so you can report per‑item progress and summaries.

- Source of truth: `server/services/db.js` (DDL), repositories in `server/services/repositories/jobsRepo.js`.
- Worker loop: `server/services/workerLoop.js` dispatches by `job.type` to worker modules under `server/services/workers/`.
- Events/SSE: `server/services/events.js` provides `emitJobUpdate` and `onJobUpdate`; `server/routes/jobs.js` exposes `GET /api/jobs/stream`.

#### Job Lifecycle

1. Enqueue: `jobsRepo.enqueue()` or `enqueueWithItems()` (when filenames are provided) from `POST /api/projects/:folder/jobs`.
2. Worker Loop picks the next `queued` job, sets `running`, `started_at`, `worker_id`, and `heartbeat_at`.
3. Worker updates `progress_*` and may update `job_items.status/message` while sending heartbeats.
4. On error: increment `attempts`; if `< max_attempts` requeue; otherwise set `failed`, `error_message`, `last_error_at`.
5. On completion: set `completed` + `finished_at`.
6. Crash recovery: stale `running` (expired `heartbeat_at`) are requeued automatically by the loop.
7. SSE events are emitted on state transitions and significant progress.

#### Typical Queries

List latest jobs for a project:

```sql
SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50;
```

Count items by status for a job:

```sql
SELECT status, COUNT(*) AS c FROM job_items WHERE job_id = ? GROUP BY status;
```

Find running jobs and stale heartbeats (for future recovery):

```sql
SELECT * FROM jobs WHERE status = 'running' AND (strftime('%s','now') - strftime('%s', heartbeat_at)) > 60;
```

#### Extending the Schema

- Prefer placing worker‑specific parameters in `jobs.payload_json` or `job_items.message`/`filename` before adding columns.
- If you need structural changes:
  - Update DDL in `server/services/db.js`.
  - Add read/write methods in `server/services/repositories/jobsRepo.js`.
  - Update `workerLoop` and workers accordingly.
  - Document the change here (new columns, allowed values, indices).

#### Frontend Expectations

- SSE payloads include updated job fields; the UI merges by `id` and refreshes list on terminal states.
- `App.jsx` triggers a project reload on job completion so thumbnails/previews appear without manual refresh.

---

### On‑Disk Layout for Derivatives (Still used for files on disk)

- Thumbnails: `<project>/.thumb/<filename>.jpg`
- Previews: `<project>/.preview/<filename>.jpg`

### Related Backend Endpoints

- POST `/api/projects/:folder/generate-thumbnails?force=true|false`
- POST `/api/projects/:folder/generate-previews?force=true|false`
- GET `/api/projects/:folder/thumbnail/:filename` → serves generated thumbnail JPG
- GET `/api/projects/:folder/preview/:filename` → serves generated preview JPG

See implementations in `server/routes/uploads.js` and `server/routes/assets.js`.

### Photo Entry Structure (Legacy)
```json
{
  "id": "string (required) - unique identifier",
  "filename": "string (required) - filename without extension",
  "created_at": "ISO datetime string (required)",
  "updated_at": "ISO datetime string (required)",
  "jpg_available": "boolean (required)",
  "raw_available": "boolean (required)", 
  "other_available": "boolean (required)",
  "keep_jpg": "boolean (required)",
  "keep_raw": "boolean (required)",
  "thumbnail_status": "string (required) - one of: pending | generated | failed | not_supported",
  "preview_status": "string (required) - one of: pending | generated | failed | not_supported",
  "tags": "array of strings (required)",
  "metadata": {
    "date_time_original": "ISO datetime string (optional)",
    "camera_make": "string (optional)",
    "camera_model": "string (optional)",
    "make": "string (optional) - Camera/device manufacturer",
    "model": "string (optional) - Camera/device model",
    "exif_image_width": "number (optional) - Image width in pixels",
    "exif_image_height": "number (optional) - Image height in pixels",
    "orientation": "number (optional) - Image orientation (1-8)"
  }
}
```

## 🔧 Schema Enforcement Points (Legacy)

### Backend (server.js) — Legacy manifest helpers have been removed from `server.js` in favor of repositories.

1. **Manifest Creation** (Line ~65)
   ```javascript
   // SCHEMA_ENFORCEMENT: Use schema-compliant manifest creation
   const createManifest = (projectName) => {
     const manifest = createDefaultManifest(projectName);
     // Validation occurs here
   }
   ```

2. **Manifest Loading** (Line ~85)
   ```javascript
   // SCHEMA_ENFORCEMENT: Load manifest with validation and migration
   const loadManifest = async (projectPath) => {
     // Migration and validation occurs here
   }
   ```

3. **Manifest Saving** (Line ~110)
   ```javascript
   // SCHEMA_ENFORCEMENT: Save manifest with validation
   const saveManifest = async (projectPath, manifest) => {
     // Validation before save occurs here
   }
   ```

4. **Photo Entry Creation** (Line ~285)
   ```javascript
   // SCHEMA_ENFORCEMENT: Create new entry using schema-compliant function
   entry = createDefaultPhotoEntry(originalName, fileType, metadata);
   // Validation occurs here
   ```

5. **Tag Updates** (Line ~353)
   ```javascript
   // SCHEMA_ENFORCEMENT: Validate and update photo entries with tag changes
   // Tag validation and entry validation occurs here
   ```

### Frontend

The frontend receives transformed data (`entries` → `photos`) but should be updated to include validation when the schema is extended to frontend operations.

## 🚀 Adding New Fields to the Manifest Schema (Legacy)

### Step-by-Step Process

1. **Update Schema Definition** (`/schema/manifest-schema.js`)
   ```javascript
   // Add to MANIFEST_SCHEMA or PHOTO_ENTRY_SCHEMA
   new_field: {
     type: 'string',
     required: false,
     default: 'default_value',
     description: 'Description of the new field'
   }
   ```

2. **Update Validation Functions**
   ```javascript
   // Add validation logic in validateManifest() or validatePhotoEntry()
   if (entry.new_field && typeof entry.new_field !== 'string') {
     errors.push('new_field must be a string');
   }
   ```

3. **Update Default Value Generators**
   ```javascript
   // Add to createDefaultManifest() or createDefaultPhotoEntry()
   new_field: 'default_value'
   ```

4. **Update Schema Version** (if breaking change)
   ```javascript
   const SCHEMA_VERSION = '1.1.0'; // Increment version
   ```

5. **Add Migration Logic** (if needed)
   ```javascript
   function migrateManifest(manifest) {
     if (manifest.schema_version === '1.0.0') {
       // Add migration logic here
       manifest.new_field = 'default_value';
       manifest.schema_version = '1.1.0';
     }
     return manifest;
   }
   ```

6. **Update All Enforcement Points**
   - Search for `// SCHEMA_ENFORCEMENT:` comments
   - Update any code that creates or modifies the affected structure
   - Add validation calls where appropriate

7. **Update Documentation**
   - Update this file
   - Update any API documentation
   - Update frontend interfaces if needed

## ⚠️ Important Guidelines

### DO's
- ✅ Always use schema functions (`createDefaultManifest`, `createDefaultPhotoEntry`)
- ✅ Validate data at all enforcement points
- ✅ Add descriptive comments with `// SCHEMA_ENFORCEMENT:`
- ✅ Consider backward compatibility when adding fields
- ✅ Test schema changes thoroughly
- ✅ Update schema version for breaking changes

### DON'Ts
- ❌ Never create manifest/entry objects manually
- ❌ Don't skip validation at enforcement points
- ❌ Don't modify schema without updating all enforcement points
- ❌ Don't remove required fields without migration logic
- ❌ Don't ignore validation errors in production

## 🧪 Testing Manifest Schema Changes (Legacy)

### Validation Testing
```javascript
const { validateManifest, validatePhotoEntry } = require('./schema/manifest-schema');

// Test manifest validation
const testManifest = { /* test data */ };
const result = validateManifest(testManifest);
console.log('Valid:', result.valid);
console.log('Errors:', result.errors);
```

### Migration Testing
```javascript
const { migrateManifest } = require('./schema/manifest-schema');

// Test with old schema version
const oldManifest = { /* old format data */ };
const migratedManifest = migrateManifest(oldManifest);
```

## 🔍 Debugging Schema Issues

### Common Issues
1. **Validation Failures**: Check console logs for detailed error messages
2. **Migration Problems**: Ensure old data is properly transformed
3. **Type Mismatches**: Verify data types match schema definitions
4. **Missing Fields**: Check if required fields are being set

### Debug Tools
- Enable detailed logging in schema validation functions
- Use browser/Node.js debugger at enforcement points
- Check manifest.json files directly for corruption
- Validate against schema in development environment

## 📚 Related Files

- `/schema/manifest-schema.js` - Main schema definition and validation
- `/server.js` - Primary enforcement points in backend
- `/SCHEMA_DOCUMENTATION.md` - This documentation file


## 🔄 Schema Evolution Strategy

The schema system is designed to handle evolution over time:

1. **Additive Changes**: New optional fields can be added without breaking existing data
2. **Migration Support**: Old data is automatically migrated when loaded
3. **Version Tracking**: Schema versions are tracked for proper migration
4. **Backward Compatibility**: Old clients can still work with new data (within reason)

This ensures the application can grow and evolve while maintaining data integrity and reliability.
