---
Title: Dependency and Toolchain Upgrade Plan
Owner: Engineering
Last-Updated: 2025-08-18
Scope: Server (Express/SQLite toolchain) + Client (Vite/React/Tailwind/testing)
---

# Summary
This plan outlines a staged approach to bring the repository to current stable versions while minimizing risk. It prioritizes low-risk updates, then proceeds to breaking upgrades with clear migration steps and verification tests.

Key context:
- Runtime: Node.js 22 LTS via nvm (`.nvmrc`), npm 10.x.
- Client already on Vite 7 and @vitejs/plugin-react 5.
- Security: see `SECURITY.md` Runtime Environment. Jobs catalog is canonical in `JOBS_OVERVIEW.md`.

# Staging Overview
- Stage 0: Preconditions and baselines
- Stage 1: Safe minor dev-dependency update (client)
- Stage 2: fs-extra (server) minor-to-major upgrade
- Stage 3: Express 4 → 5 migration
- Stage 4: archiver 5 → 7 migration
- Stage 5: better-sqlite3 9 → 12 migration
- Stage 6: @testing-library/user-event 13 → 14 migration (client)
- Stage 7: web-vitals 2 → 5 migration (client)
- Stage 8: TailwindCSS 3 → 4 migration (client)

Each stage includes: branch name, commands, code changes, tests, and rollback notes.

# Global Checklist (run at every stage)
- Ensure Node/npm versions:
  ```bash
  export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use
  node -v  # v22.x
  npm -v   # 10.x
  ```
- Clean install and audit at repo root and client:
  ```bash
  npm ci && npm audit
  cd client && npm ci && npm audit && cd ..
  ```
- Run server & client smoke tests (see Test Suite section).
- Update CHANGELOG (or PR description) with migration notes.

# Test Suite (to run per stage)
- Server smoke:
  - Start backend:
    ```bash
    npm run dev 2>&1 | jq -r '.'
    ```
  - API checks:
    ```bash
    curl -fsS http://localhost:5000/api/keep | head -n 1
    curl -fsS http://localhost:5000/api/jobs/status | head -n 1
    curl -fsS http://localhost:5000/api/config | head -n 1
    ```
  - Upload + derivative generation (use a small JPG):
    - POST to upload endpoint (see README “First Steps”).
    - Verify job progress SSE stream and item updates.
    - Download asset (signed) and verify headers.
- Client smoke:
  - `cd client && npm run dev` then open http://localhost:3000
  - Create project, upload photo, see thumbnails, open viewer.
  - Verify filters/search bar render, operations menu behaves, toasts display (if implemented).
- Build artifacts:
  - Client: `cd client && npm run build && cd ..` (ensure dist generated)
  - Container (optional): `docker compose build` then `up` to check runtime.

# Stage 0 — Preconditions and Baseline
- Branch: `chore/upgrade-stage0-baseline`
- Actions:
  - Confirm current state: `npm outdated` at repo root and in `client/`.
  - Ensure `README.md`, `PROJECT_OVERVIEW.md`, `SECURITY.md` reflect Node 22 and Vite 7 (already updated).
- Tests: Run full Test Suite.
- Rollback: N/A (no code changes).

# Stage 1 — Client minor dev-dep: @testing-library/jest-dom 6.6.4 → 6.7.0
- Branch: `chore/client-testing-library-jest-dom-6.7`
- Commands:
  ```bash
  cd client
  npm i @testing-library/jest-dom@^6.7.0
  npm audit
  ```
- Code changes: None expected.
- Tests: Client dev server + build; confirm no type/runtime issues.
- Rollback: `git reset --hard && npm ci` in `client/`.

# Stage 2 — Server fs-extra 10 → 11
- Branch: `feat/server-fs-extra-11`
- Commands:
  ```bash
  npm i fs-extra@^11.3.1
  npm audit
  ```
- Code changes:
  - Review all usages in `server/` for removed APIs (fs-extra v11 drops Node<14 support; API largely compatible with v10).
  - Prefer `await fs.ensureDir()`/`fs.rm()` semantics; verify error handling.
- Tests: Server smoke + upload flow; file ops (create dirs, move, remove) across the app.
- Rollback: `git reset --hard && npm ci`.

# Stage 3 — Express 4 → 5
- Branch: `feat/server-express-5`
- Commands:
  ```bash
  npm i express@^5.1.0
  npm audit
  ```
- Migration notes:
  - Review middleware signature changes and router error handling.
  - Validate async route handlers propagate rejections; adjust error middleware in `server/middleware/errorHandler.js` if needed.
  - Check deprecated APIs (e.g., `res.render` unused; body-parser is built-in behavior differences).
- Code changes:
  - Audit `server/routes/*.js`, `server.js` app setup, and error-handling order.
- Tests:
  - All API endpoints happy-path + error-path.
  - SSE endpoints continue streaming without warnings.
- Rollback: `git reset --hard && npm ci`.

# Stage 4 — archiver 5 → 7
- Branch: `feat/server-archiver-7`
- Commands:
  ```bash
  npm i archiver@^7.0.1
  npm audit
  ```
- Migration notes:
  - Confirm archive creation API in any download/zip endpoints.
  - Replace deprecated options; ensure proper stream error handling.
- Tests:
  - Trigger ZIP creation (bulk download) and verify archive integrity.
- Rollback: `git reset --hard && npm ci`.

# Stage 5 — better-sqlite3 9 → 12
- Branch: `feat/server-better-sqlite3-12`
- Commands:
  ```bash
  npm i better-sqlite3@^12.2.0
  npm audit
  ```
- Migration notes:
  - Native module rebuild required; ensure build tooling present in CI and Docker.
  - Review any changed defaults (busyTimeout, pragmas). Confirm prepared statements API remains compatible in `server/services/repositories/`.
  - Verify WAL mode and pragmas set as expected in `server/services/config.js` or database init code.
- Tests:
  - Full CRUD across repositories, concurrent write scenarios, long-running worker loops.
  - Import/upload producing DB writes; verify performance and no deadlocks.
- Rollback: `git reset --hard && npm ci`.

# Stage 6 — Client @testing-library/user-event 13 → 14
- Branch: `feat/client-testing-library-user-event-14`
- Commands:
  ```bash
  cd client
  npm i @testing-library/user-event@^14.6.1
  npm audit
  ```
- Migration notes:
  - API changes around `type`, `click`, and pointer events. Update any tests or ad-hoc scripts if present.
- Tests: Client dev + build; any test harnesses.
- Rollback: `git reset --hard && npm ci` in `client/`.

# Stage 7 — Client web-vitals 2 → 5
- Branch: `feat/client-web-vitals-5`
- Commands:
  ```bash
  cd client
  npm i web-vitals@^5.1.0
  npm audit
  ```
- Migration notes:
  - Import paths and metric APIs changed in v3+. If used, adjust initialization accordingly (often optional in production builds).
- Tests: Build size/regression; confirm no runtime warnings.
- Rollback: `git reset --hard && npm ci` in `client/`.

# Stage 8 — TailwindCSS 3 → 4 (largest front-end migration)
- Branch: `feat/client-tailwind-4`
- Commands:
  ```bash
  cd client
  npm i tailwindcss@^4.1.12
  npx tailwindcss init -p  # if config needs regeneration
  ```
- Migration notes:
  - Follow the official Tailwind 4 Migration Guide.
  - Review breaking changes: config structure, default content scanning, plugin compat, class name or preset changes.
  - Update `client/src/styles/` and Tailwind config accordingly.
- Tests:
  - Visual pass of all major screens: Project grid, filter panel, viewer, modals, toasts.
  - Build and verify Purge/Content scanning keeps necessary classes.
- Rollback: `git reset --hard && npm ci` in `client/`.

# CI/CD Considerations
- Ensure CI uses Node 22 and has build tools for `better-sqlite3`.
- Add a temporary matrix job to run server and client builds per stage.
- For Docker: confirm base image `node:22-bookworm-slim` and that `libvips` for `sharp` remains installed.

# Communication & Documentation
- Open one PR per stage with:
  - Summary of changes and risks
  - Exact commands run
  - Migration notes and links to upstream guides
  - Test evidence (logs/screenshots)
- Update `README.md` when Tailwind 4 migration completes.
- Update `SECURITY.md` only if new config/env/security implications arise.
- No changes to `JOBS_OVERVIEW.md` expected.

# Rollback Strategy
- Each stage isolated in its own branch and PR.
- If a stage fails tests, revert PR or force-push branch to previous commit.
- Always `npm ci` after rollback to restore lockfile state.

# Appendix: Quick Commands
```bash
# Check outdated (root and client)
npm outdated || true
(cd client && npm outdated || true)

# Clean installs and audits
npm ci && npm audit
(cd client && npm ci && npm audit)

# Run servers
npm run dev 2>&1 | jq -r '.'
(cd client && npm run dev)

# Build
(cd client && npm run build)
```
