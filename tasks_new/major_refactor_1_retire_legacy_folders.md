# Major Refactoring Task 1: Retire Legacy Folder ID Assumptions

## Overview
Remove `p<id>` validation branches once data migrations confirm all folders use sanitized names. This simplifies validation logic, reduces branching paths, and improves developer experience.

## Business Value
- **Simpler Validation**: Single code path for folder validation
- **Fewer Bugs**: Eliminates edge cases from dual folder format support
- **Better DX**: Clearer codebase for new developers
- **Reduced Maintenance**: Less code to maintain and test

## Estimated Effort
**1-2 days** including migration tooling, tests, and documentation

## Prerequisites
✅ **Data Migration Required**: Before starting this task, you MUST verify that all existing projects in the database have been migrated to use sanitized folder names (not `p<id>` format).

### Migration Check
Run this SQL query to verify no legacy folders remain:
```sql
SELECT COUNT(*) FROM projects WHERE project_folder LIKE 'p%' AND project_folder GLOB 'p[0-9]*';
```
If this returns 0, you're safe to proceed. If not, coordinate with senior dev to run migration first.

## Files to Modify

### 1. `server/utils/projects.js`
**Current State**: 
- `isLegacyProjectFolder()` function checks for `p<id>` format
- `isCanonicalProjectFolder()` accepts both legacy and new formats

**Changes**:
1. Remove `isLegacyProjectFolder()` function entirely
2. Simplify `isCanonicalProjectFolder()` to only validate sanitized names:
   ```javascript
   function isCanonicalProjectFolder(folder) {
     if (!folder || typeof folder !== 'string') {
       return false;
     }
     const normalized = String(folder).trim();
     if (!normalized) {
       return false;
     }
     const sanitized = sanitizeFolderName(normalized);
     if (sanitized !== normalized) {
       return false;
     }
     return sanitized.length <= 240;
   }
   ```
3. Update module.exports to remove `isLegacyProjectFolder`

### 2. `server/routes/projects.js`
**Current State**: Uses `isCanonicalProjectFolder()` for validation

**Changes**: No changes needed - it will automatically use the simplified validation

### 3. Search for Other References
Run these searches to find any other legacy folder checks:
```bash
grep -r "isLegacyProjectFolder" server/
grep -r "p<id>" server/ --include="*.js"
grep -r "p\d+" server/ --include="*.js"
```

Review each match and remove legacy handling code.

## Testing Requirements

### Unit Tests
Create/update tests in `server/utils/__tests__/projects.test.js`:

```javascript
describe('isCanonicalProjectFolder (post-legacy)', () => {
  it('should accept valid sanitized folder names', () => {
    expect(isCanonicalProjectFolder('my-project')).toBe(true);
    expect(isCanonicalProjectFolder('Project_2024')).toBe(true);
    expect(isCanonicalProjectFolder('photos-vacation')).toBe(true);
  });

  it('should reject legacy p<id> format', () => {
    expect(isCanonicalProjectFolder('p123')).toBe(false);
    expect(isCanonicalProjectFolder('p1')).toBe(false);
  });

  it('should reject invalid characters', () => {
    expect(isCanonicalProjectFolder('my/project')).toBe(false);
    expect(isCanonicalProjectFolder('my\\project')).toBe(false);
    expect(isCanonicalProjectFolder('../project')).toBe(false);
  });

  it('should reject empty or whitespace-only names', () => {
    expect(isCanonicalProjectFolder('')).toBe(false);
    expect(isCanonicalProjectFolder('   ')).toBe(false);
    expect(isCanonicalProjectFolder(null)).toBe(false);
  });
});
```

### Integration Tests
1. **Create Project**: Verify new projects are created with sanitized folder names
2. **Rename Project**: Verify rename operations work correctly
3. **API Validation**: Test that API endpoints reject invalid folder names

### Manual Testing Checklist
- [ ] Create a new project with various names (spaces, special chars, etc.)
- [ ] Verify folder name is properly sanitized
- [ ] Rename an existing project
- [ ] Upload photos to a project
- [ ] Access project via API using folder name
- [ ] Try to access a project with `p123` format (should fail with 400)

## Documentation Updates

### Files to Update
1. **`project_docs/PROJECT_OVERVIEW.md`**
   - Remove all mentions of `p<id>` legacy format
   - Update "Project Folder Naming" section to reflect single format
   - Update any examples showing folder names

2. **`project_docs/SCHEMA_DOCUMENTATION.md`**
   - Remove legacy folder format documentation
   - Update project folder validation rules

3. **`README.md`**
   - Remove any `p<id>` references
   - Update API examples to use only sanitized folder names

4. **`SECURITY.md`**
   - Add entry noting removal of legacy folder format support
   - Document that this simplifies validation and reduces attack surface

## Rollback Plan
If issues are discovered after deployment:
1. Revert the code changes (git revert)
2. The database still contains the actual folder names, so no data loss
3. Legacy format support can be re-added if absolutely necessary

## Success Criteria
- [ ] All `isLegacyProjectFolder` references removed
- [ ] `isCanonicalProjectFolder` simplified to single validation path
- [ ] All tests passing
- [ ] No legacy folder format accepted by API
- [ ] Documentation updated
- [ ] Manual testing completed
- [ ] Code review approved by senior developer

## Notes for Junior Developer
- **Ask Questions**: If you find legacy folder handling code you're unsure about, ask before removing
- **Test Thoroughly**: This affects core validation logic, so be extra careful
- **Check Logs**: After deployment, monitor logs for any folder validation errors
- **Coordinate**: This change affects the entire project structure, so coordinate with the team

## Related Files
- `server/utils/projects.js` - Main validation logic
- `server/routes/projects.js` - API endpoints using validation
- `server/services/repositories/projectsRepo.js` - Database operations
- `server/services/fsUtils.js` - Filesystem operations
