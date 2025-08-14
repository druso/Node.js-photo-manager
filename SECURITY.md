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
- **Action**: Add express-rate-limit to `/api/projects/:folder/commit-changes` and `/api/projects/:folder/revert-changes`

**4. Job Queue Limits** 🔧 *4-6h*
- **Risk**: Memory exhaustion from unlimited jobs
- **Action**: Max 100 pending jobs per project in scheduler

**5. Audit Logging** 🔧 *6-8h*
- **Risk**: Limited forensics capability
- **Action**: Structured logs for file ops, job failures

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

2) Removal of Client Probing for Thumbnails

- Change: Client no longer probes thumbnail URLs while pending; uses SSE events + light fallback polling.
- Benefit: Reduces 404 request volume and potential amplification vectors.
- Security considerations:
  - Asset endpoints still should retain light rate limiting and standard caching headers as above.

3) Worker Loop Configuration Warnings

- Change: Added runtime warnings for misconfigurations that could starve normal lane.
- Security considerations: Logging only; no impact on exposure.

Action requested (Security Team):

- Review SSE endpoint CORS/rate limiting posture and document any required production settings.
- Re-evaluate the need/severity of asset endpoint throttling given probing removal; keep minimal rate limits and caching guidance.
