# Node.js Photo Manager

A modern web-based photo management application designed for photographers. Upload, organize, and view your photos with automatic thumbnail generation, tagging, and project-based organization.

## What is this?

This application helps photographers manage their photo collections by:
- **Organizing photos into projects** (shoots, events, albums)
- **Supporting multiple formats** (JPG, PNG, TIFF, RAW files like CR2, NEF, ARW, DNG)
- **Automatic processing** (thumbnail and preview generation)
- **Tagging system** for easy organization and searching
- **Keep/discard workflow** for managing RAW+JPG pairs
- **Real-time progress tracking** for background processing

## Technology

- **Frontend**: React with Vite and Tailwind CSS
- **Backend**: Node.js with Express and SQLite
- **Image Processing**: Sharp library for high-performance processing

## Quick Start

### Prerequisites
- **Node.js v22 LTS** (required)
- **npm v10+**

### Installation & Setup

1. **Install dependencies**:
   ```bash
   npm install
   cd client && npm install && cd ..
   ```

2. **Configure the application**:
   ```bash
   cp config.default.json config.json
   # Edit config.json if needed (optional for basic usage)
   ```

3. **Start the application** (requires 2 terminals):
   
   **Terminal 1 - Backend**:
   ```bash
   npm run dev
   ```
   
   **Terminal 2 - Frontend**:
   ```bash
   cd client && npm run dev
   ```

4. **Open your browser** to `http://localhost:3000`

### First Steps
1. Create a new project
2. Upload some photos (drag & drop or click to select)
3. Watch thumbnails generate automatically
4. Add tags and organize your photos

### Production Build
```bash
npm run build  # Builds frontend to client/dist/
```

## Key Features

- **Project-based Organization**: Group photos by shoot, event, or any logical grouping
- **Multi-format Support**: JPG, PNG, TIFF, and RAW files (CR2, NEF, ARW, DNG)
- **Automatic Processing**: Background thumbnail and preview generation
- **Tagging System**: Add custom tags for easy organization
- **Keep/Discard Workflow**: Manage RAW+JPG pairs efficiently
- **Real-time Updates**: Live progress tracking for all background tasks
- **Drag & Drop Upload**: Intuitive file upload interface
- **Keyboard Shortcuts**: Fast navigation and actions
- **Secure Asset Serving**: Signed URLs for photo access

## Maintenance

- Background maintenance jobs keep disk and database in sync: `trash_maintenance`, `manifest_check`, `folder_check`, `manifest_cleaning`.
- An in-process scheduler enqueues these per project on a cadence (hourly/6h/daily).
- Manual reconciliation: `POST /api/projects/:folder/commit-changes` moves non‑kept files to `.trash` and enqueues reconciliation jobs.

## Common Issues

**Port 5000 already in use**:
```bash
lsof -i :5000 -t | xargs -r kill
```

**Frontend cache issues**:
```bash
rm -rf client/node_modules/.vite
cd client && npm run dev
```

**Node.js version issues**: Ensure you're using Node.js v22 LTS

## Environment Variables

- **`REQUIRE_SIGNED_DOWNLOADS`** (default: `true`) - Controls token verification for file downloads
- **`DOWNLOAD_SECRET`** - HMAC secret for signed URLs (change in production)

See [SECURITY.md](SECURITY.md) for detailed security configuration.

## Documentation

- **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** - Comprehensive developer guide with architecture, API details, and development workflow
- **[SCHEMA_DOCUMENTATION.md](SCHEMA_DOCUMENTATION.md)** - Database schema and data structure details
- **[SECURITY.md](SECURITY.md)** - Security implementation and best practices
  - Note: see “Notes for Security Analysis Team” re: maintenance jobs and `.trash` handling

## Contributing

For development setup, architecture details, API documentation, and contribution guidelines, see [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).
