# Task: Centralize Photo Path Resolution Logic

**Status:** Open
**Priority:** Medium
**Assignee:** Junior Developer

## Objective
Scan the entire codebase to identify and refactor all instances where photo file paths are manually constructed. The goal is to unify this logic using the centralized `resolvePhotoPath` helper to ensure consistency and robustness across the application.

## Context
We have recently encountered issues where file paths were being constructed incorrectly (e.g., missing extensions, wrong case sensitivity), leading to "file not found" errors. To address this, we introduced a helper function `resolvePhotoPath` in `server/utils/assetPaths.js`.

However, many parts of the codebase still use ad-hoc logic (e.g., `path.join(projectPath, filename)`) or custom helper functions to find files. We need to standardize this.

## The Helper Function
The centralized helper is located in `server/utils/assetPaths.js`:
```javascript
async function resolvePhotoPath(projectPath, photo) { ... }
```
It handles:
- Case-insensitive extension matching (e.g., `.jpg` vs `.JPG`).
- Fallback to common extensions if the stored extension is incorrect or missing.
- Verification that the file actually exists on disk.

## Scope of Work

### 1. Scan the Codebase
Search for patterns that indicate manual path construction for photos. Keywords to search for:
- `path.join` combined with `filename`
- `fs.exists` or `fs.pathExists`
- `supportedSourcePath` (in `derivativesWorker.js`)
- `getProjectPath` usage followed by path construction

**Key Directories to Check:**
- `server/services/workers/` (e.g., `derivativesWorker.js`, `imageWorker.js`, `folderDiscoveryWorker.js`)
- `server/routes/` (e.g., `assets.js`, `tusUploads.js`)
- `server/services/repositories/`
- `server/utils/`

### 2. Refactor
For each identified instance:
1.  **Analyze:** Confirm that the code is indeed trying to resolve the source path of a photo.
2.  **Replace:** Substitute the manual logic with `await resolvePhotoPath(projectPath, photo)`.
    - **Note:** `resolvePhotoPath` is **asynchronous**. You must ensure the calling function is `async` and properly `await`s the result.
3.  **Clean up:** Remove any local helper functions or redundant checks that are no longer needed (e.g., `supportedSourcePath` in `derivativesWorker.js` if it can be fully replaced).

### 3. Special Attention: `derivativesWorker.js`
The `derivativesWorker.js` file currently has a local function `supportedSourcePath` that prioritizes certain extensions.
- Evaluate if `resolvePhotoPath` covers all the needs of `derivativesWorker.js`.
- If `resolvePhotoPath` needs adjustment (e.g., to support specific prioritization), modify the shared helper instead of keeping the local one.
- The goal is to have **one** source of truth for finding a photo file.

### 4. Verify
- Ensure that the application still functions correctly after the changes.
- Verify that features relying on path resolution (e.g., thumbnail generation, metadata extraction, image serving) work as expected.

## Deliverables
- A Pull Request containing the refactored code.
- A brief summary of the files modified and any specific logic that was consolidated.
