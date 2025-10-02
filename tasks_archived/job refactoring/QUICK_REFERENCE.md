# Jobs Refactoring Quick Reference

**Last Updated**: 2025-10-01

---

## Scope Types

| Scope | project_id | Use For |
|-------|------------|---------|
| `project` | Required | Single project operations |
| `photo_set` | Optional | Cross-project photo operations |
| `global` | null | System-wide maintenance |

---

## Creating Jobs

### Simple Job (No Items)
```javascript
const job = jobsRepo.enqueue({
  tenant_id: 'user_0',
  project_id: 123,        // Optional (null for photo_set/global)
  type: 'my_job_type',
  scope: 'project',       // Optional (auto-detected)
  payload: { custom: 'data' },
  priority: 50
});
```

### Job with Items
```javascript
const job = jobsRepo.enqueueWithItems({
  tenant_id: 'user_0',
  project_id: null,       // Cross-project
  type: 'process_photos',
  scope: 'photo_set',
  items: [
    { photo_id: 1, filename: 'img1.jpg' },
    { photo_id: 2, filename: 'img2.jpg' }
  ],
  priority: 75
});
```

### Large Batch (Auto-Chunking)
```javascript
const jobs = jobsRepo.enqueueWithItems({
  tenant_id: 'user_0',
  type: 'bulk_process',
  items: largeArray,      // > 2000 items
  autoChunk: true,        // Returns array of jobs
  priority: 60
});
// jobs is an array: [job1, job2, ...]
```

---

## Starting Tasks

### Project-Scoped Task
```javascript
tasksOrchestrator.startTask({
  project_id: 123,
  type: 'change_commit',
  source: 'user',
  tenant_id: 'user_0'
});
```

### Cross-Project Task
```javascript
tasksOrchestrator.startTask({
  type: 'change_commit_all',
  scope: 'photo_set',
  items: [
    { photo_id: 1 },
    { photo_id: 2 }
  ],
  payload: { reason: 'bulk_cleanup' },
  tenant_id: 'user_0'
});
```

### Global Task
```javascript
tasksOrchestrator.startTask({
  type: 'maintenance_global',
  scope: 'global',
  source: 'maintenance',
  tenant_id: 'user_0'
});
```

---

## Worker Implementation

### Basic Pattern
```javascript
const { resolveJobTargets, groupItemsByProject } = require('./shared/photoSetUtils');

async function runMyWorker({ job, onProgress }) {
  switch (job.scope) {
    case 'project':
      return await handleProject(job, onProgress);
    case 'photo_set':
      return await handlePhotoSet(job, onProgress);
    case 'global':
      return await handleGlobal(job, onProgress);
  }
}
```

### Project Scope Handler
```javascript
async function handleProject(job, onProgress) {
  if (!job.project_id) throw new Error('Missing project_id');
  
  const project = projectsRepo.getById(job.project_id);
  if (!project || project.status === 'canceled') return;
  
  const photos = await resolveJobTargets(job);
  // Process photos...
}
```

### Photo Set Scope Handler
```javascript
async function handlePhotoSet(job, onProgress) {
  const items = jobsRepo.listItems(job.id);
  const groups = await groupItemsByProject(items);
  
  for (const { project, photos } of groups) {
    if (project.status === 'canceled') continue;
    // Process photos in this project...
  }
}
```

### Global Scope Handler
```javascript
async function handleGlobal(job, onProgress) {
  const projects = projectsRepo.list()
    .filter(p => p.status !== 'canceled');
  
  for (const project of projects) {
    // Perform operation on each project...
  }
}
```

---

## Querying Jobs

### By Project
```javascript
const jobs = jobsRepo.listByProject(projectId, {
  limit: 50,
  offset: 0,
  status: 'running',
  type: 'generate_derivatives'
});
```

### By Tenant (All Scopes)
```javascript
const jobs = jobsRepo.listByTenant('user_0', {
  limit: 50,
  scope: 'photo_set',  // Optional filter
  status: 'queued'
});
```

### Claim Next Job
```javascript
const job = jobsRepo.claimNext({
  workerId: 'worker-1',
  tenant_id: 'user_0',
  minPriority: 90,     // Priority lane
  maxPriority: 100
});
```

---

## Task Definitions

### Structure
```json
{
  "my_task": {
    "label": "My Task",
    "user_relevant": true,
    "scope": "project",
    "steps": [
      { "type": "step1", "priority": 100 },
      { "type": "step2", "priority": 95 }
    ]
  }
}
```

### Available Scopes
- `"project"` - Requires project_id
- `"photo_set"` - Optional project_id
- `"global"` - No project_id

---

## Constants

```javascript
const { MAX_ITEMS_PER_JOB } = require('./repositories/jobsRepo');
// MAX_ITEMS_PER_JOB = 2000
```

---

## Validation

### Payload Size
```javascript
const { validatePayloadSize } = require('./workers/shared/photoSetUtils');

const result = validatePayloadSize(payload, 2000);
if (!result.valid) {
  throw new Error(result.message);
}
```

### Chunking
```javascript
const { chunkPhotoIds } = require('./workers/shared/photoSetUtils');

const chunks = chunkPhotoIds(photoIds, 2000);
// Returns: [[ids 0-1999], [ids 2000-3999], ...]
```

---

## Common Patterns

### Check Scope Before Processing
```javascript
if (job.scope === 'project' && !job.project_id) {
  throw new Error('Project scope requires project_id');
}
```

### Get Project Path
```javascript
const { getProjectPath } = require('./workers/shared/photoSetUtils');

const projectPath = getProjectPath(project);
// Returns: /absolute/path/to/.projects/project-folder
```

### Resolve Job Targets
```javascript
const { resolveJobTargets } = require('./workers/shared/photoSetUtils');

const photos = await resolveJobTargets(job);
// Returns photos with project context based on job.scope
```

### Group Items by Project
```javascript
const { groupItemsByProject } = require('./workers/shared/photoSetUtils');

const groups = await groupItemsByProject(items);
// Returns: [{ project, photos: [...] }, ...]
```

---

## Error Handling

### Job Failures
```javascript
try {
  // Process job...
} catch (error) {
  jobsRepo.fail(job.id, error.message);
  throw error;
}
```

### Item Failures
```javascript
try {
  // Process item...
  jobsRepo.updateItemStatus(item.id, { 
    status: 'done' 
  });
} catch (error) {
  jobsRepo.updateItemStatus(item.id, { 
    status: 'failed',
    message: error.message 
  });
}
```

---

## Migration Notes

### Backward Compatibility
- Existing jobs without `scope` default to `'project'`
- Existing task definitions work (scope auto-detected from project_id)
- No breaking changes to existing API calls

### New Features
- Optional `project_id` enables cross-project operations
- Auto-chunking prevents oversized jobs
- Global tasks eliminate per-project loops
- Tenant-scoped queries for multi-tenant support

---

## Testing

### Unit Test Example
```javascript
const jobsRepo = require('./repositories/jobsRepo');

// Test scope auto-detection
const job = jobsRepo.enqueue({
  tenant_id: 'user_0',
  type: 'test_job'
  // No project_id, no scope
});

assert.equal(job.scope, 'photo_set'); // Auto-detected
```

### Integration Test Example
```javascript
// Test cross-project operation
const job = jobsRepo.enqueueWithItems({
  tenant_id: 'user_0',
  scope: 'photo_set',
  type: 'test_cross_project',
  items: [
    { photo_id: 1 }, // Project A
    { photo_id: 2 }  // Project B
  ]
});

const groups = await groupItemsByProject(jobsRepo.listItems(job.id));
assert.equal(groups.length, 2); // Two projects
```

---

## Troubleshooting

### Job Not Being Claimed
- Check `job.status` is 'queued'
- Verify `job.scope` matches worker expectations
- Check priority range in `claimNext()`
- Ensure tenant_id matches

### Foreign Key Errors
- Run migration: `fixJobItemsForeignKey()` in db.js
- Check `job_items` table references `jobs` (not `jobs_legacy`)

### Chunking Not Working
- Ensure `autoChunk: true` is set
- Check item count exceeds `MAX_ITEMS_PER_JOB`
- Verify return value is array when chunked

---

## See Also

- `tasks_progress/jobs_refactoring_progress.md` - Detailed progress
- `tasks_progress/worker_refactoring_guide.md` - Worker patterns
- `tasks_progress/REFACTORING_SUMMARY.md` - Complete summary
- `server/services/task_definitions.json` - Task definitions
- `server/services/workers/shared/photoSetUtils.js` - Utilities
