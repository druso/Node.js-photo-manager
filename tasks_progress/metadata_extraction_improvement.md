# Metadata Extraction Improvement

**Date**: 2025-11-05  
**Status**: ✅ Completed

## Problem Statement

The image ingestion pipeline was only extracting `DateTimeOriginal` from EXIF metadata. When this field was missing or incorrect, the system would fall back to database timestamps (`created_at`), which represents the ingestion time rather than the actual photo capture time.

## Solution Implemented

Updated metadata extraction in both upload and maintenance paths to use a proper fallback hierarchy:

1. **DateTimeOriginal** (preferred - when photo was actually taken)
2. **CreateDate** (fallback - file creation date from EXIF)
3. **ModifyDate** (final fallback - last modification date from EXIF)
4. Database `created_at` (only if all EXIF fields are missing)

## Files Modified

### 1. `/server/services/workers/folderDiscoveryWorker.js`
- Updated `extractMetadata()` function (lines 401-441)
- Added fallback logic: `DateTimeOriginal || CreateDate || ModifyDate`
- Now stores `create_date` and `modify_date` in `meta_json` for reference
- Updated function documentation to reflect fallback behavior

### 2. `/server/routes/uploads.js`
- Updated EXIF extraction logic (lines 190-214)
- Implemented same fallback hierarchy as folder discovery
- Added inline comments explaining the preference order
- Stores all three timestamp fields in `meta_json`

## Technical Details

### EXIF Parser Library
The `exif-parser` library already exposes all three timestamp fields:
- `result.tags.DateTimeOriginal` (0x9003)
- `result.tags.CreateDate` (0x9004)
- `result.tags.ModifyDate` (0x0132)

All timestamps are returned as Unix timestamps (seconds since epoch) and converted to ISO 8601 strings for database storage.

### Database Schema
- `photos.date_time_original` stores the final selected timestamp (ISO string)
- `photos.meta_json` stores all available EXIF fields including `create_date` and `modify_date`
- `photos.created_at` remains as the ingestion timestamp
- Query logic uses `COALESCE(date_time_original, created_at)` for ordering

## Benefits

1. **More accurate timestamps**: Photos without `DateTimeOriginal` now get better fallback dates
2. **Better sorting**: Cross-project views will sort more accurately by actual capture time
3. **Audit trail**: All three EXIF timestamp fields are preserved in `meta_json`
4. **Consistent behavior**: Upload and maintenance paths use identical logic

## Testing Recommendations

1. Upload photos with only `CreateDate` (no `DateTimeOriginal`) and verify correct timestamp
2. Run maintenance on folders with mixed EXIF metadata
3. Check that `meta_json` contains all available timestamp fields
4. Verify sorting in All Photos view uses correct capture times

## Documentation Updates Needed

- [ ] Update PROJECT_OVERVIEW.md metadata extraction section
- [ ] Update SCHEMA_DOCUMENTATION.md with new fallback behavior
- [ ] Add note to SECURITY.md about timestamp handling
