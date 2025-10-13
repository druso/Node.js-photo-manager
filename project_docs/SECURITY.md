# Security Documentation

## Latest Security Enhancements (2025-10)

### Authentication Rollout (2025-10-04)
- **Server hardening**: `server/routes/auth.js`, `server/middleware/authenticateAdmin.js`, and `server.js` enforce JWT-guarded access for all `/api/*` and `/api/sse/*` routes. Cookies issued by `authCookieService.js` are HTTP-only, SameSite Strict, and respect `AUTH_COOKIE_SECURE`.
- **Frontend gate**: `client/src/auth/AuthContext.jsx` and the `ProtectedApp` wrapper hold the admin UI behind a login screen and schedule refresh ~30 s before expiry. `client/src/api/httpClient.js` centralizes bearer headers.
- **Operational guardrails**: `.env.example`, `README.md`, and `PROJECT_OVERVIEW.md` document secret requirements and the fail-fast behaviour logged as `auth_config_invalid` during misconfiguration. `npm test` covers token/cookie lifecycles.

### Visibility Controls (2025-10-07)
- `POST /api/photos/visibility` introduces bulk visibility management with dry-run support and rate limiting. The handler in `server/routes/photosActions.js` revalidates payloads and emits SSE item updates to keep clients synchronized. Asset routes in `server/routes/assets.js` return 404 for private photos unless a valid admin JWT is supplied.

### Public Asset Hashing (2025-10-08)
- Option A hashing stores 32-char hashes in `photo_public_hashes` through `publicAssetHashes.ensureHashForPhoto()`. Anonymous asset requests must provide a valid `hash` query parameter; admins bypass checks but receive the active hash via headers.
- Hash rotation is driven by `server/services/scheduler.js`, and toggling visibility via `photosRepo.updateVisibility()` seeds or invalidates hashes automatically. Frontend hash lifecycle is managed by `client/src/contexts/PublicHashContext.jsx`.

### Shared Links for Public Galleries (2025-10-08 – 2025-10-12)
- Admin APIs under `/api/public-links` remain authenticated and rate limited, while public consumers use `/shared/api/:hashedKey`. `sharedLinks.js` registers the admin route before the public route to avoid collisions and clamps anonymous queries to `visibility='public'` via `photosRepo.listSharedLinkPhotos()`.
- `server/routes/photos.js` now resolves `public_link_id` parameters for All Photos endpoints, forcing anonymous callers onto public-only datasets while still allowing authenticated admins to inspect private assets. End-to-end tests in `server/routes/__tests__/photosPublicLink.test.js` and `server/routes/__tests__/sharedLinks.test.js` cover these flows.

### Client-Side Authentication Enforcement (2025-10-08)
- Routing changes in `client/src/index.js` and the login experience ensure unauthenticated users cannot reach admin screens. Shared link routes stay publicly accessible in read-only mode (`isPublicView={true}`) per `SharedLinkPage.jsx` and `useSharedLinkData()`.

## Suggested Interventions

*Maintained by security analyst, prioritized by complexity and risk.*

### 🔴 **HIGH PRIORITY** (Do now)

– Implemented: Production CORS allowlist via `ALLOWED_ORIGINS` and production `DOWNLOAD_SECRET` enforcement in `server.js` (2025-08-17 JST). Keep this section empty going forward; use as a checklist for urgent items only.


### 🟡 **MEDIUM PRIORITY** (Next cycle)

**1. Job Queue Limits** 🔧 *4-6h*
- **Risk**: Memory exhaustion from unlimited jobs
- **Action**: Max 100 pending jobs per project in scheduler

**2. Audit Logging** 🔧 *6-8h*
- **Risk**: Limited forensics capability
- **Action**: Structured logs for file ops, job failures, and project rename events (old_name → new_name, id)

**3. Batch Size Limits for Image Actions** 🔧 *4-6h*
- **Risk**: Large `items` arrays on `/api/photos/keep`, `/api/photos/tags/*`, `/api/photos/move`, and `/api/photos/process` can exhaust memory/CPU (DoS vector)
- **Action**: Enforce sane per-request caps (e.g., 200 items), reject oversized payloads early, and surface guidance in API docs

**4. Pending Changes SSE Connection Caps** 🔧 *2-3h*
- **Risk**: `/api/sse/pending-changes` has no per-IP connection limits; an attacker could open many EventSource connections and hold server resources
- **Action**: Reuse `rateLimitSseConnections()` logic from `jobs.js` (per-IP counters + global cap) and log connection churn for monitoring

**5. Auth Ops Checklist** 🔧 *2-4h*
- **Status**: ✅ Completed as part of Milestone 1.
- **Notes**: Runbook captured under **Authentication Rollout (2025-10-04)** including env provisioning order, hash rotation workflow, and emergency recovery steps.

### 🟢 **LOW PRIORITY** (Future)

**1. User Authentication** 🏗️ *2-3 weeks*
- **Risk**: No access control for multi-user
- **Action**: JWT auth with project ownership

**2. Content File Validation** 🔧 *1-2 weeks*
- **Risk**: Malicious files bypass MIME checks
- **Action**: File signature validation

---

## Recent Security-Adjacent Changes

### Frontend Layout Security Improvements (2025-09-27)

**Layout Vulnerability Fixes**:
- **Fixed Header Bypass**: Resolved issue where header could be scrolled out of view, potentially hiding security-relevant UI elements
- **Content Overflow**: Fixed horizontal scroll that could be used to hide or obscure security warnings/notifications
- **UI Stability**: Improved layout stability prevents UI manipulation that could confuse users about application state

**Technical Implementation**:
- Switched from `position: sticky` to `position: fixed` for header to ensure security UI elements remain visible
- Added `overflow-x-hidden` to prevent horizontal scroll-based UI manipulation
- Proper content spacing prevents security notifications from being hidden behind fixed elements

**Security Impact**: 
- **Low Risk Mitigation**: Prevents potential social engineering attacks that rely on hiding security UI elements
- **User Experience**: Ensures security-related notifications and controls remain visible and accessible
- **Audit Trail**: Layout stability improves reliability of user action logging and security event tracking

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
- **Option A public hashing**:
  - `GET /api/projects/image/:filename` is now unauthenticated for public photos only, returning `{ photo, assets }` metadata with hashed URLs. Private photos still respond `401` with `visibility` detail, ensuring no leakage of private assets.
  - Hash issuance uses `publicAssetHashes.ensureHashForPhoto()` and persists to `photo_public_hashes` with defaults `hash_rotation_days=21`, `hash_ttl_days=28` (override via `config.public_assets` or `PUBLIC_HASH_ROTATION_DAYS` / `PUBLIC_HASH_TTL_DAYS`). Daily scheduler invokes `rotateDueHashes()`; monitor logs for `hashes_rotated` to confirm cadence.
  - Hash validation on asset routes requires `hash` query params for anonymous callers. Failure responses (`reason: missing|expired|mismatch`) aid clients without revealing private state. Admin-authenticated requests bypass hash checks but receive `X-Public-Hash` headers so tooling can observe current tokens.
  - Operational guidance: when toggling visibility via `POST /api/photos/visibility`, hashes are seeded or cleared automatically. If hashes appear stale (e.g., repeated `expired` reasons), trigger manual rotation with `PUBLIC_HASH_ROTATION_DAYS=1` temporarily or call `rotateDueHashes()` via REPL.

**Commit/Revert Endpoints**:
- Project-scoped: `POST /api/projects/:folder/commit-changes` and `POST /api/projects/:folder/revert-changes`
- Global: `POST /api/photos/commit-changes` and `POST /api/photos/revert-changes` (operates across multiple projects)
- Commit is destructive: moves files to `.trash` and updates availability; ensure intent is authenticated/authorized in future multi-user mode.
- Revert is non-destructive: resets `keep_*` to match `*_available`.
- Global endpoints accept optional `{ projects: ["p1", "p2"] }` body to target specific projects; if omitted, auto-detects affected projects.
- Rate limiting implemented: 10 requests per 5 minutes per IP on all commit, revert, delete, and rename endpoints.
- Pending deletes summary: `GET /api/photos/pending-deletes` provides aggregated counts across projects for UI state management.

**Realtime (SSE)**:
- `GET /api/jobs/stream` hardened with per‑IP connection cap (default 2), heartbeat every 25s, and idle timeout (default 5 min). Env overrides: `SSE_MAX_CONN_PER_IP`, `SSE_IDLE_TIMEOUT_MS`.
  - Client enforcement: the frontend maintains a single shared `EventSource` (see `client/src/api/jobsApi.js → openJobStream()`) persisted on `globalThis/window` to survive Vite HMR. This reduces parallel connections and helps avoid 429s while keeping server caps unchanged.
  - Dev guidance: close duplicate tabs and hard‑refresh if transient 429s appear during hot reloads; optionally raise `SSE_MAX_CONN_PER_IP` locally.
 - Keep flag updates (`PUT /api/projects/:folder/keep`) now emit `type: item` SSEs with `keep_jpg`/`keep_raw`. This reduces client refetch pressure and prevents UI desync; rate limits on destructive endpoints remain in effect.

**Image-Scoped Actions**:
- Endpoints under `/api/photos` (`tags/add`, `tags/remove`, `keep`, `process`, `move`) accept `photo_id`-scoped batches for cross-project operations.
- Protections: each route enforces item array validation, parameter coercion via `mustGetPhotoById()`, repository-layer parameterized queries, and per-IP rate limits (60–240 req/min depending on action).
- Dry-run support allows administrators to preview effects (`dry_run=true`) without mutating state, reducing accidental destructive changes.
- **Open risk**: batch sizes are currently unbounded and rely on upstream request-size limits; see Medium Priority item 3 for mitigation plan.

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
- Admin authentication now required for all `/api/*` routes and SSE streams (login/refresh/logout remain public). Future multi-user work will extend role-based enforcement.

**Resource Management**:
- Unlimited job queue growth
- No memory usage controls
- Large batch processing (100k+ photos)

**Monitoring**:
- Structured logging now in place across backend (see Security Overview). Next steps focus on surfacing security/audit events and alerting.

---

## Weekly Security Review Summary (2025-10-02 UTC)

- npm ci: succeeded
- npm audit --audit-level=high: 0 vulnerabilities
- npm outdated: no critical upgrades available
- npm test: exercises auth configuration error handling (`auth_config_invalid` events) while verifying bcrypt/JWT helpers.
- Verified pending-changes SSE:
  - Confirmed `server/routes/sse.js` confines queries to project/project_id joins and returns only boolean flags per project; no filenames or PII leak.
  - Observed lack of per-IP limits; tracked as Medium Priority item 4.
- Mobile long-press gestures and viewer zoom remain client-only (`client/src/App.jsx`, `client/src/components/VirtualizedPhotoGrid.jsx`, `client/src/components/PhotoViewer.jsx`); no new backend surface area.
- Overall posture: No regressions detected; prioritize new SSE connection caps alongside existing queue/logging work.

## Weekly Security Review Summary (2025-09-27 UTC)

- npm ci: succeeded
- npm audit --audit-level=high: 0 vulnerabilities
- npm outdated: no critical upgrades available

Verification highlights:
- Confirmed new image-scoped endpoints in `server/routes/photosActions.js` honor rate limits, use `mustGetPhotoById()` for ID validation, and only execute through repository functions with parameterized SQL.
- Reviewed `server/services/workers/imageMoveWorker.js` to ensure file moves remain confined to project directories and emit reconciliation SSEs.
- Confirmed job orchestration in `server/services/tasksOrchestrator.js` and `server/services/repositories/jobsRepo.js` continues to enforce two-lane worker limits; no regressions detected.

Newly identified work:
- Unbounded batch sizes on photo actions present a memory/CPU DoS risk. Added mitigation to Medium Priority list.

Overall posture: protections documented in Security Overview remain accurate after recent feature work. Focus shifts to implementing batch caps and previously planned queue/logging hardening.

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

2025-09-28 UTC — Unified View Context Architecture Implementation

- **Feature**: Implemented a unified view context architecture to eliminate the conceptual distinction between All Photos and Project views
- **Changes**: 
  - Added `view.project_filter` state (null = All Photos, string = specific project) in `useAppState.js`
  - Created `useUnifiedSelection.js` hook with a normalized selection model using `PhotoRef` objects
  - Updated all components and hooks to use the unified view context
  - Maintained backward compatibility with legacy `isAllMode` flag during transition period
- **Security Assessment**:
  - ✅ **No new attack vectors**: Pure architectural improvement with identical functionality
  - ✅ **Improved maintainability**: Consistent state management and fewer branching conditions
  - ✅ **Better testability**: Unified code paths are easier to test and verify
  - ✅ **Reduced complexity**: Eliminates duplicate code and conditional logic based on view mode
  - ✅ **Backward compatibility**: All existing security controls and validations preserved
- **Risk**: None identified. This change improves code maintainability and reduces potential for inconsistent behavior between views.
- **Monitoring**: Console logs provide detailed information about view context changes and selection operations.

2025-09-28 UTC — Pagination improvements with global manager cache

- **Feature**: Implemented a global manager cache that persists PagedWindowManager instances across renders
- **Changes**: 
  - Added module-level `managerInstances` object with separate caches for All Photos mode and each project folder
  - Modified `ensureWindow` to check the cache before creating new instances
  - Updated `resetState` to reset manager state without destroying instances
  - Added logic to detect sort changes and reset the appropriate manager
- **Security Assessment**:
  - ✅ **No new attack vectors**: Pure state management improvement
  - ✅ **Improved reliability**: Prevents state loss during navigation and filtering
  - ✅ **Better debugging**: Added comprehensive logging for easier troubleshooting
  - ✅ **Consistent behavior**: Both All Photos and Project views now use the same pagination code path
- **Risk**: None identified. This change improves reliability and user experience without introducing new security concerns.
- **Monitoring**: Console logs provide detailed information about manager lifecycle and state changes.

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

2025-09-24 UTC — Image-scoped Endpoints Implementation *(integrated into Security Overview on 2025-09-27; see section above for ongoing considerations)*

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

## 2025-09-27: Repository Architecture Optimization

- **Feature**: Refactored large `photosRepo.js` (1,200+ lines) into focused, modular architecture
- **Changes**: 
  - Split into 5 specialized modules: `photoCrud.js`, `photoFiltering.js`, `photoPagination.js`, `photoPendingOps.js`, `photoQueryBuilders.js`
  - Main `photosRepo.js` now serves as clean 83-line interface that delegates to modules
  - All existing functionality preserved through delegation pattern
  - No breaking changes to external API surface
- **Security Assessment**:
  - ✅ **No new attack vectors**: Pure refactoring with identical functionality
  - ✅ **Improved maintainability**: Smaller, focused modules easier to audit and secure
  - ✅ **Better testability**: Individual modules can be tested in isolation
  - ✅ **Reduced complexity**: Single-responsibility modules reduce cognitive load for security reviews
  - ✅ **Backward compatibility**: All existing security controls and validations preserved
- **Risk**: None identified. This is a pure architectural improvement that enhances code maintainability without changing security posture.
- **Monitoring**: Server startup logs confirm successful module loading and delegation.

## 2025-10-02 UTC — Mobile Selection Mode & Viewer Gestures
  - Drives commit/revert toolbar visibility in real-time across all browser tabs
- **Security Assessment**:
  - ✅ **No authentication required**: Single-user application, consistent with existing SSE endpoints
  - ✅ **Minimal data exposure**: Only boolean flags per project (no photo data, filenames, or metadata)
  - ✅ **SQL injection protection**: Parameterized queries via `better-sqlite3`
  - ✅ **Resource management**: Connection tracking with cleanup on disconnect, keepalive every 30s
  - ✅ **DoS mitigation**: Broadcasts only on actual state changes, not on every request
  - ⚠️ **Connection limits**: No per-IP limits (unlike `/api/jobs/stream`), but low overhead per connection
- **Risk**: Low. Minimal data exposure, efficient resource usage, consistent with existing SSE patterns.
- **Future Consideration**: Add connection limits if multi-user deployment planned.
- **Monitoring**: Server logs SSE connections, disconnections, and broadcast events.

2025-10-02 UTC — Mobile Selection Mode & Viewer Gestures

- **Feature**: Added long-press selection mode for mobile grids and enhanced viewer touch gestures (pinch zoom, swipe navigation, touch-ready zoom slider).
- **Changes**: Client-side only (`client/src/App.jsx`, `client/src/components/VirtualizedPhotoGrid.jsx`, `client/src/components/PhotoViewer.jsx`); no new backend endpoints or state persisted outside the browser session.
- **Security Assessment**:
  - ✅ **No new data exposure**: All logic remains client-side; no additional API calls or identifiers transmitted.
  - ✅ **Controls preserved**: Selection banner auto-hides when cleared, ensuring UI-state consistency and preventing stale selection indicators.
  - ✅ **DoS posture unchanged**: Touch gesture handling relies on existing viewer state without increasing request volume.
- **Risk**: None identified; enhancements strengthen mobile usability without altering trust boundaries.
- **Monitoring**: Existing frontend logging remains sufficient; no new telemetry required.
