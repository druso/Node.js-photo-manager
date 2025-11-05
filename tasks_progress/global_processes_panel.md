# Global Processes Panel Update

## Summary
- Reproduced issue where the Processes drawer in All Photos view queried `/api/projects/__all__/jobs`, producing 404.
- Switched server routes to expose `/api/jobs` for tenant-wide listings using `DEFAULT_USER`.
- Updated client API (`jobsApi`) and `ProcessesPanel` to consume the tenant-wide endpoint and removed per-project dependency.
- Confirmed hamburger menu flows and Settings drawer embed reuse the unified panel without needing a project folder.

## Testing
- Manual: Loaded Processes panel from All Photos view; confirmed job list renders without network errors and SSE updates continue streaming.
- Manual: Loaded panel from project Settings drawer to ensure embedded mode works after prop removal.
