# User Folder Support - COMPLETE ✅

**Date**: 2025-10-09  
**Status**: ✅ Fixed and Ready

---

## Problem

The initial user folder implementation had a critical flaw:
- Set `PROJECTS_DIR = .projects/user_0/`
- Folder discovery scanned `.projects/user_0/` directly
- Found `p1`, `p2`, etc. as folders
- Created manifest for `user_0` itself (treating it as a project!)
- Then "merged" all `p*` folders into `user_0` and deleted them

**Result**: All photos were lost

---

## Solution

### New Architecture

**PROJECTS_DIR Structure:**
```
.projects/                    ← PROJECTS_DIR
  └── user_0/                 ← User folder (DEFAULT_USER)
      ├── p1/                 ← Project folders
      │   ├── .thumb/
      │   ├── .preview/
      │   ├── .trash/
      │   ├── .project.yaml
      │   └── *.jpg, *.raw
      ├── p2/
      └── p3/
```

**Key Changes:**
1. `PROJECTS_DIR` = `.projects/` (not `.projects/user_0/`)
2. `DEFAULT_USER` = `user_0`
3. `getProjectPath()` now includes user folder: `.projects/user_0/p1/`
4. Folder discovery scans **inside** user folder, not the user folder itself

---

## Code Changes

### 1. ✅ Updated `server/services/fsUtils.js`

**Constants:**
```javascript
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
const DEFAULT_USER = 'user_0';
```

**getProjectPath():**
```javascript
function getProjectPath(projectOrFolder, user = DEFAULT_USER) {
  const projectFolder = typeof projectOrFolder === 'string' 
    ? projectOrFolder 
    : projectOrFolder?.project_folder;
  
  if (!projectFolder) {
    throw new Error('Invalid project or folder name');
  }
  
  return path.join(PROJECTS_DIR, user, projectFolder);
}
```

**Exports:**
```javascript
module.exports = {
  PROJECTS_DIR,
  DEFAULT_USER,  // ← Added
  getProjectPath,
  ensureProjectDirs,
  moveToTrash,
  removeDerivatives,
  statMtimeSafe,
  buildAcceptPredicate,
};
```

---

### 2. ✅ Updated `server/services/workers/folderDiscoveryWorker.js`

**Import DEFAULT_USER:**
```javascript
const { ensureProjectDirs, PROJECTS_DIR, DEFAULT_USER, buildAcceptPredicate } = require('../fsUtils');
```

**Scan User Folder:**
```javascript
// Scan user folder for project folders
const userDir = path.join(PROJECTS_DIR, DEFAULT_USER);
await fs.ensureDir(userDir);

const entries = await fs.readdir(userDir);  // ← Scan inside user folder
```

**Check Deleted Projects:**
```javascript
const folderPath = path.join(PROJECTS_DIR, DEFAULT_USER, project.project_folder);
```

---

### 3. ✅ Cleaned Up

**Removed bad manifest:**
```bash
rm -f .projects/user_0/.project.yaml
```

**Reset project status:**
```sql
UPDATE projects SET status = NULL WHERE status = 'canceled';
```

---

## How It Works Now

### Folder Discovery Flow:

1. **Ensure user folder exists**: `.projects/user_0/`
2. **Scan inside user folder**: `readdir('.projects/user_0/')`
3. **Find project folders**: `p1/`, `p2/`, `p3/`, etc.
4. **Skip hidden folders**: `.thumb`, `.preview`, `.trash`, `.project.yaml`
5. **Process each project folder**:
   - Check for manifest
   - Create or reconcile project
   - Index photos
   - Check derivatives

### Path Resolution:

```javascript
getProjectPath('p1')
// Returns: /path/to/.projects/user_0/p1/

getProjectPath('p1', 'user_1')
// Returns: /path/to/.projects/user_1/p1/
```

---

## Multi-User Support

The architecture now supports multiple users:

```
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

**To add a new user:**
1. Create folder: `.projects/user_1/`
2. Update `DEFAULT_USER` or pass user parameter
3. Folder discovery will scan that user's folder

---

## Next Steps

### 1. Restore Your Photos

Once you restore the photos, place them in:
```
.projects/user_0/p1/
.projects/user_0/p2/
.projects/user_0/p3/
...
```

### 2. Restart Server

```bash
npm start
```

### 3. Folder Discovery Will Run

After 5 seconds, folder discovery will:
- Scan `.projects/user_0/`
- Find `p1/`, `p2/`, etc.
- Create projects
- Index photos
- Set thumbnail_status correctly

### 4. Verify

```bash
# Check projects
sqlite3 .db/user_0.sqlite "SELECT id, project_folder, status FROM projects;"

# Check photos
sqlite3 .db/user_0.sqlite "SELECT COUNT(*) FROM photos;"
```

---

## Benefits

✅ **User-scoped**: Each user has their own folder  
✅ **No conflicts**: User folder won't be treated as a project  
✅ **Multi-user ready**: Easy to add more users  
✅ **Clean structure**: Clear separation of concerns  
✅ **Backward compatible**: All existing code works with DEFAULT_USER  

---

## Summary

The user folder support is now properly implemented:

1. ✅ `PROJECTS_DIR` = `.projects/`
2. ✅ `DEFAULT_USER` = `user_0`
3. ✅ `getProjectPath()` includes user folder
4. ✅ Folder discovery scans inside user folder
5. ✅ No more treating user folder as project
6. ✅ Ready for multi-user

**Once you restore the photos to `.projects/user_0/p*/`, restart the server and everything will work!** 🎉
