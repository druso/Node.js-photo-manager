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

function startTask({ project_id = null, type, source = 'user', items = null, tenant_id = 'user_0', scope = null, payload: extraPayload = null }) {
  const d = loadDefs();
  const def = d[type];
  if (!def) throw new Error(`Unknown task type: ${type}`);
  
  const effectiveScope = scope || def.scope;
  if (!effectiveScope) throw new Error(`Task type '${type}' missing scope in definition`);
  
  const task_id = uuidv4();
  const first = def.steps && def.steps[0];
  if (!first) return { task_id, type };
  
  const payload = { task_id, task_type: type, source, ...extraPayload };
  let job;

  const normalizeItems = () => {
    if (!items || !Array.isArray(items) || items.length === 0) return null;

    let defaultProjectHints = null;
    if (project_id) {
      const project = projectsRepo.getById(project_id);
      if (project) {
        defaultProjectHints = {
          project_id: project.id,
          project_folder: project.project_folder,
          project_name: project.project_name,
        };
      }
    }

    return items.map((entry) => {
      if (typeof entry === 'string') {
        return defaultProjectHints ? { filename: entry, ...defaultProjectHints } : { filename: entry };
      }

      if (!entry || typeof entry !== 'object') {
        return entry;
      }

      if (defaultProjectHints && entry.project_id == null && entry.project_folder == null) {
        return { ...defaultProjectHints, ...entry };
      }

      return { ...entry };
    });
  };

  const normalizedItems = normalizeItems();

  if (normalizedItems && normalizedItems.length > 0) {
    job = jobsRepo.enqueueWithItems({
      tenant_id,
      project_id,
      type: first.type,
      payload,
      items: normalizedItems,
      priority: first.priority || 0,
      scope: effectiveScope,
      autoChunk: true,
    });
  } else {
    job = jobsRepo.enqueue({ 
      tenant_id, 
      project_id, 
      type: first.type, 
      payload, 
      priority: first.priority || 0,
      scope: effectiveScope
    });
  }
  
  // Handle chunked jobs (array return from enqueueWithItems)
  const firstJobId = Array.isArray(job) ? job[0]?.id : job?.id;
  return { task_id, type, first_job_id: firstJobId, chunked: Array.isArray(job), job_count: Array.isArray(job) ? job.length : 1 };
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
  const scope = job.scope;
  const nextPayload = { ...payload }; // propagate task metadata
  jobsRepo.enqueue({ tenant_id, project_id, type: next.type, payload: nextPayload, priority: next.priority || 0, scope });
}

module.exports = { startTask, onJobCompleted };
