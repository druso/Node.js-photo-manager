# Milestone 5: Tying It Together — Linking UI

- **Reference**: `tasks_new/user_auth.md`, `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`
- **Purpose**: Integrate shared link management into core photo browsing experiences, enabling admins to assign/remove photos from shared links directly from grids and detail panels while keeping the UI seamless.
- **Outcome**: Action menus and photo viewer offer "Share" flows mirroring `Move to…` UX, supporting multi-link selection, creation of new links, and auditing/removal—all backed by Milestones 3–4 APIs.

## Step-by-step plan
- **Step 1 — Action menu integration**
  - Add "Share" entry to photo selection action menu in `App.jsx` (or relevant component) alongside existing move/keep/tag actions.
  - Trigger modal reused from Milestone 4 (create/assign modal) with multi-select support and ability to create new link inline.
  - **Tests**: Manual verification selecting multiple photos; component tests ensuring modal opens with correct selection state.

- **Step 2 — Viewer detail controls**
  - In photo viewer detail panel, add buttons "Add to public link" and "Audit public links" per spec.
  - Reuse the same modal for adding; create audit modal listing current links with checkboxes to remove membership.
  - **Tests**: Manual QA toggling membership from viewer; React tests covering modal state transitions.

- **Step 3 — API wiring for batch operations**
  - Ensure front-end actions call batch endpoints (e.g., `POST /api/public-links/:id/photos` with array of photo IDs) and removal endpoint (e.g., `DELETE /api/public-links/:id/photos` with payload of photo IDs).
  - Add client API helpers (`client/src/api/publicLinksApi.js`) handling optimistic updates and concurrency.
  - **Tests**: Supertest verifying batch endpoints; client tests mocking API responses.

- **Step 4 — UI feedback & optimistic updates**
  - Display toasts for success/failure, similar to move modal behavior.
  - Update local photo state to reflect new visibility badges (if needed) and link counts without full refetch.
  - **Tests**: Manual QA ensuring selection persists and UI updates seamlessly; unit tests for reducer/state management.

- **Step 5 — Multi-link creation & selection UX**
  - Modal should support selecting multiple existing links and creating new ones on the fly (chip-style or multi-select list).
  - Validate input, ensure new link creation triggers backend create endpoint before association.
  - **Tests**: UI tests verifying multiple selection, validation errors, and new link creation flow.

- **Step 6 — Accessibility & keyboard support**
  - Ensure modals trap focus, support keyboard navigation, and provide clear labels.
  - **Tests**: Accessibility audit (storybook/testing-library) to confirm tab order and aria attributes.

- **Step 7 — Edge cases & consistency**
  - Handle cases where some selected photos are private (warn that public users won’t see them until made public).
  - Gracefully handle server errors (link deleted while modal open, etc.).
  - **Tests**: Manual scenarios and unit tests simulating error responses.

## Acceptance criteria
- Action menu and viewer detail panels allow admins to add/remove photos from multiple shared links, create new links, and audit existing memberships.
- UI stays consistent with move modal UX, providing clear success/error feedback and preserving selections.
- Batch operations handled efficiently via backend APIs; private photo warnings displayed.
- Accessibility standards met for new modals.
- Automated tests cover client helpers, modals, and backend endpoints; manual regression confirms seamless workflow.

## Post-milestone documentation
- Update `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md`, and `README.md` to reflect end-to-end shared link workflow, UI entry points, and security considerations for public sharing.