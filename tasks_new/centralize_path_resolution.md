# Task: Centralize Photo Lookup and Path Resolution Logic

**Status:** Open
**Priority:** Medium
**Assignee:** Junior Developer

## Objective
Refactor the codebase to unify two critical operations:
1.  **Photo Lookup:** Finding the correct database record given a filename (handling derivatives like `.webp` resolving to source `.jpg`).
2.  **Path Resolution:** Constructing the correct absolute file path on disk (handling case sensitivity and extensions).

The goal is to eliminate ad-hoc logic in routes and workers, ensuring a single source of truth for "finding a photo".

## Context
We have encountered two main classes of issues:
1.  **Path Construction:** Manual `path.join` calls failing due to case sensitivity or missing extensions. Addressed by `resolvePhotoPath` in `server/utils/assetPaths.js`.
2.  **Derivative Lookup:** Requests for `.webp` files (e.g., `image.webp`) failing because the database only knows about `image.jpg`. We patched this in `assets.js` using `getByProjectAndBasename`, but this logic needs to be standardized.

## The Helper Functions

### 1. Disk Path Resolution
Located in `server/utils/assetPaths.js`:
```javascript
async function resolvePhotoPath(projectPath, photo) { ... }
```
Handles case-insensitive matching and extension fallbacks on disk.

### 2. Database Record Lookup (To Be Standardized)
We recently added `getByProjectAndBasename` to `photosRepo.js`. This allows looking up a photo even if the requested filename has a different extension (e.g., requesting a `.webp` derivative of a `.jpg` source).

## Scope of Work

### 1. Scan the Codebase
Identify areas using manual logic for:
-   **Looking up photos:** `photosRepo.getByProjectAndFilename` followed by manual fallback logic.
-   **Constructing paths:** `path.join`, `fs.exists`, `getProjectPath` + string concatenation.

**Key Areas:**
-   `server/routes/assets.js` (Heavily patched, needs cleanup)
-   `server/services/workers/derivativesWorker.js`
-   `server/services/workers/imageWorker.js`
-   `server/routes/tusUploads.js`

### 2. Refactor Photo Lookup
-   Ensure `photosRepo.getByProjectAndBasename` (or a higher-level `resolvePhotoRecord`) is the standard way to find a photo from a user-provided filename.
-   Replace the manual "try exact, then try basename" logic in `server/routes/assets.js` with this standardized call.

### 3. Refactor Path Resolution
-   Replace manual path construction with `await resolvePhotoPath(projectPath, photo)`.
-   **Note:** `resolvePhotoPath` is **asynchronous**.

### 4. Special Attention: `derivativesWorker.js`
The `derivativesWorker.js` file currently has a local function `supportedSourcePath` that prioritizes certain extensions.
-   Evaluate if `resolvePhotoPath` covers all the needs of `derivativesWorker.js`.
-   If `resolvePhotoPath` needs adjustment (e.g., to support specific prioritization), modify the shared helper instead of keeping the local one.

### 5. Verify
-   **WebP Loading:** Ensure `foo.webp` requests still correctly serve `foo.jpg` (or the generated derivative).
-   **Uploads:** Verify that new uploads are correctly located.
-   **Regeneration:** Verify that "Regenerate Derivatives" tasks can still find source files.

## Deliverables
-   A Pull Request containing the refactored code.
-   A brief summary of the files modified and any specific logic that was consolidated.

