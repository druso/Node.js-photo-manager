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

**Assets (Thumbnails/Previews)**:
- Served without signed tokens (only originals require signatures)
- Client no longer probes pending assets; availability is driven by SSE item-level updates with light fallback polling
- Lightweight rate limits and short-lived caching headers implemented to mitigate abuse and bandwidth spikes; ETag/If-None-Match supported with 304 responses

**Commit/Revert Endpoints**:
- Commit is destructive: moves files to `.trash` and updates availability; ensure intent is authenticated/authorized in future multi-user mode.
- Revert is non-destructive: resets `keep_*` to match `*_available`.
- Rate limiting implemented: 10 requests per 5 minutes per IP on commit, revert, delete, and rename endpoints.

**Realtime (SSE)**:
- `GET /api/jobs/stream` hardened with per‑IP connection cap (default 2), heartbeat every 25s, and idle timeout (default 5 min). Env overrides: `SSE_MAX_CONN_PER_IP`, `SSE_IDLE_TIMEOUT_MS`.

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

## New Development Notes (Pending Security Review)

1) SSE Item-Level Updates for Derivatives

- Change: Backend now emits item-level SSE messages from `derivativesWorker` of the form `{ type: 'item', project_folder, filename, thumbnail_status, preview_status, updated_at }` via `GET /api/jobs/stream`.
- Rationale: Enables granular UI updates without full grid refreshes and eliminates client-side asset probing.
- Security considerations:
  - CORS: Ensure `GET /api/jobs/stream` respects production CORS allowlist.
  - Exposure: Messages contain only non-sensitive status metadata (no PII/secrets). Confirm no internal paths or secrets are included.
  - Abuse: SSE is a single long-lived connection; consider per-IP connection limits and timeouts.
  - Status: Reviewed. Implementation in `server/routes/jobs.js` emits minimal metadata (no secrets/paths). Action required: enforce CORS allowlist and add per‑IP caps + idle timeout (see Medium Priority 3b).

2) Per-Item Removal Events + Optimistic Hide on Commit

- Change: Backend emits `item_removed` during `manifest_cleaning`; client performs optimistic hide on Commit (marks assets missing, drops rows with no assets) and reconciles via SSE without a hard refresh.
- Benefit: Eliminates transient 404s and UI flicker; maintains scroll/selection and reduces network volume.
- Security considerations:
  - CORS: Ensure SSE stream adheres to strict allowlist in production.
  - Rate limiting: Light limits on commit/revert endpoints to prevent abuse of destructive ops (already in Suggested Interventions #3).
  - SSE connection policy: cap concurrent SSE streams per IP and set idle timeouts to mitigate resource pinning.
  - Status: Reviewed. No sensitive data exposure detected; endpoints exist without rate limits. Action required: add rate limits to commit/revert/delete/rename and enforce SSE connection policy.

3) Input Validation (Analyze/Keep)

- Change: Added explicit validation for `POST /api/projects/:folder/analyze-files` (requires `files: []`) and `PUT /api/projects/:folder/keep` (requires `updates: []`). Keep endpoint now normalizes filename with or without extension.
- Security considerations: Reduces 500s from malformed requests; confines errors to 400/404 paths and limits information leakage. No change in authorization surface.

3) Removal of Client Probing for Thumbnails

- Change: Client no longer probes thumbnail URLs while pending; uses SSE events + light fallback polling.
- Benefit: Reduces 404 request volume and potential amplification vectors.
- Security considerations:
  - Asset endpoints still should retain light rate limiting and standard caching headers as above.
  - Status: Reviewed. Current `assets.js` does not set caching headers/ETag nor rate limits. Action required: implement lightweight throttling and `Cache-Control`/`ETag` for 200; short negative caching for 404 (see Medium Priority #6).

4) Worker Loop Configuration Warnings

- Change: Added runtime warnings for misconfigurations that could starve normal lane.
- Security considerations: Logging only; no impact on exposure.

Action requested (Security Team):

- Review SSE endpoint CORS/rate limiting posture and document any required production settings.
- Re-evaluate the need/severity of asset endpoint throttling given probing removal; keep minimal rate limits and caching guidance.

4) Filter Panel Footer Buttons (Close/Reset)

- Change: Added non-destructive UI controls to the filters panel (`Close` to collapse the panel, `Reset` to clear active filters; disabled when no filters are active).
- Rationale: Improves UX and mobile ergonomics; no backend interaction.
- Security considerations: UI-only; no new endpoints, no changes to request surface. No additional review required.

5) Filters Layout Reorder + Popover Date Picker

- Change: Reordered filters within `UniversalFilter.jsx` to improve scanability: Row 0 text search (full width); Row 1 date taken (new dual‑month popover with presets) + orientation; Row 2 file types available + file types to keep. Replaced separate From/To inputs with a single popover range picker component (`DualMonthRangePopover.jsx`).
- Rationale: More intuitive filtering and faster selection.
- Security considerations: UI-only; no backend changes or new endpoints. No expansion of attack surface. No additional review required.

6) Viewer Delete Behavior (No Auto-Advance)

- Change: The photo viewer no longer auto-advances when the user plans a delete (sets keep none). The current index is clamped when the filtered photo list changes to avoid premature viewer close.
- Rationale: Prevents double-skip when filters hide deleted items and eliminates transient UI errors from rapid close/reopen.
- Security considerations: UI-only; no new endpoints, no change to request patterns or data exposure. No additional review required.

7) Project Deletion Converted to High-Priority Task (Soft Delete)

- Change: `DELETE /api/projects/:folder` now performs a soft-delete (`projects.status='canceled'`, `archived_at` set) and enqueues a high‑priority `project_delete` task (steps: stop processes, delete files, cleanup DB). Frontend hides canceled projects immediately.
- Benefits: Faster UX, consistent job pipeline handling, orderly cleanup, cancellation of conflicting jobs.
- Security considerations:
  - Rate limit the DELETE endpoint (see Medium Priority #3) since it triggers destructive operations.
  - Ensure only authorized users can delete (future auth); log audit entries (who/when/id/folder).
  - Worker idempotency: file deletion and DB cleanup must be safe on retries; current implementation is idempotent by checking project status and tolerating missing tables/paths.
  - Priority lane impact: high‑priority deletion jobs preempt normal processing; confirm lane capacity cannot starve other critical maintenance (keep at least 1 slot for maintenance).

8) Scheduler Change: Archived Maintenance Skip + Project Scavenge Task

- Change: Scheduler now runs `maintenance` hourly only for active (non‑archived) projects and runs a separate `project_scavenge` task hourly for archived projects to remove leftover `.projects/<project_folder>/` folders.
- Rationale: Prevents maintenance from touching archived projects and ensures eventual cleanup if deletion file step was skipped or failed.
- Security considerations:
  - Destructive file ops: `project_scavenge` removes directories; ensure it only operates when `projects.status==='canceled'` and path is confined under repo `.projects/` (it is; uses `path.join(__dirname, '../../..', '.projects', project_folder)`).
  - Idempotency: tolerate missing folders; errors bubble for retry; no DB mutation beyond reads.
  - Logging/Audit: structured logs `scavenge_*` added; include `project_id` and `project_folder`.
  - Lane impact: step priority 100; verify `pipeline.priority_lane_slots` leaves capacity for other high‑priority tasks to avoid starvation.
