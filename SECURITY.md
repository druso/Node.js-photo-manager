# Security Documentation

This document provides a comprehensive overview of security measures implemented in the Node.js Photo Manager, current protections, configuration options, and recommendations for future hardening.

## Table of Contents
- [Current Security Measures](#current-security-measures)
- [Download Security (Signed URLs)](#download-security-signed-urls)
- [Upload Security](#upload-security)
- [Database Security](#database-security)
- [Network Security](#network-security)
- [Configuration Security](#configuration-security)
- [Local Development](#local-development)
- [Future Enhancements](#future-enhancements)
- [Environment Variables](#environment-variables)
- [Files & Implementation](#files--implementation)

## Current Security Measures

The application implements multiple layers of security protection:

### ✅ **Download Protection**
- **Signed URLs**: HMAC-based token system for all file downloads
- **Time-limited access**: 2-minute default expiry for download tokens
- **Request binding**: Tokens tied to specific project, filename, and type
- **Replay protection**: Unique `jti` (JWT ID) in each token

### ✅ **Upload Security**
- **Configurable file type validation**: Server-side filtering via `config.json`
- **Dual validation**: Both MIME type and file extension checking
- **Path traversal protection**: Filename sanitization using `path.basename()`
- **File size limits**: 100MB maximum upload size
- **Fallback validation**: Safe defaults when configuration fails

### ✅ **Database Security**
- **Parameterized queries**: All database operations use prepared statements
- **Foreign key constraints**: Referential integrity enforcement
- **WAL mode**: Write-Ahead Logging for better concurrency
- **Repository pattern**: Abstracted data access layer

### ✅ **Input Validation**
- **Filename sanitization**: Prevention of directory traversal attacks
- **Project folder validation**: Path-based access control
- **MIME type verification**: Content-type validation for uploads
- **Extension allowlisting**: Configurable accepted file types

## Download Security (Signed URLs)

### Implementation Details

**Token Structure**:
```javascript
{
  f: "project-folder",    // Project folder name
  t: "jpg|raw|zip",       // File type
  n: "filename.jpg",      // Filename
  exp: 1640995200000,     // Expiry timestamp
  jti: "a1b2c3d4"         // Unique token ID
}
```

**Security Features**:
- **HMAC-SHA256 signing** with configurable secret
- **Base64URL encoding** for URL safety
- **Signature verification** on every download request
- **Expiry validation** prevents token reuse
- **Parameter binding** ensures tokens can't be misused

**Files**: `server/utils/signedUrl.js`, `server/routes/assets.js`

## Upload Security

### File Type Validation

**Configuration-based filtering** (`config.json`):
```json
{
  "uploader": {
    "accepted_files": {
      "extensions": ["jpg", "jpeg", "png", "tif", "tiff", "raw", "cr2", "nef", "arw", "dng"],
      "mime_prefixes": ["image/"]
    }
  }
}
```

**Server-side validation** (`server/routes/uploads.js`):
- **Dual checking**: Both file extension and MIME type validation
- **Configurable rules**: Accepts extensions and MIME prefixes from config
- **Fallback protection**: Safe defaults if configuration fails
- **Error handling**: Clear rejection messages for invalid files

### Path Security

**Filename sanitization**:
```javascript
const sanitizedName = path.basename(file.originalname);
if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
  // Reject invalid filenames
}
```

**Protection against**:
- Directory traversal attacks (`../../../etc/passwd`)
- Hidden file uploads (`.htaccess`, `.env`)
- Special directory names (`.`, `..`)

### File Size Limits
- **100MB maximum** per file upload
- **Memory storage**: Files processed in memory for security
- **Configurable limits**: Can be adjusted via Multer configuration

## Database Security

### SQLite Configuration
- **WAL mode enabled**: `PRAGMA journal_mode = WAL`
- **Foreign keys enforced**: `PRAGMA foreign_keys = ON`
- **File location**: `.projects/db/user_0.sqlite`
- **Automatic creation**: Database initialized on first run

### Query Security
- **Prepared statements**: All queries use parameterized statements
- **Repository pattern**: Centralized data access in `server/services/repositories/`
- **No dynamic SQL**: Prevents SQL injection attacks
- **Type validation**: Input validation before database operations

### Data Access Control
- **Project-scoped queries**: Photos filtered by project ownership
- **Unique constraints**: Prevent duplicate entries
- **Referential integrity**: Foreign key constraints maintain consistency

## Network Security

### CORS Configuration
**Current setup** (`server.js`):
```javascript
app.use(cors()); // Permissive for development
```

**Security implications**:
- ⚠️ **Development-friendly**: Currently allows all origins
- 🔒 **Production recommendation**: Restrict to specific domains
- 📝 **Configuration needed**: Should be environment-specific

### HTTPS Considerations
- **Local development**: HTTP acceptable for localhost
- **Production deployment**: HTTPS strongly recommended
- **Asset serving**: Signed URLs work over both HTTP/HTTPS

## Configuration Security

### Sensitive Configuration
**Environment variables**:
- `DOWNLOAD_SECRET`: HMAC signing key (change from default!)
- `REQUIRE_SIGNED_DOWNLOADS`: Enable/disable signed URL enforcement

**Configuration file** (`config.json`):
- ❌ **Not in source control**: Contains environment-specific settings
- 🔒 **File permissions**: Should be readable only by application user
- 📋 **Template provided**: `config.default.json` shows structure

### Security-relevant Settings
```json
{
  "uploader": {
    "accepted_files": {
      "extensions": [...],     // Allowed file extensions
      "mime_prefixes": [...]   // Allowed MIME type prefixes
    }
  },
  "pipeline": {
    "max_parallel_jobs": 1,    // Resource limiting
    "heartbeat_ms": 1000,      // Job monitoring
    "stale_seconds": 60        // Cleanup timing
  }
}
```

## Local Development

### Safe Defaults
- **Signed URLs enabled**: `REQUIRE_SIGNED_DOWNLOADS=true` by default
- **Development secret**: Default `DOWNLOAD_SECRET` for quick setup
- **Permissive CORS**: Allows cross-origin requests for ease of development
- **File validation**: Safe fallback file type restrictions

### Development Toggles
```bash
# Disable signed URLs for testing (not recommended)
REQUIRE_SIGNED_DOWNLOADS=false

# Custom signing secret
DOWNLOAD_SECRET=your-secure-secret-here
```

### Recommendations
- ✅ **Keep signed URLs enabled** for realistic testing
- ⚠️ **Change default secret** before any network exposure
- 🔒 **Use HTTPS** if accessible from other machines
- 📝 **Test with realistic file types** to verify validation

## Future Enhancements

### User Authentication & Multi-Tenancy

**When adding user accounts**:
- **Authentication gating**: Protect download URL minting endpoints
- **User-scoped tokens**: Include `userId` in token payload
- **Access control**: Verify user owns requested project/files
- **Session management**: JWT or session-based authentication

**Implementation approach**:
```javascript
// Token payload with user binding
{
  f: "project-folder",
  t: "jpg",
  n: "photo.jpg",
  exp: 1640995200000,
  jti: "a1b2c3d4",
  uid: "user123"  // User identifier
}
```

### Enhanced Security Features

**Single-use tokens**:
- Store `jti` values in Redis/LRU cache
- Mark tokens as consumed after use
- Prevent replay attacks

**Rate limiting**:
- Download endpoint throttling
- Upload rate limiting
- Token minting restrictions

**Audit logging**:
- Token generation events
- Download access logs
- Failed authentication attempts
- File upload activities

### Production Hardening

**Network security**:
- **Restrict CORS**: Specific origin allowlist
- **HTTPS enforcement**: Redirect HTTP to HTTPS
- **Security headers**: CSP, HSTS, X-Frame-Options

**Input validation**:
- **Strict project validation**: Verify project existence and ownership
- **Enhanced filename checks**: Additional sanitization rules
- **Content validation**: File content verification beyond MIME types

**Monitoring & alerting**:
- **Failed authentication tracking**
- **Unusual download patterns**
- **Large file upload monitoring**
- **Database integrity checks**

### Desktop/Local Packaging

**Air-gapped deployment**:
- Optional signed URL enforcement
- Local user model without network auth
- File system permission-based security
- Simplified configuration for single-user scenarios

## Environment Variables

### Security-Critical Variables

**`REQUIRE_SIGNED_DOWNLOADS`** (default: `true`)
- **Purpose**: Enable/disable signed URL enforcement
- **Values**: `true` (secure) | `false` (development only)
- **Security impact**: Disabling removes download protection
- **Recommendation**: Keep `true` except for temporary local testing

**`DOWNLOAD_SECRET`** (default: `"dev-download-secret-change-me"`)
- **Purpose**: HMAC signing key for download tokens
- **Security impact**: Weak secrets allow token forgery
- **Requirements**: 
  - Minimum 32 characters
  - Cryptographically random
  - Different per environment
- **Example**: `openssl rand -base64 32`

### Configuration Validation

**Security checklist for production**:
- [ ] `DOWNLOAD_SECRET` changed from default
- [ ] `REQUIRE_SIGNED_DOWNLOADS=true`
- [ ] `config.json` has appropriate file permissions
- [ ] CORS configured for specific origins
- [ ] Database file has restricted access

## Files & Implementation

### Core Security Files

**Backend Implementation**:
- `server/utils/signedUrl.js` - HMAC signing and verification
- `server/routes/assets.js` - Download protection and URL minting
- `server/routes/uploads.js` - Upload validation and sanitization
- `server/services/db.js` - Database security configuration
- `server/services/repositories/` - Parameterized query implementations

**Configuration**:
- `config.json` - Security settings (not in source control)
- `config.default.json` - Template with secure defaults
- `.env` files - Environment-specific secrets

**Frontend Security**:
- `client/src/api/` - Secure API communication patterns
- Download flows use signed URL requests
- No sensitive data in client-side storage

### Key Endpoints

**Protected endpoints**:
- `GET /api/projects/:folder/file/:type/:filename` - Requires valid token
- `GET /api/projects/:folder/files-zip/:filename` - Requires valid token
- `POST /api/projects/:folder/download-url` - Mints signed URLs

**Upload endpoints**:
- `POST /api/projects/:folder/upload` - File type validation
- `POST /api/projects/:folder/analyze-files` - Pre-upload validation

**Unprotected endpoints**:
- `GET /api/projects/:folder/thumbnail/:filename` - Thumbnails (performance)
- `GET /api/projects/:folder/preview/:filename` - Previews (performance)

---

## Security Best Practices Summary

### ✅ **Currently Implemented**
- Signed URL download protection
- Server-side file type validation
- Path traversal prevention
- Parameterized database queries
- Input sanitization
- Configurable security settings

### ⚠️ **Needs Attention**
- CORS configuration for production
- HTTPS enforcement for network deployments
- Rate limiting implementation
- Audit logging system

### 🔮 **Future Considerations**
- User authentication system
- Multi-tenant access controls
- Enhanced monitoring and alerting
- Content-based file validation
- Single-use token implementation

---

# NEW DEVELOPMENT TO BE ASSESSED BY SECURITY ANALYSIS

