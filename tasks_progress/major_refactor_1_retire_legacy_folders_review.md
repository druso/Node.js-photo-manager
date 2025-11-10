# Major Refactor 1 Plan Review (2025-11-08)

## Context
- Task: Validate "Major Refactoring Task 1: Retire Legacy Folder ID Assumptions" plan after the test process refactor.
- References consulted: project_docs/PROJECT_OVERVIEW.md, project_docs/TESTING_OVERVIEW.md, README.md, server/utils/projects.js, server/routes/projects.js, server/routes/__tests__/projectsCreate.test.js.

## Findings
1. **Core refactor scope** remains valid: `isLegacyProjectFolder` removal and simplified validation in `isCanonicalProjectFolder` still align with current code and sanitized folder requirements.
- 2025-11-08: Investigated project rename 404; confirmed maintenance worker handles folder alignment post-rename and updated Settings panel to call folder-based rename endpoint.
2. **Testing guidance needs updates**:
   - Plan references Jest-style `expect` API; current node:test suites use `assert` helpers.
   - Suggested unit test path `server/utils/__tests__/` exists but is empty; acceptable, yet plan should clarify to create new node:test suite and leverage shared helpers when filesystem access needed.
   - Integration tests should explicitly mention using `createFixtureTracker()` and token helpers per new isolation contract.
3. **Documentation updates** listed remain necessary: `p<id>` references persist in PROJECT_OVERVIEW.md, SCHEMA_DOCUMENTATION.md, README.md, SECURITY.md.

## Recommendations
- Revise testing section of plan to:
  - Provide node:test `assert` examples.
  - Reference helper utilities from `server/tests/utils/dataFixtures.js`.
  - Note reliance on `.projects-test/` isolation and seeded fixtures for integration cases.
- Keep remainder of plan intact; execution steps and success criteria still apply.

## Next Steps
- Update plan markdown accordingly.
- Implement code changes per plan once validated.
- After development, follow documentation + SECURITY.md update workflow per user rules.
