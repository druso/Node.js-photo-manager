const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const jobsRepo = require('./repositories/jobsRepo');
const projectsRepo = require('./repositories/projectsRepo');

// Lazy-load definitions once
let defs = null;
function loadDefs() {
  if (defs) return defs;
  const p = path.join(__dirname, 'task_definitions.json');
  const raw = fs.readFileSync(p, 'utf8');
  defs = JSON.parse(raw);
  return defs;
}

function startTask({ project_id, type, source = 'user', items = null, tenant_id = 'user_0' }) {
  const d = loadDefs();
  const def = d[type];
  if (!def) throw new Error(`Unknown task type: ${type}`);
  const task_id = uuidv4();
  const first = def.steps && def.steps[0];
  if (!first) return { task_id, type };
  const payload = { task_id, task_type: type, source };
  let job;
  if (items && Array.isArray(items) && items.length > 0) {
    job = jobsRepo.enqueueWithItems({ tenant_id, project_id, type: first.type, payload, items: items.map(fn => ({ filename: fn })), priority: first.priority || 0 });
  } else {
    job = jobsRepo.enqueue({ tenant_id, project_id, type: first.type, payload, priority: first.priority || 0 });
  }
  return { task_id, type, first_job_id: job?.id };
}

function onJobCompleted(job) {
  // Advance the task if this job carries a task payload
  const payload = job && job.payload_json;
  if (!payload || !payload.task_id || !payload.task_type) return;
  const d = loadDefs();
  const def = d[payload.task_type];
  if (!def || !def.steps || def.steps.length === 0) return;
  // Find index of this job type in steps
  const idx = def.steps.findIndex(s => s.type === job.type);
  if (idx < 0) return;
  let next = def.steps[idx + 1];
  if (!next) return; // Task finished
  // Conditional skip: if next is generate_derivatives and upstream set flag false
  if (next.type === 'generate_derivatives') {
    const need = payload.need_generate_derivatives;
    if (need === false) {
      // Skip this step, try the following one if present
      next = def.steps[idx + 2];
      if (!next) return;
    }
  }
  const tenant_id = job.tenant_id || 'user_0';
  const project_id = job.project_id;
  const nextPayload = { ...payload }; // propagate task metadata
  jobsRepo.enqueue({ tenant_id, project_id, type: next.type, payload: nextPayload, priority: next.priority || 0 });
}

module.exports = { startTask, onJobCompleted };
