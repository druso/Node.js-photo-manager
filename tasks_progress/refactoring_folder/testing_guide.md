# Folder Management Testing Guide

**Date**: 2025-10-09  
**Status**: Ready for Testing

---

## Quick Start - Trigger Folder Discovery

### Option 1: Wait for Automatic Discovery (Recommended)
The system automatically runs folder discovery every **5 minutes** (configurable in `config.json`).

Just wait 5 minutes after server startup, or after creating a new folder, and it will be discovered automatically!

### Option 2: Manual Trigger via API

**Note**: This endpoint requires authentication. You need to be logged in to the UI first.

#### Curl Command (with authentication):
```bash
# First, get your auth token from browser cookies or login
# Then use it in the request:

curl -X POST http://localhost:5000/api/projects/maintenance/discover-folders \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=YOUR_TOKEN_HERE"
```

**Or login via curl first:**
```bash
# Login to get token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' \
  -c cookies.txt

# Then use the cookies
curl -X POST http://localhost:5000/api/projects/maintenance/discover-folders \
  -H "Content-Type: application/json" \
  -b cookies.txt
```

### Expected Response:
```json
{
  "success": true,
  "job_id": 123,
  "message": "Folder discovery job enqueued. Check job status or logs for results."
}
```

### Configuration

You can configure the discovery interval in `config.json`:

```json
{
  "folder_discovery": {
    "interval_minutes": 5,
    "enabled": true
  }
}
```

- **interval_minutes**: How often to run discovery (default: 5)
- **enabled**: Set to false to disable automatic discovery

---

## Test Scenarios

### Test 1: Discover New Folder (No Manifest)

**Setup:**
```bash
# Create a test folder
mkdir -p ".projects/Test Discovery"

# Add a test photo (copy from existing project or use any JPG)
cp path/to/test.jpg ".projects/Test Discovery/IMG_001.jpg"
```

**Trigger Discovery:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

**Expected Results:**
- ✅ New project created in database with name "Test Discovery"
- ✅ Manifest file created: `.projects/Test Discovery/.project.yaml`
- ✅ Photo indexed in database
- ✅ Post-processing job enqueued (thumbnails/previews)
- ✅ Project appears in UI

**Verify Manifest:**
```bash
cat ".projects/Test Discovery/.project.yaml"
```

Should show:
```yaml
name: Test Discovery
id: <project_id>
created_at: '2025-10-09T...'
version: '1.0'
```

---

### Test 2: Discover Folder with Manifest

**Setup:**
```bash
# Create folder
mkdir -p ".projects/Test With Manifest"

# Create manifest manually
cat > ".projects/Test With Manifest/.project.yaml" << 'EOF'
name: "My Custom Name"
id: 999
created_at: "2025-10-09T10:00:00Z"
version: "1.0"
EOF

# Add photo
cp path/to/test.jpg ".projects/Test With Manifest/IMG_002.jpg"
```

**Trigger Discovery:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

**Expected Results:**
- ✅ Project created with name "My Custom Name" (from manifest)
- ✅ Manifest preserved
- ✅ Photo indexed
- ✅ Post-processing enqueued

---

### Test 3: External Folder Rename

**Setup:**
```bash
# Create project via UI first (e.g., "Original Name")
# Note the project folder name

# Rename the folder externally
mv ".projects/Original Name" ".projects/Renamed Externally"
```

**Trigger Discovery:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

**Expected Results:**
- ✅ Database updated with new folder name "Renamed Externally"
- ✅ Manifest updated
- ✅ Project still accessible in UI with new folder name
- ✅ All photos still accessible

---

### Test 4: Project Merging (Shared Images)

**Setup:**
```bash
# Create first project via UI: "Merge Test A"
# Upload photo: IMG_SHARED.jpg

# Create second folder with same photo
mkdir -p ".projects/Merge Test B"
cp ".projects/Merge Test A/IMG_SHARED.jpg" ".projects/Merge Test B/IMG_SHARED.jpg"

# Add unique photo to second folder
cp path/to/test2.jpg ".projects/Merge Test B/IMG_UNIQUE.jpg"
```

**Trigger Discovery:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

**Expected Results:**
- ✅ Projects automatically merged into "Merge Test A"
- ✅ IMG_SHARED.jpg not duplicated (skipped)
- ✅ IMG_UNIQUE.jpg moved to "Merge Test A"
- ✅ "Merge Test B" folder removed
- ✅ All photos accessible in single project

**Check Logs:**
```bash
# Look for merge messages in server logs
grep "merging_projects" server.log
grep "merge_complete" server.log
```

---

### Test 5: No Shared Images (Separate Projects)

**Setup:**
```bash
# Create first project via UI: "Project X"
# Upload photo: IMG_001.jpg

# Create second folder with different photo
mkdir -p ".projects/Project Y"
cp path/to/different.jpg ".projects/Project Y/IMG_002.jpg"
```

**Trigger Discovery:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

**Expected Results:**
- ✅ Two separate projects created
- ✅ "Project X" remains unchanged
- ✅ "Project Y" created as new project
- ✅ No merging occurs
- ✅ Both projects visible in UI

---

### Test 6: Manifest Regeneration

**Setup:**
```bash
# Create project via UI
# Delete the manifest file
rm ".projects/Your Project/.project.yaml"
```

**Trigger Discovery:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

**Expected Results:**
- ✅ Manifest regenerated automatically
- ✅ Correct project ID in manifest
- ✅ Project name matches database
- ✅ No data loss

---

### Test 7: Old p<id> Folder Discovery

**Setup:**
```bash
# Create old-style folder
mkdir -p ".projects/p42"

# Add photos
cp path/to/test.jpg ".projects/p42/IMG_001.jpg"
```

**Trigger Discovery:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

**Expected Results:**
- ✅ Project created with name "p42" (folder name)
- ✅ Manifest generated
- ✅ Photos indexed
- ✅ Can rename via UI to human-readable name

---

## Monitoring & Debugging

### Check Job Status:
```bash
# Get job details
curl http://localhost:3000/api/jobs/<job_id>
```

### Check Server Logs:
```bash
# Watch logs in real-time
tail -f server.log | grep -E "folder-discovery|manifest"
```

### Key Log Messages to Look For:
- `folder_discovery_started` - Job started
- `project_created_from_folder` - New project created
- `photos_discovered` - Photos indexed
- `postprocess_enqueued` - Processing jobs queued
- `merging_projects` - Merge initiated
- `merge_complete` - Merge finished
- `folder_discovery_complete` - Job complete with stats
- `manifest_missing` - Manifest regenerated
- `manifest_id_mismatch` - Manifest corrected

### Check Database:
```bash
# List all projects
sqlite3 .projects/db/user_0.sqlite "SELECT id, project_name, project_folder FROM projects;"

# Check manifest_version column
sqlite3 .projects/db/user_0.sqlite "SELECT project_folder, manifest_version FROM projects;"

# Count photos per project
sqlite3 .projects/db/user_0.sqlite "SELECT project_id, COUNT(*) FROM photos GROUP BY project_id;"
```

### Verify Manifest Files:
```bash
# Find all manifest files
find .projects -name ".project.yaml" -type f

# Check manifest content
for manifest in .projects/*/.project.yaml; do
  echo "=== $manifest ==="
  cat "$manifest"
  echo ""
done
```

---

## Troubleshooting

### Issue: Job Not Running
**Check:**
1. Is the worker loop running? (server should be started)
2. Check job status: `curl http://localhost:3000/api/jobs/<job_id>`
3. Look for errors in server logs

### Issue: Manifest Not Generated
**Check:**
1. Folder permissions (must be writable)
2. Check logs for `manifest_missing` or `manifest_regenerated`
3. Run `runManifestCheck` job manually for specific project

### Issue: Projects Not Merging
**Check:**
1. Are filenames exactly the same? (case-insensitive)
2. Check logs for `findSharedImages` results
3. Verify both folders have accepted file types

### Issue: Photos Not Indexed
**Check:**
1. Are files in accepted formats? (JPG, RAW, etc.)
2. Check `discoverPhotosInFolder` logs
3. Verify file extensions are recognized

---

## Performance Testing

### Test with Many Folders:
```bash
# Create 50 test folders
for i in {1..50}; do
  mkdir -p ".projects/Test Project $i"
  cp path/to/test.jpg ".projects/Test Project $i/IMG_001.jpg"
done

# Trigger discovery and measure time
time curl -X POST http://localhost:3000/api/maintenance/discover-folders
```

### Expected Performance:
- Discovery job should complete in < 30 seconds for 50 folders
- Each folder with 100 photos should process in < 5 seconds
- Database operations should be fast (indexed queries)

---

## Cleanup After Testing

```bash
# Remove test folders
rm -rf ".projects/Test Discovery"
rm -rf ".projects/Test With Manifest"
rm -rf ".projects/Merge Test"*
rm -rf ".projects/Project"*
rm -rf ".projects/p42"

# Or reset entire .projects directory (CAUTION!)
# rm -rf .projects/*
# (This will delete all projects and photos!)
```

---

## Success Criteria

After running all tests, verify:

- ✅ New folders are discovered and indexed
- ✅ Manifests are generated automatically
- ✅ External renames are detected and reconciled
- ✅ Projects with shared images merge automatically
- ✅ Projects without shared images remain separate
- ✅ Old p<id> folders are discovered
- ✅ Missing manifests are regenerated
- ✅ All photos are indexed correctly
- ✅ Post-processing jobs are enqueued
- ✅ UI reflects all changes
- ✅ No data loss occurs
- ✅ Performance is acceptable

---

## Next Steps After Testing

1. Review logs for any warnings or errors
2. Verify all edge cases work correctly
3. Test with real production data (backup first!)
4. Consider adding scheduler for automatic discovery
5. Update documentation with findings
6. Deploy to production

---

## API Reference

### POST /api/maintenance/discover-folders

**Description**: Manually trigger folder discovery job

**Rate Limit**: 5 requests per 10 minutes per IP

**Request:**
```bash
curl -X POST http://localhost:3000/api/maintenance/discover-folders \
  -H "Content-Type: application/json"
```

**Response (Success):**
```json
{
  "success": true,
  "job_id": 123,
  "message": "Folder discovery job enqueued. Check job status or logs for results."
}
```

**Response (Error):**
```json
{
  "error": "Failed to enqueue folder discovery job"
}
```

**Status Codes:**
- `200` - Success, job enqueued
- `429` - Rate limit exceeded
- `500` - Server error

---

## Summary

The folder management system is now fully implemented and ready for testing. Use the curl command above to trigger discovery, then verify the results using the test scenarios provided.

All manifest operations are automatic:
- ✅ Generated on project creation
- ✅ Regenerated if missing
- ✅ Validated and corrected by maintenance jobs
- ✅ Used for reconciliation during discovery

Happy testing! 🚀
