---
description: Modernize project details endpoint
---

## Project Summary

- **Objective**: Replace the legacy manifest-style payload returned by `GET /api/projects/:folder` with a modern, paginated contract that aligns with the unified All Photos / Project view architecture.
- **Motivation**: The endpoint currently loads every photo in a project and maps it to a legacy manifest shape, causing unnecessary memory/CPU pressure and duplicating logic that is already handled by paginated APIs.

## Current Pain Points

- **Full-table fetch**: Calls `photosRepo.listPaged()` with a large `limit` (100000), which can degrade performance on sizable projects.
- **Legacy data shape**: Reconstructs manifest objects that newer clients no longer require, creating confusion and technical debt.
- **Redundant responsibilities**: Duplicates pagination/filtering logic handled elsewhere, risking inconsistencies and stale behavior.

## Proposed Direction

1. **Define a lightweight project metadata response**
   - Return core project fields (`id`, `project_name`, `project_folder`, timestamps, status) without embedding full photo lists.
   - Expose derived counts (e.g., photo totals, pending deletions) via dedicated, cheap lookups if still needed.

2. **Let clients rely on paginated photo endpoints**
   - Encourage `GET /api/projects/:folder/photos` (with filters) or `GET /api/photos` for All Photos mode.
   - Provide clear migration guidance for any code still depending on the manifest payload.

3. **Introduce compatibility toggle (optional)**
   - Offer a short-lived query flag or environment switch to fall back to the legacy payload while downstream consumers migrate.

4. **Document the transition**
   - Update `PROJECT_OVERVIEW.md`, `README.md`, and API docs describing the new contract and deprecation timeline.
   - Highlight benefits (lower memory footprint, simpler client logic, faster responses).

## Success Criteria

- Endpoint no longer fetches or serializes large photo lists by default.
- Clients and tests use paginated APIs for photo data.
- Documentation reflects the simplified response.
- Observability confirms reduced response times and resource usage for project detail requests.

## Follow-up Considerations

- Evaluate removing the endpoint entirely once clients rely exclusively on paginated flows.
- Monitor telemetry for unexpected consumers and provide migration support as needed.

## Documentation Audit (2025-09-29)

- **filteredProjectData consolidation**: `PROJECT_OVERVIEW.md` already notes that `EventHandlersService.js` consumes the canonical filtered structure; no further updates required.
- **`isAllMode` retirement**: `PROJECT_OVERVIEW.md` and `CONTRIBUTING.md` direct contributors to rely on `view.project_filter`; other docs (`README.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md`) remain accurate because they exclusively describe the unified view model without mentioning the legacy flag.
- **Action**: No additional documentation changes needed at this stage. Revisit after implementing the modernized project details endpoint to capture the new API contract and migration guidance.

## Proposed Response Contract

- **`summary`**: `{ id, project_name, project_folder, created_at, updated_at }` returned verbatim from `projectsRepo.getByFolder()`.
- **`counts`**: `{ photos_total, photos_pending_delete, photos_missing_assets }` built via lightweight aggregations in `photosRepo.photoPendingOps` helpers.
- **`recent_activity` (optional)**: `{ last_job_started_at, last_job_type }` derived from `jobsRepo.listRecentByProject()` for dashboard cards.
- **`feature_flags`**: `{ legacy_manifest_enabled: boolean }` indicates whether the compatibility query flag is respected for current request (mirrors config toggle).
- **`links`**: canonical endpoints clients should follow (`/api/projects/:folder/photos`, `/api/projects/:folder/photos/locate-page`, `/api/projects/:folder/jobs`).

### Compatibility Flag

- **Query parameter**: `GET /api/projects/:folder?legacy_manifest=true` continues returning `{ ...summary, photos: [...] }` for callers that still need the manifest payload.
- **Config override**: `config.json → api.compatibility.project_manifest_until` (ISO date) controls default behavior; after the deadline, the flag returns `410 Gone` to surface lingering consumers.
- **Rate limiting**: legacy responses enforce a lower `limit` (e.g., 2000 rows) to prevent runaway memory usage while teams migrate.

### Error Semantics

- **`404`**: unchanged for missing/canceled projects.
- **`409`**: returned when `legacy_manifest=true` is requested but compatibility window has expired.
- **`200`**: success responses always include `legacy_manifest_enabled` so clients can log migrations.

## Consumer Migration Checklist

- **Frontend**: replace `projectsApi.getProjectDetails()` usages in `useAppInitialization()` and `ProjectDataService.js` with the new metadata contract plus paginated photo fetches.
- **Uploader workflows**: ensure drop-zone flows rely on `useAllPhotosUploads()` registering active project metadata rather than manifest photos.
- **CLI/automation scripts**: audit any private tooling under `tools/` or ops scripts that parse the manifest; provide sample curl commands using the paginated endpoints instead.
- **Observability**: add counter metrics (`project_details_manifest_requests`) to confirm sunset progress.

## Verification Strategy

- **Unit**: repository-level tests for new aggregation helpers and compatibility branch.
- **Integration**: API tests covering default metadata response, legacy manifest flag enabled, and refusal post-deadline.
- **Frontend smoke**: execute viewer deep-link and commit/revert flows to confirm initialization no longer depends on manifest data.
- **Performance**: capture `GET /api/projects/:folder` timing before/after change; expect significant reduction in CPU/memory.
