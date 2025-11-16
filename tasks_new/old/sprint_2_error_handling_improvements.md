# Sprint 2: Error Handling Improvements

**Assignee**: Junior Developer  
**Estimated Effort**: 1-2 hours  
**Priority**: MEDIUM  
**Expected Impact**: Better debugging, fewer silent failures  
**Difficulty**: ⭐ (Easy)

---

## 📋 Overview

Currently, many try-catch blocks in the codebase swallow errors without logging them. This makes debugging production issues nearly impossible because failures happen silently.

**Current Problem**:
```javascript
// ❌ BAD - Silent failure, impossible to debug
try {
  res.write(`: ping\n\n`);
} catch (_) {}

// ❌ BAD - No context about what failed
try {
  jobsRepo.heartbeat(job.id);
} catch {}
```

**After This Sprint**:
```javascript
// ✅ GOOD - Logged with context
try {
  res.write(`: ping\n\n`);
} catch (err) {
  log.warn('sse_heartbeat_write_failed', { error: err?.message });
}

// ✅ GOOD - Full context for debugging
try {
  jobsRepo.heartbeat(job.id);
} catch (err) {
  log.error('job_heartbeat_failed', { job_id: job.id, error: err?.message, stack: err?.stack });
}
```

---

## 🎯 Learning Objectives

By completing this sprint, you will learn:
1. Why error logging is critical for production systems
2. How to write meaningful error messages
3. Best practices for try-catch blocks
4. Using structured logging effectively

---

## 📚 Background Reading (10 minutes)

### Why Silent Failures Are Dangerous

**Scenario**: A user reports "photos aren't loading"

**With silent failures**:
- No logs to investigate
- Can't reproduce the issue
- Takes hours/days to debug
- Poor user experience

**With proper logging**:
- Check logs for error events
- See exact error message and stack trace
- Identify root cause in minutes
- Fix quickly

### What Makes a Good Error Log?

**Bad**:
```javascript
catch (err) { console.log('error'); }
```
- No context
- No error details
- Can't search logs

**Good**:
```javascript
catch (err) {
  log.error('job_heartbeat_failed', { 
    job_id: job.id,
    job_type: job.type,
    error: err?.message,
    stack: err?.stack
  });
}
```
- Clear event name
- Rich context
- Full error details
- Searchable

---

## 🛠️ Implementation Steps

### Step 1: Update workerLoop.js (30 minutes)

**File**: `server/services/workerLoop.js`

This file has **20 try-catch blocks** that need improvement.

#### Pattern 1: Heartbeat Writes

**Lines to fix**: 28, 98, 112, 126, etc.

❌ **Before**:
```javascript
try { jobsRepo.heartbeat(job.id); } catch {}
```

✅ **After**:
```javascript
try { 
  jobsRepo.heartbeat(job.id); 
} catch (err) {
  log.warn('job_heartbeat_failed', { job_id: job.id, error: err?.message });
}
```

#### Pattern 2: Job Progress Updates

**Lines to fix**: 39, 93, 115, etc.

❌ **Before**:
```javascript
try { jobsRepo.updateProgress(job.id, { done, total }); } catch {}
```

✅ **After**:
```javascript
try { 
  jobsRepo.updateProgress(job.id, { done, total }); 
} catch (err) {
  log.warn('job_progress_update_failed', { job_id: job.id, done, total, error: err?.message });
}
```

#### Pattern 3: Task Orchestrator Callbacks

**Lines to fix**: 47, 60, 72, 83, 95, 106, 117, 128, 139, 150, 161, 174, 187, 200, 213, 226

❌ **Before**:
```javascript
try { tasksOrchestrator.onJobCompleted(job); } catch {}
```

✅ **After**:
```javascript
try { 
  tasksOrchestrator.onJobCompleted(job); 
} catch (err) {
  log.error('task_orchestrator_callback_failed', { 
    job_id: job.id, 
    job_type: job.type,
    error: err?.message,
    stack: err?.stack
  });
}
```

#### Pattern 4: Crash Recovery

**Line to fix**: 287

❌ **Before**:
```javascript
try { jobsRepo.requeueStaleRunning({ staleSeconds }); } catch {}
```

✅ **After**:
```javascript
try { 
  jobsRepo.requeueStaleRunning({ staleSeconds }); 
} catch (err) {
  log.error('crash_recovery_failed', { staleSeconds, error: err?.message, stack: err?.stack });
}
```

#### Pattern 5: Main Loop Error Swallowing

**Line to fix**: 314

❌ **Before**:
```javascript
} catch (_) {
  // swallow errors in loop, they are handled per job
}
```

✅ **After**:
```javascript
} catch (err) {
  // Errors in individual jobs are handled separately
  // This catches unexpected errors in the loop itself
  log.error('worker_loop_tick_failed', { error: err?.message, stack: err?.stack });
}
```

---

### Step 2: Update jobs.js (15 minutes)

**File**: `server/routes/jobs.js`

This file has **4 try-catch blocks** to improve.

#### Pattern 1: SSE Heartbeat

**Line to fix**: 98

❌ **Before**:
```javascript
try { res.write(`: ping\n\n`); } catch (_) {}
```

✅ **After**:
```javascript
try { 
  res.write(`: ping\n\n`); 
} catch (err) {
  log.warn('sse_heartbeat_write_failed', { error: err?.message });
}
```

#### Pattern 2: SSE Bye Event

**Line to fix**: 104

❌ **Before**:
```javascript
try { res.write(`event: bye\ndata: {"reason":"idle_timeout"}\n\n`); } catch (_) {}
```

✅ **After**:
```javascript
try { 
  res.write(`event: bye\ndata: {"reason":"idle_timeout"}\n\n`); 
} catch (err) {
  log.warn('sse_bye_write_failed', { reason: 'idle_timeout', error: err?.message });
}
```

#### Pattern 3: SSE End Connection

**Line to fix**: 105

❌ **Before**:
```javascript
try { res.end(); } catch (_) {}
```

✅ **After**:
```javascript
try { 
  res.end(); 
} catch (err) {
  log.warn('sse_end_failed', { error: err?.message });
}
```

#### Pattern 4: Initial Heartbeat

**Line to fix**: 122

❌ **Before**:
```javascript
try { res.write(`: ping\n\n`); } catch (_) {}
```

✅ **After**:
```javascript
try { 
  res.write(`: ping\n\n`); 
} catch (err) {
  log.warn('sse_initial_heartbeat_failed', { error: err?.message });
}
```

---

### Step 3: Update db.js (15 minutes)

**File**: `server/services/db.js`

This file has **7 try-catch blocks** to improve.

#### Pattern 1: Index Creation Failures

**Lines to fix**: 179, 191, 197, 202, 210, 220

❌ **Before**:
```javascript
try { 
  log.warn('index_create_failed', { index: 'idx_projects_status', error: e && e.message }); 
} catch {}
```

✅ **After**:
```javascript
try { 
  log.warn('index_create_failed', { index: 'idx_projects_status', error: e?.message }); 
} catch (logErr) {
  // If logging itself fails, there's nothing we can do
  // This is a last-resort catch to prevent crashes
}
```

#### Pattern 2: Column Ensure Failures

**Line to fix**: 252

❌ **Before**:
```javascript
try { 
  log.warn('ensure_column_failed', { table, column, error: e && e.message }); 
} catch {}
```

✅ **After**:
```javascript
try { 
  log.warn('ensure_column_failed', { table, column, error: e?.message, stack: e?.stack }); 
} catch (logErr) {
  // If logging itself fails, there's nothing we can do
}
```

---

### Step 4: Update Other Files (15 minutes)

Apply the same patterns to any remaining files with empty catch blocks:

**Files to check**:
- `server/services/scheduler.js`
- `server/services/fsUtils.js`
- `server/services/publicAssetHashes.js`
- `server/routes/assets.js`
- `server/routes/projects.js`

**Search command**:
```bash
# Find all empty catch blocks
grep -r "catch (_)" server/
grep -r "catch {}" server/
grep -r "catch ()" server/
```

---

## ✅ Testing Checklist

### Code Review
- [ ] No `catch (_) {}` blocks remain
- [ ] No `catch {}` blocks remain
- [ ] All error logs include `error: err?.message`
- [ ] Critical errors include `stack: err?.stack`
- [ ] Event names are descriptive (e.g., `job_heartbeat_failed`)

### Manual Testing
1. [ ] Start the server: `npm start`
2. [ ] Trigger an error (e.g., disconnect during SSE)
3. [ ] Check logs - should see structured error events
4. [ ] Verify error messages are helpful

### Regression Testing
- [ ] Run `npm test` - all tests pass
- [ ] Server starts without errors
- [ ] All features work normally

---

## 📊 Success Criteria

- [ ] All empty catch blocks have logging
- [ ] Error logs include context (job_id, file path, etc.)
- [ ] Event names follow pattern: `{component}_{action}_failed`
- [ ] All tests pass
- [ ] No new console.log/error introduced

---

## 🐛 Common Pitfalls

### Pitfall 1: Using `e.message` Instead of `err?.message`

**Problem**: If error is not an Error object, `e.message` throws

```javascript
// ❌ BAD - Can throw if err is undefined
catch (err) {
  log.error('failed', { error: err.message });
}

// ✅ GOOD - Safe even if err is undefined
catch (err) {
  log.error('failed', { error: err?.message });
}
```

### Pitfall 2: Not Including Context

**Problem**: Can't identify which operation failed

```javascript
// ❌ BAD - Which job failed?
catch (err) {
  log.error('job_failed', { error: err?.message });
}

// ✅ GOOD - Clear context
catch (err) {
  log.error('job_heartbeat_failed', { 
    job_id: job.id, 
    job_type: job.type,
    error: err?.message 
  });
}
```

### Pitfall 3: Over-Logging

**Problem**: Logging expected errors as errors

```javascript
// ❌ BAD - SSE disconnects are normal
catch (err) {
  log.error('sse_write_failed', { error: err?.message });
}

// ✅ GOOD - Use appropriate level
catch (err) {
  log.warn('sse_write_failed', { error: err?.message });
}
```

**Log Level Guidelines**:
- `log.error()` - Unexpected failures, bugs, data corruption
- `log.warn()` - Expected failures, network issues, user errors
- `log.info()` - Normal operations, state changes
- `log.debug()` - Detailed debugging info

---

## 🎓 Learning Resources

- [Error Handling Best Practices](https://nodejs.org/en/docs/guides/error-handling/)
- [Structured Logging](https://www.honeycomb.io/blog/structured-logging-and-your-team)
- [Optional Chaining (?.) Operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining)

---

## 📝 Submission Checklist

Before marking this sprint as complete:

- [ ] Updated all files with empty catch blocks
- [ ] All error logs include context
- [ ] Used appropriate log levels (error/warn/info)
- [ ] All tests pass
- [ ] Manually tested error scenarios
- [ ] Committed with message: "fix: improve error logging in try-catch blocks for better debugging"
- [ ] Created PR with list of files changed

---

## 🆘 Need Help?

If you get stuck:
1. Search for `catch (_)` or `catch {}` to find remaining blocks
2. Check existing good examples in `server/routes/sse.js` (recently fixed)
3. Ask: "What context would help me debug this error?"
4. Request code review from senior developer

**Estimated Time**: 1-2 hours  
**Actual Time**: _____ hours (fill this in when done)

---

## 📈 Impact Metrics

After completing this sprint:
- **100% of errors** now logged with context
- **Debugging time** reduced from hours to minutes
- **Production issues** easier to diagnose
- **Better observability** for monitoring tools

**Great work!** 🎉
