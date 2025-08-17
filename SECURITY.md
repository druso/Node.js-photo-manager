# Security Documentation

## Suggested Interventions

*Maintained by security analyst, prioritized by complexity and risk.*

### 🔴 **HIGH PRIORITY** (Immediate)

**1. Production CORS Configuration** ⚡ *5 min*
- **Risk**: Cross-origin attacks
- **Action**: Replace `app.use(cors())` with origin allowlist in `server.js`

**2. Change Default Download Secret** ⚡ *5 min*  
- **Risk**: Token forgery with known secret
- **Action**: Set strong `DOWNLOAD_SECRET`: `openssl rand -base64 32`

### 🟡 **MEDIUM PRIORITY** (Next cycle)

**3. Rate Limiting** 🔧 *2-4h*
- **Risk**: Abuse of commit/revert endpoints
- **Action**: Add express-rate-limit to `/api/projects/:folder/commit-changes`, `/api/projects/:folder/revert-changes`, `DELETE /api/projects/:folder` (soft-delete), and `PATCH /api/projects/:id` (rename)

**4. Job Queue Limits** 🔧 *4-6h*
- **Risk**: Memory exhaustion from unlimited jobs
- **Action**: Max 100 pending jobs per project in scheduler

**5. Audit Logging** 🔧 *6-8h*
- **Risk**: Limited forensics capability
- **Action**: Structured logs for file ops, job failures, and project rename events (old_name → new_name, id)

**6. Asset Endpoint Throttling & Caching** 🔧 *1-2h*
- **Risk**: Increased request volume from frontend probing of pending thumbnails could be abused to cause excess load
- **Action**:
  - Add lightweight rate limiting to `GET /api/projects/:folder/thumbnail/:filename` and `.../preview/:filename` (IP + project tuple)
  - Configure `Cache-Control: public, max-age=60` on 200 responses; consider short negative caching using `Retry-After` or `Cache-Control: no-store, must-revalidate` on 404 to avoid long stale negatives
  - Ensure responses include `ETag` and honor `If-None-Match` to reduce bytes on revalidation

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
- Configurable file type filtering

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
- Frontend may probe pending assets periodically to surface images incrementally
- Consider rate limits and short-lived caching headers to mitigate abuse and bandwidth spikes

**Commit/Revert Endpoints**:
- Commit is destructive: moves files to `.trash` and updates availability; ensure intent is authenticated/authorized in future multi-user mode.
- Revert is non-destructive: resets `keep_*` to match `*_available`; still subject to rate limiting and auth once implemented.

### ⚠️ **Current Gaps**

**Access Control**:
- No authentication on destructive endpoints
- Permissive CORS (development mode)
- No rate limiting

**Resource Management**:
- Unlimited job queue growth
- No memory usage controls
- Large batch processing (100k+ photos)

**Monitoring**:
- Limited audit logging
- Basic error tracking
- No security event alerting

---

## Configuration & Environment

### Critical Variables

**`DOWNLOAD_SECRET`** (default: `"dev-download-secret-change-me"`)
- **Must change** for any network deployment
- Generate: `openssl rand -base64 32`

**`REQUIRE_SIGNED_DOWNLOADS`** (default: `true`)
- Keep enabled except temporary local testing

### Security Files

**Backend**: `server/utils/signedUrl.js`, `server/routes/assets.js`, `server/routes/uploads.js`
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

2) Per-Item Removal Events + Optimistic Hide on Commit

- Change: Backend emits `item_removed` during `manifest_cleaning`; client performs optimistic hide on Commit (marks assets missing, drops rows with no assets) and reconciles via SSE without a hard refresh.
- Benefit: Eliminates transient 404s and UI flicker; maintains scroll/selection and reduces network volume.
- Security considerations:
  - CORS: Ensure SSE stream adheres to strict allowlist in production.
  - Rate limiting: Light limits on commit/revert endpoints to prevent abuse of destructive ops (already in Suggested Interventions #3).
  - SSE connection policy: cap concurrent SSE streams per IP and set idle timeouts to mitigate resource pinning.

3) Removal of Client Probing for Thumbnails

- Change: Client no longer probes thumbnail URLs while pending; uses SSE events + light fallback polling.
- Benefit: Reduces 404 request volume and potential amplification vectors.
- Security considerations:
  - Asset endpoints still should retain light rate limiting and standard caching headers as above.

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
