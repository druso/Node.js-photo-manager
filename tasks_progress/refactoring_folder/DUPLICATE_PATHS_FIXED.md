# Duplicate Path Constants Fixed ✅

**Date**: 2025-10-09  
**Status**: ✅ Complete

---

## Problem

When creating a project, it was being created in **both** locations:
- `.projects/test/` (old hardcoded path)
- `.projects/user_0/test/` (new user-scoped path)

**Root Cause**: Multiple route files had duplicate `PROJECTS_DIR` constants and `ensureProjectDirs()` functions that weren't using the centralized versions from `fsUtils.js`.

---

## Files Fixed

### 1. ✅ `server/routes/projects.js`

**Before:**
```javascript
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');

async function ensureProjectDirs(folderName) {
  const projectPath = path.join(PROJECTS_DIR, folderName);
  await fs.ensureDir(projectPath);
  // ...
}
```

**After:**
```javascript
const { ensureProjectDirs, PROJECTS_DIR, DEFAULT_USER } = require('../services/fsUtils');

const userDir = path.join(PROJECTS_DIR, DEFAULT_USER);
fs.ensureDirSync(userDir);
```

---

### 2. ✅ `server/routes/uploads.js`

**Before:**
```javascript
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
const projectPath = path.join(PROJECTS_DIR, folder);
```

**After:**
```javascript
const { PROJECTS_DIR, DEFAULT_USER, getProjectPath } = require('../services/fsUtils');
const projectPath = getProjectPath(folder);
```

**Updated 3 occurrences** of `path.join(PROJECTS_DIR, folder)` → `getProjectPath(folder)`

---

### 3. ✅ `server/routes/tags.js`

**Before:**
```javascript
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
```

**After:**
```javascript
const { PROJECTS_DIR, DEFAULT_USER } = require('../services/fsUtils');
const userDir = path.join(PROJECTS_DIR, DEFAULT_USER);
fs.ensureDirSync(userDir);
```

---

### 4. ✅ `server/routes/keep.js`

**Before:**
```javascript
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
const projectPath = path.join(PROJECTS_DIR, folder);
```

**After:**
```javascript
const { PROJECTS_DIR, DEFAULT_USER, getProjectPath } = require('../services/fsUtils');
const projectPath = getProjectPath(folder);
```

**Also fixed:**
- Duplicate `rateLimit` import
- Missing `router` declaration
- Missing `try` block

---

## Summary of Changes

### Removed Duplicate Constants:
- ❌ `const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');` (4 files)
- ❌ `async function ensureProjectDirs()` (1 file)

### Now Using Centralized Functions:
- ✅ `getProjectPath(folder)` from `fsUtils.js`
- ✅ `ensureProjectDirs(folder)` from `fsUtils.js`
- ✅ `PROJECTS_DIR` from `fsUtils.js`
- ✅ `DEFAULT_USER` from `fsUtils.js`

---

## How It Works Now

### Project Creation Flow:

1. **User creates project** via POST `/api/projects`
2. **Repository creates DB record** with `project_folder = "p<id>"`
3. **Route calls** `ensureProjectDirs(created.project_folder)`
4. **fsUtils.ensureProjectDirs()** calls `getProjectPath(folder)`
5. **getProjectPath()** returns `.projects/user_0/p<id>/`
6. **Directories created** at correct location

### Path Resolution:

All routes now use centralized path resolution:
```javascript
const projectPath = getProjectPath(folder);
// Returns: /path/to/.projects/user_0/<folder>/
```

---

## Testing

### Verify No Duplicates:

```bash
# Create a test project
curl -X POST http://localhost:5000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project"}'

# Check only one folder exists
ls -la .projects/
# Should only show: user_0/

ls -la .projects/user_0/
# Should show: p<id>/

# Should NOT exist:
ls -la .projects/p<id>/
# Should return: No such file or directory
```

---

## Benefits

✅ **Single source of truth** - All paths from `fsUtils.js`  
✅ **No duplicates** - Projects only created in user folder  
✅ **Consistent behavior** - All routes use same path logic  
✅ **Easy to maintain** - Change once, applies everywhere  
✅ **User-scoped** - Ready for multi-user support  

---

## Summary

All route files now use the centralized path functions from `fsUtils.js`:
- ✅ `server/routes/projects.js`
- ✅ `server/routes/uploads.js`
- ✅ `server/routes/tags.js`
- ✅ `server/routes/keep.js`

**Projects will now only be created in `.projects/user_0/` - no more duplicates!** 🎉
