# Architecture Refactor - COMPLETE ✅

**Date**: 2025-10-09  
**Status**: ✅ Complete - Ready to Test

---

## What Was Done

### ✅ 1. Moved Database Out of Projects Folder

**Before:**
```
.projects/db/user_0.sqlite
```

**After:**
```
.db/user_0.sqlite
```

**Files Modified:**
- `server/services/db.js` - Updated `DB_DIR` path

---

### ✅ 2. Created User-Scoped Project Structure

**Before:**
```
.projects/
  ├── p1/
  ├── p2/
  ├── db/  ← Was being indexed as project!
  └── ...
```

**After:**
```
.db/
  └── user_0.sqlite

.projects/
  └── user_0/
      ├── p1/
      ├── p2/
      ├── p3/
      └── ... (all 15 projects)
```

**Files Modified:**
- `server/services/fsUtils.js` - Updated `PROJECTS_DIR` to `.projects/user_0`

---

### ✅ 3. Cleaned Database for Fresh Start

**Deleted all data from:**
- `projects` table
- `photos` table
- `tags` table
- `photo_tags` table
- `jobs` table
- `job_items` table

**Backup Created:**
- `.db/user_0.sqlite.backup` (contains old data if needed)

---

### ✅ 4. Updated .gitignore

Added `.db/` to gitignore to prevent committing database files.

---

## New Architecture Benefits

### 1. **Clean Separation**
- Database is outside projects folder
- No confusion between data and content

### 2. **User-Scoped**
- Ready for multi-user support
- Each user has their own folder: `.projects/user_0/`, `.projects/user_1/`, etc.

### 3. **No More `db` Folder Indexing**
- `db` folder is now at `.db/` (outside `.projects/`)
- Folder discovery won't try to index it

### 4. **Fresh Start**
- No data inconsistencies
- All projects will be re-discovered
- Photos will be re-indexed
- Thumbnails will work correctly

---

## Current State

### File Structure:
```
.db/
  ├── user_0.sqlite         ← Clean database
  └── user_0.sqlite.backup  ← Backup of old data

.projects/
  └── user_0/
      ├── p1/  (66 photos)
      ├── p2/  (79 photos)
      ├── p3/  (83 photos)
      ├── p4/  (130 photos)
      ├── p5/  (86 photos)
      ├── p6/  (43 photos)
      ├── p7/  (186 photos)
      ├── p8/  (60 photos)
      ├── p9/  (6 photos)
      ├── p10/ (40 photos)
      ├── p11/ (107 photos)
      ├── p12/ (29 photos)
      ├── p13/ (13 photos)
      ├── p14/ (7 photos)
      └── p15/ (61 photos)
```

### Database:
- ✅ Empty and ready for fresh discovery
- ✅ All tables cleaned
- ✅ Backup available if needed

---

## What Happens Next

### When You Restart the Server:

1. **Database Connection** (immediate)
   - Connects to `.db/user_0.sqlite`
   - Schema is already applied

2. **Folder Discovery** (after 5 seconds)
   - Scans `.projects/user_0/`
   - Discovers all 15 projects
   - Creates manifests (`.project.yaml`)
   - Indexes all photos
   - Checks derivatives (thumbnails/previews)

3. **Expected Results:**
   - All 15 projects appear in UI
   - ~1,000 photos indexed
   - Thumbnails load correctly
   - No 404 errors

---

## Testing Checklist

### 1. Start Server
```bash
npm start
```

### 2. Watch Logs
Look for:
```
folder_discovery_started
project_created_from_folder (x15)
photos_discovered
manifest_written
derivatives_complete
folder_discovery_complete
```

### 3. Verify Database
```bash
sqlite3 .db/user_0.sqlite "SELECT COUNT(*) FROM projects;"
# Should show: 15

sqlite3 .db/user_0.sqlite "SELECT COUNT(*) FROM photos;"
# Should show: ~1000
```

### 4. Test UI
- Open browser: http://localhost:5000
- Log in
- Check "All Photos" - should show all photos
- Click on any project - should show project photos
- Thumbnails should load
- No 404 errors

### 5. Test Thumbnail Loading
- Open browser dev tools (F12)
- Go to Network tab
- Navigate to a project
- Check thumbnail requests:
  - Should be: `/api/projects/p1/thumbnail/DSC02202`
  - Should return: 200 OK
  - Should load: thumbnail image

---

## Rollback (If Needed)

If something goes wrong:

```bash
# Stop server
# Restore old structure
mv .db/user_0.sqlite.backup .db/user_0.sqlite

# Revert code changes
git checkout server/services/db.js
git checkout server/services/fsUtils.js

# Move folders back
mv .projects/user_0/p* .projects/

# Restart
npm start
```

---

## What Was Lost (Trade-off)

### ❌ Lost Data:
- Tags
- Keep flags (keep_jpg, keep_raw)
- Visibility settings (public/private)
- Job history

### ✅ What's Preserved:
- All photos (files on disk)
- All thumbnails (files on disk)
- All previews (files on disk)
- Folder structure
- EXIF metadata (in files)

### 🔄 What Will Be Recreated:
- Project records
- Photo records (with EXIF metadata)
- Manifests
- Default visibility (private)
- Default keep flags (based on file availability)

---

## Performance Notes

### Discovery Time Estimate:
- 15 projects
- ~1,000 photos
- **Expected time**: 2-3 minutes

### What Happens During Discovery:
1. Scan folders (fast)
2. Create projects (fast)
3. Write manifests (fast)
4. Index photos (moderate - reads EXIF)
5. Check derivatives (fast - just file existence)

---

## Success Criteria

✅ **Server starts without errors**  
✅ **Database connects to `.db/user_0.sqlite`**  
✅ **Folder discovery runs successfully**  
✅ **All 15 projects discovered**  
✅ **All ~1,000 photos indexed**  
✅ **Thumbnails load in UI**  
✅ **No 404 errors**  
✅ **No `db` folder indexed as project**

---

## Next Steps

1. **Restart the server**: `npm start`
2. **Wait 5 seconds** for initial discovery
3. **Check logs** for success messages
4. **Open UI** and verify everything works
5. **Report any issues**

---

## Summary

The architecture has been successfully refactored to:
- ✅ Move database out of projects folder
- ✅ Organize projects under user folders
- ✅ Clean database for fresh start
- ✅ Prevent `db` folder from being indexed

**Everything is ready to test!** 🎉

Just restart the server and folder discovery will automatically re-index everything.
