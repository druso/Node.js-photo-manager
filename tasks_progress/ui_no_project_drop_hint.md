# UI Update: Hide Drop Hint When No Projects Exist

- **Date**: 2025-11-16
- **Context**: Align empty state copy by hiding the drag-and-drop hint when the user has no projects.
- **Changes**:
  - Threaded a `showEmptyDropHint` flag through `MainContentRenderer`, `AllPhotosPane`, and `PhotoDisplay` to Virtualized grid/table views.
  - Disable the empty drop hint when the project list is empty.
- **Testing**: Manual verification pending (UI change only).
