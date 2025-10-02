# Worker Refactoring Guide

**Created**: 2025-10-01  
**Purpose**: Guide for updating workers to support scope-agnostic job processing

## Overview

This guide documents the pattern for refactoring existing workers to support the new scope-aware job system. Workers must handle three scope types: `project`, `photo_set`, and `global`.

---

## Refactoring Pattern

### Before (Project-Scoped Only)
```javascript
async function runWorker({ job, onProgress }) {
  const project = projectsRepo.getById(job.project_id); // ❌ Assumes project_id exists
  if (!project) throw new Error('Project not found');
  
  const projectPath = path.join(__dirname, '...', '.projects', project.project_folder);
  const photos = photosRepo.listPaged({ project_id: project.id, ... }).items;
  
  // Process photos...
}
```

### After (Scope-Agnostic)
```javascript
const { resolveJobTargets, groupItemsByProject, getProjectPath } = require('./shared/photoSetUtils');

async function runWorker({ job, onProgress }) {
  // Handle all scope types
  switch (job.scope) {
    case 'project':
      return await runProjectScope(job, onProgress);
    case 'photo_set':
      return await runPhotoSetScope(job, onProgress);
    case 'global':
      return await runGlobalScope(job, onProgress);
    default:
      throw new Error(`Unsupported scope: ${job.scope}`);
  }
}

async function runProjectScope(job, onProgress) {
  // Traditional project-scoped processing
  if (!job.project_id) throw new Error('Project-scoped job missing project_id');
  
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  if (project.status === 'canceled') return; // Skip archived projects
  
  const projectPath = getProjectPath(project);
  const photos = await resolveJobTargets(job); // Returns photos with project context
  
  // Process photos...
}

async function runPhotoSetScope(job, onProgress) {
  // Cross-project photo set processing
  const items = jobsRepo.listItems(job.id);
  const groups = await groupItemsByProject(items);
  
  // Process each project group
  for (const { project, photos } of groups) {
    if (project.status === 'canceled') continue;
    
    const projectPath = getProjectPath(project);
    // Process photos in this project...
  }
}

async function runGlobalScope(job, onProgress) {
  // Global maintenance/system tasks
  const projects = projectsRepo.list().filter(p => p.status !== 'canceled');
  
  for (const project of projects) {
    const projectPath = getProjectPath(project);
    // Perform global operation on this project...
  }
}
```

---

## Worker-Specific Refactoring Notes

### derivativesWorker.js

**Current Behavior**: Generates thumbnails/previews for a single project

**Refactoring Approach**:
1. **Project Scope**: Keep existing logic, use `resolveJobTargets()` for photo list
2. **Photo Set Scope**: Group items by project, generate derivatives per project
3. **Global Scope**: Not applicable (derivatives are always photo-specific)

**Key Changes**:
- Replace `projectsRepo.getById(job.project_id)` with scope check
- Use `groupItemsByProject()` for cross-project photo sets
- Emit SSE updates with project context for each photo

**Complexity**: High (187 lines, complex logic)

---

### fileRemovalWorker.js

**Current Behavior**: Removes files marked for deletion in a single project

**Refactoring Approach**:
1. **Project Scope**: Keep existing logic
2. **Photo Set Scope**: Group by project, remove files per project
3. **Global Scope**: Not applicable (removal is always photo-specific)

**Key Changes**:
- Handle cross-project deletions in photo_set scope
- Ensure trash directory exists for each project
- Update database records after successful removal

**Complexity**: Medium (3950 bytes)

---

### maintenanceWorker.js

**Current Behavior**: Runs maintenance tasks for a single project

**Refactoring Approach**:
1. **Project Scope**: Keep existing logic
2. **Photo Set Scope**: Not applicable
3. **Global Scope**: NEW - Run maintenance across all active projects

**Key Changes**:
- Add global scope handler to replace scheduler's per-project loop
- Process all active projects in a single job
- Report progress per project

**Complexity**: Medium (9007 bytes)

**Priority**: HIGH - This enables the global maintenance task goal

---

### imageMoveWorker.js

**Current Behavior**: Moves images between projects

**Refactoring Approach**:
1. **Project Scope**: Source project context
2. **Photo Set Scope**: Support moving multiple photos from different sources
3. **Global Scope**: Not applicable

**Key Changes**:
- Already somewhat cross-project (source → destination)
- Enhance to handle multiple source projects in photo_set scope
- Ensure proper cleanup of source project manifests

**Complexity**: Medium (7381 bytes)

---

### projectDeletionWorker.js

**Current Behavior**: Deletes an entire project

**Refactoring Approach**:
1. **Project Scope**: Keep existing logic (always project-specific)
2. **Photo Set Scope**: Not applicable
3. **Global Scope**: Not applicable

**Key Changes**:
- Minimal changes needed (inherently project-scoped)
- Ensure project_id is always provided

**Complexity**: Low (5760 bytes)

---

### projectScavengeWorker.js

**Current Behavior**: Cleans up archived project files

**Refactoring Approach**:
1. **Project Scope**: Keep existing logic
2. **Photo Set Scope**: Not applicable
3. **Global Scope**: NEW - Scavenge all archived projects

**Key Changes**:
- Add global scope to process all archived projects
- Replace scheduler's per-project loop

**Complexity**: Low (1641 bytes)

---

## Implementation Priority

### Phase 1: High Priority (Enables Core Functionality)
1. ✅ **photoSetUtils.js** - Shared utilities (COMPLETE)
2. **maintenanceWorker.js** - Global maintenance support
3. **tasksOrchestrator.js** - Remove project_id requirement

### Phase 2: Medium Priority (Enables Cross-Project Operations)
4. **derivativesWorker.js** - Cross-project derivative generation
5. **fileRemovalWorker.js** - Cross-project file removal
6. **imageMoveWorker.js** - Enhanced multi-source moves

### Phase 3: Low Priority (Cleanup & Optimization)
7. **projectScavengeWorker.js** - Global scavenging
8. **projectDeletionWorker.js** - Minor updates

---

## Testing Strategy

### Unit Tests
- Test each scope type independently
- Mock `resolveJobTargets()` and `groupItemsByProject()`
- Verify error handling for missing project_id in project scope

### Integration Tests
- Create jobs with each scope type
- Verify worker claims and processes correctly
- Check database updates and SSE emissions

### End-to-End Tests
- Test cross-project commit/revert operations
- Test global maintenance task
- Verify file system operations across projects

---

## Migration Notes

### Backward Compatibility
- Existing project-scoped jobs continue to work (scope defaults to 'project')
- No changes needed to existing task definitions initially
- Workers check scope and fall back to project-scoped logic

### Breaking Changes
- Workers will eventually require scope parameter
- Old jobs without scope column will default to 'project'
- Scheduler will be updated to use global tasks instead of per-project loops

---

## Example: Simplified Worker Template

```javascript
const { resolveJobTargets, groupItemsByProject, getProjectPath } = require('./shared/photoSetUtils');
const projectsRepo = require('../repositories/projectsRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { emitJobUpdate } = require('../events');

async function runMyWorker({ job, onProgress }) {
  const payload = job.payload_json || {};
  
  // Dispatch based on scope
  switch (job.scope) {
    case 'project':
      return await handleProjectScope(job, payload, onProgress);
    case 'photo_set':
      return await handlePhotoSetScope(job, payload, onProgress);
    case 'global':
      return await handleGlobalScope(job, payload, onProgress);
    default:
      throw new Error(`Unsupported scope: ${job.scope}`);
  }
}

async function handleProjectScope(job, payload, onProgress) {
  if (!job.project_id) throw new Error('Project scope requires project_id');
  
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error(`Project ${job.project_id} not found`);
  if (project.status === 'canceled') {
    console.log(`Skipping canceled project ${project.id}`);
    return;
  }
  
  const projectPath = getProjectPath(project);
  const photos = await resolveJobTargets(job);
  
  // Process photos in this project
  for (const photo of photos) {
    // Do work...
    onProgress?.();
  }
}

async function handlePhotoSetScope(job, payload, onProgress) {
  const items = jobsRepo.listItems(job.id);
  const groups = await groupItemsByProject(items);
  
  for (const { project, photos } of groups) {
    if (project.status === 'canceled') continue;
    
    const projectPath = getProjectPath(project);
    
    // Process photos in this project
    for (const photo of photos) {
      // Do work...
      onProgress?.();
    }
  }
}

async function handleGlobalScope(job, payload, onProgress) {
  const projects = projectsRepo.list().filter(p => p.status !== 'canceled');
  
  for (const project of projects) {
    const projectPath = getProjectPath(project);
    
    // Perform global operation on this project
    // ...
    onProgress?.();
  }
}

module.exports = { runMyWorker };
```

---

## Common Pitfalls

### ❌ Don't: Assume project_id exists
```javascript
const project = projectsRepo.getById(job.project_id); // May be null!
```

### ✅ Do: Check scope first
```javascript
if (job.scope === 'project' && !job.project_id) {
  throw new Error('Project scope requires project_id');
}
```

### ❌ Don't: Hard-code project paths
```javascript
const projectPath = path.join(__dirname, '...', '.projects', project.project_folder);
```

### ✅ Do: Use utility function
```javascript
const projectPath = getProjectPath(project);
```

### ❌ Don't: Ignore scope in SSE emissions
```javascript
emitJobUpdate({ type: 'item', filename: photo.filename, ... });
```

### ✅ Do: Include project context
```javascript
emitJobUpdate({ 
  type: 'item', 
  project_folder: project.project_folder,
  filename: photo.filename,
  ...
});
```

---

## Next Steps

1. Update `tasksOrchestrator.js` to support optional project_id (Milestone 3)
2. Update `task_definitions.json` with new global task types (Milestone 3)
3. Implement worker rewrites following this guide (Milestone 2 completion)
4. Update API endpoints to use new scope-aware jobs (Milestone 4)
5. Update client to work with new endpoints (Milestone 5)
