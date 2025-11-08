# Testing Overview

## Running Tests
- `npm test` — run the entire test suite serially (node --test with concurrency=1 to preserve isolation)
- `npm test -- server/routes/__tests__/projectsDelete.test.js` — run an individual suite by path
- `npm test -- --test-name-pattern="upload"` — filter by test name (regex)
- `npm run test:coverage` — generate HTML + text coverage reports via c8
- `npm run test:coverage:ci` — generate text-summary coverage for CI pipelines
- `NODE_ENV=test` must be set; the default scripts handle this automatically
- Export admin auth secrets before running (`AUTH_ADMIN_BCRYPT_HASH`, `AUTH_JWT_SECRET_ACCESS`, `AUTH_JWT_SECRET_REFRESH`)

## Test Isolation Contract
- Tests create temporary projects under `.projects-test/user_0/`
- SQLite database lives at `.db/photo_manager.test.db` (WAL mode enabled)
- Use `createFixtureTracker()` from `server/tests/utils/dataFixtures.js` to register folders, projects, links, and clean them up automatically in `afterEach`
- `withAuthEnv()` (in `server/services/auth/__tests__/testUtils.js`) provides isolated auth secrets per test run
- Avoid writing to `.projects/` or `.db/photo_manager.sqlite`; suites should never touch production directories

## Recommended Helpers
- `seedProjectWithFixtures(tracker, seedOptions)` — create projects and ingest DSC0* fixtures with JPG/RAW pairs
- `issueAccessToken()` (from `auth/testUtils`) — generate admin JWTs for authenticated requests
- `createTestServer()` (from `server/routes/__tests__/testServer.js`) — boot Express with in-memory auth middleware and stubbed orchestrator
- `mockTasksOrchestrator()` and `mockJobsRepo()` — pattern for stubbing background jobs to capture payloads without triggering workers

## Bulk & Lifecycle Patterns
- Bulk suites use `postJson(app, url, body)` helper to simplify supertest payloads
- Always assert both response shape and repository state (DB queries via repos, filesystem via `fs.existsSync`/`fs.readFileSync`)
- Dry-run tests assert that `dry_run` payloads leave state unchanged but return preview data
- Lifecycle suites (create/update/delete) verify manifest writes via `readProjectManifest(folder)` and repository state via `projectsRepo.getByFolder`

## Fixture Inventory
- `DSC02215` (Portrait) — JPG + ARW pair, used for keep/visibility tests
- `DSC03890` (Landscape) — JPG + ARW pair, used for bulk move/process tests
- `DSC04021` (Landscape) — JPG only, used for cross-project conflict tests
- `DSC04111` (RAW only) — ARW only, used for completion conflict scenarios

## Coverage Expectations
- Security boundaries (authentication, authorization): 100%
- CRUD endpoints (projects, photos, tags): ≥90%
- Background orchestration (job enqueue flows): ≥80%
- Edge cases (dry runs, cross-project payloads, validation errors): ≥70%

## Continuous Integration
- CI runs `npm test` on every push/PR; ensure suites stay under 20 minutes total runtime
- Isolation checks fail the build if `.projects/` or production DB files change during tests
- Artifacts: CI uploads `logs/test-output.json` with compact node --test reports

## Adding New Suites
1. Place new test files under appropriate feature folder inside `server/routes/__tests__/`
2. Require helpers from `server/routes/__tests__/helpers/` when available before creating new utilities
3. Use descriptive `describe` blocks that mirror API endpoints (e.g., `describe('POST /api/photos/tags/add', ...)`)
4. Keep test runtime deterministic: avoid `setTimeout`, prefer direct repo checks
5. Update `tasks_progress/test_isolation_and_critical_coverage.md` after landing new suites

## Troubleshooting Failing Tests
- Run with `DEBUG=1 npm test -- <file>` to get verbose repo logging (helpers respect DEBUG env)
- Use `node --test --watch` for rapid iteration (requires Node 22.6+)
- If manifests persist unexpectedly, call `tracker.cleanupNow()` within the test to inspect failures before teardown
- Ensure orchestrator stubs are synchronous (`startTaskStub.mockImplementation(({ onComplete }) => onComplete())`) when tests expect immediate resolution

## Future Enhancements (Phase 6)
- Extend fixtures to include visibility variations (public/private) for asset access tests
- Add CLI recipe for running targeted suites via `npm test -- --test-name-pattern="bulk"`
