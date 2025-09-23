# Security Documentation

## Suggested Interventions

*Maintained by security analyst, prioritized by complexity and risk.*

### 🔴 **HIGH PRIORITY** (Do now)

– Implemented: Production CORS allowlist via `ALLOWED_ORIGINS` and production `DOWNLOAD_SECRET` enforcement in `server.js` (2025-08-17 JST). Keep this section empty going forward; use as a checklist for urgent items only.


### 🟡 **MEDIUM PRIORITY** (Next cycle)

**4. Job Queue Limits** 🔧 *4-6h*
- **Risk**: Memory exhaustion from unlimited jobs
- **Action**: Max 100 pending jobs per project in scheduler

**5. Audit Logging** 🔧 *6-8h*
- **Risk**: Limited forensics capability
- **Action**: Structured logs for file ops, job failures, and project rename events (old_name → new_name, id)

**6. Upload Conflict Controls** ✅ *Completed 2025-08-31*
- **Risk**: User-controlled overwrite and cross-project move operations
- **Action**: Implemented user-facing controls for duplicate overwriting and cross-project item moves via upload UI. Users can now explicitly choose to overwrite existing files in current project and/or move conflicting items from other projects. All operations are logged and processed through background job pipeline.

### 🟢 **LOW PRIORITY** (Future)

**6. User Authentication** 🏗️ *2-3 weeks*
- **Risk**: No access control for multi-user
- **Action**: JWT auth with project ownership

**7. Content File Validation** 🔧 *1-2 weeks*
- **Risk**: Malicious files bypass MIME checks
- **Action**: File signature validation

---

## Security Overview

### ✅ **Current Protections**

**Download Security**:
- HMAC-signed URLs with 2-minute expiry
- Request binding (project/filename/type)
- Replay protection via unique JWT ID

**Upload Security**:
- Dual validation (MIME + extension)
- Path traversal protection (`path.basename()`)
- 100MB size limits
- Configurable file type filtering via centralized helper `server/utils/acceptance.js` driven by `config.json → uploader.accepted_files`

**Database Security**:
- Parameterized queries (SQL injection protection)
- WAL mode + foreign key constraints
- Repository pattern abstraction

**File Operations**:
- Operations confined to project subdirectories
- Filename sanitization
- Atomic database + file transactions

**Assets (Thumbnails/Previews/Originals/ZIP)**:
- Served without signed tokens (only originals require signatures)
- Client no longer probes pending assets; availability is driven by SSE item-level updates with light fallback polling
- Lightweight rate limits and short-lived caching headers implemented to mitigate abuse and bandwidth spikes; ETag/If-None-Match supported with 304 responses
- Implementation detail: all asset endpoints (thumbnails, previews, originals, zip) use streaming (`fs.createReadStream`) instead of `res.sendFile`, with `Cache-Control` and `ETag` headers for revalidation.
- Rate limits are now configurable via `config.json → rate_limits` with environment overrides; current defaults (per IP): Thumbnails 600 rpm, Previews 600 rpm, Originals 120 rpm, ZIP 30 rpm. See `server/routes/assets.js` and `config.default.json`.
- Env overrides for local stress testing: `THUMBNAIL_RATELIMIT_MAX`, `PREVIEW_RATELIMIT_MAX`, `IMAGE_RATELIMIT_MAX`, `ZIP_RATELIMIT_MAX`.
- Originals lookup tolerates filenames with or without extensions. For `/image/:filename`, `/file/:type/:filename`, and `/files-zip/:filename`, the server attempts an exact DB match and then falls back to the base name (extension stripped). On disk, resolution is case-insensitive with a constrained directory scan fallback limited to the project folder and allowed extension sets (JPG or RAW). This mitigates 404s caused by extension casing differences (e.g., `.JPG`) while keeping the search scope bounded.
- Diagnostics added to `server/routes/assets.js` to improve forensics and abuse monitoring: `thumb_request`, `preview_request`, `image_lookup`/`image_resolve`, `file_lookup`/`file_resolve`, `zip_lookup`/`zip_resolve`, `download_url_lookup`, and stream error/exception events per endpoint.
- Frontend load shaping: the photo grid now uses a buffered `IntersectionObserver` with short dwell, which smooths scrolling and reduces bursty thumbnail requests without impacting perceived performance. This complements server-side rate limits.

**Commit/Revert Endpoints**:
- Commit is destructive: moves files to `.trash` and updates availability; ensure intent is authenticated/authorized in future multi-user mode.
- Revert is non-destructive: resets `keep_*` to match `*_available`.
- Rate limiting implemented: 10 requests per 5 minutes per IP on commit, revert, delete, and rename endpoints.

**Realtime (SSE)**:
- `GET /api/jobs/stream` hardened with per‑IP connection cap (default 2), heartbeat every 25s, and idle timeout (default 5 min). Env overrides: `SSE_MAX_CONN_PER_IP`, `SSE_IDLE_TIMEOUT_MS`.
  - Client enforcement: the frontend maintains a single shared `EventSource` (see `client/src/api/jobsApi.js → openJobStream()`) persisted on `globalThis/window` to survive Vite HMR. This reduces parallel connections and helps avoid 429s while keeping server caps unchanged.
  - Dev guidance: close duplicate tabs and hard‑refresh if transient 429s appear during hot reloads; optionally raise `SSE_MAX_CONN_PER_IP` locally.
 - Keep flag updates (`PUT /api/projects/:folder/keep`) now emit `type: item` SSEs with `keep_jpg`/`keep_raw`. This reduces client refetch pressure and prevents UI desync; rate limits on destructive endpoints remain in effect.

**All Photos (cross-project)**:
- `GET /api/photos` supports keyset pagination across all non-archived projects. Responses are short-lived and include `Cache-Control` headers appropriate for list data.
- `GET /api/photos/locate-page` locates a specific photo and returns its containing page. Protections:
  - Cache behavior: `Cache-Control: no-store` to avoid stale pagination (+ sensitive deep-linking) artifacts.
  - Rate limiting: 60 requests per minute per IP. Intended for occasional deep-link navigations, not for bulk iteration.
  - Errors: 404 when target not found/filtered out; 409 for ambiguous basename (client should pass full filename to disambiguate).

**Client-side Storage**:
- UI state persistence is session-only using `sessionStorage` (single key `session_ui_state`). No long-lived UI data is kept in `localStorage`.
- Impact: reduces risk of stale/sensitive UI state persisting across sessions or shared machines.
- Removed legacy per-project `localStorage` APIs and migration code from `client/src/utils/storage.js`.

**Monitoring & Logging**:
- Logging v2: All backend routes/services/workers emit structured JSON logs via `server/utils/logger2.js` with levels (`error|warn|info|debug`).
- Context includes `project_id`, `project_folder`, `project_name`, `job_id` where applicable; events are tagged (e.g., `upload_failed`, `list_jobs_failed`, `project_delete_failed`).
- Tune via `LOG_LEVEL`.

### ⚠️ **Current Gaps**

**Access Control**:
- No authentication on destructive endpoints

**Resource Management**:
- Unlimited job queue growth
- No memory usage controls
- Large batch processing (100k+ photos)

**Monitoring**:
- Structured logging now in place across backend (see Security Overview). Next steps focus on surfacing security/audit events and alerting.

---

## Weekly Security Review Summary (2025-08-20 UTC)

- npm ci: succeeded
- npm audit --audit-level=high: 0 vulnerabilities
- npm outdated: no outdated packages reported

All verified protections (CORS allowlist, SSE per‑IP caps + idle timeout, destructive endpoint rate limits, asset caching/ETag + throttling) are reflected in Security Overview. No immediate remediation required beyond existing Suggested Interventions.

---

## Configuration & Environment

### Critical Variables

**`DOWNLOAD_SECRET`** (default: `"dev-download-secret-change-me"`)
- **Must change** for any network deployment
- Generate: `openssl rand -base64 32`

**`REQUIRE_SIGNED_DOWNLOADS`** (default: `true`)
- Keep enabled except temporary local testing

### Runtime Environment

- Runtime: **Node.js 22** with **npm 10+**. Recommended to use **nvm** with the repo's `.nvmrc` (`22`).
  - Local setup:
    ```bash
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
    nvm install && nvm use  # reads .nvmrc (22)
    ```
- Production: Ensure hosts run Node 22.x. Lock Node version in container images or provisioning scripts.
- Reminder: If `REQUIRE_SIGNED_DOWNLOADS` is true (default), set a strong `DOWNLOAD_SECRET`; the server will exit in production if the default secret is used.

### Config merge persistence (audit note)

- Behavior: On boot and on `POST /api/config`, the server merges any missing keys from `config.default.json` into `config.json` and persists them (see `server/services/config.js`).
- Impact: Over time, `config.json` may receive new keys as defaults evolve. This is expected and should be treated as benign additions in audits/backups.

### Container Runtime (Docker) Notes

- **Image**: Multi-stage on `node:22-bookworm-slim`, installs `libvips` for `sharp`. See `Dockerfile`.
- **User**: Runs as non-root `node` user by default. Keep this in production.
- **Filesystem**: Mount only required paths as writable. Recommended:
  - Bind `.projects` to persist user data
  - Bind `config.json` for runtime configuration
  - Consider `read_only: true` with `tmpfs: [/tmp]` in `docker-compose.yml` (uncomment hints in file)
- **Network**: Expose only port `5000` to upstream proxy; set strict `ALLOWED_ORIGINS`.
  - Denied origins are surfaced as HTTP 403 (Forbidden) by the error handler for clarity; previously surfaced as 500.
- **Secrets**: Provide `DOWNLOAD_SECRET` via environment or orchestrator secrets store; avoid committing secrets.
- **Healthcheck**: Container defines `/api/config` probe; integrate with orchestrator health/auto-restart.
- **Resource limits**: Set CPU/memory limits to reduce DoS blast radius and protect host stability.

### Security Files

**Backend**: `server/utils/signedUrl.js`, `server/utils/acceptance.js`, `server/utils/rateLimit.js`, `server/routes/assets.js`, `server/routes/uploads.js`
**Config**: `config.json` (file type validation), `.env` (secrets)

---

## Development Workflow

**⚠️ SECURITY REVIEW PROCESS**:

1. **Developers**: Document new features requiring security assessment in this document
2. **Security Analyst**: Assess implications, update interventions, enrich documentation  
3. **Cleanup**: Remove temporary notes after assessment

This ensures all functionality receives security review before deployment.

---

## Recent Development Notes

All items from the previous cycle were assessed on 2025-08-20 UTC. Notes have been incorporated into this document (Security Overview and Suggested Interventions). No pending items remain here.

2025-08-24 UTC — Frontend lazy-loading observer hardened to prevent random blank thumbnails and to shape thumbnail request rates (buffer margin + dwell). No new risks introduced; this reduces potential client-side request spikes during fast scrolling.

2025-08-28 UTC — Deep-link photo redirect issue resolved. Removed session storage viewer state persistence that was causing conflicts with URL-based deep linking. The URL is now the single source of truth for viewer state, eliminating redirect loops and ensuring stable deep links like `/all/p6/DSC02415`. No new security risks introduced; this actually reduces client-side state complexity and potential for stale session data conflicts.

2025-08-28 UTC — Documentation alignment and endpoint hardening notes

- README and PROJECT_OVERVIEW updated to explicitly document All Photos filters and defaults:
  - `/api/photos`: `limit` default 200 (max 300); filters `file_type(any|jpg_only|raw_only|both)`, `keep_type(any|any_kept|jpg_only|raw_jpg|none)`, `orientation(any|vertical|horizontal)`; headers include `Cache-Control: no-store`.
  - `/api/photos/locate-page`: requires `project_folder` and `filename` or `name`; `limit` default 100 (max 300); `Cache-Control: no-store`; rate limit 60 req/min/IP; 400/404/409 errors documented.
- Uploads section now states multipart flags parsed as strings ("true"/"false", default false): `overwriteInThisProject`, `reloadConflictsIntoThisProject` (triggers `image_move`).
- Asset endpoints section reiterates rate‑limit defaults (per IP per minute) and ETag/caching behavior; originals/zip require signed tokens and `REQUIRE_SIGNED_DOWNLOADS=true` by default; `DOWNLOAD_SECRET` must be strong in production.
- SCHEMA docs clarify `taken_at := coalesce(date_time_original, created_at)` as the basis for cross‑project ordering and date filters.
- Cross-links verified so `JOBS_OVERVIEW.md` remains the canonical jobs catalog for `upload_postprocess` and `image_move` semantics.

No functional changes were introduced by this documentation update; it reflects the current implementation in `server/routes/photos.js`, `server/routes/assets.js`, and `server/routes/uploads.js`.

2025-09-23 UTC — Unified Photo Filtering Implementation

- **Feature**: Implemented server-side filtering for Project views to match All Photos functionality
- **Changes**: 
  - Added `listProjectFiltered()` function in `photosRepo.js` with same filter parameters as All Photos
  - Extended `GET /api/projects/:folder/photos` to accept filter parameters: `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`
  - Both APIs now return dual totals: `total` (filtered count) and `unfiltered_total` (total count)
  - Frontend updated to use server-side filtering for both views, eliminating client-side filtering of large datasets
- **Security Assessment**:
  - ✅ **No new attack vectors**: Uses existing parameterized query patterns and input validation
  - ✅ **Performance improvement**: Reduces client-side memory usage and eliminates large dataset transfers
  - ✅ **Consistent validation**: Filter parameters validated server-side using same logic as All Photos
  - ✅ **Rate limiting preserved**: Existing endpoint rate limits remain in effect
  - ✅ **SQL injection protection**: All new queries use parameterized statements via `better-sqlite3`
- **Risk**: None identified. This change improves scalability and reduces client-side resource consumption.
- **Monitoring**: Server debug logs include filter parameter values and count calculations for troubleshooting.
