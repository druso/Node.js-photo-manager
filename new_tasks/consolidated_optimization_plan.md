# Consolidated Optimization Plan

Date: 2025-08-29
Owner: Eng leads (backend + frontend)
Goal: Improve performance, stability, and cost-efficiency with clear phasing by complexity.

## Scope & References

- Server: `server/routes/assets.js`, `server/utils/assetPaths.js`, `server/utils/rateLimit.js`, `server/services/repositories/*.js`
- Client: `client/src/App.jsx`, `client/src/components/PhotoGridView.jsx`, `client/src/api/jobsApi.js`
- Docs to update when items land: `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, `README.md`, `SECURITY.md`, `JOBS_OVERVIEW.md`

## Guiding Principles

- Prefer streaming, versioned caching, and cheap revalidation.
- Reduce IO scans and memory usage on hot paths.
- Keep rate limits consistent and centrally configurable.
- Ship in small, test-backed increments.

---

## Complexity Buckets

### A) Quick Wins (1–2 days total)

- 1) HEAD endpoints for assets (cache validation)
  - Add `HEAD` alongside `GET` in `server/routes/assets.js` for:
    - `/:folder/thumbnail/:filename`
    - `/:folder/preview/:filename`
    - `/:folder/image/:filename`
    - `/:folder/file/:type/:filename`
  - Mirror GET headers (`ETag`, `Cache-Control`, `Content-Type` when known); return no body.
  - Tests: 200/304/404 for GET+HEAD.

- 2) Centralize rate‑limit presets
  - In `server/utils/rateLimit.js`, export helpers: `assetThumbPreviewLimiter()`, `assetOriginalLimiter()`, `assetZipLimiter()`.
  - Env: prefer `ASSETS_RATE_THUMB_PREVIEW_RPM`, `ASSETS_RATE_ORIGINAL_RPM`, `ASSETS_RATE_ZIP_RPM` with backward-compat mapping from existing vars in `assets.js`.
  - Replace inline `rateLimit({ ... })` usage in `assets.js`.
  - Observability: structured log on 429 with `evt=rate_limit_exceeded`, route, ip.

- 3) DB index audit for hot queries
  - Run `EXPLAIN QUERY PLAN` over `server/services/repositories/*.js`.
  - Likely indexes:
    - `photos(project_id, filename)` for lookups in `photosRepo.getByProjectAndFilename()`.
    - `photos(project_id, date_time_original, id)` for project pagination.
    - All-Photos filters: consider composite indexes aligned to `buildAllPhotosWhere()` (keep flags, taken_at).
  - Convert repetition to prepared statements where beneficial.

---

### B) Medium Complexity (2–4 days)

- 4) Unified derivative resolution
  - Extend `server/utils/assetPaths.js` with `resolveDerivatives({ projectPath, base })` → `{ thumbPath, previewPath }`.
  - Refactor `assets.js` thumbnail/preview routes to use this helper; ensure `baseFromParam()` used consistently across routes and workers.

- 5) Client bundle size optimization
  - Identify heavy components/deps; apply `React.lazy`/dynamic imports for non-critical views.
  - Verify Vite chunking; confirm reduction in initial bundle and improved CWV.

- 6) Asset tests & signed URL checks
  - Focused tests for `/:folder/file/:type/:filename` and `/:folder/files-zip/:filename` including signed URL validation, 404/429 paths.

---

### C) Higher Complexity (4–8 days)

- 7) DB‑driven original extension resolution (eliminate directory scans)
  - Schema: add nullable `photos.jpg_ext`, `photos.raw_ext` (non-breaking).
  - Backfill migration: one-time probe to populate ext columns; idempotent and resilient.
  - Update `photosRepo` writes to set ext columns on ingest; update `assetPaths.resolveOriginalPath()` to prefer DB ext before any `readdir` fallback.
  - Remove `readdirSync` from hot path post-backfill; keep safe fallback guarded by config flag if desired.

- 8) Image pipeline efficiency
  - Profile derivatives worker(s) for Sharp settings and batching.
  - Add bounded parallelism and batch processing; monitor memory usage.
  - Validate throughput and stability improvements.

---

### D) Optional/Deferred

- 9) SSE server-side pooling
  - Given the client SSE singleton in `client/src/api/jobsApi.js`, defer server pooling unless concurrent user scale requires it.

- 10) fs-extra minimization
  - Replace `fs-extra` with Node `fs` where advanced features aren’t used (target files listed in prior notes).

---

## Testing & Monitoring

- Asset endpoints: GET+HEAD 200/304/404; signed URL token validation; 429 after exceeding rate limits.
- DB: before/after query timings; ensure indexes hit for All-Photos filters (`file_type`, `keep_type`, `orientation`, date range).
- Client: bundle analyzer diff; CWV improvements; scrolling performance profile.
- Observability: structured logs for rate-limits and streaming errors; optional metrics counters per route.

## Documentation Updates (upon landing changes)

- `PROJECT_OVERVIEW.md`: Assets (HEAD behavior, path resolution), Realtime notes unchanged.
- `SCHEMA_DOCUMENTATION.md`: Add `jpg_ext`/`raw_ext` fields; document resolution order.
- `README.md`: Dev tips for HEAD validation and rate-limit tuning.
- `SECURITY.md`: Rate-limit presets, signed URL policy, and caching notes.
- `JOBS_OVERVIEW.md`: If worker batching/parallelism changes behavior or config.

## Rollback/Flags

- Feature flag for HEAD routes (env `ASSETS_ENABLE_HEAD=true|false`) if needed.
- Schema change is additive; safe to keep even if code falls back to legacy mode.

## Definition of Done

- Tests passing and performance deltas measured (before/after) for each bucket item.
- Docs updated per section above.
- No regressions in UX; deep links, viewer, and All-Photos pagination preserved.
