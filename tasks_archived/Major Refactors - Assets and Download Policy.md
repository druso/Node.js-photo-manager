# Major Refactors: Assets and Download Policy

## Task Objective
Implement larger, structured refactors around asset resolution, caching/validation, and rate‑limit policy to improve performance, maintainability, and security without changing UX.

## Context & Rationale
- Current code now streams thumbnails, previews, originals, and zip with ETag/Cache-Control and rate limits for heavy endpoints.
- Remaining opportunities (bigger scope) include consolidating asset path logic, enabling HEAD for cheap cache validation, centralizing rate‑limit presets, and making extension resolution DB‑driven to fully avoid directory scans.

## Resources to Use
- Code
  - `server/routes/assets.js`
  - `server/utils/assetPaths.js` (new helper; extend as needed)
  - `server/utils/rateLimit.js`
  - `server/services/repositories/photosRepo.js`
  - `server/services/scheduler.js` (if any new tasks require updates)
- Docs
  - `PROJECT_OVERVIEW.md` (Assets + Security sections)
  - `SCHEMA_DOCUMENTATION.md` (photos table; ext fields)
  - `JOBS_OVERVIEW.md` (canonical jobs catalog)
  - `SECURITY.md` (rate limiting, caching)

## Plan: Step by Step

### 1) Unified Asset Resolution Utility (server/utils/assetPaths.js)
- Goal: Provide a single source of truth to map `folder + base (+ preference)` → concrete file path(s), eliminating per‑route variations.
- Deliverables:
  - `resolveOriginalPath({ projectPath, base, prefer, entry })` (already in place; harden + tests)
  - `resolveDerivatives({ projectPath, base })` → `{ thumbPath, previewPath }`
  - `baseFromParam(name)` → already exported; ensure shared use across routes/workers
- Tests:
  - Given a matrix of extensions and bases, assert correct resolutions for JPG/RAW and derivative paths
  - Negative cases: missing files → null

### 2) HEAD Support for Cache Validation
- Goal: Add `HEAD` handlers to assets endpoints for cheap conditional requests.
- Deliverables:
  - `HEAD /api/projects/:folder/thumbnail/:filename`
  - `HEAD /api/projects/:folder/preview/:filename`
  - `HEAD /api/projects/:folder/image/:filename`
  - `HEAD /api/projects/:folder/file/:type/:filename`
- Behavior: Same headers as GET (`ETag`, `Cache-Control`, `Content-Type` if applicable), no body.
- Tests:
  - `HEAD` returns 200 with headers for existent assets; 404 for missing; 304 when If-None-Match matches ETag

### 3) Centralize Rate‑Limit Policy
- Goal: Define named presets and env overrides for asset routes to ensure consistent policy and easy tuning.
- Deliverables:
  - In `server/utils/rateLimit.js`: export helpers like `assetThumbPreviewLimiter()`, `assetOriginalLimiter()`, `assetZipLimiter()` with defaults 60/30/10 rpm and env overrides (`ASSETS_RATE_THUMB_PREVIEW_RPM`, `ASSETS_RATE_ORIGINAL_RPM`, `ASSETS_RATE_ZIP_RPM`).
  - Replace inline `rateLimit({ ... })` usages in `assets.js` with named helpers.
- Tests:
  - Unit: verify limiter constructs use env overrides if set
  - Integration: hit endpoints to confirm 429 after exceeding configured limits

### 4) DB‑Driven Extension Resolution (Schema + Repo)
- Goal: Remove any remaining ambiguity by persisting per‑variant extensions for originals (e.g., `jpg_ext`, `raw_ext`).
- Deliverables:
  - Schema change (non‑breaking): add nullable columns `jpg_ext`, `raw_ext` to `photos`.
  - Migration populating existing rows by probing file system once, then persisting for future O(1) resolution.
  - Update `photosRepo` reads/writes; `assetPaths.resolveOriginalPath` to prefer DB‑provided variant before fallback checks.
- Tests:
  - Migration correctness on existing datasets (idempotent, safe if files missing)
  - Endpoints resolve with zero `readdir` calls; confirm behavior when variants are absent

### 5) Test Coverage & Observability
- Goal: Ensure reliability and clear signals during rollout.
- Deliverables:
  - Add focused tests for asset endpoints (GET + HEAD) across states: available, missing, ETag match, ETag mismatch
  - Structured logs for rate‑limit events: `evt=rate_limit_exceeded`, include route and ip
  - Metrics hooks (if applicable) for hit/429 counts per route

## Execution Checklist
- Dev Branch: `feature/assets-refactor`
- Commits in small units per step above; update docs (`PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md`) with each change
- Manual smoke tests:
  - Load a project with mixed RAW/JPG
  - View grid and viewer; verify cache revalidation via network panel
  - Download original JPG/RAW via signed URL; exceed rpm thresholds to confirm 429 on originals/zip
  - Validate `HEAD` behavior for 200/304/404

## Rollback Plan
- Each step is self‑contained; revert specific commit(s) if issues arise
- Keep a feature flag for HEAD routing (env `ASSETS_ENABLE_HEAD=true|false`) if needed for quick disable
- For schema change: migration adds nullable columns only; safe to keep even if code fallback paths remain

## Owner & Timeline
- Owner: Backend lead
- Est. effort: 2–3 days net (excluding schema migration backfill on very large datasets)
- Dependencies: None critical; optional metrics integration if available
