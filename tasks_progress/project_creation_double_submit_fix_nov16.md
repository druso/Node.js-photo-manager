# Project Creation Double-Submit Bug Fix

**Date**: November 16, 2025  
**Issue**: Projects created with "(2)" suffix when they shouldn't have one

## Root Cause

The `CreateProjectModal` component lacked protection against double-submission. When users clicked the "Create" button twice (either accidentally or due to slow network), two API calls were made in rapid succession:

1. **First call**: Checks if "250722_Tokyo con Kohei" exists → NO → Creates it
2. **Second call**: Checks if "250722_Tokyo con Kohei" exists → YES (first call just created it) → Creates "250722_Tokyo con Kohei (2)"

## Affected Projects

Based on database analysis, the following projects were affected:
- `250722_Tokyo con Kohei (2)` - should be `250722_Tokyo con Kohei`
- `250726_Nagano camping (2)` - should be `250726_Nagano camping`
- `250729_Hakuba Trekking (2)` - should be `250729_Hakuba Trekking`

## Fix Applied

### File: `/client/src/components/CreateProjectModal.jsx`

**Changes**:
1. Added `isCreating` state to track submission status
2. Disabled form submission while creation is in progress
3. Disabled both Cancel and Create buttons during creation
4. Changed button text to "Creating..." during submission
5. Added try-finally block to ensure state is reset even on error

**Code Changes**:
- Added `const [isCreating, setIsCreating] = useState(false);`
- Modified `handleSubmit` to check `isCreating` and set it during API call
- Updated button `disabled` attributes to include `isCreating` check
- Changed button text to show loading state

## Other Modals

Checked other modals that create projects:
- ✅ `MovePhotosModal.jsx` - Already has `creating` state protection
- ✅ `UnifiedSelectionModal.jsx` - Already has `creating` state protection

## How to Fix Existing Projects

To rename the affected projects and remove the "(2)" suffix:

### Option 1: Manual Rename via UI
1. Use the project rename feature in the UI
2. Remove the " (2)" suffix from the project name
3. The maintenance system will align the folder name automatically

### Option 2: Database + Filesystem Update (Advanced)

**⚠️ BACKUP YOUR DATABASE FIRST!**

```bash
# Stop the server first
# Then run these commands:

# 1. Update database
sqlite3 .db/user_0.sqlite <<EOF
UPDATE projects SET project_folder = '250722_Tokyo con Kohei', project_name = '250722_Tokyo con Kohei' WHERE id = 4;
UPDATE projects SET project_folder = '250726_Nagano camping', project_name = '250726_Nagano camping' WHERE id = 5;
UPDATE projects SET project_folder = '250729_Hakuba Trekking', project_name = '250729_Hakuba Trekking' WHERE id = 6;
EOF

# 2. Rename folders
cd .projects/user_0/
mv "250722_Tokyo con Kohei (2)" "250722_Tokyo con Kohei"
mv "250726_Nagano camping (2)" "250726_Nagano camping"
mv "250729_Hakuba Trekking (2)" "250729_Hakuba Trekking"

# 3. Restart server
```

## Prevention

The fix ensures that:
- Users cannot double-click the Create button
- The button is disabled during API call
- Visual feedback shows "Creating..." state
- Form cannot be submitted multiple times

## Testing

To verify the fix:
1. Create a new project
2. Try to double-click the Create button
3. Verify only one project is created
4. Verify no "(2)" suffix is added

## Status

- ✅ Bug identified
- ✅ Root cause analyzed
- ✅ Fix implemented in `CreateProjectModal.jsx`
- ✅ Other modals verified to have protection
- ⏳ Existing projects need manual correction (user decision)
