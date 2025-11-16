# Node.js Photo Manager

A modern web-based photo management application for photographers. Upload, organize, and view photos with automatic processing, tagging, and project-based organization.

## What is this?

Manage photo collections with:
- **Project organization** (shoots, events, albums)
- **Multi-format support** (JPG, PNG, TIFF, RAW: CR2, NEF, ARW, DNG)
- **Automatic processing** (thumbnails and previews)
- **Tagging system** for organization and searching
- **Keep/discard workflow** for RAW+JPG pairs
- **Real-time progress tracking** for background tasks
- **Public/private visibility** with shared links

## Technology

**Frontend**: React + Vite + Tailwind CSS
- URL-based state management (shareable, bookmarkable)
- Unified view architecture (All Photos + Project views)
- Highly optimized (App.jsx: 2,350→1,666 lines, 29% reduction)
- 20+ specialized React hooks

**Backend**: Node.js v22 + Express + SQLite
- Modular repository layer
- Two-lane job pipeline (project/photo_set/global scopes)
- Parallel image processing (4 threads)

**Performance**:
- 92% faster queries (prepared statement caching)
- 75% memory reduction (unified SSE)
- 40-50% faster image processing
- 60-80% bandwidth reduction (HTTP compression)
- 90%+ fewer API calls (request batching)

## Quick Start

### Prerequisites
- **Node.js v22 LTS** (required)
- **npm v10+** (v10.0.0 or later)
- **nvm** (recommended). Repo includes `.nvmrc` set to `22`.

### Installation

```bash
# Use Node 22 with nvm
nvm install && nvm use

# Install dependencies
npm install
cd client && npm install && cd ..

# Configure
cp config.default.json config.json

# Set auth secrets (required)
export AUTH_ADMIN_BCRYPT_HASH="$(awk -F'="' '/AUTH_ADMIN_BCRYPT_HASH/ {print $2}' .env.example | tr -d '"')"
export AUTH_JWT_SECRET_ACCESS="$(awk -F'="' '/AUTH_JWT_SECRET_ACCESS/ {print $2}' .env.example | tr -d '"')"
export AUTH_JWT_SECRET_REFRESH="$(awk -F'="' '/AUTH_JWT_SECRET_REFRESH/ {print $2}' .env.example | tr -d '"')"

# Start backend (Terminal 1)
npm run dev

# Start frontend (Terminal 2)
cd client && npm run dev

# Open browser
http://localhost:5173
```

### First Steps
1. Log in as admin (password: `password` for sample hash)
2. Create a new project
3. Upload photos (drag & drop)
4. Watch thumbnails generate automatically

### Production Build
```bash
npm run build  # Builds frontend to client/dist/
```

## Key Features

- **Project-based Organization**: Group photos by shoot/event
- **Multi-format Support**: JPG, PNG, TIFF, RAW files
- **Automatic Processing**: Background thumbnail/preview generation
- **Tagging System**: Custom tags for organization
- **Keep/Discard Workflow**: Manage RAW+JPG pairs with commit/revert
- **Unified Views**: All Photos (cross-project) and Project views
- **Real-time Updates**: Live job progress via SSE
- **Virtualized Grid**: Smooth scrolling for large collections
- **Deep Linking**: Shareable URLs for photos and filtered views
- **Public Galleries**: Shared links for curated collections
- **Batch Operations**: 90%+ reduction in API calls (50 photos = 1 call)

## API Quick Reference

**Core Endpoints**:
- `GET /api/projects` — List projects
- `POST /api/projects` — Create project
- `GET /api/projects/:folder/photos` — Paginated photos (with filters/sort)
- `POST /api/projects/:folder/upload` — Upload files
- `GET /api/photos` — Cross-project listing (All Photos)
- `POST /api/photos/keep` — Update keep flags by photo_id
- `POST /api/photos/move` — Move photos between projects
- `GET /api/sse/stream` — Real-time updates (jobs + pending changes)

**Asset Serving**:
- `GET /api/projects/:folder/thumbnail/:filename` (public photos require `?hash=<hash>`)
- `GET /api/projects/:folder/preview/:filename`
- `GET /api/projects/:folder/image/:filename`

See `project_docs/SCHEMA_DOCUMENTATION.md` for complete API reference.

## Performance Optimizations

**6 Focused Sprints** (Completed November 2025):

| Sprint | Focus | Achievement |
|--------|-------|-------------|
| 1 | Database | 92% faster queries (13.39x speedup) |
| 2 | Error Handling | Comprehensive structured logging |
| 3 | SSE | 75% memory reduction |
| 4 | Request Batching | 90%+ fewer API calls |
| 5 | Image Processing | 40-50% faster with worker threads |
| 6 | HTTP Compression | 60-80% bandwidth reduction |

All optimizations maintain full backward compatibility and comprehensive test coverage.

## Configuration

Key settings in `config.json`:

```json
{
  "uploader": {
    "accepted_files": {
      "extensions": ["jpg", "jpeg", "png", "tif", "tiff", "raw", "cr2", "nef", "arw", "dng"]
    }
  },
  "processing": {
    "thumbnail": { "maxDim": 200, "quality": 80 },
    "preview": { "maxDim": 6000, "quality": 80 },
    "workerCount": 4
  },
  "pipeline": {
    "max_parallel_jobs": 1,
    "priority_lane_slots": 1,
    "priority_threshold": 90
  }
}
```

See `config.default.json` for all options.

## Environment Variables

**Required** (authentication):
- `AUTH_ADMIN_BCRYPT_HASH` — Bcrypt hash of admin password
- `AUTH_JWT_SECRET_ACCESS` — 256-bit secret for access tokens
- `AUTH_JWT_SECRET_REFRESH` — 256-bit secret for refresh tokens

**Optional**:
- `AUTH_BCRYPT_COST` — Integer 8-14 (default 12)
- `REQUIRE_SIGNED_DOWNLOADS` — Boolean (default true)
- `DOWNLOAD_SECRET` — HMAC secret for signed URLs
- `ALLOWED_ORIGINS` — Comma-separated CORS origins
- `LOG_LEVEL` — `error|warn|info|debug` (default `info`)
- `SSE_MAX_CONN_PER_IP` — Max SSE connections per IP (default 2)

See `.env.example` for sample values.

## Maintenance

**Hourly Automated Tasks**:
- Trash cleanup (24h TTL)
- Orphaned project cleanup
- Duplicate resolution
- Folder alignment (sync display name → folder name)
- Manifest checking (DB ↔ filesystem reconciliation)
- Folder scanning (discover new files)

**Manual Operations**:
- `POST /api/projects/:folder/commit-changes` — Apply pending deletions (project)
- `POST /api/photos/commit-changes` — Apply pending deletions (cross-project)
- `POST /api/projects/:folder/revert-changes` — Reset keep flags (non-destructive)

See `project_docs/JOBS_OVERVIEW.md` for detailed workflows.

## Common Issues

**Port 5000 in use**:
```bash
lsof -i :5000 -t | xargs -r kill
```

**Frontend cache issues**:
```bash
rm -rf client/node_modules/.vite && cd client && npm run dev
```

**Node version issues**: Ensure Node.js v22 LTS (`nvm use`)

**Thumbnails not generating**: Check worker loop running, Sharp installed

**SSE 429 errors (dev)**: Close duplicate browser tabs, or set `SSE_MAX_CONN_PER_IP=3`

## Testing

```bash
# Run all tests
npm test

# With coverage
npm run test:coverage

# Targeted run
npm test -- server/routes/__tests__/projects.test.js
```

Tests require auth secrets (see `.env.example`). See `project_docs/TESTING_OVERVIEW.md` for details.

## Documentation

Comprehensive documentation in `project_docs/`:

- **[PROJECT_OVERVIEW.md](project_docs/PROJECT_OVERVIEW.md)** — Architecture, core concepts, technology stack
- **[SCHEMA_DOCUMENTATION.md](project_docs/SCHEMA_DOCUMENTATION.md)** — Database schema, API contracts
- **[JOBS_OVERVIEW.md](project_docs/JOBS_OVERVIEW.md)** — Job pipeline, task definitions, priorities
- **[SECURITY.md](SECURITY.md)** — Security implementation, authentication, rate limiting

## Containerization

Production-ready Docker packaging included.

**Build**:
```bash
docker build -t nodejs-photo-manager:local .
```

**Run**:
```bash
docker run --rm -it \
  -p 5000:5000 \
  -e NODE_ENV=production \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  -e DOWNLOAD_SECRET=change-me \
  -e AUTH_ADMIN_BCRYPT_HASH="..." \
  -e AUTH_JWT_SECRET_ACCESS="..." \
  -e AUTH_JWT_SECRET_REFRESH="..." \
  -v $(pwd)/.projects:/app/.projects \
  -v $(pwd)/config.json:/app/config.json \
  nodejs-photo-manager:local
```

**Docker Compose**:
```bash
docker compose up --build
```

See `docker-compose.yml` for configuration.

## Contributing

For development setup, architecture details, and contribution guidelines, see [PROJECT_OVERVIEW.md](project_docs/PROJECT_OVERVIEW.md).

## Security

- **Authentication**: Admin-only access with bcrypt + JWT
- **Rate Limiting**: All destructive endpoints (10 req/5 min/IP)
- **Asset Protection**: Signed URLs for originals, rotating hashes for public photos
- **CORS**: Configurable origin allowlist
- **File Validation**: Server-side type checking

See [SECURITY.md](SECURITY.md) for complete security documentation.

---

**Note**: Change default auth secrets before deploying to production. See `.env.example` for generation commands.
