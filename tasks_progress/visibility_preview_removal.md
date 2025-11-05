# Visibility Preview Removal (2025-11-05)

## Summary
- Removed preview buttons from the Operations menu so only "Apply" visibility actions remain.
- Simplified `useVisibilityMutation` to drop preview/dry-run state and invocation paths.
- Updated client API to stop sending `dry_run` payloads for visibility changes.
- Removed dry-run handling from `/api/photos/visibility` route and associated test coverage.
- Updated README and PROJECT_OVERVIEW documentation to reflect the simplified endpoint behavior.

## Testing
- `npm run lint -- --max-warnings=0`
