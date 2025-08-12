# Projects: IDs, Folders, and Root Discovery

This document explains how project roots are resolved, how the current schema works, and a recommended enhancement to make on-disk folders unique by including the DB project id to avoid naming collisions.

## Current State

- Table: `projects` (see `server/services/db.js`)
  - Columns: `id` (INTEGER PK), `project_folder` (TEXT UNIQUE), `project_name`, timestamps, `schema_version`.
- Repo: `server/services/repositories/projectsRepo.js` provides `createProject`, `getById`, `getByFolder`, `list`, `updateName`, `remove`.
- Routes: `server/routes/projects.js`
  - Creates the on‑disk folder under `<repoRoot>/.projects/<project_folder>/`.
  - `:folder` params in API map to `project_folder` via `projectsRepo.getByFolder(folder)`.
- Uploads and processing: routes resolve the folder via `project_folder` and use the DB `id` for relational operations.

This works but enforces uniqueness solely through `project_folder`. If two projects share the same desired name, creation fails due to the unique constraint.

## Recommended Enhancement: Folder = slug + id

Make on‑disk folders unambiguously unique while still human‑readable by including the DB `id`:

- Folder format: `<slug(name)>--p<id>` (example: `Vacation_2024--p12`).
- Keep `project_folder` as stored canonical folder name; it remains UNIQUE.
- Advantages:
  - No collisions even for identical names
  - Easy mapping back to `id` by parsing suffix
  - Backward compatible with existing code paths that already reference `project_folder`

### Implementation Plan

1. API Change (create project)
   - After inserting row (obtain `id`), compute `folder = slugify(name) + "--p" + id` and update the row `project_folder = folder`.
   - Update `projectsRepo.createProject` to support two‑step insert/update or return id and let route update.

2. Folder Creation
   - In `server/routes/projects.js`, create the directory using the final `project_folder` and ensure subdirs: `.thumb`, `.preview`, `.trash`.

3. Backward Compatibility
   - Existing projects without `--p<id>` continue to work.
   - When listing projects, return both `project_name` and `project_folder`.

4. Parsing Helper (optional)
   - `parseProjectIdFromFolder(folder)` that returns `id` when suffix is present; fallback to DB lookup by folder when absent.

5. Migration (optional)
   - If desired, add a one‑time script to rename existing folders to the new format and update DB `project_folder` accordingly. This is not required for functionality.

## Root Discovery Cheat Sheet

- Repo root: `path.join(__dirname, '..', '..')` from server files.
- Projects root: `<repoRoot>/.projects/`.
- Project folder: `projectsRepo.getByFolder(':folder')` → `project.project_folder`.
- On‑disk path: `<repoRoot>/.projects/<project.project_folder>/`.

## Acceptance Criteria

- New projects are created with folder names containing the project id suffix.
- All APIs that take `:folder` continue to work.
- Duplicate names are allowed and mapped to distinct folders.
