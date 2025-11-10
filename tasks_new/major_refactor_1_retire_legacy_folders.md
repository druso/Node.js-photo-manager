# Major Refactoring Task 1: Retire Legacy Folder ID Assumptions

## Overview
Remove `p<id>` validation branches once data migrations confirm all folders use sanitized names. This simplifies validation logic, reduces branching paths, and improves developer experience.

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
Create/update a `node:test` suite at `server/utils/__tests__/projects.test.js` using the built-in `assert` helpers:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCanonicalProjectFolder } = require('../projects');

describe('isCanonicalProjectFolder (post-legacy)', () => {
  it('accepts valid sanitized folder names', () => {
    assert.equal(isCanonicalProjectFolder('my-project'), true);
    assert.equal(isCanonicalProjectFolder('Project_2024'), true);
    assert.equal(isCanonicalProjectFolder('photos-vacation'), true);
  });

  it('rejects legacy p<id> format', () => {
    assert.equal(isCanonicalProjectFolder('p123'), false);
    assert.equal(isCanonicalProjectFolder('p1'), false);
  });

  it('rejects invalid characters', () => {
    assert.equal(isCanonicalProjectFolder('my/project'), false);
    assert.equal(isCanonicalProjectFolder('my\\project'), false);
    assert.equal(isCanonicalProjectFolder('../project'), false);
  });

  it('rejects empty or whitespace-only names', () => {
    assert.equal(isCanonicalProjectFolder(''), false);
    assert.equal(isCanonicalProjectFolder('   '), false);
    assert.equal(isCanonicalProjectFolder(null), false);
  });
});
```

### Integration Tests
Follow the isolation workflow documented in `project_docs/TESTING_OVERVIEW.md` (uses `.projects-test/` and the shared helpers):

1. **Create Project**: Verify new projects are created with sanitized folder names using `createFixtureTracker()` for cleanup.
2. **Rename Project**: Reuse the tracker and ensure renamed folders remain sanitized.
3. **API Validation**: Use `withAuthEnv()` + `createTestServer()` utilities to assert 400 responses for invalid folders, `p<id>` included.

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
