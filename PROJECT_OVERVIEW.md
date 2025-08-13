# Project Overview: Node.js Photo Manager

## 1. Introduction

Welcome to the Node.js Photo Manager! This document provides a comprehensive overview of the project for new developers.

The application is a web-based photo management tool designed for amateur and professional photographers. It provides a simple way to upload, organize, and view photos from shoots. The long-term vision is to evolve this into a multi-user, online platform akin to Google Photos but with a focus on the needs of photo artists.

## 2. Core Concepts

The application is built around a few key concepts:

*   **Projects**: A Project is the primary organizational unit, representing a collection of photos from a single event or shooting session. Think of it as an "album" or a specific shoot. A photo belongs to exactly one Project.

*   **Photo Ingestion**: This is the process of adding photos to the application. Users can drag-and-drop files or use an upload button. The backend handles the file storage, creates database records, and queues up post-processing tasks.

*   **List and Viewer**: These are the main UI components for interacting with photos. The "List" view shows thumbnails of photos within a project, and the "Viewer" provides a full-size view of a single selected photo.

*   **Worker Pipeline**: To ensure the UI remains responsive, time-consuming tasks like generating thumbnails and previews are handled asynchronously by a background worker pipeline. This system is designed to be extensible for future processing needs.

*   **Database**: While photo files (originals, raws, previews) are stored on the file system, all their metadata—such as project association, tags, timestamps, and file paths—is stored in a central SQLite database. The frontend application relies on this database for fast access to photo information.

## 3. Technology Stack

The application is built with modern, production-ready technologies:

### Frontend Dependencies
*   **React**: Component-based UI framework
*   **Vite**: Fast build tool and development server
*   **Tailwind CSS**: Utility-first CSS framework for styling
*   **PostCSS**: CSS processing and optimization

### Backend Dependencies
*   **Express.js**: Web application framework for Node.js
*   **better-sqlite3**: High-performance SQLite database driver
*   **Sharp**: High-performance image processing library
*   **Multer**: Middleware for handling multipart/form-data (file uploads)
*   **CORS**: Cross-Origin Resource Sharing middleware
*   **fs-extra**: Enhanced file system operations
*   **exif-parser**: EXIF metadata extraction from images
*   **archiver**: ZIP file creation for bulk downloads

### Development Tools
*   **nodemon**: Auto-restart development server on file changes
*   **Node.js v22**: JavaScript runtime (LTS version required)
*   **npm v10+**: Package manager

## 4. Architecture Overview

The application follows a classic client-server architecture.

### Frontend (`client/`)

The frontend is a modern single-page application (SPA) responsible for all user interactions.

*   **Technology**: Built with **React** and **Vite** for fast development and building (`vite.config.mjs`). Uses **Tailwind CSS** for styling.
*   **Source Code**: The main application logic resides in `client/src/`.
*   **Entry Point**: The main HTML file is `client/index.html`.
*   **Static Assets**: Public assets like fonts or icons are stored in `client/public/`.
*   **Key Components**: 
    *   `App.jsx`: Main application component with routing and state management
    *   `components/`: Reusable UI components (PhotoGrid, PhotoViewer, etc.)
    *   `api/`: API client modules for backend communication

### Backend (`server/`)

The backend is a Node.js application that exposes a RESTful API for the client.

*   **Technology**: Built with **Node.js** and **Express.js** for routing. Uses **Sharp** for image processing, **better-sqlite3** for database operations, and **Multer** for file uploads.
*   **Entry Point**: The main server file is `server.js`.
*   **API Routes (`server/routes/`)**: This directory defines all the API endpoints. Key files include:
    *   `uploads.js`: Handles file uploads with configurable file type filtering
    *   `projects.js`: Manages project creation and data retrieval
    *   `assets.js`: Serves photo assets (previews, thumbnails) with signed URLs
    *   `jobs.js`: Provides endpoints for the worker pipeline and Server-Sent Events
    *   `tags.js`: Manages photo tagging functionality
    *   `keep.js`: Handles keep/discard decisions for RAW vs JPG files
*   **Business Logic (`server/services/`)**: This directory contains the core application logic:
    *   `db.js`: SQLite database initialization with WAL mode and foreign keys
    *   `repositories/`: Data access layer (projects, photos, tags, jobs)
    *   `workerLoop.js`: Background job processor with crash recovery
    *   `workers/`: Individual worker implementations (derivatives generation)
    *   `events.js`: Event emitter for real-time job updates
*   **Utilities (`server/utils/`)**: Contains helper functions used across the backend.

#### Project Folders (Fresh Start)

Projects are stored on disk under `<repoRoot>/.projects/<project_folder>/` where `project_folder` is always of the form `<slug(project_name)>--p<id>`. Duplicate human names are allowed; uniqueness is enforced by `project_folder`.

On creation, the server ensures these subdirectories exist:
- `.thumb` for thumbnails
- `.preview` for previews
- `.trash` for temporary removals

### Database

The application uses **SQLite** with better-sqlite3 for data storage, providing ACID compliance and excellent performance for this use case.

*   **Core Tables**: `projects`, `photos`, `tags`, `photo_tags` (many-to-many)
*   **Job System**: `jobs` and `job_items` tables power the async worker pipeline
*   **Features**: WAL mode enabled, foreign key constraints, comprehensive indexing
*   **Storage**: Uses SQLite with WAL mode for ACID compliance and performance
*   **Data Access**: Repository pattern with dedicated modules in `server/services/repositories/`

Refer to `SCHEMA_DOCUMENTATION.md` for detailed table structures and relationships.

## 5. Key Features

### Photo Management
*   **Multi-format Support**: Handles JPG, PNG, TIFF, and various RAW formats (CR2, NEF, ARW, DNG)
*   **Project Organization**: Photos are organized into projects (albums/shoots)
*   **Metadata Extraction**: Automatic EXIF data parsing for timestamps, camera settings, etc.
*   **Keep/Discard System**: Intelligent handling of RAW+JPG pairs with user preferences

### Image Processing
*   **Automatic Thumbnails**: Generated asynchronously for fast grid viewing
*   **Preview Generation**: High-quality previews for detailed viewing
*   **Configurable Quality**: Thumbnail and preview settings in configuration
*   **Orientation Handling**: Proper rotation based on EXIF orientation data

### User Interface
*   **Drag & Drop Upload**: Intuitive file upload with progress tracking
*   **Grid and Table Views**: Multiple viewing modes for photo browsing
*   **Full-screen Viewer**: Detailed photo viewing with zoom and navigation
*   **Keyboard Shortcuts**: Comprehensive keyboard navigation (see configuration)
*   **Real-time Updates**: Live job progress via Server-Sent Events

### Tagging System
*   **Flexible Tagging**: Add custom tags to photos for organization
*   **Tag Management**: Create, edit, and delete tags
*   **Many-to-many Relationships**: Photos can have multiple tags

### Background Processing
*   **Async Job Pipeline**: Non-blocking image processing
*   **Job Status Tracking**: Real-time progress monitoring
*   **Crash Recovery**: Automatic restart of failed jobs
*   **Extensible Workers**: Easy to add new processing tasks

### Security
*   **Signed URLs**: Secure access to photo assets with expiration
*   **File Type Validation**: Server-side filtering of uploaded files
*   **CORS Protection**: Configurable cross-origin access controls

Refer to `SECURITY.md` for detailed security implementation and best practices.

## 6. Key Workflows

### Photo Ingestion Flow

1.  **Upload**: The user uploads one or more image files via the client UI.
2.  **API Request**: The client sends the files to the `/api/uploads` endpoint on the server.
3.  **File Storage**: The server saves the original files to a designated storage location defined in the configuration.
4.  **Database Entry**: The server creates records for the new photos in the database, associating them with a project.
5.  **Job Queuing**: A new job is created and added to the `jobs` table in the database (e.g., `generate_previews`).

### Worker Pipeline Flow

1.  **Job Polling**: The `workerLoop.js` service periodically polls the `jobs` table for new, unprocessed jobs.
2.  **Job Execution**: When a new job is found, the worker executes the corresponding task (e.g., the thumbnail generation worker is called).
3.  **Processing**: The worker generates the required assets (e.g., a JPEG preview and a smaller thumbnail) and saves them to the appropriate directory.
4.  **Update Database**: The paths to the newly generated assets are saved in the photo's database record.
5.  **Job Completion**: The job is marked as `completed` in the `jobs` table.

### Maintenance Processes

Maintenance tasks keep the on‑disk state and the database in sync. They are implemented as high‑priority, idempotent jobs handled by the same worker loop.

Job types:

- `trash_maintenance`: Remove files in `.trash` older than 24h.
- `manifest_check`: Verify DB availability flags (`jpg_available`, `raw_available`) against files on disk and fix discrepancies.
- `folder_check`: Scan the project folder for untracked files; enqueue `upload_postprocess` for accepted files; move unaccepted files to `.trash`.
- `manifest_cleaning`: Delete rows where both JPG and RAW are unavailable.

Scheduler (`server/services/scheduler.js`) cadence:

- Hourly: `trash_maintenance` (priority 100)
- Every 6h: `manifest_check` (95)
- Every 6h (staggered by 30m): `folder_check` (95)
- Daily: `manifest_cleaning` (80)

Manual reconciliation endpoint:

- `POST /api/projects/:folder/commit-changes`
  - Moves non‑kept files to `.trash` based on `keep_jpg`/`keep_raw` flags
  - Updates DB availability flags accordingly
  - Enqueues `manifest_check`, `folder_check`, and `manifest_cleaning`
  - See implementation in `server/routes/maintenance.js`

## 7. Getting Started

### Prerequisites
*   **Node.js v22 LTS** (required - check with `node --version`)
*   **npm v10+** (check with `npm --version`)
*   **Git** (for cloning and version control)

### Step-by-Step Setup

1.  **Clone and Navigate**:
    ```bash
    git clone <repository-url>
    cd Node.js-photo-manager
    ```

2.  **Install Backend Dependencies**:
    ```bash
    npm install
    ```

3.  **Install Frontend Dependencies**:
    ```bash
    cd client
    npm install
    cd ..
    ```

4.  **Configuration Setup**:
    ```bash
    cp config.default.json config.json
    ```
    Edit `config.json` to customize:
    - File storage paths
    - Database location (auto-created)
    - Upload file type restrictions
    - Processing settings

5.  **Database Initialization**:
    The SQLite database is automatically created on first run. No manual migration needed.

6.  **Start Development Servers**:
    
    **Terminal 1 - Backend**:
    ```bash
    npm run dev  # Auto-restart on changes
    # or npm start for production mode
    ```
    Backend runs on `http://localhost:5000`
    
    **Terminal 2 - Frontend**:
    ```bash
    cd client
    npm run dev
    ```
    Frontend runs on `http://localhost:3000`

7.  **Verify Setup**:
    - Open `http://localhost:3000` in your browser
    - Create a new project
    - Upload a test image
    - Check that thumbnails generate automatically

### Build for Production
```bash
npm run build  # Builds client to client/dist/
```

## 8. Configuration

The application's behavior is controlled by the `config.json` file (not in source control).

### Key Configuration Sections

#### File Upload Settings
```json
"uploader": {
  "accepted_files": {
    "extensions": ["jpg", "jpeg", "png", "tif", "tiff", "raw", "cr2", "nef", "arw", "dng"],
    "mime_prefixes": ["image/"]
  }
}
```

#### Image Processing
```json
"processing": {
  "thumbnail": { "maxDim": 200, "quality": 80 },
  "preview": { "maxDim": 6000, "quality": 80 }
}
```

#### Worker Pipeline
```json
"pipeline": {
  "max_parallel_jobs": 1,
  "max_parallel_items_per_job": 1,
  "heartbeat_ms": 1000,
  "stale_seconds": 60,
  "max_attempts_default": 3
}
```

#### Keyboard Shortcuts
```json
"keyboard_shortcuts": {
  "next_photo": "ArrowRight",
  "prev_photo": "ArrowLeft",
  "zoom_in": "=",
  "zoom_out": "-",
  "view_grid": "g",
  "view_table": "t",
  "toggle_filters": "f",
  "keep_jpg_only": "j",
  "keep_raw_and_jpg": "r"
}
```

#### UI Preferences
```json
"ui": {
  "default_view_mode": "grid",
  "filters_collapsed_default": true,
  "remember_last_project": true
}
```

See `config.default.json` for the complete configuration template with all available options.

## 9. API Overview

The backend exposes a comprehensive REST API for all frontend operations:

### Core Endpoints
*   **Projects**: `GET/POST/DELETE /api/projects` - Project management
*   **Uploads**: `POST /api/projects/:folder/upload` - File upload with progress
*   **Processing**: `POST /api/projects/:folder/process` - Queue thumbnail/preview generation
*   **Analysis**: `POST /api/projects/:folder/analyze-files` - Pre-upload file analysis
*   **Assets**: 
    *   `GET /api/projects/:folder/thumbnail/:filename` - Thumbnail serving (no token)
    *   `GET /api/projects/:folder/preview/:filename` - Preview serving (no token)
    *   `POST /api/projects/:folder/download-url` - Mint signed URLs for originals
    *   `GET /api/projects/:folder/file/:type/:filename` - Download originals (requires token)
    *   `GET /api/projects/:folder/files-zip/:filename` - Download ZIP (requires token)
*   **Jobs**: `GET/POST /api/projects/:folder/jobs` - Background job management
*   **Tags**: `PUT /api/projects/:folder/tags` - Batch tag updates
*   **Keep**: `PUT /api/projects/:folder/keep` - RAW/JPG keep decisions
*   **Config**: `GET/POST /api/config`, `POST /api/config/restore` - Configuration management

### Real-time Features
*   **Server-Sent Events**: `GET /api/jobs/stream` - Live job progress updates
*   **Job Status**: Real-time notifications for thumbnail generation, uploads, etc.

### Response Formats
*   All endpoints return JSON responses
*   Consistent error handling with HTTP status codes
*   Pagination support for large datasets

## 10. Development Workflow

### Common Development Tasks

#### Adding New Features
1.  **Backend**: Add routes in `server/routes/`, business logic in `server/services/`
2.  **Database**: Update repositories in `server/services/repositories/`
3.  **Frontend**: Add components in `client/src/components/`, API calls in `client/src/api/`
4.  **Configuration**: Update `config.default.json` for new settings

#### Working with the Database
*   **Direct Access**: SQLite file located in project data directory
*   **Queries**: Use repository pattern, avoid direct SQL in routes
*   **Schema Changes**: Update repository modules and add migration logic

#### Image Processing
*   **Workers**: Add new workers in `server/services/workers/`
*   **Job Types**: Register new job types in `workerLoop.js`
*   **Processing**: Use Sharp library for image manipulation

#### Testing Uploads
*   **File Types**: Test with various formats (JPG, RAW, TIFF)
*   **Large Files**: Verify progress tracking and timeout handling
*   **Error Cases**: Test invalid file types, disk space issues

### Debugging Tips
*   **Backend Logs**: Check console output from `npm run dev`
*   **Frontend Logs**: Use browser developer tools
*   **Database**: Use SQLite browser tools to inspect data
*   **Jobs**: Monitor job status in the Processes panel
*   **File System**: Check configured storage paths for generated assets

## 11. Project Structure Details

### Frontend Structure (`client/`)
```
client/
├── src/
│   ├── App.jsx              # Main application component
│   ├── components/          # Reusable UI components
│   │   ├── PhotoGrid.jsx    # Grid view for photos
│   │   ├── PhotoViewer.jsx  # Full-screen photo viewer
│   │   ├── UploadArea.jsx   # Drag & drop upload interface
│   │   └── ProcessesPanel.jsx # Job monitoring UI
│   ├── api/                 # Backend API client modules
│   │   ├── projectsApi.js   # Project-related API calls
│   │   ├── uploadsApi.js    # Upload functionality
│   │   └── jobsApi.js       # Job monitoring and SSE
│   └── upload/              # Upload-specific utilities
├── public/                  # Static assets
├── dist/                    # Production build output
└── vite.config.mjs         # Vite configuration
```

### Backend Structure (`server/`)
```
server/
├── routes/                  # API endpoint definitions
├── services/
│   ├── repositories/        # Data access layer
│   │   ├── projectsRepo.js  # Project CRUD operations
│   │   ├── photosRepo.js    # Photo metadata management
│   │   ├── tagsRepo.js      # Tag management
│   │   └── jobsRepo.js      # Job queue operations
│   ├── workers/             # Background job processors
│   │   └── derivativesWorker.js # Thumbnail/preview generation
│   ├── db.js               # Database initialization
│   ├── workerLoop.js       # Job processing engine
│   └── events.js           # Event emitter for SSE
└── utils/                  # Shared utilities
```

## 12. Troubleshooting

### Common Issues

#### "Cannot find module" errors
*   **Solution**: Run `npm install` in both root and `client/` directories
*   **Check**: Node.js version compatibility (v22 required)

#### Upload failures
*   **Check**: File type restrictions in `config.json`
*   **Check**: Disk space and write permissions
*   **Check**: File size limits (default: no limit, but check system)

#### Thumbnails not generating
*   **Check**: Worker loop is running (should see console output)
*   **Check**: Sharp library installation (native dependencies)
*   **Check**: Source image file accessibility

#### Database errors
*   **Check**: Write permissions for database directory
*   **Check**: SQLite file not corrupted (backup and recreate if needed)
*   **Check**: Foreign key constraint violations

#### Frontend not connecting to backend
*   **Check**: Backend running on port 5000
*   **Check**: CORS configuration in server
*   **Check**: Vite proxy configuration in `client/vite.config.mjs`

### Performance Issues
*   **Large Projects**: Consider pagination settings
*   **Slow Thumbnails**: Adjust processing quality settings
*   **Memory Usage**: Monitor Sharp memory usage with large images
*   **Database Performance**: Check indexing on frequently queried columns

### Getting Help
*   **Documentation**: Check `README.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md`
*   **Configuration**: Review `config.default.json` for all options
*   **Logs**: Enable verbose logging for debugging
*   **Community**: Check project issues and discussions

---

## Summary

This Node.js Photo Manager provides a comprehensive solution for photo organization with modern web technologies. The architecture supports scalability through its async job system, provides excellent user experience with real-time updates, and maintains security through signed URLs and proper validation.

Key strengths:
- **Responsive UI** with real-time job progress
- **Robust background processing** with crash recovery
- **Flexible configuration** for various use cases
- **Extensible architecture** for future enhancements
- **Production-ready** security and performance features

For detailed information on specific subsystems, refer to the dedicated documentation files mentioned throughout this overview.
