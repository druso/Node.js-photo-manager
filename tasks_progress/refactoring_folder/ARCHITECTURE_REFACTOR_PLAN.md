# Architecture Refactor Plan - Clean Structure

**Date**: 2025-10-09  
**Status**: Planning

---

## Current Problems

1. **`db` folder is being indexed as a project** (id=38)
2. **Database is inside `.projects/`** - should be separate
3. **No user separation** - all projects mixed together
4. **Data inconsistency** - Photos reference old project IDs, but new projects were created

---

## Proposed New Structure

```
.db/
  └── user_0.sqlite          # User database (moved from .projects/db/)

.projects/
  └── user_0/                # User-specific project folder
      ├── p1/
      │   ├── .thumb/
      │   ├── .preview/
      │   ├── .trash/
      │   ├── .project.yaml
      │   └── *.jpg
      ├── p2/
      ├── p3/
      └── ...
```

---

## Benefits

1. **Clean separation** - Database outside projects folder
2. **User-scoped** - Ready for multi-user support
3. **No confusion** - `db` folder won't be discovered as project
4. **Cleaner** - `.projects/user_0/` contains only actual projects

---

## Migration Steps

### Phase 1: Move Database Out

1. Create `.db/` directory at root
2. Move `.projects/db/user_0.sqlite` → `.db/user_0.sqlite`
3. Update `server/services/db.js` to use new path
4. Test database connection

### Phase 2: Create User Folder Structure

1. Create `.projects/user_0/` directory
2. Move all `p*` folders into `.projects/user_0/`
3. Update `PROJECTS_DIR` to point to `.projects/user_0/`
4. Test folder discovery

### Phase 3: Clean Up Data Inconsistency

**Option A: Fresh Start (Recommended)**
- Delete all projects from database
- Let folder discovery re-index everything
- Clean slate, no data conflicts

**Option B: Fix Existing Data**
- Map old project IDs to new folder names
- Update all photo records
- Complex, error-prone

---

## Implementation

### Step 1: Update Database Path

**File**: `server/services/db.js`

```javascript
// Before:
const DB_DIR = path.join(__dirname, '../../.projects/db');

// After:
const DB_DIR = path.join(__dirname, '../../.db');
```

### Step 2: Update Projects Directory

**File**: `server/services/fsUtils.js`

```javascript
// Before:
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');

// After:
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects', 'user_0');
```

### Step 3: Physical File Moves

```bash
# Create new structure
mkdir -p .db
mkdir -p .projects/user_0

# Move database
mv .projects/db/user_0.sqlite .db/user_0.sqlite

# Move all project folders
mv .projects/p* .projects/user_0/

# Remove old db folder
rm -rf .projects/db
```

### Step 4: Clean Database (Fresh Start)

```bash
# Backup first
cp .db/user_0.sqlite .db/user_0.sqlite.backup

# Clean projects table
sqlite3 .db/user_0.sqlite "DELETE FROM projects;"

# Clean photos table  
sqlite3 .db/user_0.sqlite "DELETE FROM photos;"

# Clean other tables
sqlite3 .db/user_0.sqlite "DELETE FROM tags;"
sqlite3 .db/user_0.sqlite "DELETE FROM photo_tags;"
sqlite3 .db/user_0.sqlite "DELETE FROM jobs;"
sqlite3 .db/user_0.sqlite "DELETE FROM job_items;"
```

### Step 5: Restart & Discover

```bash
# Restart server
npm start

# Folder discovery will run after 5 seconds
# All projects in .projects/user_0/ will be discovered
# Photos will be indexed
# Manifests will be created
```

---

## Testing Plan

### 1. Verify Database Connection
```bash
sqlite3 .db/user_0.sqlite "SELECT COUNT(*) FROM projects;"
```

### 2. Verify Folder Discovery
- Check logs for `project_created_from_folder`
- Should discover all folders in `.projects/user_0/`

### 3. Verify Photos Indexed
```bash
sqlite3 .db/user_0.sqlite "SELECT COUNT(*) FROM photos;"
```

### 4. Verify Thumbnails Load
- Open UI
- Navigate to any project
- Thumbnails should load

---

## Rollback Plan

If something goes wrong:

```bash
# Stop server
# Restore database
cp .db/user_0.sqlite.backup .db/user_0.sqlite

# Move folders back
mv .projects/user_0/p* .projects/

# Revert code changes
git checkout server/services/db.js
git checkout server/services/fsUtils.js

# Restart
npm start
```

---

## Timeline

- **Phase 1** (Database move): 5 minutes
- **Phase 2** (Folder structure): 5 minutes  
- **Phase 3** (Clean data): 2 minutes
- **Testing**: 10 minutes

**Total**: ~25 minutes

---

## Decision Required

**Do you want to:**

**Option A: Fresh Start (Recommended)**
- Clean database
- Re-index everything
- Fast, clean, no conflicts
- ⚠️ Loses: tags, keep flags, visibility settings

**Option B: Preserve Data**
- Keep existing database
- Try to fix inconsistencies
- Complex, may have issues
- ✅ Keeps: tags, keep flags, visibility settings

**Which option do you prefer?**

---

## Next Steps

1. **Choose Option A or B**
2. **I'll implement the changes**
3. **Test thoroughly**
4. **Update documentation**

Let me know which approach you want to take!
