# Photo Manager Architecture

**Last Updated**: 2025-10-09

---


```
.db/
  └── user_0.sqlite              # User database (SQLite)

.projects/                       # Root projects directory
  └── user_0/                    # User-specific folder
      ├── p1/                    # Project folder
      │   ├── .thumb/            # Thumbnail cache
      │   ├── .preview/          # Preview cache
      │   ├── .trash/            # Deleted files
      │   ├── .project.yaml      # Project manifest
      │   └── *.jpg, *.raw       # Original photos
      ├── p2/
      └── ...
```
server/
  ├── routes/                    # API endpoints
  ├── services/                  # Business logic
  │   ├── db.js                  # Database connection
  │   ├── fsUtils.js             # File system utilities
  │   └── workers/               # Background jobs
  └── utils/                     # Shared utilities

client/
  └── src/                       # React frontend
```

---

## Key Paths

### Database
- **Location**: `.db/user_0.sqlite`
- **Defined in**: `server/services/db.js`
- **Constant**: `DB_DIR = path.join(__dirname, '../../.db')`

### Projects
- **Location**: `.projects/user_0/`
- **Defined in**: `server/services/fsUtils.js`
- **Constants**: 
  - `PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects')`
  - `DEFAULT_USER = 'user_0'`
- **Path Resolution**: `getProjectPath(folder)` → `.projects/user_0/<folder>/`

### Centralized Path Resolution
- **Function**: `getProjectPath(projectOrFolder)`
- **Location**: `server/services/fsUtils.js`
- **Usage**: All code uses this function to resolve project paths

---

## Folder Discovery

### Automatic Discovery
- **Frequency**: Every 5 minutes
- **Trigger**: Scheduled job
- **Worker**: `server/services/workers/folderDiscoveryWorker.js`

### What It Does
1. Scans `.projects/user_0/` for folders
2. Skips hidden folders (`.thumb`, `.preview`, etc.)
3. Skips `db` folder (now at `.db/`)
4. For each folder:
   - Checks if manifest exists
   - Creates project if new
   - Indexes photos
   - Generates manifests
   - Checks derivatives

### Configuration
```json
{
  "folder_discovery": {
    "interval_minutes": 5,
    "enabled": true
  }
}
```

---

## Project Manifest

### Location
Each project has a `.project.yaml` file:
```
.projects/user_0/p1/.project.yaml
```

### Format
```yaml
name: p1
id: 1
created_at: '2025-10-09T20:00:00.000Z'
version: '1.0'
```

### Purpose
- Links folder to database record
- Enables reconciliation after external changes
- Supports folder renaming detection
- Provides metadata for recovery

---

## Multi-User Support (Future)

The architecture is ready for multi-user:

```
.db/
  ├── user_0.sqlite
  ├── user_1.sqlite
  └── user_2.sqlite

.projects/
  ├── user_0/
  │   ├── p1/
  │   └── p2/
  ├── user_1/
  │   ├── p1/
  │   └── p2/
  └── user_2/
      ├── p1/
      └── p2/
```

Each user has:
- Separate database
- Separate project folder
- Isolated data

---

## Migration Notes

### From Old Structure
**Old:**
```
.projects/
  ├── db/user_0.sqlite  ← Database inside projects
  ├── p1/
  └── p2/
```

**New:**
```
.db/user_0.sqlite       ← Database outside
.projects/user_0/p1/    ← Projects organized by user
.projects/user_0/p2/
```

### No Backward Compatibility
- Fresh start approach
- No migration scripts
- Folder discovery re-indexes everything
- Clean, consistent state

---

## Benefits

### 1. Clean Separation
- Database separate from content
- Clear organization

### 2. User-Scoped
- Ready for multi-user
- Isolated data per user

### 3. Automatic Discovery
- No manual indexing
- Self-healing
- Detects external changes

### 4. Centralized Paths
- Single source of truth
- Easy to maintain
- Consistent behavior

---

## Troubleshooting

### Database Not Found
Check: `.db/user_0.sqlite` exists
Fix: Server creates it automatically on startup

### Projects Not Discovered
Check: Folders in `.projects/user_0/`
Fix: Wait 5 minutes or restart server

### Thumbnails 404
Check: Photos indexed in database
Fix: Folder discovery will index them

### `db` Folder Indexed
Check: `db` folder location
Fix: Should be at `.db/`, not `.projects/db/`

---

## Summary

- ✅ Database at `.db/user_0.sqlite`
- ✅ Projects at `.projects/user_0/`
- ✅ Automatic discovery every 5 minutes
- ✅ Centralized path resolution
- ✅ Ready for multi-user
- ✅ Self-healing architecture
