## Summary
- **Overall** — Backend auth flow is close, but a few security-hardening gaps remain. Frontend gating is mostly correct; some API clients still bypass the auth helper.

## Required fixes
- **protect all admin fetches** — `client/src/components/Settings.jsx` still calls `fetch('/api/config…')` directly. Replace these with `authFetch` so config mutations include credentials and Authorization header. Scan for other raw `fetch` calls hitting `/api/` (e.g., `client/src/api/jobsApi.js`) and migrate or document why they are exempt. Milestone spec required all admin API calls to honor the new auth flow.
- **Enforce auth on `/api/sse/pending-changes`** — In `server.js` we skip auth middleware for any path beginning with `/sse`, yet the router later mounts `app.use('/api/sse', authenticateAdmin, sseRouter)`. Because of the earlier guard, `authenticateAdmin` never runs, leaving the SSE endpoint public. Adjust the exclusion or restructure mounts so `/api/sse/*` requires authentication as intended.
- **Handle cookie-less login attempts** — `POST /api/auth/login` and `/refresh` assume `cookie-parser` populated `req.cookies`. Add tests covering missing cookies and verify we clear cookies + return 401 when refresh token absent or invalid. (Currently happy path works, but spec asked for coverage on failures.)
- **SSE client auth** — `client/src/hooks/usePendingChangesSSE.js` opens `EventSource('/api/sse/pending-changes')` without credentials. After securing the endpoint, force credentialed requests (e.g., append `?access_token=` or switch to `EventSourcePolyfill` with headers) to avoid 401 loops.

## Nice-to-have follow-ups
- **Token rotation telemetry** — Consider logging `sub`/`jti` when issuing tokens to aid troubleshooting and potential future multi-admin support.
- **Docs pass** — Update `PROJECT_OVERVIEW.md` and `SECURITY.md` sections for SSE auth expectations once the fixes land.