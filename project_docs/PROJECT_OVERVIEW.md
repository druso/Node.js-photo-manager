# Project Overview: Node.js Photo Manager

## Introduction

A web-based photo management tool for photographers. Upload, organize, and view photos with automatic processing, tagging, and project-based organization. Built for single-user deployment with future multi-user support planned.

## Core Concepts

**Projects**: Primary organizational unit (albums/shoots). Each photo belongs to exactly one project.

**Photo Ingestion**: Drag-and-drop or button upload. System analyzes for conflicts, handles storage, creates DB records, queues processing.

**Unified Views**: "All Photos" and "Project view" use identical architecture. Project view = All Photos with project filter applied. Single codebase, consistent behavior.

**Filtering & Sorting**: Server-side filtering (date, file type, keep status, orientation, tags) and sorting (date/filename/size, ASC/DESC). URL-synchronized, persists across reloads.

**Shared Links**: Public galleries with hashed URLs. Admin creates links, associates photos. Public users access via `/shared/:hashedKey`. Full deep linking support for individual photos.

**Worker Pipeline**: Async background processing for thumbnails, previews, maintenance. Jobs scoped as `project`, `photo_set`, or `global`. Parallel processing with 4 threads, MD5 caching. See `JOBS_OVERVIEW.md` for details.

**Database**: SQLite stores all metadata (projects, photos, tags, jobs). Files stored on filesystem. Modular repository layer with specialized modules.

**URL-Based State**: URLs are source of truth. Filters, viewer state, and preferences in URL. Shareable and bookmarkable.

## Technology Stack

### Frontend
- **React** + **Vite** + **Tailwind CSS**
- URL-based state management (shareable, bookmarkable)
- Unified view architecture (All Photos + Project views)
- Highly optimized (App.jsx: 1,666 lines, 29% reduction from 2,350)
- 20+ specialized React hooks
- Modular architecture: extracted components, optimized code

### Backend
- **Node.js v22** + **Express** + **SQLite** (better-sqlite3)
- **Sharp** for image processing
- Modular repositories (photoCrud, photoFiltering, photoPagination, etc.)

### Key Features
- Prepared statement caching (92% faster queries)
- Unified SSE multiplexer (75% memory reduction)
- Parallel image processing (40-50% faster)
- HTTP compression (60-80% bandwidth reduction)
- Request batching (90%+ fewer API calls)

## Architecture Overview

### Client-Server Model
```
Frontend (React SPA)  ←→  Backend (Express API)  ←→  SQLite DB
         ↓                        ↓                       ↓
    Vite Dev Server         Worker Pipeline         Filesystem
```

### Frontend Structure
```
client/src/
├── App.jsx                 # Main orchestrator (~1,666 lines)
├── components/             # VirtualizedPhotoGrid, PhotoViewer, modals
├── hooks/                  # 20+ specialized hooks (state, pagination, SSE)
├── services/               # Business logic (ProjectDataService, EventHandlers)
└── api/                    # Backend API clients
```

### Backend Structure
```
server/
├── routes/                 # API endpoints (projects, photos, uploads, assets)
├── services/
│   ├── repositories/       # Data access (projects, photos, tags, jobs)
│   ├── workers/            # Background processors (derivatives, maintenance)
│   ├── workerLoop.js       # Job dispatcher (two-lane priority system)
│   ├── imageProcessingPool.js  # Worker thread pool manager
│   ├── imageWorker.js      # Sharp processing in worker threads
│   └── sseMultiplexer.js   # Unified real-time events
└── utils/                  # Shared utilities
```

### Database Schema
- **projects**: id, name, folder, status, timestamps
- **photos**: id, project_id, filename, availability flags, keep flags, derivative status
- **tags** + **photo_tags**: Many-to-many tagging
- **jobs** + **job_items**: Async task queue
- **public_links** + **photo_public_links**: Shared galleries

See `SCHEMA_DOCUMENTATION.md` for complete schema and API reference.

## Key Workflows

### Photo Upload Flow
1. User uploads files via drag-and-drop or button
2. Backend analyzes for conflicts (duplicates, cross-project)
3. Files saved to project folder, DB records created
4. `upload_postprocess` job queued for derivative generation
5. SSE events update UI in real-time

### Background Processing
1. Worker loop polls jobs table (two-lane priority system)
2. Jobs execute based on scope (project/photo_set/global)
3. Derivatives generated (thumbnails, previews) with MD5 caching
4. Database updated, SSE events emitted
5. Job marked completed/failed with retry logic

### Maintenance (Hourly)
- Trash cleanup (24h TTL)
- Orphaned project cleanup
- Duplicate resolution
- Folder alignment (sync display name → folder name)
- Manifest checking (DB ↔ filesystem reconciliation)
- Folder scanning (discover new files)

See `JOBS_OVERVIEW.md` for complete job catalog and task definitions.

## Development Setup

### Prerequisites
- Node.js v22 LTS (use nvm: `nvm install && nvm use`)
- npm v11+
- Authentication secrets (see `.env.example`)

### Quick Start
```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Configure
cp config.default.json config.json

# Set auth secrets (required)
export AUTH_ADMIN_BCRYPT_HASH="..."  # See .env.example
export AUTH_JWT_SECRET_ACCESS="..."
export AUTH_JWT_SECRET_REFRESH="..."

# Start backend (Terminal 1)
npm run dev

# Start frontend (Terminal 2)
cd client && npm run dev

# Open browser
http://localhost:5173
```

### Production Build
```bash
npm run build  # Builds client to client/dist/
```

## API Overview

### Core Endpoints
- `GET /api/projects` — List projects
- `POST /api/projects` — Create project
- `GET /api/projects/:folder/photos` — Paginated photos (with filters/sort)
- `POST /api/projects/:folder/upload` — Upload files
- `GET /api/photos` — Cross-project listing (All Photos)
- `POST /api/photos/keep` — Update keep flags by photo_id
- `POST /api/photos/move` — Move photos between projects
- `GET /api/sse/stream` — Unified SSE endpoint (jobs + pending changes)

### Asset Serving
- `GET /api/projects/:folder/thumbnail/:filename`
- `GET /api/projects/:folder/preview/:filename`
- `GET /api/projects/:folder/image/:filename`

Public photos require `?hash=<hash>` for anonymous access. Admin requests bypass hash check.

### Batch Operations
All batch endpoints support max 2,000 items, dry-run mode, and return partial failure details:
- `POST /api/photos/tags/add` — Bulk tag addition
- `POST /api/photos/tags/remove` — Bulk tag removal
- `POST /api/photos/keep` — Bulk keep flag updates
- `POST /api/photos/process` — Bulk derivative generation
- `POST /api/photos/move` — Bulk photo moves

See `SCHEMA_DOCUMENTATION.md` for complete API reference.

## Configuration

Key settings in `config.json`:

```json
{
  "uploader": {
    "accepted_files": {
      "extensions": ["jpg", "jpeg", "png", "tif", "tiff", "raw", "cr2", "nef", "arw", "dng"],
      "mime_prefixes": ["image/"]
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

## Performance Optimizations

The application has been extensively optimized through 6 focused sprints (completed November 2025):

### Sprint Results

| Sprint | Focus | Achievement |
|--------|-------|-------------|
| 1 | Database | 92% faster queries (13.39x speedup) with prepared statement caching |
| 2 | Error Handling | Comprehensive structured logging across all components |
| 3 | SSE | 75% memory reduction with unified multiplexer |
| 4 | Request Batching | 90%+ fewer API calls (50 photos = 1 call, was 50) |
| 5 | Image Processing | 40-50% faster, 30-50% lower CPU with worker thread pool |
| 6 | HTTP Compression | 60-80% bandwidth reduction (level 6, 1KB threshold) |

### Image Processing Architecture

**Worker Thread Pool** (`imageProcessingPool.js`):
- Configurable pool size (default 4 threads)
- Message-based job distribution to worker threads
- MD5-based derivative caching (skip unchanged sources)
- Automatic worker recreation on crash
- Parallel processing with per-image error isolation
- Progressive JPEG output for faster loading

**Worker Implementation** (`imageWorker.js`):
- Runs Sharp operations in isolated thread
- Handles thumbnail (200px) and preview (6000px) generation
- Returns processing results via message passing
- Graceful error handling with detailed logging

All optimizations maintain full backward compatibility and comprehensive test coverage.

## Security

- **Authentication**: Admin-only access with bcrypt + JWT
- **Rate Limiting**: All destructive endpoints (10 req/5 min/IP)
- **Asset Protection**: Signed URLs for originals, rotating hashes for public photos
- **CORS**: Configurable origin allowlist
- **File Validation**: Server-side type checking

See `SECURITY.md` for complete security documentation.

## Testing

```bash
# Run all tests
npm test

# With coverage
npm run test:coverage

# Targeted run
npm test -- server/routes/__tests__/projects.test.js
```

Tests require auth secrets. See `project_docs/TESTING_OVERVIEW.md` for details.

## Troubleshooting

**Port 5000 in use**: `lsof -i :5000 -t | xargs -r kill`

**Frontend cache issues**: `rm -rf client/node_modules/.vite && cd client && npm run dev`

**Node version issues**: Ensure Node.js v22 LTS (`nvm use`)

**Thumbnails not generating**: Check worker loop is running, Sharp installed correctly

**Database errors**: Check write permissions, foreign key constraints

## Related Documentation

- **[JOBS_OVERVIEW.md](./JOBS_OVERVIEW.md)** — Job pipeline, task definitions, priorities
- **[SCHEMA_DOCUMENTATION.md](./SCHEMA_DOCUMENTATION.md)** — Database schema, API contracts
- **[README.md](../README.md)** — Quick start guide
- **[SECURITY.md](../SECURITY.md)** — Security implementation
- **[TESTING_OVERVIEW.md](./TESTING_OVERVIEW.md)** — Test harness and helpers

---

**Note**: This overview focuses on high-level architecture. For implementation details, see specialized documentation files above.
