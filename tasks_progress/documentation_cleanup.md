# Documentation Cleanup – 2025-11-05

## Context
- Legacy `ARCHITECTURE.md` at repo root duplicated canonical docs in `project_docs/`
- Goal: consolidate reference material in the authoritative docs per project policy

## Actions
1. Reviewed root `ARCHITECTURE.md` vs `project_docs/PROJECT_OVERVIEW.md` and `SCHEMA_DOCUMENTATION.md`
2. Migrated unique filesystem, scheduler cadence, and troubleshooting notes into `PROJECT_OVERVIEW.md`
3. Replaced `ARCHITECTURE.md` with a pointer directing readers to canonical docs
4. Removed duplicate root `SCHEMA_DOCUMENTATION.md` content, replacing it with a pointer to `project_docs/SCHEMA_DOCUMENTATION.md`
5. Synced canonical schema doc with latest folder alignment, manifest version, and EXIF fallback behavior

## Follow-ups
- Keep `project_docs/` as the single source of truth for architecture details
- Update this log whenever documentation consolidation tasks are performed
