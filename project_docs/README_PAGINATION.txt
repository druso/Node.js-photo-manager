IMPORTANT: Pagination Implementation Notes
==========================================

The pagination system has critical implementation requirements that must be maintained.

See PAGINATION_IMPLEMENTATION.md in this directory for complete details.

Quick Reference:
- Backend must ALWAYS return prevCursor when cursor parameter is present
- Frontend loadInitial must use loading lock to prevent concurrent calls
- Pagination status must reset via two paths (with/without scroll anchor)
- Scroll anchor effect must depend on [photos, totalHeight] not [photos.length, totalHeight]

Bug fixes documented in /tasks_progress/PAGINATION_FIX.md (October 2025)
