# Test Cleanup - November 17, 2025

## Issue
Three tests were failing after project deletion status tracking was removed:
1. `projectsDelete.test.js` - "archives project, cancels jobs, and queues deletion task" - Expected `status='canceled'` but got `null`
2. `projectsDelete.test.js` - "returns 404 when project already canceled" - Called non-existent `projectsRepo.archive()` function
3. `projectsUpdate.test.js` - "cannot rename canceled projects" - Called non-existent `projectsRepo.archive()` function

## Root Cause
The project deletion flow was simplified to remove status tracking (setting `status='canceled'`), as it was not useful. The tests were checking for obsolete behavior.

## Resolution
Removed obsolete tests that checked for canceled status:
- **projectsDelete.test.js**: Consolidated two tests into one simpler test "queues deletion task and cancels jobs" that only verifies:
  - Jobs are canceled
  - Deletion task is queued
  - Response is correct
  - No longer checks for `status='canceled'`
  
- **projectsUpdate.test.js**: Removed "cannot rename canceled projects" test entirely

## Results
✅ All tests now pass (6/6 tests in both files)
✅ Tests reflect current simplified deletion flow
✅ No functionality lost - the important behaviors (job cancellation, task queuing) are still tested

## Files Modified
- `/server/routes/__tests__/projectsDelete.test.js` - Simplified and removed obsolete test
- `/server/routes/__tests__/projectsUpdate.test.js` - Removed obsolete test
