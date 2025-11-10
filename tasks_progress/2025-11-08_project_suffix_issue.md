# Project URL Suffix Loading Issue (2025-11-08)

## Summary
- Investigated report that visiting `/Iceland%20July%202025` fails to load photos when the actual folder is suffixed (`"Iceland July 2025 (2)"`).
- Confirmed root cause: initialization relied on exact folder match and did not reconcile human-readable duplicates that receive `" (n)"` suffixes.
- Added normalized folder fallback in `useAppInitialization` so URL-derived folders map to canonical suffixed folders and update the SPA state/URL once the project list loads.
- No backend changes required; issue resolved entirely in frontend initialization logic.

## Testing
- Manual sanity check: ensure logic aligns view filter with canonical folder when normalized folder matches.
- Automated tests not run (hook change only).
