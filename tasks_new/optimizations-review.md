# Implementation Plan - Codebase Cleanup and Optimization

## Goal Description
Remove identified dead code, deprecated endpoints, and unused files to improve codebase health and maintainability.

## User Review Required
> [!WARNING]
> **Breaking Change**: The legacy SSE endpoint `/api/sse/pending-changes` will be removed. Ensure no external tools rely on this. The client has been verified to use the new `/api/sse/stream` endpoint via `sseClient.js`.

## Proposed Changes

### Server Cleanup

#### [DELETE] [logger.js](file:///home/druso/code/Node.js%20photo%20manager/server/utils/logger.js)
- Remove unused global console patcher. Superseded by `logger2.js`.

#### [MODIFY] [server.js](file:///home/druso/code/Node.js%20photo%20manager/server.js)
- Remove commented out require of `logger.js`.

#### [MODIFY] [sse.js](file:///home/druso/code/Node.js%20photo%20manager/server/routes/sse.js)
- Remove the deprecated `/pending-changes` endpoint.
- Remove legacy connection tracking logic associated with it.

### Client Cleanup

#### [DELETE] [PhotoGridView.jsx](file:///home/druso/code/Node.js%20photo%20manager/client/src/components/PhotoGridView.jsx)
- Remove empty file. Functionality replaced by `VirtualizedPhotoGrid.jsx`.

## Verification Plan

### Automated Tests
- Run `npm test` to ensure no regressions in server logic.
- Run `npm run test:coverage` to verify safe removal.

### Manual Verification
- **Verify SSE**: Launch the app and confirm real-time updates (e.g., upload a photo and watch processing status) still work via the `/stream` endpoint.
- **Verify Logs**: Check server logs to ensure no "module not found" errors for `logger.js`.
