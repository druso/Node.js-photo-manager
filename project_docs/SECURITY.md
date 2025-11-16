# Security Documentation

**Last Updated**: 2025-11-15 UTC  
**Maintained By**: Security Analyst  
**Security Posture**: A- (Excellent - Production Ready)

---

## Executive Summary

The Node.js Photo Manager has **enterprise-grade security** with no critical vulnerabilities. Authentication uses bcrypt + JWT, all queries are parameterized (SQL injection proof), and comprehensive rate limiting is in place.

**Security Status**:
- ✅ **Authentication**: Enterprise-grade (bcrypt, JWT, HTTP-only cookies, SameSite=Strict)
- ✅ **SQL Injection**: Protected (all parameterized queries via better-sqlite3)
- ✅ **Rate Limiting**: Comprehensive (destructive ops, assets, SSE)
- ✅ **Error Handling**: Structured logging via logger2
- ⚠️ **Action Required**: One SSE endpoint lacks per-IP connection limits (30 min fix)

---

## Critical Security Action Items

### 🔴 **IMMEDIATE ACTION REQUIRED**

**1. SSE Rate Limiting on `/api/sse/pending-changes`** 🔧 *30 minutes*

- **Vulnerability**: DoS attack via unlimited EventSource connections
- **Risk Level**: MEDIUM-HIGH
  - **Exploitability**: Easy (standard EventSource API)
  - **Impact**: Server resource exhaustion, service degradation
  - **Likelihood**: Medium (requires knowledge of endpoint)
- **Current State**: `/api/jobs/stream` has per-IP limits (2 connections); `/api/sse/pending-changes` does not
- **Fix**: Add per-IP connection tracking and limits
- **Implementation**:
  ```javascript
  // Add to server/routes/sse.js
  const ipConnCounts = new Map();
  const MAX_SSE_PER_IP = Number(process.env.SSE_MAX_CONN_PER_IP || 2);
  
  router.get('/pending-changes', (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const current = ipConnCounts.get(ip) || 0;
    
    if (current >= MAX_SSE_PER_IP) {
      return res.status(429).json({ error: 'Too many SSE connections from this IP' });
    }
    
    ipConnCounts.set(ip, current + 1);
    
    // ... existing handler code ...
    
    req.on('close', () => {
      const cur = ipConnCounts.get(ip) || 1;
      if (cur <= 1) ipConnCounts.delete(ip);
      else ipConnCounts.set(ip, cur - 1);
    });
  });
  ```
- **Testing**: 
  ```bash
  # Test connection limit
  curl -N http://localhost:3001/api/sse/pending-changes &
  curl -N http://localhost:3001/api/sse/pending-changes &
  curl -N http://localhost:3001/api/sse/pending-changes  # Should return 429
  ```
- **Status**: ⚠️ **OPEN** - Not covered by performance sprints

---

## High Priority Security Items

### 🟡 **NEXT SECURITY REVIEW CYCLE**

**1. Job Queue Limits** 🔧 *4-6h*

- **Vulnerability**: Memory exhaustion from unlimited job queueing
- **Risk Level**: MEDIUM
  - **Exploitability**: Medium (requires sustained load or malicious intent)
  - **Impact**: Memory exhaustion, service degradation, potential crash
  - **Likelihood**: Low (current rate limiting provides partial protection)
- **Current Mitigation**: Rate limiting on destructive endpoints (10 req/5min per IP)
- **Action**: Implement max 100 pending jobs per project in scheduler
- **Implementation**: Add queue size check in `server/services/scheduler.js` before enqueue
- **Status**: ⚠️ **OPEN**

**2. Audit Logging Enhancement** 🔧 *6-8h*

- **Security Gap**: Limited forensics capability for security incidents
- **Risk Level**: LOW-MEDIUM
  - **Impact**: Difficult incident response, limited forensic trail
  - **Likelihood**: N/A (operational improvement, not a vulnerability)
- **Current**: Basic structured logging via logger2
- **Action**: Add comprehensive audit trail for:
  - **File operations**: create, delete, move (with before/after state)
  - **Project operations**: create, rename, delete (with metadata)
  - **Authentication events**: login, logout, token refresh, failed attempts
  - **Permission changes**: (when multi-user implemented)
  - **Configuration changes**: security-relevant config updates
- **Format**: Structured JSON logs with `event_type: "audit"`, `action`, `actor`, `resource`, `before`, `after`, `timestamp`
- **Status**: ⚠️ **OPEN**

**3. "Select All" Response Size Limits** 🔧 *2-3h*

- **Vulnerability**: Unbounded response size on `/api/photos/all-keys`
- **Risk Level**: LOW
  - **Exploitability**: Easy (standard API call)
  - **Impact**: Large response (50k+ photos = ~1MB), increased bandwidth/memory
  - **Likelihood**: Low (legitimate use case, rate limited)
- **Current Mitigation**: 
  - Rate limited at 60 req/min per IP
  - Frontend shows confirmation dialog for >1000 photos
- **Action**: Add server-side cap (e.g., max 10,000 keys) with error guidance
- **Implementation**: Return 413 Payload Too Large with message: "Result set too large (>10k items). Please refine your filters."
- **Status**: ⚠️ **OPEN** - Current mitigations adequate, low urgency

---

## Medium Priority Security Enhancements

### 🟢 **FUTURE SECURITY WORK**

**1. Multi-User Authentication & Authorization** 🏗️ *2-3 weeks*

- **Current State**: Single admin authentication (production-grade)
- **Gap**: No per-user access control or project ownership
- **Risk Level**: LOW (single-user deployment model)
- **Action**: When multi-user support needed:
  - User registration and management
  - Project ownership and sharing
  - Role-based access control (owner, editor, viewer)
  - Audit trail for permission changes
  - Session management and concurrent login handling
- **Security Considerations**:
  - Password complexity requirements
  - Account lockout after failed attempts
  - Email verification for registration
  - Password reset flow with secure tokens
  - CSRF protection for state-changing operations
- **Status**: ⚠️ **FUTURE** - Not required for current deployment model

**2. Content File Validation** 🔧 *1-2 weeks*

- **Current State**: MIME type checking via Sharp library
- **Gap**: No file signature validation (magic bytes)
- **Risk Level**: LOW
  - **Current Protection**: Sharp validates image format, rejects malicious files
  - **Exploitability**: Low (Sharp is robust, actively maintained)
  - **Impact**: Malicious file upload (mitigated by Sharp validation)
- **Action**: Add file signature validation for defense-in-depth
- **Implementation**: Check magic bytes before passing to Sharp
- **Status**: ⚠️ **FUTURE** - Current validation adequate

**3. SSE Graceful Shutdown** 🔧 *30 minutes*

- **Gap**: No SIGTERM handler for SSE connections
- **Risk Level**: LOW
  - **Impact**: Unclean connection closures during deployments
  - **Likelihood**: N/A (cosmetic issue, not a vulnerability)
- **Action**: Add graceful shutdown to notify clients before restart
- **Implementation**:
  ```javascript
  process.on('SIGTERM', () => {
    for (const [id, res] of connections) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'shutdown' })}\n\n`);
        res.end();
      } catch (err) {
        log.warn('sse_shutdown_write_failed', { connectionId: id });
      }
    }
    connections.clear();
  });
  ```
- **Status**: ⚠️ **FUTURE** - Low priority operational improvement

---

## Current Security Protections

### Authentication & Authorization

**Admin Authentication** (Implemented 2025-10-04):
- **Password Hashing**: bcrypt with configurable cost factor
- **Access Tokens**: JWT with 1 hour TTL
- **Refresh Tokens**: JWT with 7 day TTL
- **Cookie Security**: HTTP-only, SameSite=Strict, Secure in production
- **Fail-Fast Validation**: Server exits if default secrets used in production
- **Protected Routes**: All `/api/*` routes require authentication
- **Public Routes**: Shared links remain publicly accessible (read-only)

**Configuration**:
```json
{
  "auth": {
    "admin_username": "admin",
    "admin_password_hash": "<bcrypt hash>",
    "jwt_secret": "<strong secret>",
    "jwt_access_ttl": "1h",
    "jwt_refresh_ttl": "7d",
    "bcrypt_cost": 10
  }
}
```

**Security Notes**:
- Change default secrets before network deployment
- Use `bcrypt_cost >= 10` for production
- Rotate `jwt_secret` periodically (invalidates all sessions)
- Monitor failed login attempts for brute force attacks

### SQL Injection Protection

**All queries use parameterized statements**:
```javascript
// ✅ SECURE - Parameterized query
db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id);

// ✅ SECURE - Multiple parameters
db.prepare(`SELECT * FROM photos WHERE project_id = ? AND filename = ?`)
  .get(project_id, filename);
```

**Verification**: No string concatenation in SQL queries (grep verified)

**Database Configuration**:
- WAL mode for concurrency
- Foreign key constraints enforced
- Comprehensive indexing for performance
- Repository pattern abstraction

### Rate Limiting

**Comprehensive rate limits** (per IP):
- **Destructive operations**: 10 requests per 5 minutes
- **Thumbnails**: 600 requests per minute
- **Previews**: 600 requests per minute
- **Originals**: 120 requests per minute
- **ZIP downloads**: 30 requests per minute
- **SSE `/api/jobs/stream`**: 2 concurrent connections
- **⚠️ SSE `/api/sse/pending-changes`**: NO LIMITS (see Critical Action Items)

**Configuration**: `config.json → rate_limits` with environment overrides

**Environment Variables**:
- `THUMBNAIL_RATELIMIT_MAX`
- `PREVIEW_RATELIMIT_MAX`
- `IMAGE_RATELIMIT_MAX`
- `ZIP_RATELIMIT_MAX`
- `SSE_MAX_CONN_PER_IP`

### Download Security

**Signed URLs** (HMAC-based):
- 2-minute expiry window
- Request binding (project/filename/type)
- Replay protection via unique JWT ID
- Configurable via `REQUIRE_SIGNED_DOWNLOADS` (default: true)
- Secret: `DOWNLOAD_SECRET` (must change for production)

**Generation**:
```bash
# Generate strong secret
openssl rand -base64 32
```

### Upload Security

**Validation**:
- Dual validation (MIME + extension)
- Path traversal protection (`path.basename()`)
- 100MB size limits
- Configurable file type filtering via `config.json → uploader.accepted_files`

**File Type Validation**: Centralized in `server/utils/acceptance.js`

**Accepted Types** (default):
- Images: JPG, JPEG, PNG, GIF, WEBP, HEIC, HEIF
- RAW: ARW, CR2, CR3, DNG, NEF, ORF, RAF, RW2

### File Operations Security

**Path Confinement**:
- All operations confined to project subdirectories
- Filename sanitization enforced
- Atomic database + file transactions
- No symbolic link following

**Validation**:
- Project folder names must be sanitized (no special characters, path separators)
- Filenames validated before any file system operations
- Database transactions ensure consistency

### Asset Serving Security

**Streaming Implementation**:
- All assets served via `fs.createReadStream` (not `res.sendFile`)
- ETag/If-None-Match support with 304 responses
- Cache-Control headers for revalidation
- Rate limiting per asset type

**Public Asset Hashing** (Option A):
- Public photos served via hashed URLs
- Hash rotation: 21 days (configurable)
- Hash TTL: 28 days (configurable)
- Private photos return 401 (no hash leakage)
- Admin requests bypass hash checks

**Configuration**:
```json
{
  "public_assets": {
    "hash_rotation_days": 21,
    "hash_ttl_days": 28
  }
}
```

### Realtime (SSE) Security

**`/api/jobs/stream`** (Hardened):
- Per-IP connection cap (default: 2)
- Heartbeat every 25 seconds
- Idle timeout (default: 5 minutes)
- Client-side singleton prevents connection storms
- Environment overrides: `SSE_MAX_CONN_PER_IP`, `SSE_IDLE_TIMEOUT_MS`

**`/api/sse/pending-changes`** (⚠️ Gap):
- No per-IP connection limits
- See Critical Action Items above

### Commit/Revert Security

**Endpoints**:
- Project-scoped: `POST /api/projects/:folder/commit-changes`, `POST /api/projects/:folder/revert-changes`
- Global: `POST /api/photos/commit-changes`, `POST /api/photos/revert-changes`

**Protection**:
- Rate limiting: 10 requests per 5 minutes per IP
- Authentication required
- Commit is destructive (moves files to `.trash`)
- Revert is non-destructive (resets flags)
- Audit trail via structured logging

**Global Operations**:
- Accept optional `{ projects: ["p1", "p2"] }` body
- Auto-detect affected projects if omitted
- Enqueue single `change_commit_all` task with chunked items (2k per job)

### Logging & Monitoring

**Structured Logging** (logger2):
- All backend routes/services/workers emit structured JSON logs
- Log levels: `error`, `warn`, `info`, `debug`
- Context includes: `project_id`, `project_folder`, `project_name`, `job_id`
- Event tagging: `upload_failed`, `list_jobs_failed`, `project_delete_failed`
- Configurable via `LOG_LEVEL` environment variable

**Log Format**:
```json
{
  "level": "info",
  "cmp": "photos",
  "evt": "list_photos_request",
  "project_id": 123,
  "limit": 200,
  "ts": "2025-11-15T12:34:56.789Z"
}
```

---

## Known Security Gaps

### Access Control
- **Current**: Single admin authentication
- **Gap**: No per-user access control or project ownership
- **Risk**: LOW (single-user deployment model)
- **Mitigation**: Multi-user support planned for future (see Medium Priority items)

### Resource Management
- **Gap**: Unlimited job queue growth
- **Risk**: MEDIUM (memory exhaustion under sustained load)
- **Mitigation**: Rate limiting on destructive endpoints provides partial protection
- **Action**: See High Priority items

### Monitoring
- **Current**: Structured logging in place
- **Gap**: Limited audit trail for security incidents
- **Risk**: LOW-MEDIUM (impacts incident response, not prevention)
- **Action**: See High Priority items

---

## Configuration & Environment

### Critical Environment Variables

**`DOWNLOAD_SECRET`** (default: `"dev-download-secret-change-me"`)
- **MUST CHANGE** for any network deployment
- Generate: `openssl rand -base64 32`
- Server exits in production if default secret used

**`REQUIRE_SIGNED_DOWNLOADS`** (default: `true`)
- Keep enabled except for temporary local testing
- Disabling removes download URL security

**`ALLOWED_ORIGINS`** (CORS)
- Whitelist of allowed origins for CORS
- Denied origins return 403 Forbidden
- Example: `["https://example.com", "https://app.example.com"]`

### Runtime Environment

**Node.js Version**: 22 (required)
- Use nvm with `.nvmrc` for version management
- Production: Lock Node version in container images

**Production Checklist**:
1. ✅ Change `DOWNLOAD_SECRET` to strong random value
2. ✅ Set `REQUIRE_SIGNED_DOWNLOADS=true`
3. ✅ Configure `ALLOWED_ORIGINS` for CORS
4. ✅ Set strong `auth.jwt_secret` in config.json
5. ✅ Set strong `auth.admin_password_hash` (bcrypt)
6. ✅ Review and adjust rate limits for your deployment
7. ✅ Set `LOG_LEVEL=info` (or `warn` for production)
8. ✅ Enable HTTPS (use reverse proxy like nginx)

### Container Security (Docker)

**Image**: Multi-stage build on `node:22-bookworm-slim`
- Installs `libvips` for Sharp image processing
- Runs as non-root `node` user (UID 1000)

**Security Recommendations**:
- **Filesystem**: Mount only required paths as writable
  - Bind `.projects` for user data
  - Bind `config.json` for configuration
  - Consider `read_only: true` with `tmpfs: [/tmp]`
- **Network**: Expose only port 5000 to upstream proxy
- **Secrets**: Provide via environment or secrets store (never commit)
- **Resource Limits**: Set CPU/memory limits to reduce DoS blast radius
- **Healthcheck**: Use `/api/config` probe for orchestrator health checks

**Example docker-compose.yml**:
```yaml
services:
  photo-manager:
    image: photo-manager:latest
    user: "1000:1000"  # non-root
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - ./projects:/app/.projects
      - ./config.json:/app/config.json:ro
    environment:
      - DOWNLOAD_SECRET=${DOWNLOAD_SECRET}
      - ALLOWED_ORIGINS=https://example.com
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

### Security-Relevant Files

**Backend**:
- `server/utils/signedUrl.js` - Download URL signing
- `server/utils/acceptance.js` - File type validation
- `server/utils/rateLimit.js` - Rate limiting middleware
- `server/routes/assets.js` - Asset serving
- `server/routes/uploads.js` - Upload handling
- `server/middleware/authenticateAdmin.js` - Authentication

**Configuration**:
- `config.json` - Runtime configuration (file types, rate limits, auth)
- `.env` - Secrets (DOWNLOAD_SECRET, etc.)

---

## Performance/Observability Items (Covered by Sprints)

*These items improve security posture indirectly through better observability and error handling, but are primarily performance/operational improvements. See `tasks_new/` for implementation details.*

### Sprint 1: Prepared Statement Caching
- **Security Benefit**: Reduced CPU usage makes DoS attacks harder
- **Primary Goal**: 10-30% query performance improvement
- **Effort**: 2-3 hours
- **Status**: ✅ **PLANNED** - Documentation ready in `tasks_new/sprint_1_prepared_statement_caching.md`

### Sprint 2: Error Handling Improvements
- **Security Benefit**: Better debugging of security incidents, no silent failures
- **Primary Goal**: Improve production debugging
- **Current**: 82 empty catch blocks across 23 files
- **Effort**: 1-2 hours
- **Status**: ✅ **PLANNED** - Documentation ready in `tasks_new/sprint_2_error_handling_improvements.md`

### Sprint 3: Frontend Performance
- **Security Benefit**: Smaller attack surface, faster security updates
- **Primary Goal**: 20-40% smaller bundle, faster page loads
- **Effort**: 2-4 hours
- **Status**: ✅ **PLANNED** - Documentation ready in `tasks_new/sprint_3_frontend_performance.md`

### Sprint 4: Request ID Tracking
- **Security Benefit**: Better incident response, request correlation for security events
- **Primary Goal**: Improved observability and debugging
- **Effort**: 2-3 hours
- **Status**: ✅ **PLANNED** - Documentation ready in `tasks_new/sprint_4_observability_enhancements.md`

---

## Development Workflow

### Security Review Process

1. **Developers**: Document new features requiring security assessment in this document
2. **Security Analyst**: Assess implications, update action items, enrich documentation
3. **Cleanup**: Remove temporary notes after assessment

This ensures all functionality receives security review before deployment.

### Weekly Security Review Checklist

- [ ] Run `npm ci` and verify success
- [ ] Run `npm audit --audit-level=high` and verify 0 vulnerabilities
- [ ] Run `npm outdated` and check for critical upgrades
- [ ] Run `npm test` and verify all tests pass
- [ ] Review recent code changes for security implications
- [ ] Verify no console.log in production code
- [ ] Check for empty catch blocks without logging
- [ ] Review new endpoints for authentication/authorization
- [ ] Verify rate limiting on new endpoints
- [ ] Update action items based on findings
- [ ] Document any new vulnerabilities or mitigations

---

## Recent Security Enhancements

### 2025-11-15: CTO Technical Audit
- **Grade**: A- (Excellent with minor improvements)
- **Findings**: No critical vulnerabilities, production-ready security posture
- **Action**: SSE rate limiting gap identified (see Critical Action Items)
- **Documentation**: `tasks_progress/codebase_technical_audit_2025_11_15.md`

### 2025-11-14: Manifest Check Streaming
- **Security Impact**: DoS risk reduction via bounded memory usage
- **Implementation**: Cursor-based pagination (2000 photos per chunk)
- **Benefit**: Prevents out-of-memory crashes on large projects (50k+ photos)

### 2025-11-14: Orphaned Project Cleanup
- **Security Impact**: Reduced attack surface from orphaned data
- **Implementation**: Hourly maintenance job removes orphaned projects
- **Benefit**: Maintains database-filesystem synchronization

### 2025-11-06: Code Optimization
- **Security Impact**: Reduced attack surface via code simplification
- **Implementation**: Removed legacy validation, simplified folder format
- **Benefit**: Easier security audits, fewer edge cases

### 2025-10-04: Admin Authentication
- **Implementation**: bcrypt + JWT with HTTP-only cookies
- **Protection**: All `/api/*` routes require authentication
- **Configuration**: Fail-fast validation for production secrets

### 2025-09-27: Repository Architecture Optimization
- **Security Impact**: Improved maintainability and auditability
- **Implementation**: Split `photosRepo.js` (1,200+ lines) into 5 focused modules
- **Benefit**: Smaller, focused modules easier to audit and secure

---

## Weekly Security Review Summary (2025-11-15 UTC)

### Assessment Completed
- ✅ **npm ci**: Succeeded
- ✅ **npm audit --audit-level=high**: 0 vulnerabilities
- ✅ **npm outdated**: No critical upgrades needed
- ✅ **npm test**: All tests pass

### Code Quality Verification
- ✅ **Console.log**: No instances in production code (grep verified)
- ✅ **SQL injection**: All queries use parameterized statements
- ✅ **Authentication**: Enterprise-grade implementation verified
- ⚠️ **Error handling**: 82 empty catch blocks (Sprint 2 planned)
- ⚠️ **Prepared statements**: ~160 instances without caching (Sprint 1 planned)

### New Vulnerabilities Identified
1. **SSE Connection Limits** (CRITICAL)
   - `/api/sse/pending-changes` lacks per-IP connection limits
   - DoS risk: attacker could exhaust server resources
   - Fix: 30 minutes (see Critical Action Items)

### Documentation Review
- ✅ **PROJECT_OVERVIEW.md**: Accurate, reflects current architecture
- ✅ **SCHEMA_DOCUMENTATION.md**: Complete, API contracts documented
- ✅ **JOBS_OVERVIEW.md**: Canonical job catalog, payload limits documented
- ✅ **README.md**: Setup instructions current, security notes present

### Overall Posture
**Grade: A- (Excellent)**
- Production-ready with strong security foundations
- No critical vulnerabilities (one HIGH priority gap)
- Minor optimizations planned via sprint system
- **Immediate Action**: Implement SSE rate limiting (30 min)

### Recommended Actions (Next 2 Weeks)
1. **Week 1**: Fix SSE rate limiting (30 min) + Sprint 1 (2-3h)
2. **Week 2**: Sprint 2 (1-2h) + Sprint 3 (2-4h)

---

## Document History

- **2025-11-15**: Complete security-focused rewrite, removed noise, separated sprint items
- **2025-11-15**: CTO technical audit integrated, SSE rate limiting gap identified
- **2025-11-04**: Simplified project rename security assessment
- **2025-10-04**: Admin authentication implementation documented
- **2025-09-27**: Repository architecture optimization documented
- **2025-08-20**: Initial security documentation created

---

**Next Review Due**: 2025-11-22 UTC
