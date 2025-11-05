# Test Cleanup Review (2025-11-05)

## Scope
- Investigated artifacts left behind by `npm test`, focusing on project creation and shared link fixtures.
- Surveyed server route tests and auth service tests for cleanup coverage and potential redundancies.

## Findings
- Public/shared link suites (`sharedLinks.test.js`, `publicLinks.test.js`, `photosPublicLink.test.js`) already track created project and link IDs and remove related DB rows and project folders in `cleanupTestData()`.
- Asset visibility and commit handler suites seed data manually but register teardown callbacks or explicit cleanup logic; no persistent projects or files remain after tests run.
- Auth route/config/token tests operate entirely in-memory and leave no filesystem artifacts.
- Only gap discovered: the public link creation test did not add the created ID to the tracked list, so teardown skipped it.

## Actions
- Updated the public link creation test to push the created link ID into `createdData.linkIds` to ensure the shared cleanup removes it.

## Recommendations
- Consider refactoring repeated `cleanupTestData`/`seedTestData` helpers into a shared test utility to avoid drift across suites.
- Add periodic checks (e.g., in CI) to assert `.projects/user_0` and `.db/user_0.sqlite` snapshots remain unchanged before/after the test suite, catching new leaks early.
- Future shared link tests should continue using the tracked ID pattern when creating records via HTTP APIs to guarantee cleanup.
