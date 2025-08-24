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

**Commit/Revert Endpoints**:
- Commit is destructive: moves files to `.trash` and updates availability; ensure intent is authenticated/authorized in future multi-user mode.
- Revert is non-destructive: resets `keep_*` to match `*_available`.
- Rate limiting implemented: 10 requests per 5 minutes per IP on commit, revert, delete, and rename endpoints.

**Realtime (SSE)**:
- `GET /api/jobs/stream` hardened with per‑IP connection cap (default 2), heartbeat every 25s, and idle timeout (default 5 min). Env overrides: `SSE_MAX_CONN_PER_IP`, `SSE_IDLE_TIMEOUT_MS`.
  - Client enforcement: the frontend maintains a single shared `EventSource` (see `client/src/api/jobsApi.js → openJobStream()`) persisted on `globalThis/window` to survive Vite HMR. This reduces parallel connections and helps avoid 429s while keeping server caps unchanged.
  - Dev guidance: close duplicate tabs and hard‑refresh if transient 429s appear during hot reloads; optionally raise `SSE_MAX_CONN_PER_IP` locally.

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
