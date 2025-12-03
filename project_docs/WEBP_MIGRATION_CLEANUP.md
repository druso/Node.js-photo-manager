# WebP Migration Cleanup Guide

This document outlines the steps to remove the WebP migration logic once the migration is fully complete and verified for all projects.

## Files to Modify

### 1. `server/services/task_definitions.json`
**Action**: Remove the `webp_migration` step from the `maintenance` and `maintenance_global` tasks.

```json
// Remove this block from "maintenance" and "maintenance_global" steps:
{
  "type": "webp_migration",
  "priority": 50
}
```

### 2. `server/services/workers/maintenanceWorker.js`
**Action**: Remove the `runWebPMigration` function and its export.

- Delete the `runWebPMigration` function definition.
- Remove `runWebPMigration` from the `module.exports` object at the bottom of the file.

### 3. `server/services/workerLoop.js`
**Action**: Remove the job handler for `webp_migration`.

- Remove the import of `runWebPMigration` from `./workers/maintenanceWorker`.
- Remove the `if (job.type === 'webp_migration') { ... }` block in the `handleJob` function.

### 4. `server/routes/maintenance.js`
**Action**: Remove the manual trigger endpoint.

- Remove the `POST /migrate-webp` route definition.

## Verification
After removing these components, restart the server and verify that:
1. The server starts without errors.
2. Maintenance tasks (e.g., trash cleanup) still run correctly.
