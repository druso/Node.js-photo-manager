# Projects: IDs, Folders, and Root Discovery

This document defines the fresh-start target design for project root resolution and folder naming. We will not support any migration or backward compatibility.

## Target State (Fresh Start)

- Table: `projects`
  - Columns: `id` (INTEGER PK), `project_name` (TEXT), `project_folder` (TEXT UNIQUE), timestamps.
- The `project_folder` is always the canonical on‑disk folder name and is derived at creation time from the pattern described below.
- APIs identify projects by `project_folder` in URL params and by `id` in relational operations.

Uniqueness is enforced by `project_folder`. Duplicate human names are allowed and will map to distinct folders.

## Recommended Enhancement: Folder = slug + id

Make on‑disk folders unambiguously unique while still human‑readable by including the DB `id`:

- Folder format: `<slug(name)>--p<id>` (example: `Vacation_2024--p12`).
- `project_folder` is the stored canonical folder name; it is UNIQUE.
- Advantages:
  - No collisions even for identical names
  - Easy mapping back to `id` by parsing suffix

### Implementation Plan

1. API Change (create project)
   - After inserting row (obtain `id`), compute `folder = slugify(name) + "--p" + id` and update `project_folder`.
   - Ensure repository/service method returns both `id` and `project_folder`.

2. Folder Creation
   - In `server/routes/projects.js`, create the directory using the final `project_folder` and ensure subdirs: `.thumb`, `.preview`, `.trash`.

3. Parsing Helper (optional)
   - `parseProjectIdFromFolder(folder)` returns `id` by parsing the `--p<id>` suffix. No fallback paths are required in the fresh-start design.

## Root Discovery Cheat Sheet

- Repo root: `path.join(__dirname, '..', '..')` from server files.
- Projects root: `<repoRoot>/.projects/`.
- Project folder: `projectsRepo.getByFolder(':folder')` → `project.project_folder`.
- On‑disk path: `<repoRoot>/.projects/<project.project_folder>/`.

## Acceptance Criteria

- New projects are created with folder names containing the project id suffix (`<slug>--p<id>`).
- APIs accept `:folder` that directly maps to `project_folder`.
- Duplicate human names are allowed and mapped to distinct unique folders.

